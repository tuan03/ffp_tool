"""Isolated Task 10 transport/recovery scenario; never crawl external sites."""
from __future__ import annotations

import asyncio
import socket
import tempfile
from contextlib import asynccontextmanager
from datetime import timedelta
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from pathlib import Path
from unittest.mock import patch

import uvicorn
from sqlalchemy import select

from engine.distributed.client_agent import DistributedCrawlerAgent
from engine.distributed.client_config import AgentConfig
from engine.distributed.coordinator_models import CrawlTask, CrawlProductItem, TaskResult
from engine.distributed.coordinator_models import create_session_factory
from engine.distributed.coordinator_store import CoordinatorStore
from engine.distributed.protocol import AgentLimits, payload_checksum, utc_now


def require(condition, message):
    if not condition:
        raise AssertionError(message)


async def eventually(predicate, description):
    async with asyncio.timeout(20):
        while not predicate():
            await asyncio.sleep(0.05)
    print(f"  PASS: {description}")


def verify_claim_race(engine):
    store = CoordinatorStore(create_session_factory(engine))
    store.create_job({"urls": ["B0FR4MSS2H"]})
    for identity in ("race-a", "race-b"):
        store.register_client({"clientId": identity, "displayName": identity,
                               "availableSlots": 1, "maxConcurrentInputs": 1})
    barrier = Barrier(2)
    def claim(identity):
        barrier.wait(timeout=5)
        return store.lease_tasks(identity, 1)
    with ThreadPoolExecutor(max_workers=2) as pool:
        claims = list(pool.map(claim, ("race-a", "race-b")))
    require(sum(map(len, claims)) == 1, "Concurrent claim granted duplicate leases")
    print("  PASS: concurrent PostgreSQL claim: one task, one winning lease")


@asynccontextmanager
async def coordinator(engine, root, port=0):
    # Inject only resource locations. Real lifespan, HTTP/WSS routes, store,
    # reaper and migrations execute against the caller's disposable schema.
    with patch.dict("os.environ", {
        "IMAGE_PROCESSING_CACHE_DIR": str(root / "images"),
        "PINTEREST_RUNTIME_ROOT": str(root / "pinterest"),
    }):
        # The module exports a default app at import time. Isolate that factory
        # too, so importing the test does not initialize a user's runtime DB.
        with patch("engine.distributed.coordinator_models.create_database_engine", return_value=engine):
            from engine.distributed import coordinator_server
        with patch.object(coordinator_server, "create_database_engine", return_value=engine), patch.object(
            coordinator_server, "find_project_root", return_value=root
        ):
            app = coordinator_server.create_coordinator_app()
    listener = socket.socket()
    listener.bind(("127.0.0.1", port))
    listener.listen(128)
    server = uvicorn.Server(uvicorn.Config(app, log_level="critical", access_log=False, lifespan="on"))
    serving = asyncio.create_task(server.serve(sockets=[listener]))
    try:
        await eventually(lambda: server.started or serving.done(), "Coordinator startup completed")
        require(server.started and not serving.done(), "Coordinator failed startup")
        yield app, listener.getsockname()[1]
    finally:
        server.should_exit = True
        await asyncio.wait_for(serving, timeout=20)
        listener.close()


async def verify_reliability(engine, run_number):
    with tempfile.TemporaryDirectory(prefix="ffp-task10-") as directory:
        root = Path(directory)
        crawl_calls = []

        def agent(name, port):
            instance = DistributedCrawlerAgent(project_root=root / name, config=AgentConfig(
                server_url=f"http://127.0.0.1:{port}", display_name=f"audit-{name}",
                max_concurrent_inputs=1, limits=AgentLimits(), data_directory=root / name / "data"))
            def forbidden_crawl(*args, **kwargs):
                crawl_calls.append(name)
                raise AssertionError("Recovery must not recrawl a durable result")
            instance._run_batch = forbidden_crawl
            return instance

        async with coordinator(engine, root) as (app, port):
            store = app.state.store
            a, b = agent("a", port), agent("b", port)
            for instance in (a, b):
                store.register_client({"clientId": instance.client_id, "displayName": "fixture",
                                       "availableSlots": 1, "maxConcurrentInputs": 1})
            require(a.client_id != b.client_id, "Agent identities must be independent")
            job = store.create_job({"urls": ["B0FR4MSS2H"]})
            first = store.lease_tasks(a.client_id, 1)[0]
            a.store.save_assignment(first)
            payload_a = {"jobId": job["id"], "products": [], "marker": "stale-a"}
            a.store.spool_result(task_id=first["taskId"], lease_id=first["leaseId"],
                                 checksum=payload_checksum(payload_a), payload=payload_a)
            artifact = root / "a" / "preserved.bin"
            artifact.write_bytes(b"fixture-only")
            with store.sessions.begin() as session:
                session.get(CrawlTask, first["taskId"]).lease_expires_at = utc_now() - timedelta(seconds=1)
            store.reap_expired()
            store.clear_negative_cache()
            with store.sessions.begin() as session:
                task = session.get(CrawlTask, first["taskId"])
                task.next_retry_at = utc_now() - timedelta(seconds=1)
                task.last_error = None
            second = store.lease_tasks(b.client_id, 1)[0]
            require(second["taskId"] == first["taskId"] and second["leaseId"] != first["leaseId"], "Reassignment failed")
            b.store.save_assignment(second)
            identity = {"taskId": second["taskId"], "leaseId": second["leaseId"], "clientId": b.client_id}
            product = {**identity, "jobId": job["id"], "product": {"id": "fixture-product", "title": "Current B"}}
            b.store.spool_product(task_id=second["taskId"], lease_id=second["leaseId"], product_key="fixture-product",
                                  checksum=payload_checksum(product), payload=product)
            final = {**identity, "jobId": job["id"], "products": [], "marker": "current-b"}
            b.store.spool_result(task_id=second["taskId"], lease_id=second["leaseId"],
                                 checksum=payload_checksum(final), payload=final)
            # Real HTTP commits; intentionally drop ACK before writing local state.
            product_reply = await asyncio.to_thread(b._upload_product, b.store.pending_products()[0])
            final_reply = await asyncio.to_thread(b._upload_result, b.store.pending_results()[0])
            require(product_reply["status"] == final_reply["status"] == "accepted", "Initial HTTP commit failed")
            original_id = b.client_id
            durable_id = b.store.pending_results()[0]["resultId"]
            b = agent("b", port)
            require(b.client_id == original_id and b.store.pending_results()[0]["resultId"] == durable_id,
                    "Restart changed identity or durable result")
            print("  PASS: HTTP commit + lost ACK; reopened agent preserves identity/result ID")
            agents = [asyncio.create_task(instance.run()) for instance in (a, b)]
            try:
                await eventually(lambda: a._recovery_complete and b._recovery_complete, "two agents reconcile over real WebSocket")
                await eventually(lambda: b.store.upload_counts()["results"] == 0 and b.store.upload_counts()["products"] == 0,
                                 "duplicate HTTP receipts drain B outbox")
                require(a.store.upload_counts()["results"] == 1 and len(a.store.quarantined_uploads()) == 1,
                        "Stale A outbox must be retained in quarantine")
                require(artifact.read_bytes() == b"fixture-only", "Recovery removed fixture asset")
                require(not crawl_calls, "Durable results were recrawled")
                with store.sessions() as session:
                    results = list(session.scalars(select(TaskResult)))
                    products = list(session.scalars(select(CrawlProductItem)))
                    require(len(results) == len(products) == 1, "Duplicate or missing server rows")
                    require(results[0].client_id == b.client_id and products[0].client_id == b.client_id, "Wrong writer")
                print("  PASS: A quarantined + asset retained; B result/product counts=1; recrawl count=0")
                for connection in list(app.state.connection_manager.connections.values()):
                    await connection.close(code=1012)
                await eventually(lambda: not a._is_connected and not b._is_connected, "forced WSS disconnect closes admission")
                require(a._available_slots() == b._available_slots() == 0, "Offline agent advertised capacity")
                await eventually(lambda: a._recovery_complete and b._recovery_complete, "both agents automatically reconnect after transport loss")
                require(not crawl_calls, "Reconnect recrawled a durable result")
            finally:
                for instance in (a, b):
                    instance.stop()
                await asyncio.wait_for(asyncio.gather(*agents), timeout=20)
        # Restart the real application over the same schema, and both agent
        # runtimes over their same private SQLite stores.
        async with coordinator(engine, root) as (app, port):
            a, b = agent("a", port), agent("b", port)
            agents = [asyncio.create_task(instance.run()) for instance in (a, b)]
            try:
                await eventually(lambda: a._recovery_complete and b._recovery_complete, "Coordinator and both agents restart/reconnect")
                require(b.client_id == original_id and not crawl_calls, "Restart identity/recrawl regression")
                require(a.store.upload_counts()["results"] == 1 and b.store.upload_counts()["results"] == 0, "Restart lost spool disposition")
                require(artifact.read_bytes() == b"fixture-only", "Restart removed asset")
                with app.state.store.sessions() as session:
                    require(len(list(session.scalars(select(TaskResult)))) == 1, "Server restart lost result")
                    require(len(list(session.scalars(select(CrawlProductItem)))) == 1, "Server restart lost streamed product")
            finally:
                for instance in (a, b):
                    instance.stop()
                await asyncio.wait_for(asyncio.gather(*agents), timeout=20)
    print(f"RUN {run_number}: two-agent HTTP/WSS recovery PASS; temporary agent directories removed")
