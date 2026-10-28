"""Read local pipeline activity independently of API and process liveness."""
import json
import os
import time
from pathlib import Path


def _is_pipeline_process(pid: int) -> bool:
    try:
        args = Path(f"/proc/{pid}/cmdline").read_bytes().split(b"\0")
        return b"scripts/shopify-pipeline-worker.ts" in args
    except OSError:
        return False


def pipeline_health(file: str, *, now: float | None = None, is_alive=_is_pipeline_process) -> str:
    try:
        record = json.loads(Path(file).read_text())
        pid = record.get("pid")
        updated = record.get("updatedAt")
        if type(pid) is not int or pid <= 0 or type(updated) not in (int, float):
            return "unavailable"
        age = (time.time() if now is None else now) - updated / 1000
        status = record.get("status")
        if not 0 <= age <= (180 if status == "starting" else 45):
            return "unavailable"
        if not is_alive(pid):
            return "unavailable"
        return status if status in ("healthy", "starting") else "unavailable"
    except (OSError, ValueError, TypeError, AttributeError):
        return "unavailable"


def attach_pipeline_health(snapshot: dict, *, file: str | None) -> dict:
    handoff = snapshot.get("seoQueueHandoff")
    if not file or not isinstance(handoff, dict):
        return snapshot
    return {**snapshot, "seoQueueHandoff": {**handoff, "workerStatus": pipeline_health(file)}}


if __name__ == "__main__":
    file = os.environ.get("FFP_PIPELINE_HEALTH_FILE")
    raise SystemExit(0 if file and pipeline_health(file) == "healthy" else 1)
