"""FastAPI coordinator for distributed Amazon crawler agents."""

from __future__ import annotations

import asyncio
import base64
import gzip
import io
import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse

from ..image_processing import ImageProcessingService, normalize_profile, process_image_bytes
from . import PROTOCOL_VERSION, SUPPORTED_PROTOCOL_VERSIONS
from .coordinator_models import Base, create_database_engine, create_session_factory
from .coordinator_store import ActiveJobExistsError, CoordinatorStore
from .protocol import HEARTBEAT_INTERVAL_SECONDS, LEASE_SECONDS, payload_checksum, require_message, utc_iso


class ResultPayloadTooLarge(ValueError):
    pass


def debug_event(event: str, **details: Any) -> None:
    print(json.dumps({
        "timestamp": utc_iso(),
        "component": "crawler-coordinator",
        "event": event,
        **details,
    }, ensure_ascii=False), flush=True)


def positive_environment_integer(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, str(default))))
    except ValueError:
        return default


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

    async def add(self, client_id: str, websocket: WebSocket) -> bool:
        async with self.lock:
            if client_id in self.connections:
                return False
            self.connections[client_id] = websocket
            return True

    async def remove(self, client_id: str, websocket: WebSocket) -> bool:
        async with self.lock:
            if self.connections.get(client_id) is websocket:
                self.connections.pop(client_id, None)
                self.runtime.pop(client_id, None)
                return True
            return False

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
    project_root = Path(__file__).resolve().parents[5]
    image_processing_root = Path(
        os.environ.get("IMAGE_PROCESSING_CACHE_DIR", str(project_root / ".runtime" / "image-processing"))
    ).resolve()
    image_service = ImageProcessingService(
        image_processing_root,
        workers=positive_environment_integer("IMAGE_PROCESSING_WORKERS", 4),
        cache_ttl_minutes=positive_environment_integer("IMAGE_PROCESSING_CACHE_TTL_MINUTES", 60),
        legacy_profile_root=project_root / "Tool_crawer_New_update" / "config_file" / "image_processing_profiles",
    )
    history_retention_minutes = positive_environment_integer(
        "AMAZON_COORDINATOR_JOB_RETENTION_MINUTES",
        60,
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if create_schema:
            Base.metadata.create_all(engine)
        stop = asyncio.Event()

        async def reap_loop() -> None:
            next_cleanup_at = 0.0
            while not stop.is_set():
                await asyncio.to_thread(store.reap_expired)
                await asyncio.to_thread(store.purge_stopped_jobs)
                loop_time = asyncio.get_running_loop().time()
                if loop_time >= next_cleanup_at:
                    await asyncio.to_thread(
                        store.cleanup_history,
                        retention_minutes=history_retention_minutes,
                    )
                    protected_tokens = await asyncio.to_thread(store.review_image_tokens)
                    await asyncio.to_thread(image_service.clear_expired, protected_tokens)
                    next_cleanup_at = loop_time + 60
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
            image_service.close()
            engine.dispose()

    app = FastAPI(title="FFP Amazon Crawler Coordinator", version="1.0.0", lifespan=lifespan)
    app.state.store = store
    app.state.connection_manager = manager
    app.state.image_processing_service = image_service
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
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/v1/health")
    def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "apiVersion": "v1",
            "protocolVersion": PROTOCOL_VERSION,
            "workerProtocolVersion": PROTOCOL_VERSION,
        }

    @app.post("/api/v1/crawl-jobs", status_code=202)
    def create_job(payload: dict[str, Any]) -> dict[str, Any]:
        try:
            enriched_payload = dict(payload)
            image_profile = image_service.profiles.load(str(payload.get("imageProfileSlug") or "default"))
            enriched_payload["imageProfileSlug"] = image_profile["slug"]
            enriched_payload["imageProfileRevision"] = image_profile["revision"]
            return store.create_job(enriched_payload)
        except KeyError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except ActiveJobExistsError as error:
            raise HTTPException(
                status_code=409,
                detail=f"Job {error.job_id} đang chạy hoặc đang dừng. Hãy chờ Stop hoàn tất.",
            ) from error
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
        connected_client_ids = await manager.connected_client_ids()
        snapshot = store.cancel_job(job_id, connected_client_ids)
        if snapshot is None:
            raise HTTPException(status_code=404, detail="Crawl job was not found.")
        cache_generation = store.current_cache_generation()
        cancellation = snapshot.get("cancellation") or {}
        debug_event(
            "stop_requested",
            jobId=job_id,
            cancellationId=cancellation.get("id"),
            cacheGeneration=cache_generation,
            connectedClientIds=sorted(connected_client_ids),
            pendingAgentCount=len(cancellation.get("pendingAgents") or []),
            pendingPipelineItemCount=int(cancellation.get("pendingPipelineItems") or 0),
            pendingCleanupCount=len(cancellation.get("pendingCleanupAgents") or []),
        )
        await manager.broadcast({
            "type": "cancel",
            "jobId": job_id,
            "cancellationId": (snapshot.get("cancellation") or {}).get("id"),
            "discard": True,
            "cacheGeneration": cache_generation,
        })
        protected_tokens = await asyncio.to_thread(store.review_image_tokens)
        await asyncio.to_thread(image_service.clear_cache, protected_tokens)
        await asyncio.to_thread(store.purge_stopped_jobs)
        return snapshot

    @app.post("/api/v1/crawl-jobs/{job_id}/replace", status_code=202)
    async def replace_job(job_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        source_job = store.get_job(job_id)
        if source_job is None:
            raise HTTPException(status_code=404, detail="Crawl job was not found.")
        if source_job.get("status") not in {"completed", "partial"}:
            raise HTTPException(status_code=409, detail="Chỉ có thể chạy lại job đã hoàn tất.")
        try:
            enriched_payload = dict(payload)
            image_profile = image_service.profiles.load(str(payload.get("imageProfileSlug") or "default"))
            enriched_payload["imageProfileSlug"] = image_profile["slug"]
            enriched_payload["imageProfileRevision"] = image_profile["revision"]
            enriched_payload["replacementOfJobId"] = job_id
            enriched_payload["schedulerPriority"] = 100
            replacement = store.create_job(enriched_payload)
        except KeyError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        except ActiveJobExistsError as error:
            raise HTTPException(
                status_code=409,
                detail=f"Job {error.job_id} đang chạy hoặc đang dừng. Hãy chờ Stop hoàn tất.",
            ) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        return {"replacementJob": replacement}

    @app.delete("/api/v1/crawl-jobs/{job_id}")
    async def delete_job(job_id: str) -> Response:
        snapshot = store.cancel_job(job_id)
        if snapshot is not None:
            await manager.broadcast({
                "type": "cancel",
                "jobId": job_id,
                "cancellationId": (snapshot.get("cancellation") or {}).get("id"),
                "discard": True,
            })
        if not store.delete_job(job_id):
            raise HTTPException(status_code=404, detail="Crawl job was not found.")
        return Response(status_code=204)

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
        protected_tokens = await asyncio.to_thread(store.review_image_tokens)
        image_cache = await asyncio.to_thread(image_service.clear_cache, protected_tokens)
        result["removedFiles"] += image_cache["removedFiles"]
        result["removedBytes"] += image_cache["removedBytes"]
        result["imageProcessing"] = image_cache
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

    @app.get("/api/v1/product-reviews")
    def list_product_reviews() -> dict[str, Any]:
        items = store.list_product_reviews()
        return {"items": items, "total": len(items)}

    @app.delete("/api/v1/product-reviews")
    def delete_all_product_reviews() -> dict[str, int]:
        return store.delete_all_product_reviews()

    @app.get("/api/v1/product-reviews/events")
    async def stream_product_reviews(request: Request) -> StreamingResponse:
        async def stream():
            previous = ""
            while not await request.is_disconnected():
                items = await asyncio.to_thread(store.list_product_reviews)
                encoded = json.dumps(items, ensure_ascii=False, sort_keys=True)
                if encoded != previous:
                    previous = encoded
                    yield f"event: review_snapshot\ndata: {encoded}\n\n"
                else:
                    yield ": keep-alive\n\n"
                await asyncio.sleep(1)

        return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    @app.patch("/api/v1/product-reviews/{item_id}")
    def update_product_review(item_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        patch = payload.get("patch")
        if not isinstance(patch, dict):
            raise HTTPException(status_code=422, detail="patch is required.")
        result = store.update_product_review(
            item_id,
            expected_version=int(payload.get("expectedVersion") or 0),
            patch=patch,
        )
        if result is None:
            raise HTTPException(status_code=404, detail="Review item was not found.")
        if result.get("conflict"):
            raise HTTPException(status_code=409, detail="Review item changed; reload before editing.")
        if result.get("deleted"):
            raise HTTPException(status_code=409, detail="Review item was deleted.")
        if result.get("locked"):
            raise HTTPException(status_code=409, detail="Review item cannot be edited while syncing.")
        return result

    @app.post("/api/v1/product-reviews/{item_id}/decision")
    def decide_product_review(item_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            result = store.decide_product_review(
                item_id,
                expected_version=int(payload.get("expectedVersion") or 0),
                decision=str(payload.get("decision") or ""),
                reason=str(payload.get("reason") or "").strip() or None,
            )
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error
        if result is None:
            raise HTTPException(status_code=404, detail="Review item was not found.")
        if result.get("conflict"):
            raise HTTPException(status_code=409, detail="Review item changed; reload before deciding.")
        if result.get("deleted"):
            raise HTTPException(status_code=409, detail="Review item was deleted.")
        if result.get("locked"):
            raise HTTPException(status_code=409, detail="Review item cannot be changed while syncing.")
        return result

    @app.post("/api/v1/product-reviews/{item_id}/sync")
    def queue_product_review_sync(item_id: str) -> dict[str, Any]:
        result = store.queue_product_review_sync(item_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Review item was not found.")
        if result.get("notApproved"):
            raise HTTPException(status_code=409, detail="Only approved products can be synced.")
        if result.get("deleted"):
            raise HTTPException(status_code=409, detail="Review item was deleted.")
        if result.get("reconciliationRequired"):
            raise HTTPException(status_code=409, detail="Shopify write needs reconciliation before retrying.")
        return result

    @app.post("/api/v1/product-reviews/sync-approved")
    def queue_all_approved_reviews() -> dict[str, Any]:
        item_ids = store.queue_all_approved_reviews()
        return {"queued": len(item_ids), "itemIds": item_ids}

    @app.get("/api/v1/image-profiles")
    def list_image_profiles() -> dict[str, Any]:
        return {"profiles": image_service.profiles.list()}

    @app.get("/api/v1/image-profiles/{profile_slug}")
    def get_image_profile(profile_slug: str) -> dict[str, Any]:
        try:
            return image_service.profiles.load(profile_slug)
        except KeyError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

    @app.put("/api/v1/image-profiles/{profile_slug}")
    def save_image_profile(profile_slug: str, payload: dict[str, Any]) -> dict[str, Any]:
        return image_service.profiles.save(payload, profile_slug)

    @app.get("/api/v1/image-profiles/{profile_slug}/logo")
    def get_image_profile_logo(profile_slug: str) -> FileResponse:
        try:
            profile = image_service.profiles.load(profile_slug)
            logo_path = image_service.profiles.logo_path(profile_slug, profile["revision"])
        except KeyError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        if logo_path is None:
            raise HTTPException(status_code=404, detail="Image profile does not have a logo.")
        return FileResponse(logo_path)

    @app.post("/api/v1/image-profiles/{profile_slug}/logo")
    def save_image_profile_logo(profile_slug: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            return image_service.profiles.save_logo(profile_slug, str(payload.get("dataUrl") or ""))
        except KeyError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except ValueError as error:
            raise HTTPException(status_code=422, detail=str(error)) from error

    @app.post("/api/v1/image-profiles/{profile_slug}/preview")
    async def preview_image_profile(profile_slug: str, payload: dict[str, Any]) -> dict[str, str]:
        data_url = str(payload.get("dataUrl") or "")
        if not data_url.startswith("data:image/") or ";base64," not in data_url:
            raise HTTPException(status_code=422, detail="Preview image must be an image data URL.")
        try:
            source = base64.b64decode(data_url.split(",", 1)[1], validate=True)
            if len(source) > 20 * 1024 * 1024:
                raise ValueError("Preview image exceeds 20 MB.")
            draft = payload.get("profile") if isinstance(payload.get("profile"), dict) else None
            try:
                saved = image_service.profiles.load(profile_slug)
                logo_path = image_service.profiles.logo_path(profile_slug, saved["revision"])
            except KeyError:
                if draft is None:
                    raise
                saved = normalize_profile(draft, profile_slug)
                logo_path = None
            profile = normalize_profile({**saved, **(draft or {})}, profile_slug)
            preview = await asyncio.to_thread(
                process_image_bytes,
                source,
                profile,
                logo_content=logo_path.read_bytes() if logo_path else None,
                seed="profile-preview",
            )
        except Exception as error:
            raise HTTPException(status_code=422, detail=f"Unable to render preview: {error}") from error
        return {"dataUrl": "data:image/jpeg;base64," + base64.b64encode(preview).decode("ascii")}

    @app.delete("/api/v1/image-profiles/{profile_slug}")
    def delete_image_profile(profile_slug: str) -> dict[str, str]:
        try:
            image_service.profiles.delete(profile_slug)
        except ValueError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        return {"status": "deleted"}

    @app.post("/api/v1/internal/image-processing/process")
    async def process_product_images(
        payload: dict[str, Any],
        x_pipeline_key: str | None = Header(default=None, alias="X-Pipeline-Key"),
    ) -> dict[str, Any]:
        require_pipeline_key(x_pipeline_key)
        product = payload.get("product")
        if not isinstance(product, dict):
            raise HTTPException(status_code=422, detail="product is required.")
        profile_slug = str(payload.get("profileSlug") or "default")
        profile_revision = str(payload.get("profileRevision") or "").strip() or None
        try:
            return await asyncio.to_thread(
                image_service.process_product,
                product,
                profile_slug,
                profile_revision,
            )
        except KeyError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        except Exception as error:
            raise HTTPException(status_code=422, detail=f"Image processing failed: {error}") from error

    @app.get("/api/v1/internal/image-processing/files/{file_token}")
    def get_processed_image(
        file_token: str,
        x_pipeline_key: str | None = Header(default=None, alias="X-Pipeline-Key"),
    ) -> FileResponse:
        require_pipeline_key(x_pipeline_key)
        try:
            path = image_service.file_path(file_token)
        except KeyError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        return FileResponse(path, media_type="image/jpeg", filename=f"{file_token}.jpg")

    @app.get("/api/v1/product-reviews/images/{file_token}")
    def get_review_image(file_token: str) -> FileResponse:
        try:
            path = image_service.file_path(file_token)
        except KeyError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error
        return FileResponse(path, media_type="image/jpeg", filename=f"{file_token}.jpg")

    @app.post("/api/v1/internal/product-pipeline/{item_id}/image-processing")
    def mark_product_image_processing(
        item_id: str,
        payload: dict[str, Any],
        x_pipeline_key: str | None = Header(default=None, alias="X-Pipeline-Key"),
    ) -> dict[str, Any]:
        require_pipeline_key(x_pipeline_key)
        normalized = payload.get("normalizedProduct")
        summary = payload.get("imageProcessing")
        if not isinstance(normalized, dict) or not isinstance(summary, dict):
            raise HTTPException(status_code=422, detail="normalizedProduct and imageProcessing are required.")
        if not store.mark_product_image_processing(
            item_id,
            worker_id=str(payload.get("workerId") or ""),
            normalized_payload=normalized,
            image_summary=summary,
        ):
            raise HTTPException(status_code=409, detail="Pipeline item claim is stale.")
        return {"status": "image_processing"}

    @app.post("/api/v1/internal/product-pipeline/{item_id}/review-ready")
    def mark_product_review_ready(
        item_id: str,
        payload: dict[str, Any],
        x_pipeline_key: str | None = Header(default=None, alias="X-Pipeline-Key"),
    ) -> dict[str, Any]:
        require_pipeline_key(x_pipeline_key)
        normalized = payload.get("normalizedProduct")
        seo_summary = payload.get("seo")
        image_summary = payload.get("imageProcessing")
        review_summary = payload.get("review")
        if not all(isinstance(value, dict) for value in (normalized, seo_summary, image_summary, review_summary)):
            raise HTTPException(status_code=422, detail="normalizedProduct, seo, imageProcessing and review are required.")
        if not store.mark_product_review_ready(
            item_id,
            worker_id=str(payload.get("workerId") or ""),
            normalized_payload=normalized,
            seo_summary=seo_summary,
            image_summary=image_summary,
            review_summary=review_summary,
        ):
            raise HTTPException(status_code=409, detail="Pipeline item claim is stale.")
        return {"status": "waiting_review"}

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
            seo_summary=payload.get("seo") if isinstance(payload.get("seo"), dict) else None,
        )
        if not updated:
            raise HTTPException(status_code=409, detail="Pipeline item claim is stale.")
        return {"status": "syncing"}

    @app.post("/api/v1/internal/product-pipeline/{item_id}/seo")
    def mark_product_seo(
        item_id: str,
        payload: dict[str, Any],
        x_pipeline_key: str | None = Header(default=None, alias="X-Pipeline-Key"),
    ) -> dict[str, Any]:
        require_pipeline_key(x_pipeline_key)
        normalized = payload.get("normalizedProduct")
        seo_summary = payload.get("seo")
        if not isinstance(normalized, dict) or not isinstance(seo_summary, dict):
            raise HTTPException(status_code=422, detail="normalizedProduct and seo are required.")
        updated = store.mark_product_seo(
            item_id,
            worker_id=str(payload.get("workerId") or ""),
            normalized_payload=normalized,
            seo_summary=seo_summary,
        )
        if not updated:
            raise HTTPException(status_code=409, detail="Pipeline item claim is stale.")
        return {"status": "seo"}

    @app.post("/api/v1/internal/product-pipeline/{item_id}/shopify-checkpoint")
    def checkpoint_shopify_product(
        item_id: str,
        payload: dict[str, Any],
        x_pipeline_key: str | None = Header(default=None, alias="X-Pipeline-Key"),
    ) -> dict[str, Any]:
        require_pipeline_key(x_pipeline_key)
        shopify_result = payload.get("shopify")
        store_id = str(payload.get("storeId") or "").strip()
        normalized_checksum = str(payload.get("normalizedChecksum") or "").strip()
        if not isinstance(shopify_result, dict) or not store_id or not normalized_checksum:
            raise HTTPException(
                status_code=422,
                detail="storeId, normalizedChecksum and shopify are required.",
            )
        stop_requested = store.checkpoint_shopify_product(
            item_id,
            worker_id=str(payload.get("workerId") or ""),
            store_id=store_id,
            normalized_checksum=normalized_checksum,
            shopify_result=shopify_result,
        )
        if stop_requested is None:
            raise HTTPException(status_code=409, detail="Pipeline item claim is stale.")
        return {"status": "checkpointed", "stopRequested": stop_requested}

    @app.post("/api/v1/internal/product-pipeline/{item_id}/shopify-write-started")
    def mark_shopify_write_started(
        item_id: str,
        payload: dict[str, Any],
        x_pipeline_key: str | None = Header(default=None, alias="X-Pipeline-Key"),
    ) -> dict[str, str]:
        require_pipeline_key(x_pipeline_key)
        if not store.mark_shopify_write_started(
            item_id,
            worker_id=str(payload.get("workerId") or ""),
        ):
            raise HTTPException(status_code=409, detail="Pipeline item was stopped before Shopify write.")
        return {"status": "shopify_writing"}

    @app.post("/api/v1/internal/product-pipeline/{item_id}/heartbeat")
    def heartbeat_product_pipeline(
        item_id: str,
        payload: dict[str, Any],
        x_pipeline_key: str | None = Header(default=None, alias="X-Pipeline-Key"),
    ) -> dict[str, Any]:
        require_pipeline_key(x_pipeline_key)
        state = store.product_cancellation_state(item_id, worker_id=str(payload.get("workerId") or ""))
        if state is None:
            raise HTTPException(status_code=409, detail="Pipeline item claim is stale.")
        return {"status": state}

    @app.post("/api/v1/internal/product-pipeline/{item_id}/cancelled")
    def acknowledge_product_pipeline_cancel(
        item_id: str,
        payload: dict[str, Any],
        x_pipeline_key: str | None = Header(default=None, alias="X-Pipeline-Key"),
    ) -> dict[str, str]:
        require_pipeline_key(x_pipeline_key)
        if not store.acknowledge_product_cancel(item_id, worker_id=str(payload.get("workerId") or "")):
            raise HTTPException(status_code=409, detail="Pipeline cancellation acknowledgement is stale.")
        store.purge_stopped_jobs()
        return {"status": "cancelled"}

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
            capabilities = hello.get("capabilities") if isinstance(hello.get("capabilities"), dict) else {}
            if capabilities.get("mediaGalleryV2") is not True:
                await websocket.close(code=4003, reason="Agent must support complete Amazon media galleries.")
                return
            client_id = str(hello.get("clientId") or "").strip()
            if not client_id:
                await websocket.close(code=4000, reason="clientId is required.")
                return
            if not await manager.add(client_id, websocket):
                client_id = ""
                await websocket.close(code=4001, reason="This agent is already connected.")
                return
            client = await asyncio.to_thread(store.register_client, hello)
            cancel_intents = [str(value) for value in list(hello.get("cancelIntents") or []) if str(value)]
            acknowledged_intents: list[str] = []
            stop_clients = await manager.connected_client_ids()
            stop_clients.add(client_id)
            for job_id in cancel_intents:
                cancelled = await asyncio.to_thread(store.cancel_job, job_id, stop_clients)
                if cancelled is not None:
                    acknowledged_intents.append(job_id)
            local_tasks = [value for value in list(hello.get("localTasks") or []) if isinstance(value, dict)]
            reconciliation = await asyncio.to_thread(store.reconcile_tasks, client_id, local_tasks)
            maximum_slots = int(client.get("maxConcurrentInputs") or 0)
            required_cache_generation = await asyncio.to_thread(store.current_cache_generation)
            client_cache_generation = max(0, int(hello.get("cacheGeneration") or 0))
            is_cache_ready = client_cache_generation >= required_cache_generation
            available_slots = max(0, int(hello.get("availableSlots") or 0)) if is_cache_ready else 0
            await manager.update_runtime(
                client_id,
                active_tasks=max(0, maximum_slots - available_slots),
                available_slots=available_slots,
            )
            await websocket.send_json({
                "type": "hello_ack", "protocolVersion": PROTOCOL_VERSION,
                "heartbeatIntervalSeconds": HEARTBEAT_INTERVAL_SECONDS, "leaseSeconds": LEASE_SECONDS,
                **reconciliation,
                "acknowledgedCancelIntents": acknowledged_intents,
                "requiredCacheGeneration": required_cache_generation,
            })
            if is_cache_ready:
                recovered_jobs = await asyncio.to_thread(
                    store.acknowledge_client_cache_generation,
                    client_id,
                    client_cache_generation,
                )
                if recovered_jobs:
                    purged = await asyncio.to_thread(store.purge_stopped_jobs)
                    debug_event(
                        "stop_cleanup_recovered_on_connect",
                        clientId=client_id,
                        cacheGeneration=client_cache_generation,
                        jobIds=recovered_jobs,
                        purgedJobs=purged,
                    )
            for cancelled_job_id in acknowledged_intents:
                await manager.broadcast({
                    "type": "cancel",
                    "jobId": cancelled_job_id,
                    "discard": True,
                    "cacheGeneration": required_cache_generation,
                })

            async def assign(slots: int) -> None:
                if not is_cache_ready:
                    return
                leases = await asyncio.to_thread(store.lease_tasks, client_id, slots)
                await manager.reserve_tasks(client_id, len(leases))
                for lease in leases:
                    await websocket.send_json(lease)

            if is_cache_ready:
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
                    cancelled_job_ids = await asyncio.to_thread(
                        store.heartbeat,
                        client_id,
                        running,
                        str(message.get("status") or "online"),
                    )
                    for cancelled_job_id in cancelled_job_ids:
                        await websocket.send_json({
                            "type": "cancel",
                            "jobId": cancelled_job_id,
                            "discard": True,
                            "cacheGeneration": await asyncio.to_thread(store.current_cache_generation),
                        })
                    if is_cache_ready:
                        await assign(int(message.get("availableSlots") or 0))
                elif message_type == "ready":
                    await manager.update_available_slots(client_id, int(message.get("availableSlots") or 0))
                    if is_cache_ready:
                        await assign(int(message.get("availableSlots") or 0))
                elif message_type == "progress":
                    await asyncio.to_thread(store.update_progress, client_id, message)
                elif message_type == "task_failed":
                    response = await asyncio.to_thread(store.fail_task, client_id, message)
                    await websocket.send_json({"type": "task_failed_ack", "taskId": message.get("taskId"), **response})
                    await assign(1)
                elif message_type == "cancel_ack":
                    response = await asyncio.to_thread(store.acknowledge_task_cancel, client_id, message)
                    await websocket.send_json({"type": "cancel_ack_received", "taskId": message.get("taskId"), **response})
                    await assign(1)
                elif message_type == "cancel_received":
                    response = await asyncio.to_thread(store.acknowledge_task_cancel_received, client_id, message)
                    await websocket.send_json({"type": "cancel_received_ack", "taskId": message.get("taskId"), **response})
                elif message_type == "cache_cleared":
                    await manager.record_cache_response(client_id, message)
                elif message_type == "cache_generation_ack":
                    acknowledged_generation = max(0, int(message.get("cacheGeneration") or 0))
                    if acknowledged_generation >= required_cache_generation:
                        is_cache_ready = True
                        recovered_jobs = await asyncio.to_thread(
                            store.acknowledge_client_cache_generation,
                            client_id,
                            acknowledged_generation,
                        )
                        if recovered_jobs:
                            purged = await asyncio.to_thread(store.purge_stopped_jobs)
                            debug_event(
                                "stop_cleanup_recovered_from_generation_ack",
                                clientId=client_id,
                                cacheGeneration=acknowledged_generation,
                                jobIds=recovered_jobs,
                                purgedJobs=purged,
                            )
                        acknowledged_slots = max(0, int(message.get("availableSlots") or 0))
                        await manager.update_available_slots(client_id, acknowledged_slots)
                        await assign(acknowledged_slots)
                elif message_type == "stop_cleanup_ack":
                    debug_event(
                        "stop_cleanup_ack_received",
                        clientId=client_id,
                        jobId=str(message.get("jobId") or ""),
                        cacheGeneration=max(0, int(message.get("cacheGeneration") or 0)),
                        removedFiles=int(message.get("removedFiles") or 0),
                        removedBytes=int(message.get("removedBytes") or 0),
                        error=str(message.get("error") or "") or None,
                    )
                    acknowledged = await asyncio.to_thread(
                        store.acknowledge_stop_cleanup,
                        client_id,
                        job_id=str(message.get("jobId") or ""),
                        cache_generation=max(0, int(message.get("cacheGeneration") or 0)),
                        error=str(message.get("error") or "") or None,
                    )
                    if acknowledged:
                        purged = await asyncio.to_thread(store.purge_stopped_jobs)
                        debug_event(
                            "stop_completed",
                            clientId=client_id,
                            jobId=str(message.get("jobId") or ""),
                            purgedJobs=purged,
                        )
        except (WebSocketDisconnect, asyncio.TimeoutError):
            pass
        except ValueError as error:
            await websocket.close(code=4000, reason=str(error)[:120])
        finally:
            if client_id:
                if await manager.remove(client_id, websocket):
                    await asyncio.to_thread(store.mark_client_disconnected, client_id)
                    await asyncio.to_thread(store.purge_stopped_jobs)

    return app


app = create_coordinator_app()
