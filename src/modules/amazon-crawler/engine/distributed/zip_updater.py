"""Separate-process portable updater. Only the EXE and _internal are managed.

The helper runs from its own copy, keeps a recovery journal before every move,
and leaves user configuration and browser profiles outside the managed paths.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
import zipfile

from .zip_release import EXECUTABLE, MAX_EXPANDED_BYTES, validate_zip, verify_release


def reject_reparse(path: Path) -> None:
    for candidate in (path, *path.parents):
        if candidate.is_symlink() or getattr(candidate, "is_junction", lambda: False)():
            raise ValueError("Update paths cannot contain reparse points.")


def write_status(root: Path, stage: str, **extra) -> None:
    partial = root / "status.part"
    partial.write_text(json.dumps({"stage": stage, **extra}), encoding="utf-8")
    partial.replace(root / "status.json")


def prepare_update(install: Path, config: Path, data: Path, envelope: dict, archive: Path) -> Path:
    if os.name != "nt" or not getattr(sys, "frozen", False):
        raise ValueError("ZIP updates require the packaged Windows Agent.")
    install, config, data = install.absolute(), config.absolute(), data.absolute()
    for path in (install, config, data):
        reject_reparse(path)
    managed = [install / EXECUTABLE, install / "_internal"]
    if (not config.is_file() or not managed[0].is_file() or not managed[1].is_dir()
            or any(data == path or path in data.parents or config == path or path in config.parents for path in managed)):
        raise ValueError("Agent config/data must be outside managed executable/runtime paths.")
    manifest = verify_release(envelope)
    validate_zip(archive, manifest)
    # Probe write access without touching existing application files.
    probe = install / (".update-probe-" + uuid.uuid4().hex)
    with probe.open("xb"):
        pass
    probe.unlink()
    if shutil.disk_usage(install).free < MAX_EXPANDED_BYTES + archive.stat().st_size:
        raise ValueError("Insufficient disk space for update staging and recovery.")
    work = Path(tempfile.mkdtemp(prefix="ffp-zip-update-"))
    try:
        helper = work / "helper"
        helper.mkdir()
        shutil.copy2(managed[0], helper / EXECUTABLE)
        shutil.copytree(managed[1], helper / "_internal")
        shutil.copy2(archive, work / "release.zip")
        plan = {"install": str(install), "config": str(config), "data": str(data),
                "parentPid": os.getpid(), "release": envelope, "work": str(work)}
        (work / "plan.json").write_text(json.dumps(plan), encoding="utf-8")
        write_status(work, "PREPARED", version=manifest["version"])
        return work
    except Exception:
        # This is a newly allocated updater-only temporary directory.
        shutil.rmtree(work)
        raise


def launch_prepared_update(work: Path) -> None:
    log = work / "updater.log"
    with log.open("ab") as output:
        process = subprocess.Popen([str(work / "helper" / EXECUTABLE), "--apply-zip-update", str(work / "plan.json")],
                         cwd=work, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                         creationflags=0x08000000 | 0x00000008)
    # Do not shut down the working Agent until the helper has verified and
    # extracted everything. A broken helper must leave the old Agent alive.
    deadline = time.monotonic() + 120
    while process.poll() is None and time.monotonic() < deadline:
        try:
            status = json.loads((work / "status.json").read_text(encoding="utf-8"))
            if status.get("stage") == "WAITING_FOR_EXIT":
                return
        except (OSError, ValueError):
            pass
        time.sleep(0.2)
    if process.poll() is None:
        process.terminate()
        process.wait(timeout=10)
    raise ValueError("Updater did not become ready; the current Agent was not stopped.")


def wait_for_parent(pid: int, timeout: float = 120) -> None:
    import ctypes
    from ctypes import wintypes
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x00100000, False, pid)
    if not handle:
        if ctypes.get_last_error() == 87:  # Process already exited.
            return
        raise OSError("Cannot verify old Agent shutdown.")
    try:
        if kernel.WaitForSingleObject(handle, int(timeout * 1000)) != 0:
            raise TimeoutError("Old Agent did not exit; files were not changed.")
    finally:
        kernel.CloseHandle(handle)


def install_runtime(install: Path, staged: Path, recovery: Path, probe) -> None:
    """Roll back managed files if installation or the offline startup probe fails."""
    recovery.mkdir(exist_ok=False)
    moved: list[str] = []
    added: list[str] = []
    try:
        for name in (EXECUTABLE, "_internal"):
            write_status(recovery, "MOVING", moved=moved, added=added, next=name)
            (install / name).rename(recovery / name)
            moved.append(name)
            write_status(recovery, "INSTALLING", moved=moved, added=added, next=name)
            (staged / name).rename(install / name)
            added.append(name)
        write_status(recovery, "PROBING", moved=moved, added=added)
        probe()
        write_status(recovery, "INSTALLED", moved=moved, added=added)
    except Exception:
        # Retain failed new files for diagnostics instead of deleting user directories.
        for name in reversed(moved):
            if name in added:
                (install / name).rename(recovery / ("failed-" + name))
            (recovery / name).rename(install / name)
        write_status(recovery, "ROLLED_BACK")
        raise


def apply_update(plan_path: Path) -> int:
    from .instance_lock import AgentInstanceLock
    from .client_store import ClientStore
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    work = plan_path.absolute().parent
    if str(work) != plan["work"] or not work.name.startswith("ffp-zip-update-"):
        raise ValueError("Invalid updater workspace.")
    install, data, config = (Path(plan[key]) for key in ("install", "data", "config"))
    for path in (work, install, data, config):
        reject_reparse(path)
    manifest = verify_release(plan["release"])
    archive = work / "release.zip"
    validate_zip(archive, manifest)
    staged = install / (".ffp-staged-" + work.name)
    recovery = install / (".ffp-recovery-" + work.name)
    staged.mkdir(exist_ok=False)
    with zipfile.ZipFile(archive) as bundle:
        bundle.extractall(staged)
    write_status(work, "WAITING_FOR_EXIT")
    wait_for_parent(int(plan["parentPid"]))
    database_backup = work / "agent.sqlite3"
    receipt = work / "probe.json"
    try:
        with AgentInstanceLock(data):
            store = ClientStore(data / "agent.sqlite3")
            if store.drain_outbox_count() or store.recover_assignments():
                raise ValueError("Agent still has assignments or unacknowledged outbox; update cancelled.")
            store.set_paused(True)
            with sqlite3.connect(data / "agent.sqlite3") as source, sqlite3.connect(database_backup) as backup:
                source.backup(backup)

            def probe() -> None:
                completed = subprocess.run([str(install / EXECUTABLE), "--config", str(config),
                    "--zip-update-probe", str(receipt)], cwd=install, timeout=90,
                    creationflags=0x08000000, capture_output=True)
                if completed.returncode or not receipt.is_file():
                    raise ValueError("New Agent failed startup probe.")
                report = json.loads(receipt.read_text(encoding="utf-8"))
                if (report.get("version") != manifest["version"] or report.get("status") != "PASS"
                        or report.get("clientId") != store.client_id()):
                    raise ValueError("New Agent version, identity or database verification failed.")

            try:
                install_runtime(install, staged, recovery, probe)
            except Exception:
                # Probe has exited (subprocess.run kills and waits on timeout); no new work was admitted.
                with sqlite3.connect(database_backup) as backup, sqlite3.connect(data / "agent.sqlite3") as destination:
                    backup.backup(destination)
                raise
        write_status(work, "INSTALLED_AWAITING_CONNECTION", version=manifest["version"], recovery=str(recovery))
        shutil.copy2(work / "status.json", data / "last-zip-update.json")
    except Exception:
        write_status(work, "FAILED_OR_ROLLED_BACK", recovery=str(recovery))
        shutil.copy2(work / "status.json", data / "last-zip-update.json")
        subprocess.Popen([str(install / EXECUTABLE), "--config", str(config), "--start-minimized"],
                         cwd=install, creationflags=0x08000000)
        raise
    subprocess.Popen([str(install / EXECUTABLE), "--config", str(config), "--start-minimized"],
                     cwd=install, creationflags=0x08000000)
    # Network availability is not a reason to downgrade a locally verified runtime.
    return 0
