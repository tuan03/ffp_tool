"""Task 01/02 lease verification: existing local PostgreSQL, disposable schema.

Run from the repository: python scripts/audits/audit_lease_baseline.py
For Task 02: add --expect current-lease. Baseline mode expects pre-fix behavior.
Never changes runtime code, public tables, container state, or PostgreSQL settings.
"""
from __future__ import annotations

import json
import argparse
import re
import subprocess
import sys
import uuid
from datetime import timedelta
from pathlib import Path

from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.engine import URL

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src/modules/amazon-crawler"))

from engine.distributed.coordinator_models import (  # noqa: E402
    Base, CrawlTask, CrawlProductItem, TaskAttempt, TaskResult, create_session_factory,
)
from engine.distributed.coordinator_store import CoordinatorStore  # noqa: E402
from engine.distributed.protocol import payload_checksum, utc_now  # noqa: E402


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def local_test_url() -> URL:
    # Read credentials in memory only; never print Docker inspect or the URL.
    response = subprocess.run(
        ["docker", "inspect", "ffp-local-postgres"],
        check=True, capture_output=True, text=True,
    )
    container = json.loads(response.stdout)[0]
    require(container["State"]["Running"], "Local PostgreSQL is not running")
    bindings = container["NetworkSettings"]["Ports"].get("5432/tcp") or []
    binding = next((entry for entry in bindings if entry["HostIp"] == "127.0.0.1"), None)
    require(binding is not None, "Require an existing loopback-only PostgreSQL binding")
    environment = dict(entry.split("=", 1) for entry in container["Config"]["Env"] if "=" in entry)
    return URL.create(
        "postgresql+psycopg", username=environment["POSTGRES_USER"],
        password=environment.get("POSTGRES_PASSWORD"), host="127.0.0.1",
        port=int(binding["HostPort"]), database=environment.get("POSTGRES_DB", environment["POSTGRES_USER"]),
    )


def characterize(engine, run_number: int, expectation: str) -> None:
    sessions = create_session_factory(engine)
    store = CoordinatorStore(sessions)
    job = store.create_job({"urls": ["B0FR4MSS2H"]})
    for client_id in ("audit-a", "audit-b"):
        store.register_client({
            "clientId": client_id, "displayName": client_id,
            "availableSlots": 1, "maxConcurrentInputs": 1,
            "capabilities": {"amazon": True},
        })
    first = store.lease_tasks("audit-a", 1)[0]
    with sessions.begin() as session:
        task = session.get(CrawlTask, first["taskId"])
        require(task is not None and task.assigned_client_id == "audit-a", "A must own first lease")
        task.lease_expires_at = utc_now() - timedelta(seconds=1)
    if expectation == "current-lease":
        expired = store.accept_result(
            first["taskId"], "audit-a", first["leaseId"], "fixture-checksum",
            {"jobId": job["id"], "products": []},
        )
        require(expired["status"] == "stale", "Expired lease must be rejected even before reaper")
        print(f"RUN {run_number}: expired A before reaper=stale")
    reaped = store.reap_expired()
    require(reaped["requeuedTasks"] == 1, "Exactly one expired task must be requeued")
    second = store.lease_tasks("audit-b", 1)[0]
    require(first["taskId"] == second["taskId"], "B must receive the same task")
    require(first["leaseId"] != second["leaseId"], "B must receive a new lease")
    with sessions() as session:
        task = session.get(CrawlTask, first["taskId"])
        require(task.assigned_client_id == "audit-b" and task.lease_id == second["leaseId"], "B must be current owner")
    print(f"RUN {run_number}: A expired -> requeued -> B owns a different lease")

    payload_a = {"jobId": job["id"], "products": [], "auditSource": "A"}
    payload_b = {"jobId": job["id"], "products": [], "auditSource": "B"}
    response_a = store.accept_result(first["taskId"], "audit-a", first["leaseId"], payload_checksum(payload_a), payload_a)
    if expectation == "current-lease":
        with sessions() as session:
            task = session.get(CrawlTask, first["taskId"])
            require(task.status == "leased" and task.lease_id == second["leaseId"], "Rejected A must leave B's lease untouched")
            require(session.get(TaskResult, first["taskId"]) is None, "Rejected A must not persist a result")
    response_b = store.accept_result(second["taskId"], "audit-b", second["leaseId"], payload_checksum(payload_b), payload_b)
    print(f"RUN {run_number}: late A={response_a['status']}; current B={response_b['status']}")
    is_current = expectation == "current-lease"
    require(response_a["status"] == ("stale" if is_current else "accepted"), "Unexpected late A response")
    require(response_b["status"] == ("accepted" if is_current else "duplicate"), "Unexpected current B response")
    if is_current:
        retry = store.accept_result(second["taskId"], "audit-b", second["leaseId"], payload_checksum(payload_b), payload_b)
        late_retry = store.accept_result(first["taskId"], "audit-a", first["leaseId"], payload_checksum(payload_a), payload_a)
        require(retry["status"] == "duplicate", "Lost-ACK retry must stay idempotent")
        require(late_retry["status"] == "stale", "Old writer must not receive another writer's ACK")
        print(f"RUN {run_number}: B retries after completion=duplicate; late A retries=stale")
    with sessions() as session:
        task = session.get(CrawlTask, first["taskId"])
        results = list(session.scalars(select(TaskResult)))
        attempts = list(session.scalars(select(TaskAttempt).order_by(TaskAttempt.leased_at)))
        winner = "B" if is_current else "A"
        require(len(results) == 1 and results[0].client_id == f"audit-{winner.lower()}", "Unexpected result writer or count")
        require(results[0].payload["auditSource"] == winner, "Wrong stored payload")
        require(task.status == "completed" and task.lease_id == (second if is_current else first)["leaseId"], "Wrong completed task lease")
        require(len(attempts) == 2, "Both attempts must remain")
        require(attempts[0].status == ("abandoned" if is_current else "completed"), "Wrong A attempt state")
        require(attempts[1].status == ("completed" if is_current else "leased"), "Wrong B attempt state")
        print(f"RUN {run_number}: task=completed, stored result={winner}, count=1; attempts A={attempts[0].status} B={attempts[1].status}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--expect", choices=("baseline", "current-lease"), default="baseline")
    parser.add_argument("--streaming", action="store_true", help="Verify Task 03 instead of final-result baseline")
    arguments = parser.parse_args()
    expectation = arguments.expect
    url = local_test_url()
    admin = create_engine(url, connect_args={"connect_timeout": 5}, hide_parameters=True)
    try:
        for run_number in (1, 2):
            schema = "ffp_audit01_" + uuid.uuid4().hex
            require(re.fullmatch(r"ffp_audit01_[0-9a-f]{32}", schema) is not None, "Unsafe schema name")
            engine = None
            created = False
            try:
                with admin.begin() as connection:
                    connection.execute(text(f'CREATE SCHEMA "{schema}"'))
                created = True
                print(f"RUN {run_number}: created isolated schema {schema}")
                engine = create_engine(
                    url, connect_args={"options": f"-csearch_path={schema}", "connect_timeout": 5},
                    hide_parameters=True,
                )
                with engine.connect() as connection:
                    require(connection.execute(text("SELECT current_schema()")).scalar() == schema, "Wrong schema")
                    print("backend=postgresql; search_path excludes public")
                require(not inspect(engine).get_table_names(), "Test schema must start empty")
                Base.metadata.create_all(engine)
                if arguments.streaming:
                    verify_streaming(engine, run_number)
                else:
                    characterize(engine, run_number, expectation)
            finally:
                if engine is not None:
                    engine.dispose()
                if created:
                    # Exact generated schema, created by this run only. Never public.
                    with admin.begin() as connection:
                        connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
                    with admin.connect() as connection:
                        remains = connection.execute(text("SELECT 1 FROM pg_namespace WHERE nspname=:name"), {"name": schema}).scalar()
                    require(remains is None, "Test schema cleanup failed")
                    print(f"RUN {run_number}: own test schema removed and absence verified")
    finally:
        admin.dispose()
    if arguments.streaming:
        print("PASS: current-lease product streaming verified twice; other mutation paths remain outside Task 03.")
    elif expectation == "baseline":
        print("PASS: baseline reproduced twice; spec current-lease-only remains NOT MET. No runtime fix applied.")
    else:
        print("PASS: current-lease final result verified twice; product streaming and other mutation paths are NOT covered.")


def verify_streaming(engine, run_number: int) -> None:
    sessions = create_session_factory(engine)
    store = CoordinatorStore(sessions)
    job = store.create_job({"urls": ["B0FR4MSS2H"]})
    for client_id in ("audit-a", "audit-b"):
        store.register_client({"clientId": client_id, "displayName": client_id,
                               "availableSlots": 1, "maxConcurrentInputs": 1})
    first = store.lease_tasks("audit-a", 1)[0]
    payload = {"jobId": job["id"], "product": {"id": "fixture-product", "title": "Current B"}}

    def upload(lease, client_id):
        return store.accept_product(lease["taskId"], client_id, lease["leaseId"],
                                    "fixture-product", payload_checksum(payload), payload)

    with sessions.begin() as session:
        session.get(CrawlTask, first["taskId"]).lease_expires_at = utc_now() - timedelta(seconds=1)
    require(upload(first, "audit-a")["status"] == "stale", "Expired A must not stream before reaper")
    store.reap_expired()
    second = store.lease_tasks("audit-b", 1)[0]
    require(upload(first, "audit-a")["status"] == "stale", "Reassigned A must not stream")
    with sessions() as session:
        require(not list(session.scalars(select(CrawlProductItem))), "Stale A created a pipeline item")
        require(session.get(CrawlTask, first["taskId"]).lease_id == second["leaseId"], "Stale A changed current lease")
    require(upload(second, "audit-b")["status"] == "accepted", "Current B must stream")
    require(upload(second, "audit-b")["status"] == "duplicate", "B retry must not duplicate item")
    payload["product"]["title"] = "Stale overwrite"
    require(upload(first, "audit-a")["status"] == "stale", "Old A must not overwrite B")
    with sessions() as session:
        items = list(session.scalars(select(CrawlProductItem)))
        require(len(items) == 1 and items[0].raw_payload["title"] == "Current B", "Stored product changed")
        require(items[0].client_id == "audit-b", "Wrong product owner")
    print(f"RUN {run_number}: expired A=stale; reassigned A=stale; B=accepted; retry B=duplicate; late overwrite A=stale; pipeline items=1 (B)")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Database errors can include connection details: do not dump credentials.
        print(f"FAIL: {type(error).__name__}; inspect locally without publishing connection secrets.", file=sys.stderr)
        sys.exit(1)
