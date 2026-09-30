"""Local review-image HTTP API and ChatGPT extension bridge."""

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import Header, HTTPException, Response
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from review_image_generator import ReviewImageBusyError, ReviewImageService

PROJECT_ROOT = Path(__file__).resolve().parents[4]
load_dotenv(PROJECT_ROOT / ".env.local")
os.environ["BRIDGE_TOKEN"] = os.getenv("REVIEW_IMAGE_BRIDGE_TOKEN", "change-this-token")

from server import BRIDGE_TOKEN, app, require_token


BRIDGE_PORT = 8770


def call_image_bridge(prompt: str, images: list[dict[str, str]]) -> dict[str, str]:
    request = urllib.request.Request(
        f"http://127.0.0.1:{BRIDGE_PORT}/image-edit",
        data=json.dumps({"prompt": prompt, "images": images, "timeout_seconds": 900}).encode(),
        headers={"Content-Type": "application/json", "X-Bridge-Token": BRIDGE_TOKEN},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=920) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            detail = json.load(exc).get("detail")
        except (ValueError, AttributeError):
            detail = str(exc)
        raise RuntimeError(f"ChatGPT Bridge: {detail}") from exc
    if not isinstance(payload.get("image"), dict):
        raise RuntimeError("ChatGPT Bridge không trả về file ảnh.")
    return payload["image"]


review_image_service = ReviewImageService(
    PROJECT_ROOT / "data" / "review-image-templates",
    PROJECT_ROOT / "exports" / "review-images",
    call_image_bridge,
)


class CreateReviewImageRequest(BaseModel):
    productDataUrl: str = Field(min_length=1, max_length=7_100_000)
    prompt: str = Field(min_length=1, max_length=10_000)
    scope: str
    templateName: str | None = None
    excludeTemplate: str | None = None


class UploadReviewTemplateRequest(BaseModel):
    fileName: str = Field(min_length=1, max_length=255)
    imageDataUrl: str = Field(min_length=1, max_length=7_100_000)


def authorize(value: str | None) -> None:
    require_token(value)


def image_response(path: Path, *, download: bool = False, job_id: str = "") -> Response:
    mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}[path.suffix.lower()]
    headers = {"Cache-Control": "no-store"}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="review-{job_id}{path.suffix}"'
    return Response(content=path.read_bytes(), media_type=mime, headers=headers)


@app.get("/api/review-images/health")
def review_image_health(x_bridge_token: str | None = Header(default=None)):
    authorize(x_bridge_token)
    return {"ok": True, "templates": len(review_image_service._templates())}


@app.get("/api/review-images/templates")
def list_templates(x_bridge_token: str | None = Header(default=None)):
    authorize(x_bridge_token)
    return {"ok": True, "templates": review_image_service.list_templates()}


@app.post("/api/review-images/templates", status_code=201)
def upload_template(body: UploadReviewTemplateRequest, x_bridge_token: str | None = Header(default=None)):
    authorize(x_bridge_token)
    try:
        name = review_image_service.save_template(body.fileName, body.imageDataUrl)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"ok": True, "template": {"name": name}}


@app.get("/api/review-images/templates/{name}")
def get_template(name: str, x_bridge_token: str | None = Header(default=None)):
    authorize(x_bridge_token)
    try:
        return image_response(review_image_service.template_path(name))
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(404, str(exc)) from exc


@app.delete("/api/review-images/templates/{name}")
def delete_template(name: str, x_bridge_token: str | None = Header(default=None)):
    authorize(x_bridge_token)
    try:
        deleted_name = review_image_service.delete_template(name)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"ok": True, "template": {"name": deleted_name}}


@app.post("/api/review-images/jobs", status_code=202)
def create_job(body: CreateReviewImageRequest, x_bridge_token: str | None = Header(default=None)):
    authorize(x_bridge_token)
    try:
        job = review_image_service.submit(
            body.productDataUrl, body.prompt, body.scope,
            template_name=body.templateName, exclude_template=body.excludeTemplate,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except ReviewImageBusyError as exc:
        raise HTTPException(429, str(exc)) from exc
    return {"ok": True, "job": job}


@app.get("/api/review-images/jobs/{job_id}")
def get_job(job_id: str, x_bridge_token: str | None = Header(default=None)):
    authorize(x_bridge_token)
    try:
        return {"ok": True, "job": review_image_service.snapshot(job_id)}
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@app.get("/api/review-images/jobs/{job_id}/image")
def get_job_image(job_id: str, x_bridge_token: str | None = Header(default=None)):
    authorize(x_bridge_token)
    try:
        return image_response(review_image_service.image_path(job_id))
    except (ValueError, FileNotFoundError) as exc:
        raise HTTPException(404, str(exc)) from exc


@app.post("/api/review-images/jobs/{job_id}/approve")
def approve_job(job_id: str, x_bridge_token: str | None = Header(default=None)):
    authorize(x_bridge_token)
    try:
        return {"ok": True, "job": review_image_service.approve(job_id)}
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.get("/api/review-images/jobs/{job_id}/download")
def download_job_image(job_id: str, x_bridge_token: str | None = Header(default=None)):
    authorize(x_bridge_token)
    try:
        return image_response(review_image_service.image_path(job_id, approved_only=True), download=True, job_id=job_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=BRIDGE_PORT, access_log=False, log_level="warning")
