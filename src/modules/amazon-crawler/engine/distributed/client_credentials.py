"""User-scoped Windows DPAPI credentials; no plaintext fallback or redirects."""
from __future__ import annotations

import base64
import ctypes
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


def validate_secure_origin(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username is not None
            or parsed.password is not None or parsed.path not in ("", "/")
            or parsed.query or parsed.fragment or any(char.isspace() for char in url)):
        raise ValueError("AGENT_HTTPS_ORIGIN_REQUIRED")
    _ = parsed.port  # Reject malformed ports before storing or sending a key.
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc.lower(), "", "", ""))


def _crypt(payload: bytes, *, decrypt: bool) -> bytes:
    if sys.platform != "win32":
        raise ValueError("AGENT_WINDOWS_CREDENTIAL_STORE_REQUIRED")
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_ubyte))]

    crypt = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    operation = crypt.CryptUnprotectData if decrypt else crypt.CryptProtectData
    operation.argtypes = [ctypes.POINTER(Blob), ctypes.c_void_p, ctypes.c_void_p,
                          ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    operation.restype = wintypes.BOOL
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    buffer = (ctypes.c_ubyte * len(payload)).from_buffer_copy(payload)
    incoming, outgoing = Blob(len(payload), buffer), Blob()
    try:
        # UI_FORBIDDEN, deliberately NOT LOCAL_MACHINE: only the enrolled user can decrypt.
        if not operation(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
            raise ValueError("AGENT_CREDENTIAL_UNAVAILABLE")
        return ctypes.string_at(outgoing.data, outgoing.size)
    finally:
        ctypes.memset(buffer, 0, len(payload))
        if outgoing.data:
            ctypes.memset(outgoing.data, 0, outgoing.size)
            kernel.LocalFree(outgoing.data)


def protect_secret(payload: bytes) -> bytes:
    return _crypt(payload, decrypt=False)


def unprotect_secret(payload: bytes) -> bytes:
    return _crypt(payload, decrypt=True)


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise ValueError("AGENT_REDIRECT_REJECTED")


def credential_request(request: urllib.request.Request):
    return urllib.request.build_opener(_NoRedirect()).open(request, timeout=60)


def store_credential(store, origin: str, key: str) -> str:
    origin = validate_secure_origin(origin)
    if not re.fullmatch(r"ffp_agent_[0-9a-f]{32}_[A-Za-z0-9_-]{43}", key):
        raise ValueError("AGENT_KEY_INVALID")
    protected = protect_secret(json.dumps({"origin": origin, "key": key}).encode())
    return store.begin_enrollment(base64.b64encode(protected).decode("ascii"))


def load_credential(store, origin: str) -> tuple[str, str]:
    origin = validate_secure_origin(origin)
    protected, request_id = store.enrollment_state()
    try:
        payload = json.loads(unprotect_secret(base64.b64decode(protected, validate=True)))
        if (payload.get("origin") != origin or not isinstance(payload.get("key"), str)
                or not re.fullmatch(r"ffp_agent_[0-9a-f]{32}_[A-Za-z0-9_-]{43}", payload["key"])):
            raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise ValueError("AGENT_CREDENTIAL_UNAVAILABLE") from None
    return payload["key"], request_id


def enroll_agent(store, origin: str, display_name: str) -> str:
    origin = validate_secure_origin(origin)
    key, request_id = load_credential(store, origin)
    request = urllib.request.Request(origin + "/api/v1/worker/register",
        data=json.dumps({"requestId": request_id, "displayName": display_name}).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with credential_request(request) as response:
            payload = json.loads(response.read(8192))
    except urllib.error.HTTPError as error:
        raise ValueError("AGENT_NEED_REAUTH" if error.code in (401, 403, 409) else "AGENT_ENROLLMENT_FAILED") from None
    agent_id = payload.get("agentId")
    if payload.get("authProtocol") != 1 or not isinstance(agent_id, str) or not re.fullmatch("[0-9a-f]{32}", agent_id):
        raise ValueError("AGENT_ENROLLMENT_RESPONSE_INVALID")
    store.accept_enrollment(agent_id)
    return agent_id
