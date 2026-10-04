"""Wake the existing Windows dashboard without starting another crawler instance."""

from __future__ import annotations

import ctypes
import hashlib
import os
from ctypes import wintypes
from pathlib import Path


def activation_name(data_directory: Path) -> str:
    identity = os.path.normcase(str(data_directory.resolve()))
    return "Local\\FFPAgentDashboard-" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:32]


def _kernel() -> ctypes.WinDLL:
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateEventW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.BOOL, wintypes.LPCWSTR]
    kernel.CreateEventW.restype = wintypes.HANDLE
    kernel.OpenEventW.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.LPCWSTR]
    kernel.OpenEventW.restype = wintypes.HANDLE
    kernel.SetEvent.argtypes = [wintypes.HANDLE]
    kernel.SetEvent.restype = wintypes.BOOL
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.WaitForSingleObject.restype = wintypes.DWORD
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.CloseHandle.restype = wintypes.BOOL
    return kernel


class ActivationSignal:
    def __init__(self, data_directory: Path) -> None:
        self._kernel = _kernel()
        self._handle = self._kernel.CreateEventW(None, False, False, activation_name(data_directory))
        if not self._handle:
            raise ctypes.WinError(ctypes.get_last_error())

    def requested(self) -> bool:
        return bool(self._handle) and self._kernel.WaitForSingleObject(self._handle, 0) == 0

    def close(self) -> None:
        if self._handle:
            self._kernel.CloseHandle(self._handle)
            self._handle = None


def request_activation(data_directory: Path) -> bool:
    if os.name != "nt":
        return False
    kernel = _kernel()
    handle = kernel.OpenEventW(0x0002, False, activation_name(data_directory))
    if not handle:
        return False
    try:
        return bool(kernel.SetEvent(handle))
    finally:
        kernel.CloseHandle(handle)
