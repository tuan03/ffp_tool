"""FFP local STDIO bridge. No content generation and no plaintext credentials."""
import argparse
import getpass
import json
import pathlib
import shutil
import sys
import threading
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request
import uuid
import random
from email.utils import parsedate_to_datetime

VERSION = "1.0.0-preview"
USER_AGENT = "FFP-SEO-Worker/1.0"


class SafeTransportError(RuntimeError):
    """Only fixed local messages; never include server bodies or credentials."""


ALLOWED_KEYRINGS = {
    "keyring.backends.Windows.WinVaultKeyring",
    "keyring.backends.macOS.Keyring",
    "keyring.backends.SecretService.Keyring",
}


def endpoint(value):
    parsed = urllib.parse.urlsplit(value)
    is_loopback_http = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if (parsed.scheme != "https" and not is_loopback_http) or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("An HTTPS endpoint, or HTTP loopback endpoint, without credentials/query is required")
    if parsed.path != "/mcp/seo-worker":
        raise ValueError("Endpoint must end with /mcp/seo-worker")
    return value


def secret_store():
    import keyring
    backend = keyring.get_keyring()
    name = type(backend).__module__ + "." + type(backend).__name__
    if name not in ALLOWED_KEYRINGS:
        raise RuntimeError("OS credential vault unavailable. Configure Windows Credential Manager, macOS Keychain or Linux Secret Service; plaintext fallback is forbidden.")
    return keyring


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Endpoint redirect refused; verify the configured FFP endpoint")


def can_retry(message):
    if message.get("method") in {"initialize", "tools/list", "resources/list", "resources/read", "ping"}:
        return True
    params = message.get("params", {})
    return message.get("method") == "tools/call" and (
        params.get("name") in {"worker_status", "queue_status", "run_status", "job_status", "job_get_context", "job_get_image",
                               "get_seo_performance", "list_seo_opportunities", "get_page_seo_evidence", "get_seo_change_history"}
        or bool(params.get("arguments", {}).get("requestId")))


def retry_delay(header, attempt, now=None):
    if header:
        try:
            delay = float(header)
        except ValueError:
            try:
                delay = parsedate_to_datetime(header).timestamp() - (time.time() if now is None else now)
            except (ValueError, TypeError, OverflowError):
                return None
        # Do not retry earlier than Retry-After or block the session indefinitely.
        return max(0, delay) if delay <= 120 else None
    return min(30, 2 ** attempt + random.random())


class Remote:
    def __init__(self, url, token):
        self.url, self.token = endpoint(url), token
        self.opener = urllib.request.build_opener(NoRedirect)

    def send(self, message):
        raw = json.dumps(message).encode()
        if len(raw) > 1_000_000:
            raise RuntimeError("Request too large")
        request = urllib.request.Request(self.url, data=raw, headers={
            "Authorization": "Bearer " + self.token,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "User-Agent": USER_AGENT,
        }, method="POST")
        for attempt in range(3):
            try:
                with self.opener.open(request, timeout=45) as response:
                    body = response.read(16_000_001)
                    if len(body) > 16_000_000:
                        raise RuntimeError("Response too large")
                    return json.loads(body) if body else None
            except urllib.error.HTTPError as error:
                error.close()
                if error.code not in {429, 502, 503, 504} or not can_retry(message) or attempt == 2:
                    if error.code == 403:
                        raise SafeTransportError("HTTP 403: request rejected by access policy. Check Cloudflare/WAF and use the updated Agent Pack.") from None
                    if error.code == 401:
                        raise SafeTransportError("HTTP 401: token rejected. Check expiry/revocation and copy the complete FFP worker token.") from None
                    raise SafeTransportError(f"HTTP {error.code}: FFP transport rejected request. Check server availability.") from None
                delay = retry_delay(error.headers.get("Retry-After"), attempt)
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                if not can_retry(message) or attempt == 2:
                    raise SafeTransportError("FFP transport unavailable; check network/TLS and resume safely.") from None
                delay = retry_delay(None, attempt)
            if delay is None:
                raise RuntimeError("Retry-After exceeds local budget; resume later")
            time.sleep(delay)


def tool_payload(response):
    result = (response or {}).get("result", {})
    if result.get("isError") or "error" in (response or {}):
        return None
    for block in result.get("content", []):
        if block.get("type") == "text":
            try:
                value = json.loads(block["text"])
                return value if isinstance(value, dict) else None
            except (ValueError, KeyError):
                return None
    return None


def call(remote, name, arguments, request_id="helper"):
    return remote.send({"jsonrpc": "2.0", "id": request_id, "method": "tools/call", "params": {"name": name, "arguments": arguments}})


class Heartbeat:
    def __init__(self, remote):
        self.remote = remote
        self.lease = None
        self.progress_at = 0
        self.lock = threading.Lock()
        self.stop = threading.Event()

    def observe(self, message, response):
        payload = tool_payload(response)
        if payload is None:
            return
        name = message.get("params", {}).get("name")
        with self.lock:
            if name == "queue_claim_next" and payload.get("lease"):
                self.lease = payload["lease"]
                self.progress_at = time.monotonic()
            elif name in {"job_save_analysis", "job_research_keywords", "job_choose_keywords", "job_submit_draft"}:
                self.progress_at = time.monotonic()
            elif name in {"job_release", "job_report_failure", "run_finish", "worker_finish"} or (name == "job_status" and payload.get("status") == "REVIEW_READY"):
                self.lease = None

    def tick(self):
        with self.lock:
            lease = self.lease
            if lease and time.monotonic() - self.progress_at >= 1800:
                self.lease = None
                print("FFP: paused heartbeat after 30 minutes without progress. Resume the run explicitly.", file=sys.stderr)
                return
        if not lease:
            return
        try:
            response = call(self.remote, "queue_heartbeat", {"lease": lease, "requestId": str(uuid.uuid4())}, "heartbeat")
            if tool_payload(response) is None:
                raise RuntimeError("Heartbeat rejected")
        except Exception:
            with self.lock:
                if self.lease == lease:
                    self.lease = None
            print("FFP: heartbeat stopped after connection/auth/lease failure. Check status and resume safely.", file=sys.stderr)

    def loop(self):
        while not self.stop.wait(60):
            self.tick()


def bridge(remote):
    heartbeat = Heartbeat(remote)
    threading.Thread(target=heartbeat.loop, daemon=True).start()
    try:
        while True:
            line = sys.stdin.buffer.readline(1_000_002)
            if not line:
                break
            if len(line) > 1_000_001:
                raise RuntimeError("Request too large")
            message = json.loads(line)
            try:
                response = remote.send(message)
                heartbeat.observe(message, response)
            except Exception:
                response = {"jsonrpc": "2.0", "id": message.get("id"), "error": {"code": -32000, "message": "FFP_CONNECTION_FAILED: check auth/network; reuse mutation requestId on retry"}}
            if "id" in message and response is not None:
                print(json.dumps(response), flush=True)
    finally:
        heartbeat.stop.set()


def setup(workspace, url, profile):
    workspace = pathlib.Path(workspace).resolve(strict=True)
    config = workspace / ".codex" / "config.toml"
    skill = workspace / ".agents" / "skills" / "ffp-seo"
    for candidate in [workspace / ".codex", workspace / ".agents", skill.parent, skill, config]:
        if candidate.is_symlink():
            raise RuntimeError("Setup refuses symlink destinations")
    existing = config.read_text(encoding="utf-8") if config.exists() else ""
    parsed = tomllib.loads(existing)
    if "ffp_seo_worker" in parsed.get("mcp_servers", {}) or skill.exists():
        raise RuntimeError("FFP configuration already exists; review it manually instead of overwriting")
    command = json.dumps(sys.executable)
    args = json.dumps([str(pathlib.Path(__file__).resolve()), "bridge", "--endpoint", endpoint(url), "--profile", profile])
    updated = existing + f'\n[mcp_servers.ffp_seo_worker]\ncommand = {command}\nargs = {args}\n'
    tomllib.loads(updated)
    config.parent.mkdir(parents=True, exist_ok=True)
    # Back up an existing config before a strictly additive edit.
    if config.exists():
        backup = config.with_name("config.toml.ffp-backup")
        if backup.exists():
            raise RuntimeError("Existing FFP backup requires manual review")
        shutil.copy2(config, backup)
    skill.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(pathlib.Path(__file__).parent / "skill", skill)
    config.write_text(updated, encoding="utf-8")
    print("Added FFP MCP and .agents/skills/ffp-seo. Restart Codex in this trusted workspace.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["login", "logout", "status", "doctor", "setup", "bridge"])
    parser.add_argument("--endpoint", required=True, type=endpoint)
    parser.add_argument("--profile", default="default")
    parser.add_argument("--workspace", default=".")
    options = parser.parse_args()
    if options.command == "setup":
        setup(options.workspace, options.endpoint, options.profile)
        return
    vault = secret_store()
    service = "ffp-seo-worker:" + options.endpoint
    if options.command == "doctor":
        print("Python >=3.11, secure endpoint policy and supported OS vault available. This does not certify live connectivity or cross-platform acceptance.")
        return
    if options.command == "logout":
        if vault.get_password(service, options.profile):
            vault.delete_password(service, options.profile)
        print("Local credential removed. Revoke token in FFP Agent Access to invalidate all copies.")
        return
    if options.command == "login":
        if not sys.stdin.isatty():
            raise RuntimeError("Login requires an interactive terminal with hidden input")
        token = getpass.getpass("FFP token (hidden): ")
        if not token.startswith("ffp_worker_") or any(char.isspace() for char in token):
            raise RuntimeError("Invalid token format")
        status = tool_payload(call(Remote(options.endpoint, token), "worker_status", {}))
        if not status:
            raise RuntimeError("Token rejected; nothing was stored")
        vault.set_password(service, options.profile, token)
        print("Stored in OS credential vault for worker " + status["workerId"] + "; stores: " + ", ".join(status.get("storeIds", [status["storeId"]])) + "; selected: " + status["storeId"])
        return
    token = vault.get_password(service, options.profile)
    if not token:
        raise RuntimeError("Not logged in; run login in an interactive terminal")
    remote = Remote(options.endpoint, token)
    if options.command == "status":
        payload = tool_payload(call(remote, "worker_status", {}))
        if not payload:
            raise RuntimeError("Token expired, revoked or unavailable")
        print(json.dumps(payload))
    else:
        bridge(remote)


if __name__ == "__main__":
    try:
        main()
    except SafeTransportError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        # Never echo third-party exceptions, HTTP bodies or credentials.
        print("FFP operation failed. Check endpoint, Python 3.11+, OS credential vault and token validity. No plaintext fallback is used.", file=sys.stderr)
        sys.exit(1)
