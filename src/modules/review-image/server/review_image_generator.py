"""Local review-photo jobs backed by the ChatGPT image bridge."""

import base64
import binascii
import io
import secrets
import threading
import time
import uuid
from pathlib import Path
from typing import Callable

from PIL import Image, UnidentifiedImageError


MAX_IMAGE_BYTES = 5 * 1024 * 1024
IMAGE_FORMATS = {"PNG": ("image/png", ".png"), "JPEG": ("image/jpeg", ".jpg"), "WEBP": ("image/webp", ".webp")}
JOB_RETENTION_SECONDS = 24 * 60 * 60


class ReviewImageBusyError(Exception):
    """The bounded bridge queue has no capacity for another image job."""


def _validate_image_bytes(image_bytes: bytes, declared_mime: str) -> None:
    if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
        raise ValueError
    with Image.open(io.BytesIO(image_bytes)) as image:
        if image.width > 4096 or image.height > 4096 or image.width * image.height > 20_000_000:
            raise ValueError
        actual_mime = IMAGE_FORMATS[image.format][0]
        image.verify()
    if actual_mime != declared_mime:
        raise ValueError


def decode_image_data_url(value: str) -> tuple[str, bytes]:
    try:
        header, encoded = value.split(",", 1)
        declared_mime = header.removeprefix("data:").removesuffix(";base64")
        if header != f"data:{declared_mime};base64" or declared_mime not in {item[0] for item in IMAGE_FORMATS.values()}:
            raise ValueError
        image_bytes = base64.b64decode(encoded, validate=True)
        _validate_image_bytes(image_bytes, declared_mime)
        return declared_mime, image_bytes
    except (ValueError, KeyError, binascii.Error, UnidentifiedImageError, OSError) as exc:
        raise ValueError("File ảnh phải là PNG, JPEG hoặc WebP hợp lệ, tối đa 5 MB.") from exc


class ReviewImageService:
    def __init__(
        self,
        template_dir: Path,
        output_dir: Path,
        bridge_call: Callable[[str, list[dict[str, str]]], dict[str, str]],
        max_pending_jobs: int = 3,
    ) -> None:
        self.template_dir = Path(template_dir)
        self.output_dir = Path(output_dir)
        self.template_dir.mkdir(parents=True, exist_ok=True)
        self.bridge_call = bridge_call
        self.jobs: dict[str, dict] = {}
        self.lock = threading.RLock()
        self.max_pending_jobs = max_pending_jobs
        self.pending_jobs = 0

    def _prune_finished_jobs(self) -> None:
        cutoff = time.monotonic() - JOB_RETENTION_SECONDS
        for job_id, job in list(self.jobs.items()):
            if job.get("finished_at", float("inf")) < cutoff:
                del self.jobs[job_id]

    def _templates(self) -> list[Path]:
        if not self.template_dir.is_dir():
            return []
        candidates = []
        root = self.template_dir.resolve()
        for path in sorted(self.template_dir.iterdir()):
            if not path.is_file() or not path.resolve().is_relative_to(root) or path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
                continue
            try:
                mime = IMAGE_FORMATS[{'.png': 'PNG', '.jpg': 'JPEG', '.jpeg': 'JPEG', '.webp': 'WEBP'}[path.suffix.lower()]][0]
                _validate_image_bytes(path.read_bytes(), mime)
            except (ValueError, KeyError, OSError, UnidentifiedImageError):
                continue
            candidates.append(path)
        return candidates

    def template_path(self, name: str) -> Path:
        match = next((path for path in self._templates() if path.name == name), None)
        if match is None:
            raise ValueError("Ảnh template không tồn tại hoặc không hợp lệ.")
        return match

    def submit(
        self,
        product_data_url: str,
        prompt: str,
        scope: str,
        *,
        template_name: str | None = None,
        exclude_template: str | None = None,
    ) -> dict:
        product_mime, product_bytes = decode_image_data_url(product_data_url)
        prompt = prompt.strip()
        if not prompt or len(prompt) > 10_000:
            raise ValueError("Prompt phải có từ 1 đến 10.000 ký tự.")
        if scope not in {"main", "set"}:
            raise ValueError("Chế độ sản phẩm không hợp lệ.")
        scope_instruction = (
            "Required product selection: the main handbag only; ignore any wallet or accessory in Image 2."
            if scope == "main" else
            "Required product selection: the main handbag and matching wallet; place the wallet beside the bag."
        )
        prompt = scope_instruction + "\n\n" + prompt
        if len(prompt) > 10_000:
            raise ValueError("Prompt quá dài sau khi thêm hướng dẫn chọn sản phẩm; hãy rút ngắn prompt.")
        templates = self._templates()
        if not templates:
            raise ValueError("Thư mục template chưa có ảnh PNG, JPEG hoặc WebP hợp lệ.")
        if template_name:
            template = self.template_path(template_name)
        else:
            choices = [path for path in templates if path.name != exclude_template] or templates
            template = secrets.choice(choices)
        job_id = uuid.uuid4().hex
        job = {
            "job_id": job_id,
            "status": "queued",
            "template_name": template.name,
            "scope": scope,
            "approved": False,
            "error": None,
            "output_name": None,
        }
        with self.lock:
            self._prune_finished_jobs()
            if self.pending_jobs >= self.max_pending_jobs:
                raise ReviewImageBusyError("Bridge đang bận. Hãy chờ job hiện tại xong rồi thử lại.")
            self.pending_jobs += 1
            self.jobs[job_id] = job
        worker = threading.Thread(
            target=self._run,
            args=(job_id, prompt, template, product_mime, product_bytes),
            daemon=True,
        )
        try:
            worker.start()
        except Exception:
            with self.lock:
                self.pending_jobs -= 1
                del self.jobs[job_id]
            raise
        return self.snapshot(job_id)

    def _run(self, job_id: str, prompt: str, template: Path, product_mime: str, product_bytes: bytes) -> None:
        with self.lock:
            self.jobs[job_id]["status"] = "running"
        try:
            template_mime = IMAGE_FORMATS[{".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP"}[template.suffix.lower()]][0]
            images = [
                {"name": "template", "mime_type": template_mime, "data": base64.b64encode(template.read_bytes()).decode()},
                {"name": "product", "mime_type": product_mime, "data": base64.b64encode(product_bytes).decode()},
            ]
            response = self.bridge_call(prompt, images)
            result_mime = response.get("mime_type", "")
            result_data = response.get("data", "")
            if not result_mime or not result_data:
                raise ValueError("ChatGPT chưa trả về file ảnh; hãy tạo lại.")
            _, image_bytes = decode_image_data_url(f"data:{result_mime};base64,{result_data}")
            extension = next(ext for mime, ext in IMAGE_FORMATS.values() if mime == result_mime)
            self.output_dir.mkdir(parents=True, exist_ok=True)
            output_name = job_id + extension
            (self.output_dir / output_name).write_bytes(image_bytes)
            with self.lock:
                self.jobs[job_id].update(status="completed", output_name=output_name)
        except Exception as exc:
            with self.lock:
                self.jobs[job_id].update(status="failed", error=str(exc))
        finally:
            with self.lock:
                self.jobs[job_id]["finished_at"] = time.monotonic()
                self.pending_jobs -= 1

    def snapshot(self, job_id: str) -> dict:
        with self.lock:
            self._prune_finished_jobs()
            if job_id not in self.jobs:
                raise ValueError("Job ảnh không tồn tại.")
            return dict(self.jobs[job_id])

    def approve(self, job_id: str) -> dict:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job or job["status"] != "completed":
                raise ValueError("Ảnh chưa tạo xong nên chưa thể duyệt.")
            job["approved"] = True
            return dict(job)

    def image_path(self, job_id: str, *, approved_only: bool = False) -> Path:
        job = self.snapshot(job_id)
        if job["status"] != "completed" or (approved_only and not job["approved"]):
            raise ValueError("Ảnh chưa sẵn sàng để tải.")
        return self.output_dir / job["output_name"]
