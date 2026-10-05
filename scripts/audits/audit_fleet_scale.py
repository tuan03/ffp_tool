"""Five-process local Coordinator load gate on a disposable PostgreSQL schema.

The audit runs fixture-only crawler work. It starts one loopback-only Coordinator
and five real DistributedCrawlerAgent processes with a deterministic fake crawler.
It never touches the application's public schema or external Amazon/Shopify APIs.
"""
from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from urllib.request import Request, urlopen

from sqlalchemy import create_engine, func, select, text
from sqlalchemy.engine import URL

ROOT = Path(__file__).resolve().parents[2]
ENGINE_ROOT = ROOT / "src/modules/amazon-crawler"
sys.path.insert(0, str(ENGINE_ROOT))
sys.path.insert(0, str(ROOT / "scripts/audits"))

from audit_lease_baseline import local_test_url, require  # noqa: E402
from engine.distributed.coordinator_migrations import migrate_coordinator  # noqa: E402
from engine.distributed.coordinator_models import (  # noqa: E402
    Base, ClientRecord, CrawlTask, TaskAttempt, TaskResult, create_session_factory,
)

AGENT_COUNT = 5
DEFAULT_TASKS = 100


class FixtureCrawler:
    """Deterministic crawler substitute; it performs no network or commerce I/O."""

    def __init__(self, *, root, settings, progress, cancel_event, proxy_config_path, **_kwargs):
        self.browser_pool = type("Pool", (), {"close": lambda _self: None})()

    def run(self, *, job_id, sources, on_input_complete, on_product_complete, write_export, **_kwargs):
        for source in sources:
            if not source.rsplit("/", 1)[-1]:
                continue
            time.sleep(0.25)
            on_input_complete({
                "source": source, "asin": source.rsplit("/", 1)[-1], "status": "completed",
                "products": [], "errors": [], "warnings": [], "durationMs": 40,
                "completedAt": "2026-10-05T00:00:00+00:00",
            })


def reserve_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, int((len(ordered) - 1) * fraction))], 2) if ordered else 0.0


def process_agent(index: int, server_url: str, data_root: Path) -> subprocess.Popen:
    command = [sys.executable, str(Path(__file__).resolve()), "--agent-worker", str(index), server_url, str(data_root)]
    return subprocess.Popen(command, cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                            env={**os.environ, "PYTHONPATH": str(ENGINE_ROOT)})


def agent_worker(index: int, server_url: str, data_root: Path) -> int:
    from engine.distributed import client_agent
    from engine.distributed.client_agent import DistributedCrawlerAgent
    from engine.distributed.client_config import AgentConfig
    from engine.distributed.protocol import AgentLimits

    agent = DistributedCrawlerAgent(
        project_root=data_root / f"agent-{index}",
        config=AgentConfig(server_url=server_url, display_name=f"scale-agent-{index}",
                           max_concurrent_inputs=2, limits=AgentLimits(),
                           data_directory=data_root / f"agent-{index}"),
        crawler_factory=FixtureCrawler,
    )
    return_code = 0
    try:
        import asyncio
        asyncio.run(agent.run())
    except KeyboardInterrupt:
        return_code = 0
    return return_code


def main() -> int:
    if len(sys.argv) > 1 and sys.argv[1] == "--agent-worker":
        return agent_worker(int(sys.argv[2]), sys.argv[3], Path(sys.argv[4]))
    tasks = int(os.environ.get("FFP_SCALE_AUDIT_TASKS", str(DEFAULT_TASKS)))
    require(1 <= tasks <= 200, "FFP_SCALE_AUDIT_TASKS must be between 1 and the 200-input Coordinator job limit")
    url = local_test_url()
    admin = create_engine(url, connect_args={"connect_timeout": 5}, hide_parameters=True)
    schema = "ffp_audit01_" + uuid.uuid4().hex
    engine = None
    created = False
    coordinator = None
    agents: list[subprocess.Popen] = []
    logs = None
    log_handle = None
    image_cache = None
    agent_root_path = None
    try:
        with admin.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        created = True
        scoped_url = url.set(query={**url.query, "options": f"-csearch_path={schema}"})
        engine = create_engine(scoped_url, connect_args={"connect_timeout": 5}, hide_parameters=True)
        require(engine.connect().execute(text("SELECT current_schema()")).scalar() == schema,
                "Disposable schema search_path check failed")
        migrate_coordinator(engine)

        port = reserve_port()
        server_url = f"http://127.0.0.1:{port}"
        server_env = {**os.environ, "PYTHONPATH": str(ENGINE_ROOT),
                      "AMAZON_COORDINATOR_DATABASE_URL": scoped_url.render_as_string(hide_password=False)}
        logs = tempfile.TemporaryDirectory(prefix="ffp-scale-coordinator-")
        image_cache = tempfile.TemporaryDirectory(prefix="ffp-scale-images-")
        log_path = Path(logs.name) / "coordinator.log"
        log_handle = log_path.open("w", encoding="utf-8")
        server_env["IMAGE_PROCESSING_CACHE_DIR"] = str(Path(image_cache.name) / "cache")
        coordinator = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "engine.distributed.coordinator_server:app",
             "--app-dir", str(ENGINE_ROOT), "--host", "127.0.0.1", "--port", str(port), "--log-level", "error"],
            cwd=ROOT, env=server_env, stdout=log_handle, stderr=subprocess.STDOUT,
        )
        for _ in range(100):
            if coordinator.poll() is not None:
                raise RuntimeError(f"Coordinator exited during startup; see private temporary log {log_path}")
            try:
                with urlopen(f"{server_url}/api/v1/health", timeout=1) as response:
                    if response.status == 200:
                        break
            except Exception:
                time.sleep(0.1)
        else:
            raise RuntimeError("Loopback Coordinator did not become healthy")

        with tempfile.TemporaryDirectory(prefix="ffp-scale-agents-", ignore_cleanup_errors=True) as agent_root:
            agent_root_path = Path(agent_root)
            agents = [process_agent(index, server_url, Path(agent_root)) for index in range(AGENT_COUNT)]
            for _ in range(150):
                try:
                    with urlopen(f"{server_url}/api/v1/clients", timeout=2) as response:
                        connected = [client for client in json.loads(response.read())
                                     if client.get("isConnected") and client.get("readyForTasks") is True
                                     and int(client.get("availableSlots") or 0) > 0]
                    if len(connected) == AGENT_COUNT:
                        break
                except Exception:
                    pass
                if any(agent.poll() is not None for agent in agents):
                    raise RuntimeError("A fixture agent exited before all five connected")
                time.sleep(0.1)
            else:
                raise RuntimeError("Five independent fixture agents did not connect")
            # Let each process finish hello reconciliation and emit its first ready/heartbeat.
            time.sleep(3)
            identifiers = [f"B{index:09d}" for index in range(1, tasks + 1)]
            # Submit only after all five agents are connected so startup order cannot dominate fairness.
            request = Request(
                f"{server_url}/api/v1/crawl-jobs",
                data=json.dumps({"urls": [f"https://www.amazon.com/dp/{asin}" for asin in identifiers]}).encode("utf-8"),
                headers={"Content-Type": "application/json"}, method="POST",
            )
            with urlopen(request, timeout=10) as response:
                job = json.loads(response.read())
            with create_session_factory(engine)() as session:
                seeded_tasks = int(session.scalar(select(func.count()).select_from(CrawlTask)
                                                   .where(CrawlTask.job_id == job["id"])) or 0)
            require(seeded_tasks == tasks, f"Only {seeded_tasks} of {tasks} fixture tasks were created")
            start = time.perf_counter()
            max_backlog = tasks
            last_metrics = {}
            resource_peaks: dict[str, dict[str, float | int]] = {}
            while time.perf_counter() - start < 180:
                with engine.connect() as connection:
                    states = dict(connection.execute(select(CrawlTask.status, func.count())
                                                    .where(CrawlTask.job_id == job["id"])
                                                    .group_by(CrawlTask.status)).all())
                remaining = sum(count for state, count in states.items() if state not in {"completed", "failed", "cancelled"})
                max_backlog = max(max_backlog, int(states.get("queued", 0)))
                try:
                    with urlopen(f"{server_url}/api/v1/crawler-metrics?jobId={job['id']}", timeout=2) as response:
                        metrics = json.loads(response.read())
                        last_metrics = metrics.get("scheduler", {})
                        for agent in metrics.get("agents", []):
                            if not isinstance(agent, dict):
                                continue
                            name = str(agent.get("displayName") or agent.get("agentId") or "agent")
                            worker = agent.get("workerHealth") if isinstance(agent.get("workerHealth"), dict) else {}
                            resources = agent.get("resources") if isinstance(agent.get("resources"), dict) else {}
                            peak = resource_peaks.setdefault(name, {"maxRssBytes": 0, "maxCpuPercent": 0.0})
                            rss_bytes = worker.get("rssBytes") or resources.get("rssBytes") or 0
                            cpu_percent = worker.get("cpuPercent") or 0.0
                            peak["maxRssBytes"] = max(int(peak["maxRssBytes"]), int(rss_bytes))
                            peak["maxCpuPercent"] = max(float(peak["maxCpuPercent"]), float(cpu_percent))
                except Exception:
                    pass
                if states.get("completed", 0) == tasks:
                    break
                if any(agent.poll() is not None for agent in agents):
                    raise RuntimeError("A fixture agent exited before the workload completed")
                time.sleep(0.1)
            elapsed = time.perf_counter() - start
            require(states.get("completed", 0) == tasks, f"Only {states.get('completed', 0)} of {tasks} tasks completed")
            with create_session_factory(engine)() as session:
                job_task_ids = select(CrawlTask.id).where(CrawlTask.job_id == job["id"])
                attempts = list(session.scalars(select(TaskAttempt).where(TaskAttempt.task_id.in_(job_task_ids))))
                result_count = len(list(session.scalars(select(TaskResult).where(TaskResult.task_id.in_(job_task_ids)))))
                agent_names = dict(session.execute(select(ClientRecord.id, ClientRecord.display_name)
                    .where(ClientRecord.display_name.like("scale-agent-%"))).all())
                completion_counts = dict(session.execute(select(TaskAttempt.client_id, func.count())
                    .where(TaskAttempt.task_id.in_(job_task_ids), TaskAttempt.status == "completed")
                    .group_by(TaskAttempt.client_id)).all())
            with engine.connect() as connection:
                database_version = str(connection.execute(text("SHOW server_version")).scalar())
                schema_bytes = int(connection.execute(text("""
                    SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0)
                    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = current_schema() AND c.relkind IN ('r', 'm', 't')
                """)).scalar() or 0)
            per_agent = {name: int(completion_counts.get(agent_id, 0))
                         for agent_id, name in sorted(agent_names.items(), key=lambda item: item[1])}
            latencies = [(attempt.finished_at - attempt.leased_at).total_seconds() * 1000
                         for attempt in attempts if attempt.finished_at and attempt.leased_at]
            report = {
                "backend": "PostgreSQL", "databaseVersion": database_version,
                "agentProcesses": AGENT_COUNT, "tasks": tasks,
                "completed": states.get("completed", 0), "results": result_count,
                "elapsedSeconds": round(elapsed, 2), "throughputTasksPerSecond": round(tasks / elapsed, 2),
                "taskLatencyMs": {"p50": percentile(latencies, .50), "p95": percentile(latencies, .95),
                                  "p99": percentile(latencies, .99), "max": round(max(latencies, default=0), 2)},
                "maxObservedQueuedBacklog": max_backlog,
                "completedTasksByAgent": per_agent,
                "resourcePeaksByAgent": resource_peaks,
                "databaseSchemaBytes": schema_bytes,
                "finalScheduler": last_metrics,
            }
            require(result_count == tasks, "Persisted results do not match completed task count")
            require(len(per_agent) == AGENT_COUNT and all(count > 0 for count in per_agent.values()),
                    f"At least one independent agent process received no completed work: {per_agent}")
            require(not last_metrics or int(last_metrics.get("overCapacityAgents", 0)) == 0,
                    "Scheduler reported agent capacity overflow")
            print(json.dumps(report, indent=2, sort_keys=True))
            for agent in agents:
                agent.terminate()
            for agent in agents:
                agent.wait(timeout=10)
            agents = []
        return 0
    finally:
        for agent in agents:
            agent.kill()
            agent.wait()
        if coordinator is not None:
            coordinator.terminate()
            try:
                coordinator.wait(timeout=10)
            except subprocess.TimeoutExpired:
                coordinator.kill()
                coordinator.wait()
        if log_handle is not None:
            log_handle.close()
        if agent_root_path is not None:
            shutil.rmtree(agent_root_path, ignore_errors=True)
        if logs is not None:
            logs.cleanup()
        if image_cache is not None:
            image_cache.cleanup()
        if engine is not None:
            engine.dispose()
        if created:
            with admin.begin() as connection:
                connection.execute(text(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE'))
            with admin.connect() as connection:
                require(connection.execute(text("SELECT schema_name FROM information_schema.schemata WHERE schema_name=:schema"),
                                           {"schema": schema}).scalar() is None,
                        "Disposable audit schema was not removed")
        admin.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
