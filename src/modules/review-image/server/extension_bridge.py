"""Single authenticated browser executor, independent of HTTP/server ownership."""
import asyncio
from concurrent.futures import TimeoutError as FutureTimeoutError
import json
import secrets
import time
import uuid
from pathlib import Path

from fastapi import WebSocket, WebSocketDisconnect


class ExtensionBridge:
    def __init__(self, token):
        self.token = token
        self.socket = None
        self.lock = asyncio.Lock()
        self.pending = {}
        self.cancelled = {}
        self.loop = None
        self.stopping = False

    async def connect(self, socket: WebSocket):
        origin = socket.headers.get("origin", "")
        if socket.query_params or not origin.startswith("chrome-extension://"):
            await socket.close(code=4403)
            return
        await socket.accept()
        try:
            raw = await asyncio.wait_for(socket.receive_text(), 5)
            if len(raw) > 4096:
                raise ValueError("Invalid authentication frame")
            message = json.loads(raw)
            supplied = message.get("token") if isinstance(message, dict) else None
            if not isinstance(message, dict) or message.get("type") != "authenticate" or not isinstance(supplied, str) or not secrets.compare_digest(supplied, self.token):
                await socket.close(code=4401)
                return
            if self.socket is not None or self.stopping:
                await socket.close(code=4409)
                return
            self.socket = socket
            xpaths = json.loads(Path(__file__).with_name("xpathGPT.txt").read_text(encoding="utf-8"))
            await socket.send_json({"type": "hello", "xpaths": xpaths})
            while True:
                message = await socket.receive_json()
                if not isinstance(message, dict):
                    continue
                if message.get("type") == "ping":
                    await socket.send_json({"type": "pong"})
                    continue
                pending = self.pending.get(str(message.get("job_id", "")))
                if not pending or pending["future"].done():
                    continue
                if message.get("type") == "job_result":
                    pending["future"].set_result(message.get("image", {}))
                elif message.get("type") == "job_error":
                    pending["future"].set_exception(RuntimeError("Extension could not generate the image. Inspect the pinned ChatGPT tab."))
        except (WebSocketDisconnect, RuntimeError, ValueError, asyncio.TimeoutError):
            pass
        finally:
            if self.socket is socket:
                self.socket = None
                for pending in list(self.pending.values()):
                    if not pending["future"].done():
                        pending["future"].set_exception(RuntimeError("Extension disconnected; inspect ChatGPT before retrying."))
            try:
                await socket.close()
            except RuntimeError:
                pass

    async def generate(self, prompt, images, session):
        async with self.lock:
            self.cancelled = {key: expiry for key, expiry in self.cancelled.items() if expiry > time.monotonic()}
            if self.cancelled.pop(session, None):
                raise RuntimeError("Image generation cancelled")
            if self.socket is None or self.stopping:
                raise RuntimeError("No extension connected. Open ChatGPT and enable the extension.")
            job_id = uuid.uuid4().hex
            future = asyncio.get_running_loop().create_future()
            self.pending[job_id] = {"session": session, "future": future}
            try:
                await self.socket.send_json({"type": "job", "kind": "image_edit", "job_id": job_id,
                                             "prompt": prompt, "images": images, "conversation_mode": "session",
                                             "conversation_session_id": session})
                return await asyncio.wait_for(future, 900)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                if self.socket:
                    await self.socket.send_json({"type": "cancel", "job_id": job_id})
                raise RuntimeError("Image generation timed out; inspect ChatGPT before retrying.") from None
            finally:
                self.pending.pop(job_id, None)

    def generate_sync(self, prompt, images, session):
        if self.loop is None or self.stopping:
            raise RuntimeError("Review Studio is shutting down")
        future = asyncio.run_coroutine_threadsafe(self.generate(prompt, images, session), self.loop)
        try:
            return future.result(timeout=1800)
        except FutureTimeoutError:
            future.cancel()
            raise RuntimeError("Image queue timed out; inspect ChatGPT before retrying.") from None

    async def cancel(self, session):
        self.cancelled[session] = time.monotonic() + 1800
        if len(self.cancelled) > 500:
            self.cancelled.pop(next(iter(self.cancelled)))
        for job_id, pending in list(self.pending.items()):
            if pending["session"] == session:
                if not pending["future"].done():
                    pending["future"].set_exception(RuntimeError("Image generation cancelled"))
                if self.socket:
                    await self.socket.send_json({"type": "cancel", "job_id": job_id})

    async def shutdown(self):
        self.stopping = True
        for pending in list(self.pending.values()):
            if not pending["future"].done():
                pending["future"].set_exception(RuntimeError("Server shutting down; inspect ChatGPT before retrying."))
        if self.socket:
            await self.socket.close(code=1012)
