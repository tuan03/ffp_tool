"""Build a signed Windows ZIP release; never publish or print private key material."""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src/modules/amazon-crawler"))
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from engine.distributed import AGENT_VERSION, PROTOCOL_VERSION
from engine.distributed.release_trust import TRUSTED_RELEASE_KEYS
from engine.distributed.zip_release import EXECUTABLE, validate_zip, verify_release, require_https


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--generate-key", type=Path, help="Create a user-scoped Windows DPAPI key file (never overwrite).")
    parser.add_argument("--key-file", type=Path, help="Local DPAPI key; CI uses FFP_AGENT_RELEASE_PRIVATE_KEY (base64).")
    parser.add_argument("--key-id", required=True)
    parser.add_argument("--input", type=Path, default=Path("artifacts/windows/FFPAmazonCrawlerAgent"))
    parser.add_argument("--output", type=Path, default=Path("installer-output"))
    parser.add_argument("--release-base-url", default="https://github.com/tuan03/ffp_tool/releases/download")
    parser.add_argument("--notes", default="Windows Agent update")
    args = parser.parse_args()
    if args.generate_key:
        from engine.distributed.client_credentials import protect_secret
        key = Ed25519PrivateKey.generate()
        args.generate_key.parent.mkdir(parents=True, exist_ok=True)
        with args.generate_key.open("xb") as destination:
            destination.write(protect_secret(key.private_bytes_raw()))
        print(json.dumps({"keyId": args.key_id, "publicKey": base64.b64encode(key.public_key().public_bytes_raw()).decode()}))
        return
    if args.key_file:
        from engine.distributed.client_credentials import unprotect_secret
        raw = unprotect_secret(args.key_file.read_bytes())
    else:
        raw = base64.b64decode(os.environ["FFP_AGENT_RELEASE_PRIVATE_KEY"], validate=True)
    key = Ed25519PrivateKey.from_private_bytes(raw)
    public = base64.b64encode(key.public_key().public_bytes_raw()).decode()
    if TRUSTED_RELEASE_KEYS.get(args.key_id) != public:
        raise ValueError("Release key must match the public key embedded in the transition Agent.")
    require_https(args.release_base_url)
    args.output.mkdir(parents=True, exist_ok=True)
    filename = f"FFP-Amazon-Crawler-{AGENT_VERSION}-windows-x64.zip"
    archive = args.output / filename
    # Only executable/runtime are managed by updater; user agent.json is never replaced.
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        bundle.write(args.input / EXECUTABLE, EXECUTABLE)
        bundle.write(Path(__file__).resolve().parents[1] / "config/amazon-crawler-agent.example.json", "agent.json")
        for path in sorted((args.input / "_internal").rglob("*")):
            if path.is_symlink() or getattr(path, "is_junction", lambda: False)():
                raise ValueError("Release runtime cannot contain reparse points.")
            if path.is_file():
                bundle.write(path, path.relative_to(args.input).as_posix())
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    manifest = {"schemaVersion": 2, "platform": "windows-x64", "version": AGENT_VERSION,
                "minimumServerVersion": AGENT_VERSION, "protocolVersion": PROTOCOL_VERSION,
                "size": archive.stat().st_size, "sha256": digest,
                "url": f"{args.release_base_url.rstrip('/')}/agent-v{AGENT_VERSION}/{filename}",
                "publishedAt": datetime.now(timezone.utc).isoformat(), "notes": args.notes}
    validate_zip(archive, manifest)
    payload = json.dumps(manifest, ensure_ascii=False, separators=(",", ":")).encode()
    envelope = {"keyId": args.key_id, "payload": base64.b64encode(payload).decode(),
                "signature": base64.b64encode(key.sign(payload)).decode()}
    verify_release(envelope)
    (args.output / "latest-zip.json").write_text(json.dumps(envelope), encoding="utf-8")
    (args.output / (filename + ".sha256")).write_text(f"{digest}  {filename}\n", encoding="ascii")
    print(f"Verified ZIP release {AGENT_VERSION}: {archive}")


if __name__ == "__main__":
    main()
