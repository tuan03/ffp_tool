"""Local FastAPI host for asynchronous Amazon crawl jobs."""

from __future__ import annotations

import os
import threading
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .crawler_core import AmazonCrawler, CrawlSettings

MODULE_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = Path(__file__).resolve().parents[4]
load_dotenv(PROJECT_ROOT / ".env.local")


class Job:
    def __init__(self, job_id: str, sources: list[str], settings: CrawlSettings) -> None:
        self.job_id = job_id
        self.sources = sources
        self.settings = settings
        self.status = "queued"
        self.progress: dict[str, Any] = {"phase": "queued", "completed": 0, "total": len(sources), "message": "Job đang chờ xử lý."}
        self.result: dict[str, Any] | None = None
        self.error: str | None = None
        self.cancel_event = threading.Event()
        self.lock = threading.Lock()

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {"jobId": self.job_id, "status": self.status, "progress": deepcopy(self.progress), "result": deepcopy(self.result), "error": self.error}

    def update_progress(self, progress: dict[str, Any]) -> None:
        with self.lock:
            requested_status = progress.pop("status", None)
            if requested_status == "waiting_captcha":
                self.status = "waiting_captcha"
            elif self.status == "waiting_captcha":
                self.status = "running"
            self.progress = deepcopy(progress)


class JobStore:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()

    def create(self, sources: list[str], settings: CrawlSettings) -> Job:
        job = Job(uuid.uuid4().hex[:16], sources, settings)
        with self._lock:
            self._jobs[job.job_id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)


jobs = JobStore()
app = FastAPI(title="FFP Amazon Crawler Engine", version="1.0.0")

configured_origins = os.environ.get("AMAZON_CRAWLER_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
allowed_origins = [origin.strip() for origin in configured_origins.split(",") if origin.strip()]
app.add_middleware(CORSMiddleware, allow_origins=allowed_origins, allow_credentials=False, allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type"])


def _run_job(job: Job) -> None:
    with job.lock:
        job.status = "running"
        job.progress = {"phase": "product", "completed": 0, "total": len(job.sources), "message": "Đang khởi động crawler..."}
    crawler = AmazonCrawler(root=PROJECT_ROOT, settings=job.settings, progress=job.update_progress, cancel_event=job.cancel_event)
    try:
        output = crawler.run(job_id=job.job_id, sources=job.sources)
        with job.lock:
            job.result = output
            job.status = str(output["status"])
            job.progress = {"phase": "export", "completed": 1, "total": 1, "message": "Job đã hoàn tất."}
    except InterruptedError:
        with job.lock:
            job.status = "cancelled"
            job.progress = {"phase": "product", "completed": 0, "total": len(job.sources), "message": "Job đã dừng."}
    except Exception as error:
        with job.lock:
            job.status = "failed"
            job.error = str(error)
            job.progress = {"phase": "product", "completed": 0, "total": len(job.sources), "message": "Job thất bại."}
    finally:
        crawler.browser_pool.close()


@app.get("/api/amazon-crawler/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": "1.0.0"}


@app.post("/api/amazon-crawler/jobs", status_code=202)
def create_job(payload: dict[str, Any]) -> dict[str, str]:
    raw_sources = payload.get("urls")
    if not isinstance(raw_sources, list) or not all(isinstance(source, str) for source in raw_sources):
        raise HTTPException(status_code=422, detail="urls must be an array of strings.")
    if not raw_sources:
        raise HTTPException(status_code=422, detail="At least one Amazon URL or ASIN is required.")
    if len(raw_sources) > 200:
        raise HTTPException(status_code=422, detail="A batch may contain at most 200 inputs.")
    try:
        settings = CrawlSettings.from_api(payload)
    except (TypeError, ValueError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    job = jobs.create(raw_sources, settings)
    threading.Thread(target=_run_job, args=(job,), name=f"amazon-crawler-{job.job_id}", daemon=True).start()
    return {"jobId": job.job_id}


@app.get("/api/amazon-crawler/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Crawler job was not found.")
    return job.snapshot()


@app.delete("/api/amazon-crawler/jobs/{job_id}")
def cancel_job(job_id: str) -> dict[str, str]:
    job = jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Crawler job was not found.")
    with job.lock:
        if job.status not in {"completed", "partial", "failed", "cancelled"}:
            job.cancel_event.set()
            job.status = "cancelled"
            job.progress = {"phase": "product", "completed": job.progress.get("completed", 0), "total": job.progress.get("total", len(job.sources)), "message": "Đang dừng job an toàn..."}
    return {"jobId": job_id, "status": job.status}


@app.get("/api/amazon-crawler/exports/{filename}")
def download_export(filename: str) -> FileResponse:
    if not filename.startswith("amazon-crawl-") or not filename.endswith(".json") or Path(filename).name != filename:
        raise HTTPException(status_code=400, detail="Invalid export filename.")
    export_directory = (PROJECT_ROOT / "exports").resolve()
    path = (export_directory / filename).resolve()
    if path.parent != export_directory or not path.is_file():
        raise HTTPException(status_code=404, detail="Export was not found.")
    return FileResponse(path, media_type="application/json", filename=filename)
