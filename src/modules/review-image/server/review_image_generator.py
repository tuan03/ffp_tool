"""Local review-photo jobs backed by the ChatGPT image bridge."""

import base64
import binascii
import io
import re
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
DEFAULT_STORE_ID = "preaureum"
STORE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
CONVERSATION_SESSION_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
CONVERSATION_ISOLATION_INSTRUCTION = (
    "Use only the two newest image attachments in this message. Ignore all templates, products and generated images "
    "from earlier messages in this conversation."
)
RUG_REFERENCE_INSTRUCTION = (
    "Identify the two current attachments by filename, regardless of their display order: "
    "SCENE_BACKGROUND is the file whose filename begins with template-; "
    "REPLACEMENT_PRODUCT is the file whose filename begins with product-. "
    "Required rug replacement: Image 1 (template attachment) is the only scene source. "
    "Keep its framing, camera, floor, furniture and lighting; remove all its original rugs and restore the covered floor. "
    "Image 2 (product attachment) is the only product source: isolate its actual rugs and ignore its background as a scene source. "
    "Insert those rugs into Image 1, preserving their count, shapes, proportions, relative sizes and artwork, "
    "except customer names that must be replaced as instructed. Do not just repaint the template rug, "
    "fit the new product to its shape, or recreate the scene from Image 2. "
    "PHYSICAL SCALE: Do not shrink the product to fit the cleared template footprint, visible free floor, "
    "or old rug dimensions. A large area rug or play mat must remain a large floor covering, not a small doormat. "
    "Use supplied or clearly visible length and width measurements first; otherwise use recognizable objects "
    "in Image 2 as physical scale cues only, without copying them into the scene. "
    "Pixel size and camera magnification are not real-world measurements. "
    "Do not invent exact centimeter or inch measurements if none are supplied; retain a plausible full-size product for its category. "
    "Keep Image 1's framing and floor perspective; if the full-size product cannot be fully visible, "
    "allow the rug to extend beyond the frame or naturally beneath furniture instead of miniaturizing it. "
    "Frame-edge clipping may hide part of the rug, but do not truncate its physical shape or redesign its artwork. "
    "Physical scale takes priority over any instruction below to show every edge or fit within the old rug area. "
    "The following instructions must respect these image roles."
)


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
    except (ValueError, KeyError, SyntaxError, binascii.Error, UnidentifiedImageError, OSError) as exc:
        raise ValueError("File ảnh phải là PNG, JPEG hoặc WebP hợp lệ, tối đa 5 MB.") from exc


class ReviewImageService:
    def __init__(
        self,
        template_dir: Path,
        output_dir: Path,
        bridge_call: Callable[[str, list[dict[str, str]], str], dict[str, str]],
        max_pending_jobs: int = 3,
    ) -> None:
        self.template_dir = Path(template_dir)
        self.output_dir = Path(output_dir)
        self.template_dir.mkdir(parents=True, exist_ok=True)
        self._migrate_legacy_templates()
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

    def _store_template_dir(self, store_id: str) -> Path:
        clean_store_id = store_id.strip().lower()
        if not STORE_ID_PATTERN.fullmatch(clean_store_id):
            raise ValueError("Store ID không hợp lệ.")
        store_dir = self.template_dir / clean_store_id
        if not store_dir.resolve().is_relative_to(self.template_dir.resolve()):
            raise ValueError("Store ID không hợp lệ.")
        return store_dir

    def _migrate_legacy_templates(self) -> None:
        destination = self._store_template_dir(DEFAULT_STORE_ID)
        legacy_files = [
            path for path in self.template_dir.iterdir()
            if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
        ]
        if not legacy_files:
            return
        destination.mkdir(parents=True, exist_ok=True)
        for source in legacy_files:
            target = destination / source.name
            if target.exists():
                target = destination / f"{source.stem}-{uuid.uuid4().hex}{source.suffix.lower()}"
            source.replace(target)

    def _templates(self, store_id: str = DEFAULT_STORE_ID) -> list[Path]:
        store_dir = self._store_template_dir(store_id)
        if not store_dir.is_dir():
            return []
        candidates = []
        root = store_dir.resolve()
        for path in sorted(store_dir.iterdir()):
            if not path.is_file() or not path.resolve().is_relative_to(root) or path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
                continue
            try:
                mime = IMAGE_FORMATS[{'.png': 'PNG', '.jpg': 'JPEG', '.jpeg': 'JPEG', '.webp': 'WEBP'}[path.suffix.lower()]][0]
                _validate_image_bytes(path.read_bytes(), mime)
            except (ValueError, KeyError, SyntaxError, OSError, UnidentifiedImageError):
                continue
            candidates.append(path)
        return candidates

    def template_path(self, name: str, store_id: str = DEFAULT_STORE_ID) -> Path:
        match = next((path for path in self._templates(store_id) if path.name == name), None)
        if match is None:
            raise ValueError("Ảnh template không tồn tại hoặc không hợp lệ.")
        return match

    def list_templates(self, store_id: str = DEFAULT_STORE_ID) -> list[dict[str, str]]:
        return [{"name": path.name} for path in self._templates(store_id)]

    def save_template(self, file_name: str, image_data_url: str, *, store_id: str = DEFAULT_STORE_ID) -> str:
        mime, image_bytes = decode_image_data_url(image_data_url)
        original_name = re.split(r"[/\\]", file_name.strip())[-1]
        stem = re.sub(r"[^A-Za-z0-9_-]+", "-", Path(original_name).stem).strip("-_")[:60] or "template"
        extension = next(extension for format_mime, extension in IMAGE_FORMATS.values() if format_mime == mime)
        unique_id = uuid.uuid4().hex
        saved_name = f"{stem}-{unique_id}{extension}"
        store_dir = self._store_template_dir(store_id)
        store_dir.mkdir(parents=True, exist_ok=True)
        temporary_path = store_dir / f".{unique_id}.part"
        try:
            temporary_path.write_bytes(image_bytes)
            temporary_path.replace(store_dir / saved_name)
        finally:
            temporary_path.unlink(missing_ok=True)
        return saved_name

    def delete_template(self, name: str, store_id: str = DEFAULT_STORE_ID) -> str:
        clean_store_id = store_id.strip().lower()
        with self.lock:
            path = self.template_path(name, clean_store_id)
            is_in_use = any(
                job.get("store_id") == clean_store_id and job.get("template_name") == path.name and job.get("status") in {"queued", "running"}
                for job in self.jobs.values()
            )
            if is_in_use:
                raise ValueError("Ảnh template đang được dùng để tạo ảnh; hãy chờ job hoàn tất rồi xóa.")
            try:
                path.unlink()
            except OSError as exc:
                raise ValueError("Không thể xóa ảnh template.") from exc
            return path.name

    def delete_templates(self, store_id: str, names: list[str]) -> dict[str, list]:
        deleted: list[str] = []
        failures: list[dict[str, str]] = []
        for name in dict.fromkeys(names):
            try:
                deleted.append(self.delete_template(name, store_id))
            except ValueError as exc:
                failures.append({"name": name, "message": str(exc)})
        return {"deleted": deleted, "failures": failures}

    def submit(
        self,
        product_data_url: str,
        prompt: str,
        scope: str,
        *,
        store_id: str = DEFAULT_STORE_ID,
        template_name: str | None = None,
        exclude_template: str | None = None,
        conversation_session_id: str | None = None,
    ) -> dict:
        product_mime, product_bytes = decode_image_data_url(product_data_url)
        prompt = prompt.strip()
        if not prompt or len(prompt) > 10_000:
            raise ValueError("Prompt phải có từ 1 đến 10.000 ký tự.")
        if scope not in {"main", "set", "single"}:
            raise ValueError("Chế độ sản phẩm không hợp lệ.")
        clean_store_id = store_id.strip().lower()
        scope_instruction = {
            "main": "Required product selection: the main handbag only; ignore any wallet or accessory in Image 2.",
            "set": "Required product selection: the main handbag and matching wallet; place the wallet beside the bag.",
            "single": "Required product selection: use the exact product shown in Image 2 without inventing matching accessories.",
        }[scope]
        prompt = scope_instruction + "\n\n" + CONVERSATION_ISOLATION_INSTRUCTION + "\n\n" + prompt
        if clean_store_id == "capozen":
            # Bind older UI drafts to filenames instead of ambiguous attachment positions.
            prompt = RUG_REFERENCE_INSTRUCTION + "\n\n" + prompt
            prompt = re.sub(
                r"\bImage\s*([12])\b",
                lambda match: "SCENE_BACKGROUND" if match.group(1) == "1" else "REPLACEMENT_PRODUCT",
                prompt,
                flags=re.IGNORECASE,
            )
        if len(prompt) > 10_200:
            raise ValueError("Prompt quá dài sau khi thêm hướng dẫn chọn sản phẩm; hãy rút ngắn prompt.")
        templates = self._templates(clean_store_id)
        if not templates:
            raise ValueError("Thư mục template chưa có ảnh PNG, JPEG hoặc WebP hợp lệ.")
        if template_name:
            template = self.template_path(template_name, clean_store_id)
        else:
            choices = [path for path in templates if path.name != exclude_template] or templates
            template = secrets.choice(choices)
        job_id = uuid.uuid4().hex
        clean_conversation_session_id = (conversation_session_id or f"single-{job_id}").strip()
        if not CONVERSATION_SESSION_PATTERN.fullmatch(clean_conversation_session_id):
            raise ValueError("Conversation session ID không hợp lệ.")
        job = {
            "job_id": job_id,
            "store_id": clean_store_id,
            "status": "queued",
            "template_name": template.name,
            "scope": scope,
            "approved": False,
            "error": None,
            "output_name": None,
            "conversation_session_id": clean_conversation_session_id,
        }
        with self.lock:
            self._prune_finished_jobs()
            if self.pending_jobs >= self.max_pending_jobs:
                raise ReviewImageBusyError("Bridge đang bận. Hãy chờ job hiện tại xong rồi thử lại.")
            self.pending_jobs += 1
            self.jobs[job_id] = job
        worker = threading.Thread(
            target=self._run,
            args=(job_id, prompt, template, product_mime, product_bytes, clean_conversation_session_id),
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

    def _run(self, job_id: str, prompt: str, template: Path, product_mime: str, product_bytes: bytes, conversation_session_id: str) -> None:
        try:
            with self.lock:
                if self.jobs[job_id]["status"] == "cancelled":
                    return
                self.jobs[job_id]["status"] = "running"
            template_mime = IMAGE_FORMATS[{".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP"}[template.suffix.lower()]][0]
            images = [
                {"name": "template", "mime_type": template_mime, "data": base64.b64encode(template.read_bytes()).decode()},
                {"name": "product", "mime_type": product_mime, "data": base64.b64encode(product_bytes).decode()},
            ]
            response = self.bridge_call(prompt, images, conversation_session_id)
            result_mime = response.get("mime_type", "")
            result_data = response.get("data", "")
            if not result_mime or not result_data:
                raise ValueError("ChatGPT chưa trả về file ảnh; hãy tạo lại.")
            _, image_bytes = decode_image_data_url(f"data:{result_mime};base64,{result_data}")
            extension = next(ext for mime, ext in IMAGE_FORMATS.values() if mime == result_mime)
            with self.lock:
                if self.jobs[job_id]["status"] == "cancelled":
                    return
            self.output_dir.mkdir(parents=True, exist_ok=True)
            output_name = job_id + extension
            output_path = self.output_dir / output_name
            output_path.write_bytes(image_bytes)
            with self.lock:
                if self.jobs[job_id]["status"] == "cancelled":
                    output_path.unlink(missing_ok=True)
                else:
                    self.jobs[job_id].update(status="completed", output_name=output_name)
        except Exception as exc:
            with self.lock:
                if self.jobs[job_id]["status"] != "cancelled":
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

    def cancel(self, job_id: str) -> dict:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                raise ValueError("Job ảnh không tồn tại.")
            if job["approved"]:
                raise ValueError("Ảnh đã được duyệt nên không thể hủy.")
            if job["status"] == "cancelled":
                return dict(job)
            if job["status"] == "failed":
                return dict(job)
            output_name = job.get("output_name")
            job.update(status="cancelled", error=None, output_name=None)
            if output_name:
                (self.output_dir / output_name).unlink(missing_ok=True)
            return dict(job)

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
