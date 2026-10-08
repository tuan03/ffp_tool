"""Coordinator release catalog: cache verified metadata, never advertise source version."""
import json
import os
import threading
import time

from .zip_release import read_release_url, verify_release

_lock = threading.Lock()
_cached: dict | None = None
_cached_until = 0.0
_cached_url = ""
_failure_until = 0.0


def cached_release_version() -> str | None:
    url = os.environ.get("FFP_AGENT_RELEASE_MANIFEST_URL", "").strip()
    return _cached["version"] if _cached and url == _cached_url and time.monotonic() < _cached_until else None


def load_release_catalog() -> dict:
    global _cached, _cached_until, _cached_url, _failure_until
    url = os.environ.get("FFP_AGENT_RELEASE_MANIFEST_URL", "").strip()
    if not url:
        raise ValueError("Agent ZIP release channel is not configured.")
    with _lock:
        now = time.monotonic()
        if url == _cached_url and _cached and now < _cached_until:
            return dict(_cached)
        if url == _cached_url and now < _failure_until:
            raise ValueError("Agent ZIP release channel is temporarily unavailable.")
        _cached_url = url
        try:
            envelope = json.loads(read_release_url(url))
            manifest = verify_release(envelope)
            _cached = {"release": envelope, "version": manifest["version"], "manifest": manifest}
            _cached_until = now + 300
            _failure_until = 0
            return dict(_cached)
        except Exception:
            _cached = None
            _failure_until = now + 30
            raise ValueError("Agent ZIP release is unavailable or its signature is invalid.") from None
