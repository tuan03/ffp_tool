import asyncio
import base64
import binascii
import json
import os
import secrets
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

BASE_DIR = Path(__file__).resolve().parent
XPATH_FILE = BASE_DIR / "xpathGPT.txt"

HOST = os.getenv("BRIDGE_HOST", "127.0.0.1")
PORT = int(os.getenv("BRIDGE_PORT", "8770"))
BRIDGE_TOKEN = os.getenv("BRIDGE_TOKEN", "change-this-token")

app = FastAPI(title="ChatGPT Session Bridge", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PromptRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=200_000)
    timeout_seconds: int = Field(default=300, ge=10, le=1800)
    conversation_mode: str = Field(
        default="current",
        pattern="^(current|new)$",
        description="'current' uses the open conversation; 'new' asks the extension to open a new chat.",
    )


class ImagePart(BaseModel):
    name: str
    mime_type: str
    data: str


class ImageEditRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=10_200)
    timeout_seconds: int = Field(default=900, ge=1, le=1800)
    images: list[ImagePart]

    @model_validator(mode="after")
    def validate_images(self):
        if [image.name for image in self.images] != ["template", "product"]:
            raise ValueError("Images must be ordered: template, product")
        for image in self.images:
            if image.mime_type not in {"image/png", "image/jpeg", "image/webp"}:
                raise ValueError("Only PNG, JPEG and WebP images are supported")
            try:
                size = len(base64.b64decode(image.data, validate=True))
            except binascii.Error as exc:
                raise ValueError("Invalid image base64") from exc
            if not 0 < size <= 5 * 1024 * 1024:
                raise ValueError("Each image must be no larger than 5 MB")
        return self


class XPathUpdate(BaseModel):
    prompt_input: str
    send_button: str
    stop_button: str = ""
    assistant_messages: str
    new_chat_button: str = ""


extensions: set[WebSocket] = set()
jobs: dict[str, dict[str, Any]] = {}
jobs_lock = asyncio.Lock()
prompt_execution_lock = asyncio.Lock()


def require_token(value: str | None) -> None:
    if not secrets.compare_digest(value or "", BRIDGE_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid bridge token")


def load_xpaths() -> dict[str, str]:
    try:
        raw = XPATH_FILE.read_text(encoding="utf-8")
        data = json.loads(raw)
    except FileNotFoundError as exc:
        raise RuntimeError(f"Missing XPath file: {XPATH_FILE}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Invalid JSON in {XPATH_FILE}: {exc}") from exc

    required = {"prompt_input", "send_button", "assistant_messages"}
    missing = required.difference(data)
    if missing:
        raise RuntimeError(f"Missing XPath keys: {', '.join(sorted(missing))}")
    return {str(k): str(v) for k, v in data.items()}


async def send_json_safe(ws: WebSocket, payload: dict[str, Any]) -> bool:
    try:
        await ws.send_text(json.dumps(payload, ensure_ascii=False))
        return True
    except Exception:
        extensions.discard(ws)
        return False


async def broadcast(payload: dict[str, Any]) -> int:
    sent = 0
    for ws in list(extensions):
        if await send_json_safe(ws, payload):
            sent += 1
    return sent


@app.get("/health")
async def health():
    return {
        "ok": True,
        "extensions_connected": len(extensions),
        "pending_jobs": sum(1 for j in jobs.values() if j["status"] in {"queued", "running"}),
    }


@app.get("/config")
async def get_config(x_bridge_token: str | None = Header(default=None)):
    require_token(x_bridge_token)
    return load_xpaths()


@app.put("/config")
async def update_config(
    body: XPathUpdate,
    x_bridge_token: str | None = Header(default=None),
):
    require_token(x_bridge_token)
    XPATH_FILE.write_text(
        json.dumps(body.model_dump(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    config = load_xpaths()
    await broadcast({"type": "config", "xpaths": config})
    return {"ok": True, "xpaths": config}


@app.post("/prompt")
async def create_prompt(
    body: PromptRequest,
    x_bridge_token: str | None = Header(default=None),
):
    require_token(x_bridge_token)

    if not extensions:
        raise HTTPException(
            status_code=503,
            detail="No extension is connected. Open ChatGPT and enable the extension.",
        )

    # The browser extension has exactly one ChatGPT tab and can execute only
    # one prompt at a time. Keep the lock for the full request lifetime,
    # including waiting for the extension result.
    await prompt_execution_lock.acquire()
    lock_released = False

    def release_prompt_lock() -> None:
        nonlocal lock_released
        if not lock_released:
            lock_released = True
            prompt_execution_lock.release()

    current_task = asyncio.current_task()
    if current_task:
        current_task.add_done_callback(lambda _task: release_prompt_lock())
    job_id = str(uuid.uuid4())
    event = asyncio.Event()

    async with jobs_lock:
        jobs[job_id] = {
            "job_id": job_id,
            "kind": "text",
            "status": "queued",
            "prompt": body.prompt,
            "conversation_mode": body.conversation_mode,
            "created_at": time.time(),
            "event": event,
            "result": None,
            "error": None,
        }

    sent = await broadcast(
        {
            "type": "job",
            "job_id": job_id,
            "prompt": body.prompt,
            "conversation_mode": body.conversation_mode,
            "xpaths": load_xpaths(),
        }
    )

    if sent == 0:
        async with jobs_lock:
            jobs[job_id]["status"] = "failed"
            jobs[job_id]["error"] = "Extension disconnected before receiving the job"
        release_prompt_lock()
        raise HTTPException(status_code=503, detail="Extension disconnected")

    try:
        await asyncio.wait_for(event.wait(), timeout=body.timeout_seconds)
    except asyncio.TimeoutError:
        async with jobs_lock:
            job = jobs[job_id]
            job["status"] = "timeout"
            job["error"] = f"No result after {body.timeout_seconds} seconds"
        await broadcast({"type": "cancel", "job_id": job_id})
        release_prompt_lock()
        raise HTTPException(status_code=504, detail=jobs[job_id]["error"])

    job = jobs[job_id]
    if job["status"] == "completed":
        release_prompt_lock()
        return {
            "ok": True,
            "job_id": job_id,
            "answer": job["result"],
        }

    release_prompt_lock()
    raise HTTPException(
        status_code=500,
        detail=job["error"] or "Extension failed to execute the job",
    )


@app.post("/image-edit")
async def create_image_edit(
    body: ImageEditRequest,
    x_bridge_token: str | None = Header(default=None),
):
    require_token(x_bridge_token)
    if not extensions:
        raise HTTPException(status_code=503, detail="No extension is connected")

    started_at = asyncio.get_running_loop().time()
    try:
        await asyncio.wait_for(prompt_execution_lock.acquire(), timeout=body.timeout_seconds)
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="Timed out waiting for the ChatGPT tab") from exc
    lock_released = False

    def release_lock() -> None:
        nonlocal lock_released
        if not lock_released:
            lock_released = True
            prompt_execution_lock.release()

    current_task = asyncio.current_task()
    if current_task:
        current_task.add_done_callback(lambda _task: release_lock())
    job_id = str(uuid.uuid4())
    event = asyncio.Event()
    async with jobs_lock:
        jobs[job_id] = {
            "job_id": job_id,
            "kind": "image_edit",
            "status": "queued",
            "created_at": time.time(),
            "event": event,
            "result": None,
            "error": None,
        }
    sent = await broadcast({
        "type": "job",
        "kind": "image_edit",
        "job_id": job_id,
        "prompt": body.prompt,
        "images": [image.model_dump() for image in body.images],
        "conversation_mode": "new",
        "xpaths": load_xpaths(),
    })
    if sent == 0:
        jobs[job_id].update(status="failed", error="Extension disconnected")
        release_lock()
        raise HTTPException(status_code=503, detail="Extension disconnected")
    try:
        remaining = max(0, body.timeout_seconds - (asyncio.get_running_loop().time() - started_at))
        await asyncio.wait_for(event.wait(), timeout=remaining)
    except asyncio.TimeoutError:
        jobs[job_id].update(status="timeout", error="No image result before timeout")
        await broadcast({"type": "cancel", "job_id": job_id})
        release_lock()
        raise HTTPException(status_code=504, detail="No image result before timeout")
    job = jobs[job_id]
    release_lock()
    if job["status"] == "completed":
        image = job["result"]
        job["result"] = None
        return {"ok": True, "job_id": job_id, "image": image}
    raise HTTPException(status_code=502, detail=job["error"] or "Image generation failed")


@app.get("/jobs/{job_id}")
async def get_job(
    job_id: str,
    x_bridge_token: str | None = Header(default=None),
):
    require_token(x_bridge_token)
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        k: v
        for k, v in job.items()
        if k not in {"event", "prompt"}
    }

@app.websocket("/ws/extension")
async def extension_socket(websocket: WebSocket):
    token = websocket.query_params.get("token", "")

    if not secrets.compare_digest(token, BRIDGE_TOKEN):
        await websocket.close(code=4401, reason="Invalid token")
        return

    await websocket.accept()
    extensions.add(websocket)

    print(
        f"Extension connected. "
        f"Connected extensions: {len(extensions)}"
    )

    try:
        await send_json_safe(
            websocket,
            {
                "type": "hello",
                "server_time": time.time(),
                "xpaths": load_xpaths(),
            },
        )

        while True:
            try:
                message_event = await websocket.receive()
            except (WebSocketDisconnect, RuntimeError):
                break

            event_type = message_event.get("type")

            if event_type == "websocket.disconnect":
                break

            if event_type != "websocket.receive":
                continue

            raw = message_event.get("text")

            if raw is None:
                raw_bytes = message_event.get("bytes")

                if raw_bytes is None:
                    continue

                try:
                    raw = raw_bytes.decode("utf-8")
                except UnicodeDecodeError:
                    continue

            try:
                message = json.loads(raw)
            except json.JSONDecodeError:
                print("Extension sent invalid JSON:", raw)
                continue

            msg_type = message.get("type")

            if msg_type == "ping":
                await send_json_safe(
                    websocket,
                    {
                        "type": "pong",
                        "time": time.time(),
                    },
                )
                continue

            if msg_type == "job_started":
                job_id = message.get("job_id")
                job = jobs.get(job_id)

                if job:
                    job["status"] = "running"
                    print(f"Job started: {job_id}")

                continue

            if msg_type == "job_result":
                job_id = message.get("job_id")
                job = jobs.get(job_id)

                if not job:
                    print(f"Result for unknown job: {job_id}")
                    continue

                if job.get("status") in {"timeout", "failed"}:
                    continue
                if job.get("kind") == "image_edit":
                    image = message.get("image")
                    if not isinstance(image, dict) or not image.get("mime_type") or not image.get("data"):
                        job["status"] = "failed"
                        job["error"] = "Extension did not return an image"
                        job["event"].set()
                        continue
                    job["result"] = image
                else:
                    job["result"] = message.get("answer", "")
                job["status"] = "completed"
                job["error"] = None
                job["event"].set()

                print(f"Job completed: {job_id}")
                continue

            if msg_type == "job_error":
                job_id = message.get("job_id")
                job = jobs.get(job_id)

                error_message = message.get(
                    "error",
                    "Unknown extension error",
                )

                print(
                    f"Extension job error [{job_id}]: "
                    f"{error_message}"
                )

                if not job:
                    continue

                job["status"] = "failed"
                job["error"] = error_message
                job["event"].set()
                continue

    except asyncio.CancelledError:
        raise
    except Exception as error:
        print(
            "Unexpected WebSocket error:",
            type(error).__name__,
            str(error),
        )
    finally:
        extensions.discard(websocket)

        print(
            f"Extension disconnected. "
            f"Connected extensions: {len(extensions)}"
        )

        try:
            await websocket.close()
        except Exception:
            pass

if __name__ == "__main__":
    import uvicorn

    print(f"Bridge API: http://{HOST}:{PORT}")
    print(f"WebSocket: ws://{HOST}:{PORT}/ws/extension")
    print("Set BRIDGE_TOKEN before exposing this server outside localhost.")
    uvicorn.run(app, host=HOST, port=PORT)
