"""Current resident memory of an agent and its descendants, without reading command lines."""
from __future__ import annotations

import ctypes
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_CPU_SAMPLE_LOCK = threading.Lock()
_CPU_SAMPLE: tuple[float, float] | None = None


def _windows_processes() -> dict[int, tuple[int, str, int | None]]:
    from ctypes import wintypes

    class ProcessEntry(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("usage", wintypes.DWORD), ("pid", wintypes.DWORD),
                    ("heap", ctypes.c_size_t), ("module", wintypes.DWORD), ("threads", wintypes.DWORD),
                    ("parent", wintypes.DWORD), ("priority", wintypes.LONG), ("flags", wintypes.DWORD),
                    ("name", wintypes.WCHAR * 260)]

    class MemoryCounters(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("faults", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in ("peak", "resident", "quotaPeakPaged", "quotaPaged", "quotaPeakNonPaged", "quotaNonPaged", "pagefile", "peakPagefile")
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    psapi = ctypes.WinDLL("psapi", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.Process32FirstW.argtypes = kernel.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
    kernel.Process32FirstW.restype = kernel.Process32NextW.restype = wintypes.BOOL
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    psapi.GetProcessMemoryInfo.argtypes = [wintypes.HANDLE, ctypes.POINTER(MemoryCounters), wintypes.DWORD]
    psapi.GetProcessMemoryInfo.restype = wintypes.BOOL
    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    if snapshot == ctypes.c_void_p(-1).value:
        raise OSError("Process enumeration is unavailable.")
    processes = {}
    try:
        entry = ProcessEntry(size=ctypes.sizeof(ProcessEntry))
        available = kernel.Process32FirstW(snapshot, ctypes.byref(entry))
        while available:
            # Read memory only after selecting descendants below; enumerating names is cheap.
            processes[int(entry.pid)] = (int(entry.parent), str(entry.name), None)
            available = kernel.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel.CloseHandle(snapshot)
    for pid in _descendants(processes, os.getpid()):
        handle = kernel.OpenProcess(0x410, False, pid)
        if handle:
            try:
                memory = MemoryCounters(size=ctypes.sizeof(MemoryCounters))
                if psapi.GetProcessMemoryInfo(handle, ctypes.byref(memory), memory.size):
                    parent, name, _ = processes[pid]
                    processes[pid] = (parent, name, int(memory.resident))
            finally:
                kernel.CloseHandle(handle)
    return processes


def _linux_processes() -> dict[int, tuple[int, str, int | None]]:
    processes = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            fields = dict(line.split(":", 1) for line in (entry / "status").read_text().splitlines() if ":" in line)
            rss = fields.get("VmRSS")
            processes[int(entry.name)] = (int(fields["PPid"]), fields["Name"].strip(), int(rss.split()[0]) * 1024 if rss else None)
        except (OSError, ValueError, KeyError):
            continue
    return processes


def _descendants(processes: dict[int, tuple[int, str, int | None]], root: int) -> set[int]:
    children: dict[int, list[int]] = {}
    for pid, (parent, _, _) in processes.items():
        children.setdefault(parent, []).append(pid)
    selected = set()
    pending = [root]
    while pending:
        pid = pending.pop()
        if pid in selected:
            continue
        selected.add(pid)
        pending.extend(children.get(pid, []))
    return selected & processes.keys()


def sample_resources() -> dict[str, Any]:
    global _CPU_SAMPLE
    timestamp = datetime.now(timezone.utc).isoformat()
    wall_now = time.monotonic()
    process_now = time.process_time()
    with _CPU_SAMPLE_LOCK:
        previous = _CPU_SAMPLE
        _CPU_SAMPLE = (wall_now, process_now)
    cpu_percent = None
    if previous is not None and wall_now > previous[0]:
        cpu_percent = max(0.0, min(100.0, (process_now - previous[1]) * 100.0
            / (wall_now - previous[0]) / max(1, os.cpu_count() or 1)))
    try:
        processes = _windows_processes() if os.name == "nt" else _linux_processes()
        selected = [processes[pid] for pid in _descendants(processes, os.getpid())]
        memory = [resident for _, _, resident in selected if resident is not None]
        return {"rssBytes": sum(memory) if memory else None, "cpuPercent": cpu_percent, "processCount": len(selected),
                "browserProcesses": sum(any(marker in name.casefold() for marker in ("chrome", "chromium", "msedge")) for _, name, _ in selected),
                "isComplete": bool(selected) and len(memory) == len(selected), "sampledAt": timestamp}
    except (OSError, ValueError):
        return {"rssBytes": None, "cpuPercent": cpu_percent, "browserProcesses": None, "processCount": None, "isComplete": False, "sampledAt": timestamp}
