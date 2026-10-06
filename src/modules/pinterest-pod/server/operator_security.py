"""Opt-in Pinterest operator sessions and destination-bound Coordinator transport."""
import base64
import hashlib
import os
import re
import secrets
import threading
import time
import urllib.request
from urllib.parse import urlsplit


def operator_credentials():
    username = os.getenv("PINTEREST_OPERATOR_USERNAME") or os.getenv("FFP_OPERATOR_USERNAME", "")
    password = os.getenv("PINTEREST_OPERATOR_PASSWORD") or os.getenv("FFP_OPERATOR_PASSWORD", "")
    if not username and not password:
        return None
    if not username or not password or ":" in username:
        raise ValueError("Incomplete Pinterest operator configuration")
    return (username + ":" + password).encode("utf-8")


def coordinator_operator_credentials():
    username = os.getenv("PINTEREST_COORDINATOR_OPERATOR_USERNAME", "")
    password = os.getenv("PINTEREST_COORDINATOR_OPERATOR_PASSWORD", "")
    if not username and not password:
        return None
    if not username or not password or ":" in username:
        raise ValueError("Incomplete Pinterest Coordinator operator configuration")
    return (username + ":" + password).encode("utf-8")


def credential_fingerprint(credentials):
    return hashlib.sha256(credentials).hexdigest()


def coordinator_headers(url):
    credentials = coordinator_operator_credentials()
    if credentials is None:
        return {}
    target = urlsplit(url)
    base = urlsplit(os.getenv("PINTEREST_COORDINATOR_URL", "http://127.0.0.1:8766"))
    if (target.scheme, target.netloc) != (base.scheme, base.netloc):
        return {}
    if target.username or target.password or not re.fullmatch(r"/api/v1/(clients|crawl-jobs|pinterest-jobs)(/[^?#]*)?", target.path):
        return {}
    if target.scheme != "https" and not (target.scheme == "http" and target.hostname in {"127.0.0.1", "localhost", "::1"}):
        raise ValueError("Coordinator operator transport requires HTTPS or loopback")
    return {"Authorization": "Basic " + base64.b64encode(credentials).decode("ascii")}


class NoCredentialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def open_coordinator_request(request, timeout):
    headers = coordinator_headers(request.full_url)
    for name, value in headers.items():
        request.add_header(name, value)
    if headers:
        return urllib.request.build_opener(NoCredentialRedirect()).open(request, timeout=timeout)
    return urllib.request.urlopen(request, timeout=timeout)


class OperatorSessions:
    """Bounded in-memory sessions: restart/credential rotation requires login again."""
    def __init__(self):
        self.sessions = {}
        self.lock = threading.Lock()

    def create(self, fingerprint, now=None):
        now = time.monotonic() if now is None else now
        with self.lock:
            self.sessions = {key: value for key, value in self.sessions.items() if value[1] > now}
            if len(self.sessions) >= 128:
                raise ValueError("Operator session limit reached")
            token = secrets.token_urlsafe(32)
            self.sessions[token] = (fingerprint, now + 3600)
            return token

    def accepts(self, token, fingerprint, now=None):
        now = time.monotonic() if now is None else now
        with self.lock:
            entry = self.sessions.get(token)
            return entry is not None and entry[0] == fingerprint and entry[1] > now

    def revoke(self, token):
        with self.lock:
            self.sessions.pop(token, None)
