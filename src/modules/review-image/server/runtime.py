"""Composable Review Studio application; does not open a port or spawn a server."""
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
import secrets

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket
from fastapi.responses import FileResponse, JSONResponse

from .contracts import CreateImage, DeleteTemplates, FinishUpload, UploadImage, UploadTemplate
from .extension_bridge import ExtensionBridge
from .persistence import ReviewRepository
from .review_image_generator import ReviewImageBusyError, ReviewImageService


def create_review_app(*, engine, runtime_root, internal_token, extension_token, pipeline_token):
    if not internal_token or not extension_token or not pipeline_token or internal_token == extension_token:
        raise ValueError("Review Studio requires distinct internal and extension credentials plus a pipeline credential")
    root = Path(runtime_root).resolve()
    repository = ReviewRepository(engine)
    bridge = ExtensionBridge(extension_token)
    service = ReviewImageService(root / "templates", root / "outputs", bridge.generate_sync, repository=repository)

    @asynccontextmanager
    async def lifespan(app):
        await asyncio.to_thread(repository.initialize)
        await asyncio.to_thread(repository.recover)
        bridge.loop = asyncio.get_running_loop()
        try:
            yield
        finally:
            await bridge.shutdown()
            await asyncio.to_thread(service.shutdown)
            engine.dispose()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.repository = repository
    app.state.bridge = bridge
    app.state.service = service

    def authorize(x_bridge_token: str | None = Header(default=None)):
        if not secrets.compare_digest(x_bridge_token or "", internal_token):
            raise HTTPException(401, "Unauthorized")

    def pipeline_authorize(x_pipeline_key: str | None = Header(default=None)):
        if not secrets.compare_digest(x_pipeline_key or "", pipeline_token):
            raise HTTPException(401, "Unauthorized")

    secured = [Depends(authorize)]

    @app.exception_handler(ValueError)
    async def invalid_request(_request: Request, error: ValueError):
        return JSONResponse(status_code=409, content={"detail": str(error)})

    @app.exception_handler(ReviewImageBusyError)
    async def busy(_request: Request, _error: ReviewImageBusyError):
        return JSONResponse(status_code=429, content={"detail": "Review Studio is busy; retry after the current job finishes."})

    @app.get("/api/review-images/health", dependencies=secured)
    def health():
        repository.ready()
        return {"ok": True, "templates": len(repository.all("template")), "extensionConnected": bridge.socket is not None}

    @app.get("/api/review-images/templates", dependencies=secured)
    def templates(storeId: str):
        return {"templates": service.list_templates(storeId)}

    @app.post("/api/review-images/templates", dependencies=secured, status_code=201)
    def save_template(body: UploadTemplate):
        return {"template": {"name": service.save_template(body.fileName, body.imageDataUrl, store_id=body.storeId)}}

    @app.delete("/api/review-images/templates/batch", dependencies=secured)
    def delete_templates(body: DeleteTemplates):
        return service.delete_templates(body.storeId, body.names)

    @app.get("/api/review-images/templates/{name}", dependencies=secured)
    def template(name: str, storeId: str):
        return FileResponse(service.template_path(name, storeId), headers={"Cache-Control": "no-store"})

    @app.delete("/api/review-images/templates/{name}", dependencies=secured)
    def delete_template(name: str, storeId: str):
        return {"template": {"name": service.delete_template(name, storeId)}}

    @app.post("/api/review-images/jobs", dependencies=secured, status_code=202)
    def create_job(body: CreateImage):
        if bridge.socket is None:
            raise HTTPException(503, "Chưa có extension kết nối. Mở tab ChatGPT và bật extension Review Image.")
        return {"job": service.submit(body.productDataUrl, body.prompt, body.scope, store_id=body.storeId,
                                      template_name=body.templateName, exclude_template=body.excludeTemplate,
                                      conversation_session_id=body.conversationSessionId)}

    @app.get("/api/review-images/jobs/{job_id}", dependencies=secured)
    def get_job(job_id: str):
        return {"job": service.snapshot(job_id)}

    @app.post("/api/review-images/jobs/{job_id}/cancel", dependencies=secured)
    async def cancel_job(job_id: str):
        if await asyncio.to_thread(repository.get, "upload", job_id):
            raise HTTPException(409, "An upload has already been requested")
        job = await asyncio.to_thread(service.cancel, job_id)
        await bridge.cancel(job["conversation_session_id"])
        return {"job": job}

    @app.post("/api/review-images/jobs/{job_id}/approve", dependencies=secured)
    def approve(job_id: str):
        return {"job": service.approve(job_id)}

    @app.get("/api/review-images/jobs/{job_id}/image", dependencies=secured)
    def image(job_id: str):
        return FileResponse(service.image_path(job_id), headers={"Cache-Control": "no-store"})

    @app.get("/api/review-images/jobs/{job_id}/download", dependencies=secured)
    def download(job_id: str):
        path = service.image_path(job_id, approved_only=True)
        return FileResponse(path, filename=f"review-{path.name}", headers={"Cache-Control": "no-store"})

    @app.post("/api/review-images/jobs/{job_id}/shopify", dependencies=secured)
    def enqueue(job_id: str, body: UploadImage):
        job = service.snapshot(job_id)
        if job["store_id"] != body.storeId or not job["approved"] or job["status"] != "completed":
            raise HTTPException(409, "Approve a completed image belonging to this store before upload")
        service.image_path(job_id, approved_only=True)
        return upload_response(repository.enqueue_upload(job_id, body.storeId, job["output_name"]))

    def upload_response(upload):
        if not upload:
            raise HTTPException(404, "Upload not found")
        if upload["status"] == "completed":
            return upload["result"]
        if upload["status"] == "uncertain":
            raise HTTPException(409, upload.get("error", "Inspect Shopify before retrying"))
        return JSONResponse(status_code=202, content={"status": upload["status"], "jobId": upload["jobId"]})

    @app.get("/api/review-images/jobs/{job_id}/shopify", dependencies=secured)
    def upload_status(job_id: str):
        return upload_response(repository.get("upload", job_id))

    @app.post("/api/v1/internal/review-images/uploads/claim", dependencies=[Depends(pipeline_authorize)])
    def claim():
        return {"upload": repository.claim_upload()}

    @app.post("/api/v1/internal/review-images/uploads/{job_id}/finish", dependencies=[Depends(pipeline_authorize)])
    def finish(job_id: str, body: FinishUpload):
        if body.result is not None and not all(body.result.get(key) for key in ("fileId", "shopifyCdnUrl", "fileStatus")):
            raise HTTPException(422, "Invalid Shopify result")
        return repository.finish_upload(job_id, body.attemptId, body.result)

    @app.websocket("/api/review-images/extension")
    async def extension(socket: WebSocket):
        await bridge.connect(socket)

    return app
