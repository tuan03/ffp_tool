"""FastAPI coordinator for distributed Amazon crawler agents."""

from __future__ import annotations

import asyncio
import gzip
import io
import json
import os
import uuid
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

from . import PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS
from .coordinator_models import Base, create_database_engine, create_session_factory
from .coordinator_store import CoordinatorStore
from .protocol import HEARTBEAT_INTERVAL_SECONDS, LEASE_SECONDS, payload_checksum, require_message


class ResultPayloadTooLarge(ValueError):
    pass


def decompress_gzip_limited(payload: bytes, *, maximum_bytes: int) -> bytes:
    with gzip.GzipFile(fileobj=io.BytesIO(payload), mode="rb") as stream:
        decompressed = stream.read(maximum_bytes + 1)
    if len(decompressed) > maximum_bytes:
        raise ResultPayloadTooLarge(f"Decompressed result payload exceeds {maximum_bytes} bytes.")
    return decompressed


async def read_request_body_limited(request: Request, *, maximum_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > maximum_bytes:
            raise ResultPayloadTooLarge(f"Result payload exceeds {maximum_bytes} bytes.")
        chunks.append(chunk)
    return b"".join(chunks)


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: dict[str, WebSocket] = {}
        self.runtime: dict[str, dict[str, int]] = {}
        self.lock = asyncio.Lock()
        self.cache_requests: dict[str, dict[str, Any]] = {}

    async def add(self, client_id: str, websocket: WebSocket) -> None:
        async with self.lock:
            previous = self.connections.get(client_id)
            self.connections[client_id] = websocket
        if previous is not None and previous is not websocket:
            await previous.close(code=4001, reason="Replaced by a newer client connection.")

    async def remove(self, client_id: str, websocket: WebSocket) -> None:
        async with self.lock:
            if self.connections.get(client_id) is websocket:
                self.connections.pop(client_id, None)
                self.runtime.pop(client_id, None)

    async def update_runtime(self, client_id: str, *, active_tasks: int, available_slots: int) -> None:
        async with self.lock:
            if client_id not in self.connections:
                return
            self.runtime[client_id] = {
                "activeTasks": max(0, int(active_tasks)),
                "availableSlots": max(0, int(available_slots)),
            }

    async def runtime_snapshot(self) -> dict[str, dict[str, int]]:
        async with self.lock:
            return {client_id: dict(status) for client_id, status in self.runtime.items()}

    async def reserve_tasks(self, client_id: str, count: int) -> None:
        async with self.lock:
            status = self.runtime.get(client_id)
            if status is None:
                return
            reserved = max(0, min(int(count), status["availableSlots"]))
            status["activeTasks"] += reserved
            status["availableSlots"] -= reserved

    async def update_available_slots(self, client_id: str, available_slots: int) -> None:
        async with self.lock:
            status = self.runtime.get(client_id)
            if status is None:
                return
            capacity = status["activeTasks"] + status["availableSlots"]
            available = max(0, min(int(available_slots), capacity))
            status["availableSlots"] = available
            status["activeTasks"] = capacity - available

    async def broadcast(self, payload: dict[str, Any]) -> None:
        async with self.lock:
            connections = list(self.connections.values())
        await asyncio.gather(*(connection.send_json(payload) for connection in connections), return_exceptions=True)

    async def connected_client_ids(self) -> set[str]:
        async with self.lock:
            return set(self.connections)

    async def record_cache_response(self, client_id: str, payload: dict[str, Any]) -> None:
        request_id = str(payload.get("requestId") or "")
        async with self.lock:
            pending = self.cache_requests.get(request_id)
            if pending is None or client_id not in pending["expected"]:
                return
            pending["responses"][client_id] = payload
            if pending["expected"].issubset(pending["responses"]):
                pending["event"].set()

    async def clear_client_caches(self, *, timeout_seconds: float = 10.0) -> dict[str, Any]:
        request_id = uuid.uuid4().hex
        async with self.lock:
            connections = dict(self.connections)
            pending = {
                "expected": set(connections),
                "responses": {},
                "event": asyncio.Event(),
            }
            self.cache_requests[request_id] = pending
        if not connections:
            async with self.lock:
                self.cache_requests.pop(request_id, None)
            return {"requestedClients": 0, "respondedClients": 0, "removedFiles": 0, "removedBytes": 0, "clients": []}
        send_results = await asyncio.gather(*(
            connection.send_json({"type": "clear_cache", "requestId": request_id})
            for connection in connections.values()
        ), return_exceptions=True)
        failed_clients = {client_id for client_id, result in zip(connections, send_results) if isinstance(result, Exception)}
        async with self.lock:
            pending["expected"].difference_update(failed_clients)
            if pending["expected"].issubset(pending["responses"]):
                pending["event"].set()
        try:
            await asyncio.wait_for(pending["event"].wait(), timeout=timeout_seconds)
        except TimeoutError:
            pass
        async with self.lock:
            self.cache_requests.pop(request_id, None)
            responses = dict(pending["responses"])
        client_results = [{"clientId": client_id, **response} for client_id, response in responses.items()]
        return {
            "requestedClients": len(connections),
            "respondedClients": len(responses),
            "removedFiles": sum(int(response.get("removedFiles") or 0) for response in responses.values()),
            "removedBytes": sum(int(response.get("removedBytes") or 0) for response in responses.values()),
            "clients": client_results,
        }


def create_coordinator_app(*, database_url: str | None = None, create_schema: bool = True) -> FastAPI:
    engine = create_database_engine(database_url)
    sessions = create_session_factory(engine)
    store = CoordinatorStore(sessions)
    manager = ConnectionManager()

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if create_schema:
            Base.metadata.create_all(engine)
        stop = asyncio.Event()

        async def reap_loop() -> None:
            while not stop.is_set():
                await asyncio.to_thread(store.reap_expired)
                try:
                    await asyncio.wait_for(stop.wait(), timeout=5)
                except TimeoutError:
                    pass

        task = asyncio.create_task(reap_loop())
        try:
            yield
        finally:
            stop.set()
            await task
            engine.dispose()

    app = FastAPI(title="FFP Amazon Crawler Coordinator", version="1.0.0", lifespan=lifespan)
    app.state.store = store
    app.state.connection_manager = manager
    origins = [value.strip() for value in os.environ.get(
        "AMAZON_COORDINATOR_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",") if value.strip()]
    lan_origin_pattern = (
        r"^https?://(?:localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|"
        r"192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})(?::\d+)?$"
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_origin_regex=lan_origin_pattern,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "Content-Encoding", "X-Client-Id", "X-Lease-Id", "X-Result-Checksum"],
    )

    @app.get("/api/v1/health")
    def health() -> dict[str, Any]:
        return {"status": "ok", "protocolVersion": PROTOCOL_VERSION}

    @app.post("/api/v1/crawl-jobs", status_code=202)
    def create_job(payload: dict[str, Any]) -> dict[str, Any]:
        try:
            return store.create_job(payload)
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @app.get("/api/v1/crawl-jobs")
    def list_jobs(limit: int = 100) -> list[dict[str, Any]]:
        return store.list_jobs(limit)

    @app.get("/api/v1/crawl-jobs/{job_id}")
    def get_job(job_id: str) -> dict[str, Any]:
        snapshot = store.get_job(job_id)
        if snapshot is None:
            raise HTTPException(status_code=404, detail="Crawl job was not found.")
        return snapshot

    @app.get("/api/v1/crawl-jobs/{job_id}/results")
    def get_results(job_id: str) -> dict[str, Any]:
        result = store.job_results(job_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Crawl job was not found.")
        return result

    @app.get("/api/v1/crawl-jobs/{job_id}/products")
    def get_job_products(job_id: str) -> dict[str, Any]:
        result = store.job_products(job_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Crawl job was not found.")
        return result

    @app.get("/api/v1/crawl-jobs/{job_id}/export")
    def export_results(job_id: str) -> JSONResponse:
        result = store.job_results(job_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Crawl job was not found.")
        return JSONResponse(result, headers={"Content-Disposition": f'attachment; filename="amazon-crawl-{job_id}.json"'})

    @app.post("/api/v1/crawl-jobs/{job_id}/cancel")
    async def cancel_job(job_id: str) -> dict[str, Any]:
        snapshot = store.cancel_job(job_id)
        if snapshot is None:
            raise HTTPException(status_code=404, detail="Crawl job was not found.")
        await manager.broadcast({"type": "cancel", "jobId": job_id})
        return snapshot

    @app.post("/api/v1/crawl-jobs/{job_id}/retry-failed")
    def retry_failed(job_id: str) -> dict[str, Any]:
        snapshot = store.retry_failed(job_id)
        if snapshot is None:
            raise HTTPException(status_code=404, detail="Crawl job was not found.")
        return snapshot

    @app.post("/api/v1/crawl-jobs/{job_id}/retry-failed-syncs")
    def retry_failed_syncs(job_id: str) -> dict[str, Any]:
        snapshot = store.retry_failed_syncs(job_id)
        if snapshot is None:
            raise HTTPException(status_code=404, detail="Crawl job was not found.")
        return snapshot

    @app.get("/api/v1/clients")
    async def list_clients() -> list[dict[str, Any]]:
        clients = await asyncio.to_thread(store.list_clients)
        connected_ids = await manager.connected_client_ids()
        runtime = await manager.runtime_snapshot()
        return [
            {
                **client,
                "isConnected": client["id"] in connected_ids,
                "leasedTasks": client["activeTasks"],
                "activeTasks": runtime.get(client["id"], {}).get("activeTasks", 0),
                "availableSlots": runtime.get(client["id"], {}).get("availableSlots", 0),
            }
            for client in clients
        ]

    @app.delete("/api/v1/clients/cache")
    async def clear_client_caches() -> dict[str, Any]:
        result = await manager.clear_client_caches()
        if result["requestedClients"] == 0:
            raise HTTPException(status_code=409, detail="No crawler client is currently connected.")
        return result

    @app.get("/api/v1/crawl-jobs/{job_id}/events")
    async def job_events(job_id: str, request: Request, after: int = 0) -> StreamingResponse:
        if store.get_job(job_id) is None:
            raise HTTPException(status_code=404, detail="Crawl job was not found.")

        async def stream():
            cursor = max(0, after)
            while not await request.is_disconnected():
                events = await asyncio.to_thread(store.events_after, job_id, cursor)
                if not events:
                    yield ": keep-alive\n\n"
                for event in events:
                    cursor = max(cursor, int(event["id"]))
                    yield f"id: {event['id']}\nevent: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"
                await asyncio.sleep(1)

        return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    @app.put("/api/v1/worker/tasks/{task_id}/result")
    async def upload_result(
        task_id: str,
        request: Request,
        x_client_id: str = Header(alias="X-Client-Id"),
        x_lease_id: str = Header(alias="X-Lease-Id"),
        x_result_checksum: str | None = Header(default=None, alias="X-Result-Checksum"),
    ) -> dict[str, Any]:
        try:
            body = await read_request_body_limited(request, maximum_bytes=50 * 1024 * 1024)
        except ResultPayloadTooLarge as error:
            raise HTTPException(status_code=413, detail="Result payload exceeds 50 MB.") from error
        if request.headers.get("content-encoding", "").casefold() == "gzip":
            try:
                body = decompress_gzip_limited(body, maximum_bytes=50 * 1024 * 1024)
            except ResultPayloadTooLarge as error:
                raise HTTPException(status_code=413, detail="Decompressed result payload exceeds 50 MB.") from error
            except (OSError, EOFError) as error:
                raise HTTPException(status_code=400, detail="Invalid gzip result payload.") from error
        if len(body) > 50 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Decompressed result payload exceeds 50 MB.")
        try:
            payload = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise HTTPException(status_code=400, detail="Result body must be valid JSON.") from error
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="Result body must be a JSON object.")
        identity = {
            "taskId": task_id,
            "clientId": x_client_id,
            "leaseId": x_lease_id,
        }
        if any(str(payload.get(name) or "") != expected for name, expected in identity.items()):
            raise HTTPException(status_code=400, detail="Result envelope identity does not match route and headers.")
        checksum = payload_checksum(payload)
        if x_result_checksum and x_result_checksum != checksum:
            raise HTTPException(status_code=400, detail="Result checksum does not match payload.")
        response = store.accept_result(task_id, x_client_id, x_lease_id, checksum, payload)
        status = response["status"]
        if status == "missing":
            raise HTTPException(status_code=404, detail="Crawler task was not found.")
        if status == "cancelled":
            raise HTTPException(status_code=409, detail="Crawler task was cancelled.")
        if status == "stale":
            raise HTTPException(status_code=409, detail="Crawler task lease is stale or was never issued.")
        if status == "invalid":
            raise HTTPException(status_code=400, detail="Result job identity does not match the leased task.")
        return response

    @app.put("/api/v1/worker/tasks/{task_id}/products/{product_key}")
    async def upload_product(
        task_id: str,
        product_key: str,
        request: Request,
        x_client_id: str = Header(alias="X-Client-Id"),
        x_lease_id: str = Header(alias="X-Lease-Id"),
        x_result_checksum: str | None = Header(default=None, alias="X-Result-Checksum"),
    ) -> dict[str, Any]:
        try:
            body = await read_request_body_limited(request, maximum_bytes=50 * 1024 * 1024)
            if request.headers.get("content-encoding", "").casefold() == "gzip":
                body = decompress_gzip_limited(body, maximum_bytes=50 * 1024 * 1024)
            payload = json.loads(body)
        except ResultPayloadTooLarge as error:
            raise HTTPException(status_code=413, detail="Product payload exceeds 50 MB.") from error
        except (OSError, EOFError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise HTTPException(status_code=400, detail="Product body must be valid JSON.") from error
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="Product body must be a JSON object.")
        identity = {"taskId": task_id, "clientId": x_client_id, "leaseId": x_lease_id}
        if any(str(payload.get(name) or "") != expected for name, expected in identity.items()):
            raise HTTPException(status_code=400, detail="Product envelope identity does not match route and headers.")
        checksum = payload_checksum(payload)
        if x_result_checksum and x_result_checksum != checksum:
            raise HTTPException(status_code=400, detail="Product checksum does not match payload.")
        response = store.accept_product(
            task_id,
            x_client_id,
            x_lease_id,
            product_key,
            checksum,
            payload,
        )
        if response["status"] == "missing":
            raise HTTPException(status_code=404, detail="Crawler task was not found.")
        if response["status"] in {"cancelled", "stale"}:
            raise HTTPException(status_code=409, detail="Crawler task is cancelled or the lease is stale.")
        if response["status"] == "invalid":
            raise HTTPException(status_code=400, detail="Product envelope is invalid.")
        return response

    def require_pipeline_key(value: str | None) -> None:
        expected = os.environ.get("SHOPIFY_PIPELINE_TOKEN", "").strip()
        if expected and value != expected:
            raise HTTPException(status_code=401, detail="Invalid pipeline worker key.")

    @app.post("/api/v1/internal/product-pipeline/claim")
    def claim_product_pipeline(
        payload: dict[str, Any],
        x_pipeline_key: str | None = Header(default=None, alias="X-Pipeline-Key"),
    ) -> dict[str, Any]:
        require_pipeline_key(x_pipeline_key)
        worker_id = str(payload.get("workerId") or "").strip()
        store_id = str(payload.get("storeId") or "").strip()
        if not worker_id or not store_id:
            raise HTTPException(status_code=422, detail="workerId and storeId are required.")
        return {
            "items": store.claim_product_items(
                worker_id=worker_id,
                store_id=store_id,
                limit=int(payload.get("limit") or 1),
            )
        }

    @app.post("/api/v1/internal/product-pipeline/{item_id}/syncing")
    def mark_product_syncing(
        item_id: str,
        payload: dict[str, Any],
        x_pipeline_key: str | None = Header(default=None, alias="X-Pipeline-Key"),
    ) -> dict[str, Any]:
        require_pipeline_key(x_pipeline_key)
        normalized = payload.get("normalizedProduct")
        if not isinstance(normalized, dict):
            raise HTTPException(status_code=422, detail="normalizedProduct is required.")
        updated = store.mark_product_syncing(
            item_id,
            worker_id=str(payload.get("workerId") or ""),
            normalized_payload=normalized,
            proxy_profile=str(payload.get("proxyProfile") or ""),
        )
        if not updated:
            raise HTTPException(status_code=409, detail="Pipeline item claim is stale.")
        return {"status": "syncing"}

    @app.post("/api/v1/internal/product-pipeline/{item_id}/heartbeat")
    def heartbeat_product_pipeline(
        item_id: str,
        payload: dict[str, Any],
        x_pipeline_key: str | None = Header(default=None, alias="X-Pipeline-Key"),
    ) -> dict[str, Any]:
        require_pipeline_key(x_pipeline_key)
        if not store.heartbeat_product_item(item_id, worker_id=str(payload.get("workerId") or "")):
            raise HTTPException(status_code=409, detail="Pipeline item claim is stale.")
        return {"status": "ok"}

    @app.post("/api/v1/internal/product-pipeline/{item_id}/complete")
    def complete_product_pipeline(
        item_id: str,
        payload: dict[str, Any],
        x_pipeline_key: str | None = Header(default=None, alias="X-Pipeline-Key"),
    ) -> dict[str, Any]:
        require_pipeline_key(x_pipeline_key)
        normalized = payload.get("normalizedProduct")
        shopify_result = payload.get("shopify")
        store_id = str(payload.get("storeId") or "").strip()
        if not isinstance(normalized, dict) or not isinstance(shopify_result, dict) or not store_id:
            raise HTTPException(status_code=422, detail="storeId, normalizedProduct and shopify are required.")
        updated = store.complete_product_item(
            item_id,
            worker_id=str(payload.get("workerId") or ""),
            store_id=store_id,
            normalized_checksum=str(payload.get("normalizedChecksum") or ""),
            normalized_payload=normalized,
            shopify_result=shopify_result,
        )
        if not updated:
            raise HTTPException(status_code=409, detail="Pipeline item claim is stale.")
        return {"status": "completed"}

    @app.post("/api/v1/internal/product-pipeline/{item_id}/fail")
    def fail_product_pipeline(
        item_id: str,
        payload: dict[str, Any],
        x_pipeline_key: str | None = Header(default=None, alias="X-Pipeline-Key"),
    ) -> dict[str, Any]:
        require_pipeline_key(x_pipeline_key)
        error = payload.get("error") if isinstance(payload.get("error"), dict) else {"message": "Pipeline failed."}
        store_id = str(payload.get("storeId") or "").strip()
        if not store_id:
            raise HTTPException(status_code=422, detail="storeId is required.")
        status = store.fail_product_item(
            item_id,
            worker_id=str(payload.get("workerId") or ""),
            store_id=store_id,
            error=error,
            retryable=bool(payload.get("retryable", False)),
            reconciliation_required=bool(payload.get("reconciliationRequired", False)),
            retry_after_seconds=int(payload["retryAfterSeconds"]) if payload.get("retryAfterSeconds") else None,
        )
        if status is None:
            raise HTTPException(status_code=409, detail="Pipeline item claim is stale.")
        return {"status": status}

    @app.websocket("/api/v1/worker/connect")
    async def worker_socket(websocket: WebSocket) -> None:
        await websocket.accept()
        client_id = ""
        try:
            hello = require_message(await asyncio.wait_for(websocket.receive_json(), timeout=15), "hello")
            if str(hello.get("protocolVersion")) not in SUPPORTED_PROTOCOL_VERSIONS:
                await websocket.close(code=4002, reason="Unsupported protocol version.")
                return
            client = await asyncio.to_thread(store.register_client, hello)
            client_id = client["id"]
            await manager.add(client_id, websocket)
            maximum_slots = int(client.get("maxConcurrentInputs") or 0)
            available_slots = max(0, int(hello.get("availableSlots") or 0))
            await manager.update_runtime(
                client_id,
                active_tasks=max(0, maximum_slots - available_slots),
                available_slots=available_slots,
            )
            await websocket.send_json({
                "type": "hello_ack", "protocolVersion": PROTOCOL_VERSION,
                "heartbeatIntervalSeconds": HEARTBEAT_INTERVAL_SECONDS, "leaseSeconds": LEASE_SECONDS,
            })

            async def assign(slots: int) -> None:
                leases = await asyncio.to_thread(store.lease_tasks, client_id, slots)
                await manager.reserve_tasks(client_id, len(leases))
                for lease in leases:
                    await websocket.send_json(lease)

            await assign(int(hello.get("availableSlots") or 0))
            while True:
                message = require_message(await websocket.receive_json())
                message_type = message["type"]
                if message_type == "heartbeat":
                    running = list(message.get("running") or [])
                    await manager.update_runtime(
                        client_id,
                        active_tasks=len(running),
                        available_slots=int(message.get("availableSlots") or 0),
                    )
                    await asyncio.to_thread(
                        store.heartbeat,
                        client_id,
                        running,
                        str(message.get("status") or "online"),
                    )
                    await assign(int(message.get("availableSlots") or 0))
                elif message_type == "ready":
                    await manager.update_available_slots(client_id, int(message.get("availableSlots") or 0))
                    await assign(int(message.get("availableSlots") or 0))
                elif message_type == "progress":
                    await asyncio.to_thread(store.update_progress, client_id, message)
                elif message_type == "task_failed":
                    response = await asyncio.to_thread(store.fail_task, client_id, message)
                    await websocket.send_json({"type": "task_failed_ack", "taskId": message.get("taskId"), **response})
                    await assign(1)
                elif message_type == "cache_cleared":
                    await manager.record_cache_response(client_id, message)
        except (WebSocketDisconnect, asyncio.TimeoutError):
            pass
        except ValueError as error:
            await websocket.close(code=4000, reason=str(error)[:120])
        finally:
            if client_id:
                await manager.remove(client_id, websocket)
                await asyncio.to_thread(store.mark_client_disconnected, client_id)

    return app


app = create_coordinator_app()
