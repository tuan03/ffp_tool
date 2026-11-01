"""Centralized encrypted Etsy Open API v3 credential & rate-limit vault.

All Etsy API calls and OAuth2 token refreshes execute exclusively on the
Coordinator Server through this store:
- Credentials are encrypted at rest with Fernet (AES-128-CBC + HMAC-SHA256).
- Concurrent token refreshes are serialized via in-process lock + DB row/advisory
  lock and coalesced so rotated refresh tokens are never consumed twice.
- Deployments/restarts never overwrite newer DB tokens with stale env vars.
- Single-environment refresh guard (`refresh_enabled` + `environment_owner`)
  prevents Local and VPS from refreshing the same Etsy token family concurrently.
- Centralized Etsy rate-limit tracking respects `Retry-After` and stops tight
  retry loops when daily/per-second quota is exhausted.
- Raw tokens and shared secrets are NEVER returned in status/admin responses or
  sent to Windows Agents.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import json
import os
import threading
from typing import Any, Callable, Mapping
import urllib.error
import urllib.parse
import urllib.request

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import select, text
from sqlalchemy.orm import Session, sessionmaker

from .coordinator_models import EtsyOAuthCredential
from .protocol import iso_utc, utc_now


PRIMARY_CREDENTIAL_ID = "primary"
ETSY_API_ORIGIN = "https://openapi.etsy.com/v3/application"
ETSY_TOKEN_ENDPOINT = "https://api.etsy.com/v3/public/oauth/token"
ETSY_TOKEN_REFRESH_MARGIN_SECONDS = 90
ETSY_REFRESH_ADVISORY_LOCK_ID = 821773499
ETSY_DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9",
}


class EtsyAuthError(RuntimeError):
    """Base error for Etsy credential or authorization failures."""

    def __init__(self, message: str, *, code: str = "ETSY_AUTH_ERROR", status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


class EtsyAuthDisabledError(EtsyAuthError):
    """Raised when token refresh is disabled on this environment."""

    def __init__(self, message: str) -> None:
        super().__init__(message, code="ETSY_REFRESH_DISABLED", status_code=409)


class EtsyRateLimitError(RuntimeError):
    """Raised when Etsy API rate limit or daily quota blocks requests."""

    def __init__(
        self,
        message: str,
        *,
        retry_after_seconds: float,
        quota_exhausted: bool = False,
        headers: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = "ETSY_QUOTA_EXHAUSTED" if quota_exhausted else "ETSY_RATE_LIMITED"
        self.retry_after_seconds = max(1.0, float(retry_after_seconds))
        self.quota_exhausted = quota_exhausted
        self.headers = headers or {}


@dataclass(frozen=True)
class DecryptedEtsyCredentials:
    keystring: str
    shared_secret: str
    access_token: str | None
    refresh_token: str | None
    etsy_user_id: str | None
    token_expires_at: datetime | None
    refresh_enabled: bool
    environment_owner: str
    token_generation: int

    @property
    def api_key_header(self) -> str:
        if self.shared_secret:
            return f"{self.keystring}:{self.shared_secret}"
        return self.keystring


def _ensure_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _mask_keystring(keystring: str | None) -> str | None:
    clean = str(keystring or "").strip()
    if not clean:
        return None
    if len(clean) <= 6:
        return f"{clean[:2]}***"
    return f"{clean[:4]}...{clean[-3:]}"


def _extract_etsy_user_id(token: str | None) -> str | None:
    clean = str(token or "").strip()
    if "." not in clean:
        return None
    prefix = clean.split(".", 1)[0].strip()
    return prefix if prefix.isdigit() else None


def _parse_bool_env(name: str, default: bool | None = None) -> bool | None:
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    lowered = raw.strip().lower()
    if lowered in {"1", "true", "yes", "on"}:
        return True
    if lowered in {"0", "false", "no", "off"}:
        return False
    return default


def _derive_fernet(secret_seed: str | None = None) -> Fernet:
    explicit = (
        secret_seed
        or os.environ.get("FFP_ETSY_TOKEN_ENCRYPTION_KEY")
    )
    if not explicit or not str(explicit).strip():
        raise EtsyAuthError(
            "Thiếu FFP_ETSY_TOKEN_ENCRYPTION_KEY trên server để mã hóa token Etsy.",
            code="ETSY_ENCRYPTION_KEY_MISSING",
            status_code=500,
        )
    hkdf = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=b"ffp-etsy-oauth-vault-v1",
        info=b"etsy-oauth-credentials",
    )
    derived = base64.urlsafe_b64encode(hkdf.derive(str(explicit).strip().encode("utf-8")))
    return Fernet(derived)


def _parse_retry_after_seconds(headers: Mapping[str, Any] | None, *, now: datetime) -> float | None:
    if not headers:
        return None
    raw_value = None
    for key, value in headers.items():
        if str(key).lower() == "retry-after" and value is not None:
            raw_value = str(value).strip()
            break
    if not raw_value:
        return None
    try:
        return max(1.0, float(raw_value))
    except ValueError:
        pass
    try:
        parsed_dt = parsedate_to_datetime(raw_value)
        if parsed_dt.tzinfo is None:
            parsed_dt = parsed_dt.replace(tzinfo=timezone.utc)
        delta = (parsed_dt.astimezone(timezone.utc) - now).total_seconds()
        return max(1.0, delta)
    except Exception:
        return None


def _header_int(headers: Mapping[str, Any] | None, target_name: str) -> int | None:
    if not headers:
        return None
    lowered_target = target_name.lower()
    for key, value in headers.items():
        if str(key).lower() == lowered_target and value is not None:
            try:
                return int(str(value).strip())
            except ValueError:
                return None
    return None


HttpTransport = Callable[[str, str, dict[str, str], bytes | None, float], tuple[int, dict[str, str], str]]


def _default_http_transport(
    method: str,
    url: str,
    headers: dict[str, str],
    body: bytes | None,
    timeout_seconds: float,
) -> tuple[int, dict[str, str], str]:
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            charset = response.headers.get_content_charset() or "utf-8"
            text_body = response.read().decode(charset, errors="replace")
            response_headers = {str(k): str(v) for k, v in response.headers.items()}
            return int(response.status), response_headers, text_body
    except urllib.error.HTTPError as exc:
        charset = exc.headers.get_content_charset() if exc.headers else None
        raw_bytes = exc.read() if hasattr(exc, "read") else b""
        text_body = raw_bytes.decode(charset or "utf-8", errors="replace") if raw_bytes else ""
        response_headers = {str(k): str(v) for k, v in (exc.headers.items() if exc.headers else [])}
        return int(exc.code), response_headers, text_body


class EtsyAuthStore:
    """Thread-safe, DB-locked manager for Etsy Open API v3 credentials and rate limits."""

    def __init__(
        self,
        session_factory: sessionmaker[Session],
        *,
        encryption_secret: str | None = None,
        http_transport: HttpTransport | None = None,
        sleep_fn: Callable[[float], None] | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._encryption_secret = encryption_secret
        self._http_transport = http_transport or _default_http_transport
        self._refresh_lock = threading.Lock()
        import time as _time
        self._sleep = sleep_fn or _time.sleep

    def _fernet(self) -> Fernet:
        return _derive_fernet(self._encryption_secret)

    def _encrypt(self, value: str | None) -> str | None:
        clean = str(value or "").strip()
        if not clean:
            return None
        return self._fernet().encrypt(clean.encode("utf-8")).decode("ascii")

    def _decrypt(self, ciphertext: str | None) -> str | None:
        if not ciphertext:
            return None
        try:
            return self._fernet().decrypt(ciphertext.encode("ascii")).decode("utf-8")
        except InvalidToken as exc:
            raise EtsyAuthError(
                "Không thể giải mã thông tin xác thực Etsy (FFP_ETSY_TOKEN_ENCRYPTION_KEY không khớp).",
                code="ETSY_DECRYPT_FAILED",
                status_code=500,
            ) from exc

    def _active_environment_name(self) -> str:
        configured = str(os.environ.get("ETSY_TOKEN_ENVIRONMENT") or "").strip()
        if configured:
            return configured
        return "vps" if os.environ.get("NODE_ENV") == "production" else "local"

    def _is_refresh_allowed_on_this_node(self, row: EtsyOAuthCredential) -> tuple[bool, str | None]:
        env_toggle = _parse_bool_env("ETSY_TOKEN_REFRESH_ENABLED", default=None)
        if env_toggle is False:
            return False, "Biến môi trường ETSY_TOKEN_REFRESH_ENABLED đang tắt làm mới token trên môi trường này."
        if not bool(row.refresh_enabled):
            return False, "Làm mới token Etsy đang bị tắt trong cấu hình quản trị."
        configured_env = self._active_environment_name()
        owner = str(row.environment_owner or "").strip()
        if configured_env and owner and configured_env != owner:
            return (
                False,
                f"Môi trường hiện tại ({configured_env}) không phải môi trường giữ quyền refresh ({owner}).",
            )
        return True, None

    def _lock_credential_row(self, session: Session) -> EtsyOAuthCredential | None:
        bind = session.get_bind()
        dialect_name = bind.dialect.name if bind is not None else ""
        if dialect_name == "postgresql":
            session.execute(
                text("SELECT pg_advisory_xact_lock(:lock_id)"),
                {"lock_id": ETSY_REFRESH_ADVISORY_LOCK_ID},
            )
            return session.scalar(
                select(EtsyOAuthCredential)
                .where(EtsyOAuthCredential.id == PRIMARY_CREDENTIAL_ID)
                .with_for_update()
            )
        return session.scalar(
            select(EtsyOAuthCredential).where(EtsyOAuthCredential.id == PRIMARY_CREDENTIAL_ID)
        )

    def bootstrap_from_env_if_empty(self) -> bool:
        """Seed encrypted Etsy credentials from environment ONLY when DB has no credentials.

        Never overwrites an existing DB credential record on deploy/restart.
        """
        keystring = str(os.environ.get("ETSY_API_KEYSTRING") or "").strip()
        shared_secret = str(
            os.environ.get("ETSY_API_SHARED_SECRET") or os.environ.get("ETSY_SHARED_SECRET") or ""
        ).strip()
        access_token = str(
            os.environ.get("ETSY_OAUTH_ACCESS_TOKEN") or os.environ.get("ETSY_ACCESS_TOKEN") or ""
        ).strip()
        refresh_token = str(
            os.environ.get("ETSY_OAUTH_REFRESH_TOKEN") or os.environ.get("ETSY_REFRESH_TOKEN") or ""
        ).strip()
        if not keystring and not refresh_token and not access_token:
            return False

        raw_expiry = str(os.environ.get("ETSY_ACCESS_TOKEN_EXPIRES_AT") or "").strip()
        expires_at: datetime | None = None
        if raw_expiry:
            try:
                expires_at = datetime.fromtimestamp(float(raw_expiry), tz=timezone.utc)
            except ValueError:
                expires_at = None

        refresh_enabled = _parse_bool_env("ETSY_TOKEN_REFRESH_ENABLED", default=True)
        environment_owner = str(
            os.environ.get("ETSY_TOKEN_ENVIRONMENT_OWNER") or self._active_environment_name()
        ).strip() or "local"

        with self._refresh_lock:
            with self._session_factory.begin() as session:
                existing = self._lock_credential_row(session)
                if existing is not None and (
                    existing.keystring_ciphertext
                    or existing.refresh_token_ciphertext
                    or existing.access_token_ciphertext
                    or existing.token_generation > 0
                ):
                    return False

                now = utc_now()
                user_id = _extract_etsy_user_id(access_token) or _extract_etsy_user_id(refresh_token)
                if existing is None:
                    row = EtsyOAuthCredential(
                        id=PRIMARY_CREDENTIAL_ID,
                        keystring_ciphertext=self._encrypt(keystring),
                        shared_secret_ciphertext=self._encrypt(shared_secret),
                        access_token_ciphertext=self._encrypt(access_token),
                        refresh_token_ciphertext=self._encrypt(refresh_token),
                        keystring_hint=_mask_keystring(keystring),
                        etsy_user_id=user_id,
                        token_expires_at=expires_at,
                        refresh_enabled=bool(refresh_enabled),
                        environment_owner=environment_owner,
                        token_generation=1 if (access_token or refresh_token) else 0,
                        rate_limit_state={},
                        created_at=now,
                        updated_at=now,
                    )
                    session.add(row)
                else:
                    existing.keystring_ciphertext = self._encrypt(keystring)
                    existing.shared_secret_ciphertext = self._encrypt(shared_secret)
                    existing.access_token_ciphertext = self._encrypt(access_token)
                    existing.refresh_token_ciphertext = self._encrypt(refresh_token)
                    existing.keystring_hint = _mask_keystring(keystring)
                    existing.etsy_user_id = user_id
                    existing.token_expires_at = expires_at
                    existing.refresh_enabled = bool(refresh_enabled)
                    existing.environment_owner = environment_owner
                    existing.token_generation = 1 if (access_token or refresh_token) else 0
                    existing.updated_at = now
                return True

    def _decrypt_row(self, row: EtsyOAuthCredential) -> DecryptedEtsyCredentials:
        keystring = self._decrypt(row.keystring_ciphertext) or ""
        shared_secret = self._decrypt(row.shared_secret_ciphertext) or ""
        access_token = self._decrypt(row.access_token_ciphertext)
        refresh_token = self._decrypt(row.refresh_token_ciphertext)
        return DecryptedEtsyCredentials(
            keystring=keystring,
            shared_secret=shared_secret,
            access_token=access_token,
            refresh_token=refresh_token,
            etsy_user_id=row.etsy_user_id or _extract_etsy_user_id(access_token) or _extract_etsy_user_id(refresh_token),
            token_expires_at=_ensure_utc(row.token_expires_at),
            refresh_enabled=bool(row.refresh_enabled),
            environment_owner=str(row.environment_owner or "local"),
            token_generation=int(row.token_generation or 0),
        )

    def get_rate_limit_snapshot(self, session: Session | None = None, *, now: datetime | None = None) -> dict[str, Any]:
        current_now = _ensure_utc(now) or utc_now()
        if session is not None:
            row = session.get(EtsyOAuthCredential, PRIMARY_CREDENTIAL_ID)
            state = dict(row.rate_limit_state or {}) if row else {}
        else:
            with self._session_factory() as local_session:
                row = local_session.get(EtsyOAuthCredential, PRIMARY_CREDENTIAL_ID)
                state = dict(row.rate_limit_state or {}) if row else {}

        cooldown_raw = state.get("cooldownUntil")
        cooldown_dt: datetime | None = None
        if isinstance(cooldown_raw, str) and cooldown_raw.strip():
            try:
                cooldown_dt = datetime.fromisoformat(cooldown_raw.replace("Z", "+00:00"))
                cooldown_dt = _ensure_utc(cooldown_dt)
            except ValueError:
                cooldown_dt = None

        retry_after = 0.0
        is_limited = False
        if cooldown_dt and cooldown_dt > current_now:
            is_limited = True
            retry_after = round((cooldown_dt - current_now).total_seconds(), 1)

        return {
            "isRateLimited": is_limited,
            "retryAfterSeconds": retry_after if is_limited else 0.0,
            "cooldownUntil": iso_utc(cooldown_dt) if cooldown_dt and is_limited else None,
            "quotaExhausted": bool(state.get("quotaExhausted")) if is_limited else False,
            "limitPerSecond": state.get("limitPerSecond"),
            "remainingThisSecond": state.get("remainingThisSecond"),
            "limitPerDay": state.get("limitPerDay"),
            "remainingToday": state.get("remainingToday"),
            "updatedAt": state.get("updatedAt"),
        }

    def is_rate_limited(self, session: Session | None = None, *, now: datetime | None = None) -> bool:
        return bool(self.get_rate_limit_snapshot(session, now=now).get("isRateLimited"))

    def _record_rate_limit_headers(
        self,
        headers: Mapping[str, Any] | None,
        *,
        status_code: int,
        now: datetime | None = None,
    ) -> dict[str, Any]:
        current_now = _ensure_utc(now) or utc_now()
        limit_per_sec = _header_int(headers, "x-limit-per-second")
        rem_sec = _header_int(headers, "x-remaining-this-second")
        limit_day = _header_int(headers, "x-limit-per-day")
        rem_day = _header_int(headers, "x-remaining-today")
        retry_after = _parse_retry_after_seconds(headers, now=current_now)

        has_any_header = any(
            item is not None for item in (limit_per_sec, rem_sec, limit_day, rem_day, retry_after)
        )
        if not has_any_header and status_code != 429:
            return {}

        quota_exhausted = rem_day is not None and rem_day <= 0
        cooldown_until: datetime | None = None
        effective_retry_after: float | None = None
        if status_code == 429 or quota_exhausted:
            if retry_after is not None:
                effective_retry_after = retry_after
            elif quota_exhausted:
                effective_retry_after = 3600.0
            else:
                effective_retry_after = 5.0
            cooldown_until = current_now + timedelta(seconds=effective_retry_after)

        with self._session_factory.begin() as session:
            row = session.get(EtsyOAuthCredential, PRIMARY_CREDENTIAL_ID)
            if row is not None:
                previous = dict(row.rate_limit_state or {})
                next_state = {
                    "limitPerSecond": limit_per_sec if limit_per_sec is not None else previous.get("limitPerSecond"),
                    "remainingThisSecond": rem_sec if rem_sec is not None else previous.get("remainingThisSecond"),
                    "limitPerDay": limit_day if limit_day is not None else previous.get("limitPerDay"),
                    "remainingToday": rem_day if rem_day is not None else previous.get("remainingToday"),
                    "retryAfterSeconds": effective_retry_after,
                    "cooldownUntil": iso_utc(cooldown_until) if cooldown_until else None,
                    "quotaExhausted": quota_exhausted,
                    "updatedAt": iso_utc(current_now),
                }
                row.rate_limit_state = next_state
                row.updated_at = current_now
                return next_state

        return {
            "limitPerSecond": limit_per_sec,
            "remainingThisSecond": rem_sec,
            "limitPerDay": limit_day,
            "remainingToday": rem_day,
            "retryAfterSeconds": effective_retry_after,
            "cooldownUntil": iso_utc(cooldown_until) if cooldown_until else None,
            "quotaExhausted": quota_exhausted,
            "updatedAt": iso_utc(current_now),
        }

    def get_status(self) -> dict[str, Any]:
        """Return safe operator-facing Etsy connection status (NEVER exposes secrets/tokens)."""
        with self._session_factory() as session:
            row = session.get(EtsyOAuthCredential, PRIMARY_CREDENTIAL_ID)
            if row is None:
                return {
                    "configured": False,
                    "hasApiKey": False,
                    "hasSharedSecret": False,
                    "hasAccessToken": False,
                    "hasRefreshToken": False,
                    "keystringHint": None,
                    "etsyUserId": None,
                    "tokenExpiresAt": None,
                    "tokenExpired": False,
                    "refreshEnabled": bool(_parse_bool_env("ETSY_TOKEN_REFRESH_ENABLED", default=True)),
                    "refreshAllowedOnCurrentNode": bool(_parse_bool_env("ETSY_TOKEN_REFRESH_ENABLED", default=True)),
                    "refreshBlockReason": None,
                    "environmentOwner": self._active_environment_name(),
                    "currentEnvironment": self._active_environment_name(),
                    "tokenGeneration": 0,
                    "lastRefreshedAt": None,
                    "lastVerifiedAt": None,
                    "lastError": None,
                    "rateLimit": self.get_rate_limit_snapshot(session),
                }

            now = utc_now()
            expires_at = _ensure_utc(row.token_expires_at)
            refresh_allowed, block_reason = self._is_refresh_allowed_on_this_node(row)
            has_api_key = bool(row.keystring_ciphertext)
            has_secret = bool(row.shared_secret_ciphertext)
            has_access = bool(row.access_token_ciphertext)
            has_refresh = bool(row.refresh_token_ciphertext)
            return {
                "configured": bool(has_api_key and has_secret),
                "hasApiKey": has_api_key,
                "hasSharedSecret": has_secret,
                "hasAccessToken": has_access,
                "hasRefreshToken": has_refresh,
                "keystringHint": row.keystring_hint,
                "etsyUserId": row.etsy_user_id,
                "tokenExpiresAt": iso_utc(expires_at),
                "tokenExpired": bool(expires_at and expires_at <= now),
                "refreshEnabled": bool(row.refresh_enabled),
                "refreshAllowedOnCurrentNode": refresh_allowed,
                "refreshBlockReason": block_reason,
                "environmentOwner": row.environment_owner or "local",
                "currentEnvironment": self._active_environment_name(),
                "tokenGeneration": int(row.token_generation or 0),
                "lastRefreshedAt": iso_utc(_ensure_utc(row.last_refreshed_at)),
                "lastVerifiedAt": iso_utc(_ensure_utc(row.last_verified_at)),
                "lastError": row.last_error,
                "rateLimit": self.get_rate_limit_snapshot(session, now=now),
            }

    def update_credentials(
        self,
        *,
        keystring: str | None = None,
        shared_secret: str | None = None,
        access_token: str | None = None,
        refresh_token: str | None = None,
        token_expires_at: datetime | int | float | str | None = None,
        refresh_enabled: bool | None = None,
        environment_owner: str | None = None,
    ) -> dict[str, Any]:
        """Atomically update encrypted Etsy credentials without echoing raw values back."""
        parsed_expiry: datetime | None = None
        if isinstance(token_expires_at, datetime):
            parsed_expiry = _ensure_utc(token_expires_at)
        elif isinstance(token_expires_at, (int, float)):
            parsed_expiry = datetime.fromtimestamp(float(token_expires_at), tz=timezone.utc)
        elif isinstance(token_expires_at, str) and token_expires_at.strip():
            raw = token_expires_at.strip()
            try:
                parsed_expiry = datetime.fromtimestamp(float(raw), tz=timezone.utc)
            except ValueError:
                parsed_expiry = _ensure_utc(datetime.fromisoformat(raw.replace("Z", "+00:00")))

        with self._refresh_lock:
            with self._session_factory.begin() as session:
                row = self._lock_credential_row(session)
                now = utc_now()
                if row is None:
                    row = EtsyOAuthCredential(
                        id=PRIMARY_CREDENTIAL_ID,
                        refresh_enabled=True if refresh_enabled is None else bool(refresh_enabled),
                        environment_owner=str(environment_owner or self._active_environment_name()).strip() or "local",
                        token_generation=0,
                        rate_limit_state={},
                        created_at=now,
                        updated_at=now,
                    )
                    session.add(row)

                token_changed = False
                if keystring is not None and keystring.strip():
                    clean_key = keystring.strip()
                    row.keystring_ciphertext = self._encrypt(clean_key)
                    row.keystring_hint = _mask_keystring(clean_key)
                if shared_secret is not None and shared_secret.strip():
                    row.shared_secret_ciphertext = self._encrypt(shared_secret.strip())
                if access_token is not None and access_token.strip():
                    clean_access = access_token.strip()
                    row.access_token_ciphertext = self._encrypt(clean_access)
                    row.etsy_user_id = _extract_etsy_user_id(clean_access) or row.etsy_user_id
                    token_changed = True
                if refresh_token is not None and refresh_token.strip():
                    clean_refresh = refresh_token.strip()
                    row.refresh_token_ciphertext = self._encrypt(clean_refresh)
                    row.etsy_user_id = _extract_etsy_user_id(clean_refresh) or row.etsy_user_id
                    token_changed = True
                if parsed_expiry is not None:
                    row.token_expires_at = parsed_expiry
                if refresh_enabled is not None:
                    row.refresh_enabled = bool(refresh_enabled)
                if environment_owner is not None and environment_owner.strip():
                    row.environment_owner = environment_owner.strip()
                if token_changed:
                    row.token_generation = int(row.token_generation or 0) + 1
                    row.last_error = None
                row.updated_at = now

        return self.get_status()

    def get_valid_credentials(self, *, require_oauth: bool = False) -> DecryptedEtsyCredentials:
        with self._session_factory() as session:
            row = session.get(EtsyOAuthCredential, PRIMARY_CREDENTIAL_ID)
            if row is None:
                raise EtsyAuthError(
                    "Chưa cấu hình kết nối Etsy API trên server.",
                    code="ETSY_NOT_CONFIGURED",
                    status_code=400,
                )
            creds = self._decrypt_row(row)

        if not creds.keystring or not creds.shared_secret:
            raise EtsyAuthError(
                "Thiếu Etsy API keystring hoặc shared secret trên server.",
                code="ETSY_API_KEY_MISSING",
                status_code=400,
            )

        if not require_oauth:
            return creds

        now = utc_now()
        needs_refresh = (
            not creds.access_token
            or (
                creds.token_expires_at is not None
                and creds.token_expires_at <= now + timedelta(seconds=ETSY_TOKEN_REFRESH_MARGIN_SECONDS)
            )
        )
        if needs_refresh:
            if not creds.refresh_token:
                raise EtsyAuthError(
                    "Thiếu Etsy OAuth refresh token để tải biến thể Inventory.",
                    code="ETSY_OAUTH_MISSING",
                    status_code=401,
                )
            return self.refresh_access_token(
                stale_access_token=creds.access_token,
                seen_generation=creds.token_generation,
                reason="expiring_or_missing",
            )
        return creds

    def refresh_access_token(
        self,
        *,
        stale_access_token: str | None = None,
        seen_generation: int | None = None,
        reason: str = "manual",
        force: bool = False,
    ) -> DecryptedEtsyCredentials:
        """Atomically refresh Etsy OAuth2 access & refresh tokens with coalescing."""
        with self._refresh_lock:
            with self._session_factory.begin() as session:
                row = self._lock_credential_row(session)
                if row is None:
                    raise EtsyAuthError(
                        "Chưa cấu hình kết nối Etsy API trên server.",
                        code="ETSY_NOT_CONFIGURED",
                        status_code=400,
                    )
                current = self._decrypt_row(row)
                now = utc_now()

                if not force:
                    if (
                        seen_generation is not None
                        and current.token_generation > seen_generation
                        and current.access_token
                    ):
                        return current
                    if (
                        stale_access_token
                        and current.access_token
                        and current.access_token != stale_access_token
                    ):
                        return current
                    if (
                        not stale_access_token
                        and current.access_token
                        and current.token_expires_at is not None
                        and current.token_expires_at > now + timedelta(seconds=ETSY_TOKEN_REFRESH_MARGIN_SECONDS)
                    ):
                        return current

                allowed, block_reason = self._is_refresh_allowed_on_this_node(row)
                if not allowed:
                    row.last_error = block_reason
                    row.updated_at = now
                    raise EtsyAuthDisabledError(block_reason or "Làm mới token Etsy đang bị khóa.")

                if not current.keystring or not current.shared_secret:
                    raise EtsyAuthError(
                        "Thiếu Etsy API keystring hoặc shared secret để làm mới OAuth token.",
                        code="ETSY_API_KEY_MISSING",
                        status_code=400,
                    )
                if not current.refresh_token:
                    raise EtsyAuthError(
                        "Thiếu Etsy OAuth refresh token trên server.",
                        code="ETSY_OAUTH_MISSING",
                        status_code=401,
                    )

                form_body = urllib.parse.urlencode(
                    {
                        "grant_type": "refresh_token",
                        "client_id": current.keystring,
                        "refresh_token": current.refresh_token,
                    }
                ).encode("utf-8")
                headers = {
                    **ETSY_DEFAULT_HEADERS,
                    "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
                    "x-api-key": current.api_key_header,
                }
                status_code, response_headers, raw_body = self._http_transport(
                    "POST",
                    ETSY_TOKEN_ENDPOINT,
                    headers,
                    form_body,
                    30.0,
                )

                if status_code == 429:
                    retry_after = _parse_retry_after_seconds(response_headers, now=now) or 10.0
                    rem_day = _header_int(response_headers, "x-remaining-today")
                    row.last_error = f"Etsy giới hạn tần suất khi refresh token (HTTP 429, chờ {int(retry_after)}s)."
                    row.updated_at = now
                    raise EtsyRateLimitError(
                        row.last_error,
                        retry_after_seconds=retry_after,
                        quota_exhausted=rem_day is not None and rem_day <= 0,
                        headers=response_headers,
                    )

                if status_code < 200 or status_code >= 300:
                    error_detail = f"Etsy OAuth refresh thất bại với HTTP {status_code}."
                    try:
                        parsed_err = json.loads(raw_body) if raw_body else {}
                        err_desc = parsed_err.get("error_description") or parsed_err.get("error")
                        if err_desc:
                            error_detail = f"Etsy OAuth refresh thất bại (HTTP {status_code}): {err_desc}"
                    except Exception:
                        pass
                    row.last_error = error_detail
                    row.updated_at = now
                    raise EtsyAuthError(
                        error_detail,
                        code="ETSY_OAUTH_REFRESH_FAILED",
                        status_code=401 if status_code in {400, 401, 403} else 502,
                    )

                try:
                    payload = json.loads(raw_body) if raw_body else {}
                except ValueError as exc:
                    row.last_error = "Phản hồi refresh OAuth từ Etsy không phải JSON hợp lệ."
                    row.updated_at = now
                    raise EtsyAuthError(row.last_error, code="ETSY_OAUTH_INVALID_JSON", status_code=502) from exc

                next_access = str(payload.get("access_token") or "").strip()
                next_refresh = str(payload.get("refresh_token") or current.refresh_token).strip()
                if not next_access:
                    row.last_error = "Phản hồi refresh OAuth từ Etsy thiếu access_token."
                    row.updated_at = now
                    raise EtsyAuthError(row.last_error, code="ETSY_OAUTH_EMPTY_TOKEN", status_code=502)

                try:
                    expires_in = max(60, int(payload.get("expires_in") or 3600))
                except (TypeError, ValueError):
                    expires_in = 3600
                expires_at = now + timedelta(seconds=expires_in)

                row.access_token_ciphertext = self._encrypt(next_access)
                row.refresh_token_ciphertext = self._encrypt(next_refresh)
                row.etsy_user_id = _extract_etsy_user_id(next_access) or row.etsy_user_id
                row.token_expires_at = expires_at
                row.token_generation = int(row.token_generation or 0) + 1
                row.last_refreshed_at = now
                row.last_error = None
                row.updated_at = now

                return self._decrypt_row(row)

    def request_json(
        self,
        path_or_url: str,
        *,
        oauth: bool = False,
        timeout_seconds: float = 45.0,
    ) -> tuple[Any, dict[str, Any]]:
        """Execute a centralized Etsy Open API v3 GET request with rate-limit & OAuth handling."""
        now = utc_now()
        snapshot = self.get_rate_limit_snapshot(now=now)
        if snapshot.get("isRateLimited"):
            retry_after = float(snapshot.get("retryAfterSeconds") or 5.0)
            quota_exhausted = bool(snapshot.get("quotaExhausted"))
            raise EtsyRateLimitError(
                (
                    f"Đã hết hạn mức Etsy API trong ngày; tạm dừng {int(retry_after)}s."
                    if quota_exhausted
                    else f"Đang chờ giới hạn tốc độ Etsy API ({retry_after:.1f}s)."
                ),
                retry_after_seconds=retry_after,
                quota_exhausted=quota_exhausted,
            )

        url = (
            path_or_url
            if path_or_url.startswith(("http://", "https://"))
            else f"{ETSY_API_ORIGIN}/{path_or_url.lstrip('/')}"
        )
        creds = self.get_valid_credentials(require_oauth=oauth)
        oauth_refresh_attempted = False
        rate_limit_waited = False

        while True:
            headers = {
                **ETSY_DEFAULT_HEADERS,
                "x-api-key": creds.api_key_header,
            }
            if oauth:
                if not creds.access_token:
                    raise EtsyAuthError(
                        "Thiếu Etsy OAuth access token.",
                        code="ETSY_OAUTH_MISSING",
                        status_code=401,
                    )
                headers["Authorization"] = f"Bearer {creds.access_token}"

            started_at = utc_now()
            status_code, response_headers, raw_body = self._http_transport(
                "GET",
                url,
                headers,
                None,
                timeout_seconds,
            )
            duration_ms = round((utc_now() - started_at).total_seconds() * 1000, 1)
            recorded_rl = self._record_rate_limit_headers(
                response_headers,
                status_code=status_code,
                now=utc_now(),
            )

            if status_code == 401 and oauth and not oauth_refresh_attempted:
                creds = self.refresh_access_token(
                    stale_access_token=creds.access_token,
                    seen_generation=creds.token_generation,
                    reason="http_401",
                )
                oauth_refresh_attempted = True
                continue

            if status_code == 429:
                retry_after = float(recorded_rl.get("retryAfterSeconds") or _parse_retry_after_seconds(response_headers, now=utc_now()) or 5.0)
                quota_exhausted = bool(recorded_rl.get("quotaExhausted"))
                if not quota_exhausted and not rate_limit_waited and retry_after <= 15.0:
                    rate_limit_waited = True
                    self._sleep(retry_after)
                    continue
                raise EtsyRateLimitError(
                    (
                        f"Hết hạn mức Etsy API (HTTP 429); thử lại sau {int(retry_after)}s."
                        if quota_exhausted
                        else f"Etsy API giới hạn tốc độ (HTTP 429); Retry-After={int(retry_after)}s."
                    ),
                    retry_after_seconds=retry_after,
                    quota_exhausted=quota_exhausted,
                    headers=response_headers,
                )

            if status_code in {401, 403}:
                detail = f"Lỗi quyền truy cập Etsy API (HTTP {status_code})."
                try:
                    parsed_err = json.loads(raw_body) if raw_body else {}
                    err_msg = parsed_err.get("error") or parsed_err.get("error_description")
                    if err_msg:
                        detail = f"Lỗi quyền Etsy API (HTTP {status_code}): {err_msg}"
                except Exception:
                    pass
                with self._session_factory.begin() as session:
                    row = session.get(EtsyOAuthCredential, PRIMARY_CREDENTIAL_ID)
                    if row is not None:
                        row.last_error = detail
                        row.updated_at = utc_now()
                raise EtsyAuthError(
                    detail,
                    code=f"ETSY_HTTP_{status_code}",
                    status_code=status_code,
                )

            if status_code < 200 or status_code >= 300:
                detail = f"Etsy HTTP {status_code}"
                try:
                    parsed_err = json.loads(raw_body) if raw_body else {}
                    err_msg = parsed_err.get("error") or parsed_err.get("error_description")
                    if err_msg:
                        detail = f"Etsy HTTP {status_code}: {err_msg}"
                except Exception:
                    pass
                raise RuntimeError(detail)

            try:
                parsed = json.loads(raw_body) if raw_body else {}
            except ValueError as exc:
                raise RuntimeError("Phản hồi Etsy API không phải JSON hợp lệ.") from exc

            return parsed, {
                "url": url,
                "status": status_code,
                "durationMs": duration_ms,
                "rateLimit": recorded_rl,
            }

    def test_connection(self, *, refresh_oauth: bool = False) -> dict[str, Any]:
        """Verify live Etsy API key (`openapi-ping`) and OAuth refresh/token health."""
        ping_payload, ping_meta = self.request_json("openapi-ping", oauth=False, timeout_seconds=25.0)
        application_id = ping_payload.get("application_id") if isinstance(ping_payload, dict) else None

        oauth_verified = False
        creds = self.get_valid_credentials(require_oauth=False)
        if creds.refresh_token or creds.access_token:
            now = utc_now()
            should_refresh = refresh_oauth or not creds.access_token or (
                creds.token_expires_at is None
                or creds.token_expires_at <= now + timedelta(seconds=ETSY_TOKEN_REFRESH_MARGIN_SECONDS)
            )
            if should_refresh and creds.refresh_token:
                allowed_status = self.get_status()
                if allowed_status.get("refreshAllowedOnCurrentNode"):
                    creds = self.refresh_access_token(
                        stale_access_token=creds.access_token if not refresh_oauth else None,
                        seen_generation=creds.token_generation if not refresh_oauth else None,
                        reason="connection_test",
                        force=refresh_oauth,
                    )
                    oauth_verified = bool(creds.access_token)
            else:
                oauth_verified = bool(creds.access_token)

        now = utc_now()
        with self._session_factory.begin() as session:
            row = session.get(EtsyOAuthCredential, PRIMARY_CREDENTIAL_ID)
            if row is not None:
                row.last_verified_at = now
                row.last_error = None
                row.updated_at = now

        status = self.get_status()
        return {
            "ok": True,
            "applicationId": application_id,
            "oauthVerified": oauth_verified,
            "pingDurationMs": ping_meta.get("durationMs"),
            "status": status,
        }
