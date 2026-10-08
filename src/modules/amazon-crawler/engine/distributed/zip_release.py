"""Signed release metadata and bounded ZIP validation shared by server and agent."""
from __future__ import annotations

import base64
import hashlib
import json
import re
import stat
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from .release_trust import TRUSTED_RELEASE_KEYS

MAX_ARCHIVE_BYTES = 2 * 1024**3
MAX_EXPANDED_BYTES = 6 * 1024**3
EXECUTABLE = "FFPAmazonCrawlerAgent.exe"


def version_tuple(value: str) -> tuple[int, int, int]:
    if not isinstance(value, str) or not re.fullmatch(r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)", value):
        raise ValueError("Invalid stable release version.")
    major, minor, patch = value.split(".")
    return int(major), int(minor), int(patch)


def require_https(url: str) -> str:
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("Release downloads require HTTPS without embedded credentials.")
    return url


class SecureRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        require_https(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def read_release_url(url: str, limit: int = 65536) -> bytes:
    require_https(url)
    with urllib.request.build_opener(SecureRedirect()).open(url, timeout=30) as response:
        content = response.read(limit + 1)
    if len(content) > limit:
        raise ValueError("Release metadata exceeds size limit.")
    return content


def verify_release(envelope: object, *, keys: dict[str, str] | None = None) -> dict:
    trust = TRUSTED_RELEASE_KEYS if keys is None else keys
    if not isinstance(envelope, dict) or envelope.get("keyId") not in trust:
        raise ValueError("Release signing key is not trusted by this installation.")
    try:
        payload = base64.b64decode(envelope["payload"], validate=True)
        signature = base64.b64decode(envelope["signature"], validate=True)
        public_key = base64.b64decode(trust[envelope["keyId"]], validate=True)
        if len(payload) > 32768:
            raise ValueError("Manifest exceeds size limit.")
        Ed25519PublicKey.from_public_bytes(public_key).verify(signature, payload)
        manifest = json.loads(payload)
    except Exception as error:
        raise ValueError("Release signature or manifest is invalid.") from error
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 2 or manifest.get("platform") != "windows-x64":
        raise ValueError("Unsupported ZIP release schema or platform.")
    version_tuple(manifest.get("version"))
    version_tuple(manifest.get("minimumServerVersion"))
    require_https(manifest.get("url", ""))
    if (not isinstance(manifest.get("size"), int) or not 0 < manifest["size"] <= MAX_ARCHIVE_BYTES
            or not re.fullmatch(r"[a-f0-9]{64}", str(manifest.get("sha256", "")))
            or not isinstance(manifest.get("protocolVersion"), str)
            or not re.fullmatch(r"\d+", manifest["protocolVersion"])):
        raise ValueError("Invalid release checksum, size or protocol.")
    return manifest


def require_compatible(manifest: dict, current_version: str, server_version: str, protocol: str) -> None:
    if version_tuple(manifest["version"]) <= version_tuple(current_version):
        raise ValueError("Release is not newer than the installed Agent.")
    if version_tuple(server_version) < version_tuple(manifest["minimumServerVersion"]):
        raise ValueError("Coordinator upgrade is required before this Agent update.")
    if protocol != manifest["protocolVersion"]:
        raise ValueError("Release protocol is incompatible with the Coordinator.")


def validate_zip(archive: Path, manifest: dict) -> list[str]:
    if archive.stat().st_size != manifest["size"]:
        raise ValueError("ZIP size mismatch.")
    with archive.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != manifest["sha256"]:
            raise ValueError("ZIP checksum mismatch.")
    names: list[str] = []
    seen: set[str] = set()
    expanded = 0
    with zipfile.ZipFile(archive) as bundle:
        if len(bundle.infolist()) > 30000:
            raise ValueError("Too many ZIP entries.")
        for entry in bundle.infolist():
            name = entry.filename.rstrip("/")
            path = PurePosixPath(name)
            mode = entry.external_attr >> 16
            if (not name or "\\" in name or ":" in name or path.is_absolute()
                    or any(part in {".", "..", ""} or part.endswith((".", " "))
                           or re.fullmatch(r"(?i)(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?", part)
                           for part in name.split("/"))
                    or any(ord(char) < 32 for char in name)
                    or stat.S_ISLNK(mode) or entry.flag_bits & 1
                    or name.casefold() in seen
                    or (name not in {EXECUTABLE, "agent.json"} and path.parts[0] != "_internal")):
                raise ValueError("Unsafe or unexpected ZIP entry.")
            seen.add(name.casefold())
            expanded += entry.file_size
            if expanded > MAX_EXPANDED_BYTES:
                raise ValueError("Expanded ZIP exceeds size limit.")
            if not entry.is_dir():
                names.append(name)
        if EXECUTABLE not in names or not any(name.startswith("_internal/") for name in names):
            raise ValueError("ZIP is missing the packaged Agent runtime.")
        files = {name.casefold() for name in names}
        if any(str(parent).casefold() in files for name in names for parent in PurePosixPath(name).parents):
            raise ValueError("ZIP contains conflicting file and directory paths.")
        if bundle.testzip() is not None:
            raise ValueError("ZIP contains corrupt entries.")
    return names


def download_zip(manifest: dict, destination: Path, progress=lambda count, total: None) -> None:
    part = destination.with_suffix(".part")
    try:
        with urllib.request.build_opener(SecureRedirect()).open(require_https(manifest["url"]), timeout=30) as response:
            with part.open("xb") as output:
                count = 0
                while chunk := response.read(1024 * 1024):
                    count += len(chunk)
                    if count > manifest["size"]:
                        raise ValueError("Download exceeds signed release size.")
                    output.write(chunk)
                    progress(count, manifest["size"])
        validate_zip(part, manifest)
        part.replace(destination)
    finally:
        part.unlink(missing_ok=True)
