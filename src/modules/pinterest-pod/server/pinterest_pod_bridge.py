"""Pinterest POD Studio - Bridge & Shopify Integration Module.

Self-contained, in-process local pipeline for Pinterest POD creation,
tracks generation jobs, caches deliverables (lifestyle mockups & 300DPI CMYK print files),
and transforms outputs into complete Shopify-ready products (Rug & Blanket)
with size variants, pricing, and print CMYK metafields.
"""

from __future__ import annotations

import base64
import copy
import dataclasses
import json
import mimetypes
import os
import logging
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

logger = logging.getLogger("pinterest_pod_bridge")

# Paths
ROOT = Path(__file__).resolve().parent
try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env")
except ImportError:
    pass

TEMP_DIR = ROOT / "temp" / "pinterest_pod"
_env_out = os.getenv("TREND_PRODUCT_OUTPUT")
if _env_out:
    _p = Path(_env_out)
    LOCAL_OUTPUT_DIR = (_p if _p.is_absolute() else (ROOT / _p)).resolve()
else:
    LOCAL_OUTPUT_DIR = (ROOT / "data" / "pinterest_pod" / "output").resolve()
LOCAL_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
STANDALONE_OUTPUT_DIR = (ROOT / "output").resolve()


def resolve_run_dir(run_id: str) -> Path | None:
    """Find a run directory across local data, workspace output, or standalone tool output."""
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(run_id or "")).strip()
    if not safe_id:
        return None
    # Check candidate roots dynamically so monkeypatched attributes in tests are respected
    candidate_roots = [
        LOCAL_OUTPUT_DIR,
        STANDALONE_OUTPUT_DIR,
        ROOT / "output",
        TEMP_DIR,
    ]
    for r in candidate_roots:
        if not r or not r.exists():
            continue
        direct = (r / safe_id).resolve()
        if direct.is_dir():
            return direct
        sub_out = (r / safe_id / "output").resolve()
        if sub_out.is_dir():
            return sub_out
    for r in candidate_roots:
        if not r or not r.exists():
            continue
        try:
            for child in r.iterdir():
                if child.is_dir() and (child.name == safe_id or safe_id in child.name):
                    return child
        except Exception:
            pass
    return None


def natural_sort_key(s: Any) -> list[int | str]:
    """Sort strings naturally by human/numerical order (e.g. rug_001, rug_002, rug_010)."""
    name = s.name if isinstance(s, Path) else str(s or "")
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", name)]


def save_room_template_images(items: list[Any], target_dir: Path) -> list[Path]:
    """Decodes base64 data URLs, downloads HTTP URLs, or copies local image files into target_dir."""
    target_dir.mkdir(parents=True, exist_ok=True)
    saved_paths: list[Path] = []
    for idx, item in enumerate(items, start=1):
        url = ""
        name = ""
        if isinstance(item, dict):
            url = str(item.get("url") or item.get("image_url") or item.get("local_path") or "")
            name = str(item.get("name") or "")
        elif isinstance(item, str):
            url = item.strip()
        elif isinstance(item, Path) and item.exists() and item.is_file():
            dest = target_dir / item.name
            if dest.resolve() != item.resolve():
                shutil.copy2(item, dest)
            saved_paths.append(dest)
            continue

        if not url:
            continue

        # 1. Check if it's an existing local path
        try:
            p = Path(url)
            if p.exists() and p.is_file():
                dest_name = name if name and "." in name else p.name
                dest = target_dir / dest_name
                if dest.resolve() != p.resolve():
                    shutil.copy2(p, dest)
                saved_paths.append(dest)
                continue
        except Exception:
            pass

        # 2. Check if it's a base64 Data URL (data:image/...)
        if url.startswith("data:image/"):
            try:
                header, data = url.split(",", 1)
                mime = header.split(";")[0].split(":")[1]
                ext = ".png" if "png" in mime else ".jpg"
                img_bytes = base64.b64decode(data)
                dest_filename = f"room_template_{idx}{ext}"
                dest = target_dir / dest_filename
                dest.write_bytes(img_bytes)
                saved_paths.append(dest)
                continue
            except Exception as e:
                logger.warning("Failed to decode base64 room template #%d: %s", idx, e)

        # 3. Check if it's an HTTP/HTTPS URL
        if url.startswith(("http://", "https://")):
            try:
                dest = target_dir / f"room_template_{idx}.jpg"
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                with urllib.request.urlopen(req, timeout=15) as resp:
                    dest.write_bytes(resp.read())
                saved_paths.append(dest)
                continue
            except Exception as e:
                logger.warning("Failed to download remote room template #%d from %s: %s", idx, url, e)

    return saved_paths


# Standalone API URL (legacy optional)
DEFAULT_API_URL = os.getenv("TREND_PRODUCT_API_URL", "").rstrip("/")


# Standard Print Master & Storefront Display Specifications
POD_PRINT_SPECS: dict[str, dict[str, Any]] = {
    "rug": {
        "width_px": 4000,
        "height_px": 6400,
        "dpi": 300,
        "color_mode": "CMYK",
        "aspect_ratio": "5:8",
        "label": "4000 x 6400 px @ 300 DPI (CMYK)",
        "badge": "✓ Chuẩn in xưởng: 4000 x 6400 px @ 300 DPI (CMYK)",
    },
    "blanket": {
        "width_px": 10000,
        "height_px": 11000,
        "dpi": 300,
        "color_mode": "CMYK",
        "aspect_ratio": "10:11",
        "label": "10000 x 11000 px @ 300 DPI (CMYK)",
        "badge": "✓ Chuẩn in xưởng: 10000 x 11000 px @ 300 DPI (CMYK)",
    },
    "bag": {
        "width_px": 4500,
        "height_px": 5400,
        "dpi": 300,
        "color_mode": "CMYK",
        "aspect_ratio": "5:6",
        "label": "4500 x 5400 px @ 300 DPI (CMYK)",
        "badge": "✓ Chuẩn in xưởng: 4500 x 5400 px @ 300 DPI (CMYK)",
    },
    "custom": {
        "width_px": 4000,
        "height_px": 4000,
        "dpi": 300,
        "color_mode": "CMYK",
        "aspect_ratio": "1:1",
        "label": "4000 x 4000 px @ 300 DPI (CMYK)",
        "badge": "✓ Chuẩn in xưởng: 4000 x 4000 px @ 300 DPI (CMYK)",
    },
}

POD_STOREFRONT_SPECS: dict[str, Any] = {
    "width": 1500,
    "height": 1500,
    "fit": "contain",
    "background": "#ffffff",
    "upscale": True,
    "label": "1500 x 1500 px (White Background #ffffff, Fit Contain)",
    "badge": "Shopify Storefront: 1500 x 1500 px (Fit Contain, #ffffff)",
}

DEFAULT_ARTWORK_IMAGE_SIZE = "2K"


def infer_product_type_from_niche(niche: str) -> str:
    """Automatically infer product type from niche keyword:
    * If niche contains 'bag', 'tote', 'backpack', 'purse', 'handbag', 'satchel' -> 'bag' (preset 4500x5400 px).
    * If niche contains 'blanket', 'throw', 'quilt' -> 'blanket' (preset 10000x11000 px).
    * If niche contains 'rug', 'carpet', 'mat' -> 'rug' (preset 4000x6400 px).
    * Otherwise -> 'custom' (universal 4000x4000 px).
    """
    lower = (niche or "").lower().strip()
    if any(kw in lower for kw in ("bag", "tote", "backpack", "purse", "handbag", "satchel")):
        return "bag"
    if any(kw in lower for kw in ("blanket", "throw", "quilt")):
        return "blanket"
    if any(kw in lower for kw in ("rug", "carpet", "mat")):
        return "rug"
    return "custom"


def get_print_spec(product_type: str) -> dict[str, Any]:
    norm = str(product_type or "").lower().strip()
    if norm in POD_PRINT_SPECS:
        return copy.deepcopy(POD_PRINT_SPECS[norm])
    inferred = infer_product_type_from_niche(norm)
    return copy.deepcopy(POD_PRINT_SPECS.get(inferred, POD_PRINT_SPECS["custom"]))


def get_storefront_spec() -> dict[str, Any]:
    return copy.deepcopy(POD_STOREFRONT_SPECS)


def send_windows_desktop_notification(title: str, message: str, delay_sec: int = 0) -> bool:
    """Trigger a native Windows notification banner, floating card, and sound that works even when the browser is minimized or closed."""
    if os.name != "nt":
        return False

    def _worker():
        try:
            if delay_sec > 0:
                time.sleep(delay_sec)

            notifier_script = ROOT / "desktop_notifier.py"
            if notifier_script.exists():
                subprocess.run(
                    [
                        sys.executable,
                        str(notifier_script),
                        "--title", str(title or "Pinterest POD Studio"),
                        "--message", str(message or "Hoàn thành tác vụ!"),
                    ],
                    capture_output=True,
                    text=True,
                    timeout=25,
                    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                )
                return
        except Exception as exc:
            logger.debug(f"desktop_notifier helper error: {exc}")

        # Fallback
        try:
            import winsound
            winsound.MessageBeep(winsound.MB_ICONASTERISK)
        except Exception:
            pass

    threading.Thread(target=_worker, daemon=True).start()
    return True


def get_print_standard_badge(product_type: str) -> str:
    return get_print_spec(product_type).get("badge", "✓ Chuẩn in xưởng: 4000 x 6400 px @ 300 DPI (CMYK)")


def get_storefront_standard_badge() -> str:
    return POD_STOREFRONT_SPECS.get("badge", "Shopify Storefront: 1500 x 1500 px (Fit Contain, #ffffff)")


def ensure_print_image_standard(image_path: Path | str, print_spec: dict[str, Any]) -> bool:
    """Ensures a CMYK print master file matches exact factory specifications:
    width_px x height_px @ 300 DPI in CMYK color mode.
    If physical dimensions or color mode differ, automatically upscales/converts and saves.
    """
    p = Path(image_path)
    if not p.exists() or not p.is_file() or p.stat().st_size == 0:
        return False
    try:
        from PIL import Image, ImageOps
        Image.MAX_IMAGE_PIXELS = None

        target_w = int(print_spec["width_px"])
        target_h = int(print_spec["height_px"])
        target_dpi = int(print_spec.get("dpi", 300))

        with Image.open(p) as im:
            current_w, current_h = im.size
            current_mode = im.mode
            current_dpi = im.info.get("dpi")
            dpi_match = False
            if current_dpi:
                try:
                    dpi_match = round(float(current_dpi[0])) == target_dpi and round(float(current_dpi[1])) == target_dpi
                except Exception:
                    dpi_match = False

            if (current_w, current_h) == (target_w, target_h) and current_mode == "CMYK" and dpi_match:
                return True

            fitted = ImageOps.fit(im, (target_w, target_h), method=Image.Resampling.LANCZOS, centering=(0.5, 0.5))

            if fitted.mode != "CMYK":
                if fitted.mode in ("RGBA", "LA", "P"):
                    bg = Image.new("RGB", fitted.size, (255, 255, 255))
                    alpha = fitted.split()[-1] if fitted.mode in ("RGBA", "LA") else None
                    bg.paste(fitted.convert("RGB") if fitted.mode == "P" else fitted, mask=alpha)
                    cmyk = bg.convert("CMYK")
                else:
                    cmyk = fitted.convert("CMYK")
            else:
                cmyk = fitted

            cmyk.save(p, "JPEG", quality=95, dpi=(target_dpi, target_dpi))
            return True
    except Exception:
        return False

# Size presets for Rug and Blanket
POD_SIZE_PRESETS: dict[str, list[dict[str, str]]] = {
    "rug_rectangle": [
        {"label": '36" x 60"', "code": "36X60", "price": "69.99", "compareAtPrice": "89.99"},
        {"label": '48" x 72"', "code": "48X72", "price": "99.99", "compareAtPrice": "129.99"},
        {"label": '60" x 96"', "code": "60X96", "price": "149.99", "compareAtPrice": "189.99"},
    ],
    "rug_round": [
        {"label": '3 ft Round (36")', "code": "3RND", "price": "59.99", "compareAtPrice": "79.99"},
        {"label": '4 ft Round (48")', "code": "4RND", "price": "89.99", "compareAtPrice": "119.99"},
        {"label": '5 ft Round (60")', "code": "5RND", "price": "129.99", "compareAtPrice": "159.99"},
        {"label": '6 ft Round (72")', "code": "6RND", "price": "179.99", "compareAtPrice": "219.99"},
    ],
    "rug_arch": [
        {"label": '3x5 ft Arch (36" x 60")', "code": "3X5-ARCH", "price": "69.99", "compareAtPrice": "89.99"},
        {"label": '4x6 ft Arch (48" x 72")', "code": "4X6-ARCH", "price": "99.99", "compareAtPrice": "129.99"},
        {"label": '5x7 ft Arch (60" x 84")', "code": "5X7-ARCH", "price": "139.99", "compareAtPrice": "179.99"},
    ],
    "rug_organic": [
        {"label": 'Small Organic (36" x 48")', "code": "S-ORGANIC", "price": "64.99", "compareAtPrice": "84.99"},
        {"label": 'Medium Organic (48" x 60")', "code": "M-ORGANIC", "price": "94.99", "compareAtPrice": "124.99"},
        {"label": 'Large Organic (60" x 72")', "code": "L-ORGANIC", "price": "134.99", "compareAtPrice": "169.99"},
    ],
    "rug_square": [
        {"label": "2x2 ft - XS", "code": "2X2-XS", "price": "39.99", "compareAtPrice": "49.99"},
        {"label": "3x3 ft - S", "code": "3X3-S", "price": "59.99", "compareAtPrice": "74.99"},
        {"label": "4x4 ft - M", "code": "4X4-M", "price": "89.99", "compareAtPrice": "109.99"},
        {"label": "5x5 ft - L", "code": "5X5-L", "price": "119.99", "compareAtPrice": "149.99"},
        {"label": "6x6 ft - XL", "code": "6X6-XL", "price": "169.99", "compareAtPrice": "209.99"},
    ],
    "rug_runner": [
        {"label": '24" x 72" - Runner', "code": "24X72-RUN", "price": "59.99", "compareAtPrice": "79.99"},
        {"label": '30" x 96" - Runner', "code": "30X96-RUN", "price": "89.99", "compareAtPrice": "119.99"},
        {"label": '30" x 120" - Long Runner', "code": "30X120-RUN", "price": "119.99", "compareAtPrice": "149.99"},
    ],
    "blanket": [
        {"label": '30" x 40" - Small / Throw', "code": "30X40", "price": "39.99", "compareAtPrice": "49.99"},
        {"label": '50" x 60" - Medium / Standard', "code": "50X60", "price": "59.99", "compareAtPrice": "74.99"},
        {"label": '60" x 80" - Large / Queen', "code": "60X80", "price": "79.99", "compareAtPrice": "99.99"},
    ],
    "custom": [
        {"label": "Standard Print", "code": "STD", "price": "49.99", "compareAtPrice": "64.99"},
    ],
}

# In-memory job registry & poller locks
JOB_CACHE_LOCK = threading.Lock()
ACTIVE_JOBS: dict[str, dict[str, Any]] = {}
POLLER_THREADS: dict[str, threading.Thread] = {}
JOB_CANCEL_EVENTS: dict[str, threading.Event] = {}
LOCAL_WORKER_THREADS: dict[str, threading.Thread] = {}


def ensure_temp_dir() -> Path:
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    return TEMP_DIR


def manifest_path_for_job(job_id: str) -> Path:
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(job_id or ""))
    if not safe_id:
        raise ValueError("Invalid job ID")
    return TEMP_DIR / safe_id / "manifest.json"


def load_job_manifest(job_id: str) -> dict[str, Any] | None:
    path = manifest_path_for_job(job_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def save_job_manifest(job_id: str, data: dict[str, Any]) -> None:
    path = manifest_path_for_job(job_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Standalone Service HTTP Helpers
# ---------------------------------------------------------------------------

def http_get_json(url: str, timeout: float = 10.0) -> dict[str, Any]:
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "ShopifyToolBridge/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
        return json.loads(body)


def http_post_json(url: str, data: dict[str, Any], timeout: float = 30.0) -> tuple[int, dict[str, Any]]:
    payload = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "ShopifyToolBridge/1.0"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8") if exc.fp else "{}"
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"error": body}
        return exc.code, parsed


def http_delete_json(url: str, timeout: float = 10.0) -> tuple[int, dict[str, Any]]:
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "ShopifyToolBridge/1.0"},
        method="DELETE",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8") if exc.fp else "{}"
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"error": body}
        return exc.code, parsed


# ---------------------------------------------------------------------------
# POD Studio Local Engine Status & Pinterest Auth
# ---------------------------------------------------------------------------

_LOGIN_PROCESS: Any = None


def check_service_health(api_url: str = "") -> dict[str, Any]:
    """Check POD Studio local engine status (self-contained in-process pipeline)."""
    return {
        "online": True,
        "mode": "local",
        "engine": "POD Studio: Sẵn sàng (Local Engine)",
        "url": api_url or "local",
        "error": None,
    }


def check_browser_profile_logged_in(profile_dir: Path | None = None) -> bool:
    """Check if the persistent Pinterest browser profile contains active login cookies."""
    p_dir = profile_dir or (ROOT / "pinterest" / ".pinterest_browser_profile")
    if not p_dir.exists():
        return False
    candidate_cookie_files = [
        p_dir / "Default" / "Network" / "Cookies",
        p_dir / "Network" / "Cookies",
        p_dir / "Cookies",
    ]
    query = (
        "SELECT 1 FROM cookies "
        "WHERE (host_key LIKE '%pinterest%' OR host_key LIKE '%.pinterest.%') "
        "AND name IN ('_auth', '_pinterest_sess') "
        "AND (length(value) > 0 OR length(encrypted_value) > 0) "
        "LIMIT 1"
    )
    for c_file in candidate_cookie_files:
        if c_file.exists() and c_file.is_file() and c_file.stat().st_size > 0:
            import sqlite3
            # 1. Try read-only direct SQLite connection
            conn = None
            try:
                uri = f"file:{c_file.as_posix()}?mode=ro"
                conn = sqlite3.connect(uri, uri=True, timeout=1.0)
                cur = conn.cursor()
                cur.execute(query)
                if cur.fetchone():
                    return True
            except Exception:
                # 2. If locked by running browser on Windows, copy to temp file and read
                import tempfile
                tmp_db = None
                tmp_conn = None
                try:
                    with tempfile.NamedTemporaryFile(delete=False, suffix=".db") as tmp_f:
                        tmp_db = Path(tmp_f.name)
                    shutil.copy2(c_file, tmp_db)
                    tmp_conn = sqlite3.connect(str(tmp_db), timeout=1.0)
                    cur = tmp_conn.cursor()
                    cur.execute(query)
                    if cur.fetchone():
                        return True
                except Exception:
                    pass
                finally:
                    if tmp_conn is not None:
                        try:
                            tmp_conn.close()
                        except Exception:
                            pass
                    if tmp_db is not None and tmp_db.exists():
                        try:
                            tmp_db.unlink(missing_ok=True)
                        except Exception:
                            pass
            finally:
                if conn is not None:
                    try:
                        conn.close()
                    except Exception:
                        pass
    return False


def refresh_pinterest_oauth_token(tokens: dict[str, Any], token_file: Path) -> tuple[bool, dict[str, Any]]:
    """Refresh Pinterest OAuth access token using refresh_token."""
    refresh_token = str(tokens.get("refresh_token") or "").strip()
    app_id = str(os.getenv("PINTEREST_APP_ID") or "").strip()
    app_secret = str(os.getenv("PINTEREST_APP_SECRET") or "").strip()
    if not refresh_token or not app_id or not app_secret:
        return False, tokens

    auth = base64.b64encode(f"{app_id}:{app_secret}".encode("utf-8")).decode("ascii")
    try:
        req = urllib.request.Request(
            "https://api.pinterest.com/v5/oauth/token",
            data=urllib.parse.urlencode({
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
            }).encode("utf-8"),
            headers={
                "Authorization": f"Basic {auth}",
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            new_payload = json.loads(resp.read().decode("utf-8"))
            if isinstance(new_payload, dict) and new_payload.get("access_token"):
                tokens.update(new_payload)
                now = time.time()
                if new_payload.get("expires_in"):
                    tokens["access_token_expires_at"] = now + float(new_payload["expires_in"])
                tokens["issued_at"] = now
                token_file.parent.mkdir(parents=True, exist_ok=True)
                token_file.write_text(json.dumps(tokens, ensure_ascii=False, indent=2), encoding="utf-8")
                logger.info("Đã tự động gia hạn Pinterest OAuth access token thành công.")
                return True, tokens
    except Exception as exc:
        logger.warning("Không thể tự động gia hạn Pinterest OAuth token: %s", exc)

    return False, tokens


def check_oauth_token_valid(token_file: Path | None = None) -> tuple[bool, dict[str, Any]]:
    """Check if the Pinterest OAuth tokens file exists and has valid tokens, auto-refreshing if needed."""
    if token_file is not None:
        t_file = token_file if (token_file.exists() and token_file.is_file()) else None
    else:
        candidates = [
            ROOT / "pinterest" / ".pinterest_oauth_tokens.json",
            ROOT / ".pinterest_oauth_tokens.json",
        ]
        t_file = None
        for cand in candidates:
            if cand.exists() and cand.is_file():
                t_file = cand
                break

    # If no file exists, check fallback environment variable
    env_token = str(os.getenv("PINTEREST_ACCESS_TOKEN") or "").strip()
    if not t_file:
        if env_token:
            return True, {"access_token": env_token, "source": "env"}
        return False, {}

    try:
        data = json.loads(t_file.read_text(encoding="utf-8"))
        has_token = bool(data.get("access_token") or data.get("refresh_token"))
        exp = data.get("access_token_expires_at")
        
        # Check if token is expired or close to expiry (within 300 seconds)
        if exp and float(exp) < (time.time() + 300):
            if data.get("refresh_token"):
                refreshed, new_data = refresh_pinterest_oauth_token(data, t_file)
                if refreshed:
                    return True, new_data
            if float(exp) < time.time():
                # Expired and cannot refresh
                if env_token:
                    return True, {"access_token": env_token, "source": "env"}
                return False, data

        return has_token, data
    except Exception:
        if env_token:
            return True, {"access_token": env_token, "source": "env"}
        return False, {}


def generate_pinterest_oauth_url(redirect_uri: str | None = None) -> dict[str, Any]:
    """Generate official Pinterest OAuth authorization URL."""
    app_id = str(os.getenv("PINTEREST_APP_ID") or "1595071").strip()
    r_uri = str(redirect_uri or os.getenv("PINTEREST_REDIRECT_URI") or "http://localhost:8768/api/pinterest-pod/oauth/callback").strip()
    scopes = str(os.getenv("PINTEREST_SCOPES") or "user_accounts:read,boards:read,pins:read,ads:read").strip()
    
    query = urllib.parse.urlencode({
        "consumer_id": app_id,
        "redirect_uri": r_uri,
        "response_type": "code",
        "scope": scopes,
        "state": f"ffp_pod_{int(time.time())}",
    })
    auth_url = f"https://www.pinterest.com/oauth/?{query}"
    return {
        "ok": True,
        "auth_url": auth_url,
        "app_id": app_id,
        "redirect_uri": r_uri,
        "scopes": scopes,
    }


def extract_oauth_code_from_string(value: str) -> str:
    """Extract code parameter from full redirect URL or raw code string."""
    text = str(value or "").strip()
    if not text:
        return ""
    if "code=" in text:
        try:
            parsed = urllib.parse.urlparse(text)
            if parsed.query:
                q = urllib.parse.parse_qs(parsed.query)
                code_list = q.get("code")
                if code_list and code_list[0]:
                    return code_list[0].strip()
        except Exception:
            pass
    return text


def exchange_pinterest_oauth_code(code_or_url: str, redirect_uri: str | None = None) -> dict[str, Any]:
    """Exchange authorization code for Pinterest access and refresh tokens."""
    code = extract_oauth_code_from_string(code_or_url)
    if not code:
        raise ValueError("Mã code authorization không hợp lệ hoặc bị trống.")

    app_id = str(os.getenv("PINTEREST_APP_ID") or "1595071").strip()
    app_secret = str(os.getenv("PINTEREST_APP_SECRET") or "").strip()
    r_uri = str(redirect_uri or os.getenv("PINTEREST_REDIRECT_URI") or "http://localhost:8768/api/pinterest-pod/oauth/callback").strip()

    if not app_id or not app_secret:
        raise ValueError("PINTEREST_APP_ID hoặc PINTEREST_APP_SECRET chưa được cấu hình trong .env.")

    auth = base64.b64encode(f"{app_id}:{app_secret}".encode("utf-8")).decode("ascii")
    post_data = urllib.parse.urlencode({
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": r_uri,
        "continuous_refresh": "true",
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.pinterest.com/v5/oauth/token",
        data=post_data,
        headers={
            "Authorization": f"Basic {auth}",
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="ignore")
        try:
            parsed_err = json.loads(err_body)
            msg = parsed_err.get("message") or parsed_err.get("error") or err_body
        except Exception:
            msg = err_body
        raise RuntimeError(f"Pinterest OAuth token exchange failed ({exc.code}): {msg}") from exc
    except Exception as exc:
        raise RuntimeError(f"Lỗi kết nối tới máy chủ Pinterest OAuth: {exc}") from exc

    if not isinstance(payload, dict) or not payload.get("access_token"):
        raise RuntimeError("Phản hồi từ Pinterest không chứa access_token hợp lệ.")

    now = time.time()
    payload["issued_at"] = now
    if payload.get("expires_in"):
        payload["access_token_expires_at"] = now + float(payload["expires_in"])
    if payload.get("refresh_token_expires_in"):
        payload["refresh_token_expires_at"] = now + float(payload["refresh_token_expires_in"])

    # Save to primary token file
    target_file = (ROOT / "pinterest" / ".pinterest_oauth_tokens.json").resolve()
    target_file.parent.mkdir(parents=True, exist_ok=True)
    target_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    
    # Also save to root token file for maximum compatibility
    try:
        (ROOT / ".pinterest_oauth_tokens.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass

    logger.info("Đã lưu Pinterest OAuth token vào: %s", target_file)
    return {
        "ok": True,
        "message": "Kết nối tài khoản Pinterest thành công!",
        "saved_path": str(target_file),
        "access_token_preview": payload.get("access_token", "")[:12] + "...",
        "has_refresh_token": bool(payload.get("refresh_token")),
        "expires_in_days": round(float(payload.get("expires_in", 0)) / 86400, 1),
    }


def save_manual_pinterest_token(access_token: str, refresh_token: str = "", scopes: str = "") -> dict[str, Any]:
    """Validate and save manually provided Pinterest access token."""
    token = str(access_token or "").strip()
    if not token:
        raise ValueError("Access Token không được để trống.")

    # Validate token with Pinterest /v5/user_account
    req = urllib.request.Request(
        "https://api.pinterest.com/v5/user_account",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            account_data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        err_body = exc.read().decode("utf-8", errors="ignore")
        raise ValueError(f"Access Token không hợp lệ hoặc không có quyền ({exc.code}): {err_body}") from exc
    except Exception as exc:
        raise RuntimeError(f"Lỗi kiểm tra token với Pinterest API: {exc}") from exc

    username = account_data.get("username") or account_data.get("id") or "pinterest_user"
    now = time.time()
    payload = {
        "access_token": token,
        "token_type": "bearer",
        "scope": scopes or str(os.getenv("PINTEREST_SCOPES") or "user_accounts:read,boards:read,pins:read,ads:read"),
        "issued_at": now,
        "username": username,
        "business_name": account_data.get("business_name"),
    }
    if refresh_token.strip():
        payload["refresh_token"] = refresh_token.strip()

    target_file = (ROOT / "pinterest" / ".pinterest_oauth_tokens.json").resolve()
    target_file.parent.mkdir(parents=True, exist_ok=True)
    target_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    try:
        (ROOT / ".pinterest_oauth_tokens.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass

    logger.info("Đã lưu token thủ công cho tài khoản @%s", username)
    return {
        "ok": True,
        "message": f"Đã kết nối thành công tài khoản Pinterest @{username}",
        "username": username,
        "business_name": account_data.get("business_name"),
        "saved_path": str(target_file),
    }


def resolve_browser_profile_dir() -> Path:
    """Resolve browser profile directory, checking local module first, then fallback environments."""
    local_profile = (ROOT / "pinterest" / ".pinterest_browser_profile").resolve()
    if check_browser_profile_logged_in(local_profile):
        return local_profile

    fallback_candidates = [
        Path("D:/CODE/Code_Clone/tool_shopify/pinterest/.pinterest_browser_profile"),
        (ROOT.parent.parent.parent.parent / "tool_shopify" / "pinterest" / ".pinterest_browser_profile").resolve(),
    ]
    for cand in fallback_candidates:
        if cand.exists() and check_browser_profile_logged_in(cand):
            return cand.resolve()

    return local_profile


def get_pinterest_auth_status() -> dict[str, Any]:
    """Inspect browser profile and OAuth token status for Pinterest POD Studio."""
    profile_dir = resolve_browser_profile_dir()
    token_file = (ROOT / "pinterest" / ".pinterest_oauth_tokens.json").resolve()
    root_token_file = (ROOT / ".pinterest_oauth_tokens.json").resolve()

    browser_logged_in = check_browser_profile_logged_in(profile_dir)
    oauth_valid, token_data = check_oauth_token_valid(token_file)
    is_fully_logged_in = bool(browser_logged_in and oauth_valid)

    if is_fully_logged_in:
        status_text = "Pinterest: Đã kết nối đầy đủ (API & Crawler)"
    elif oauth_valid:
        status_text = "Pinterest: API OK (Chưa đăng nhập trình duyệt cào)"
    elif browser_logged_in:
        status_text = "Pinterest: Cần kết nối API Token để quét Trend"
    else:
        status_text = "Pinterest: Chưa kết nối"

    oauth_info = generate_pinterest_oauth_url()

    return {
        "ok": True,
        "logged_in": is_fully_logged_in,
        "browser_logged_in": browser_logged_in,
        "oauth_valid": oauth_valid,
        "status_text": status_text,
        "profile_dir": str(profile_dir),
        "profile_exists": profile_dir.exists(),
        "oauth_file_exists": token_file.exists() or root_token_file.exists() or bool(os.getenv("PINTEREST_ACCESS_TOKEN")),
        "auth_url": oauth_info.get("auth_url"),
        "redirect_uri": oauth_info.get("redirect_uri"),
        "app_id_configured": bool(os.getenv("PINTEREST_APP_ID")),
        "token_info": {
            "has_access_token": bool(token_data.get("access_token")),
            "has_refresh_token": bool(token_data.get("refresh_token")),
            "expires_at": token_data.get("access_token_expires_at"),
            "username": token_data.get("username"),
            "source": token_data.get("source", "file"),
        } if token_data else None,
    }


def launch_pinterest_login(timeout: int = 600) -> dict[str, Any]:
    """Launch interactive browser login window with the persistent profile."""
    global _LOGIN_PROCESS
    if _LOGIN_PROCESS is not None and _LOGIN_PROCESS.poll() is None:
        return {
            "ok": True,
            "status": "already_running",
            "message": "Cửa sổ đăng nhập Pinterest đang mở. Vui lòng hoàn tất đăng nhập trên trình duyệt.",
        }

    script = (ROOT / "pinterest" / "pinterest_browser_login.py").resolve()
    if not script.exists():
        script = (ROOT / "pinterest" / "image_crawler" / "pinterest_browser_login.py").resolve()

    if not script.exists():
        return {
            "ok": False,
            "error": f"Không tìm thấy script đăng nhập tại {script}",
        }

    profile_dir = resolve_browser_profile_dir()
    profile_dir.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        str(script),
        "--profile-dir",
        str(profile_dir),
        "--timeout",
        str(timeout),
    ]

    try:
        import subprocess
        creationflags = 0
        if sys.platform == "win32":
            creationflags = subprocess.CREATE_NEW_PROCESS_GROUP
        _LOGIN_PROCESS = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            creationflags=creationflags,
        )
        return {
            "ok": True,
            "status": "launched",
            "pid": _LOGIN_PROCESS.pid,
            "message": "Đã mở trình duyệt đăng nhập Pinterest. Sau khi đăng nhập xong, phiên sẽ tự động được lưu.",
        }
    except Exception as exc:
        return {
            "ok": False,
            "error": f"Lỗi khi khởi chạy trình duyệt: {exc}",
        }


# ---------------------------------------------------------------------------
# Stepper & Progress Calculation
# ---------------------------------------------------------------------------

def calculate_stepper_state(job_data: dict[str, Any]) -> dict[str, Any]:
    """Calculate 4-step progress and current step description from job state and logs."""
    status = str(job_data.get("status") or "queued").lower()
    logs = job_data.get("logs") or []

    # Steps definition (Clean 4-step studio flow)
    steps = [
        {"index": 1, "key": "trends", "label": "Pinterest Trends", "desc": "Khám phá xu hướng & từ khóa hot"},
        {"index": 2, "key": "curate", "label": "Candidate Review", "desc": "Chọn lọc & duyệt ảnh ứng viên HD"},
        {"index": 3, "key": "cmyk", "label": "CMYK 300DPI Render", "desc": "Chuẩn bị file in sắc nét cho xưởng"},
        {"index": 4, "key": "mockups", "label": "AI Lifestyle Mockup", "desc": "Tạo bối cảnh sống động & xuất thành phẩm"},
    ]

    current_step = 1
    percent = 5
    current_message = "Đang khởi tạo job..."

    if status == "completed":
        current_step = 4
        percent = 100
        current_message = "Hoàn thành! Đã tạo đầy đủ mockup AI & file in CMYK."
    elif status == "ready_for_review":
        current_step = 2
        percent = 40
        cands = job_data.get("candidates") or []
        current_message = f"Đã quét & chấm điểm Vision AI ({len(cands)} ứng viên). Mời bạn duyệt mẫu để sản xuất."
    elif status in {"failed", "cancelled"}:
        percent = 100
        current_message = f"Job {status}: {job_data.get('error') or 'Không rõ nguyên nhân'}"
    else:
        # Scan log lines in reverse order to find the latest active pipeline stage
        found_stage = False
        for line in reversed(logs):
            line_lower = str(line).lower()
            if any(m in line_lower for m in ("step 4", "lifestyle", "direct_ai", "mockup view", "ai background:", "rendering local product mockups")):
                current_step = 4
                percent = 75
                current_message = line.strip() or "Đang sinh mockup lifestyle AI chân thực..."
                found_stage = True
                break
            elif any(m in line_lower for m in ("step 3", "exporting cmyk", "fitting canvas", "300dpi_cmyk", "300dpi print", "final_print", "cmyk print jpg")):
                current_step = 3
                percent = 55
                current_message = line.strip() or "Đang kết xuất file CMYK 300DPI chuẩn in..."
                found_stage = True
                break
            elif any(m in line_lower for m in ("step 2", "generating flat artwork", "enhancing/upscaling", "make_print_design", "removing near-white background", "processing design")):
                current_step = 2
                percent = 35
                current_message = line.strip() or "Đang xử lý và nâng cấp độ phân giải artwork..."
                found_stage = True
                break
            elif any(m in line_lower for m in ("step 1", "starting product workflow", "collected", "crawled image", "dedupe", "pre-screening", "crawler", "task5")):
                current_step = 1
                percent = 20
                current_message = line.strip() or "Đang quét Pinterest Trends & tải candidates..."
                found_stage = True
                break

        if not found_stage:
            current_step = 1
            percent = 10
            current_message = logs[-1].strip() if logs else "Đang kết nối worker..."

    return {
        "status": status,
        "currentStep": current_step,
        "current_step": current_step,
        "percent": percent,
        "message": current_message,
        "steps": steps,
        "logsCount": len(logs),
    }


# ---------------------------------------------------------------------------
# Asset Caching & Serving
# ---------------------------------------------------------------------------

def cache_job_assets(job_id: str, job_data: dict[str, Any], base_url: str, api_url: str = DEFAULT_API_URL) -> dict[str, Any]:
    """Download deliverables from standalone API and store locally for reliable Shopify sync & UI preview."""
    job_dir = TEMP_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)

    output = job_data.get("output") or job_data.get("deliverables") or {}
    marketing_images = output.get("marketing_images") or []
    cmyk_images = output.get("print_cmyk_images") or []
    final_png_images = output.get("final_png_images") or []
    product_cutouts = output.get("product_cutouts") or []
    product_cutouts_white = output.get("product_cutouts_white") or []
    perspective_mockups = output.get("perspective_mockups") or []

    run_id_val = output.get("run_id") or job_data.get("run_id") or job_data.get("runId") or job_id
    r_dir = resolve_run_dir(run_id_val)

    def _normalize_asset_item(raw_item: Any, default_name: str) -> dict[str, Any]:
        if isinstance(raw_item, str):
            clean_str = raw_item.strip()
            if clean_str in ("", "undefined", "null"):
                return {"name": default_name, "filename": default_name, "url": ""}
            fname = Path(clean_str).name or default_name
            p_obj = Path(clean_str)
            p_exist = p_obj.exists() and p_obj.is_file()
            return {
                "name": fname,
                "filename": fname,
                "path": str(p_obj.resolve()) if p_exist else "",
                "url": clean_str if (clean_str.startswith("http://") or clean_str.startswith("https://") or clean_str.startswith("/")) else "",
            }
        elif isinstance(raw_item, dict):
            d = dict(raw_item)
            raw_url = str(d.get("url") or "").strip()
            if raw_url in ("undefined", "null"):
                d["url"] = ""
            raw_dl = str(d.get("download_url") or "").strip()
            if raw_dl in ("undefined", "null"):
                d["download_url"] = ""
            fname = d.get("filename") or d.get("name") or (Path(d.get("path") or "").name if d.get("path") else "") or default_name
            if str(fname) in ("undefined", "null", ""):
                fname = default_name
            d["filename"] = str(fname)
            d["name"] = str(fname)
            return d
        return {"name": default_name, "filename": default_name, "url": ""}

    def _locate_and_copy(item_dict: dict[str, Any], subfolders: tuple[str, ...]) -> bool:
        name = item_dict.get("filename") or item_dict.get("name")
        if not name or name in ("undefined", "null"):
            return False
        dest = job_dir / name
        if dest.exists() and dest.stat().st_size > 0:
            return True
        for p_key in ("path", "local_path", "file_path"):
            val = item_dict.get(p_key)
            if val:
                p_val = Path(str(val))
                if p_val.exists() and p_val.is_file():
                    try:
                        shutil.copy2(p_val, dest)
                        return True
                    except Exception:
                        pass
        if r_dir and r_dir.exists():
            rel_path = item_dict.get("relative_path")
            if rel_path:
                cand_rel = r_dir / rel_path
                if cand_rel.exists() and cand_rel.is_file():
                    try:
                        shutil.copy2(cand_rel, dest)
                        return True
                    except Exception:
                        pass
            for sub in subfolders:
                cand = (r_dir / sub / name) if sub else (r_dir / name)
                if cand.exists() and cand.is_file():
                    try:
                        shutil.copy2(cand, dest)
                        return True
                    except Exception:
                        pass
        cand_dir = resolve_run_dir(run_id_val)
        if cand_dir and cand_dir.exists() and cand_dir != r_dir:
            for sub in subfolders:
                cand = (cand_dir / sub / name) if sub else (cand_dir / name)
                if cand.exists() and cand.is_file():
                    try:
                        shutil.copy2(cand, dest)
                        return True
                    except Exception:
                        pass
        return False

    def _download_if_needed(item_dict: dict[str, Any], timeout: float = 30.0) -> None:
        name = item_dict.get("filename") or item_dict.get("name")
        if not name or name in ("undefined", "null"):
            return
        dest = job_dir / name
        if dest.exists() and dest.stat().st_size > 0:
            return
        dl_url = item_dict.get("download_url") or item_dict.get("url") or ""
        if dl_url and dl_url not in ("undefined", "null") and "/api/pinterest-pod/assets/" not in dl_url:
            fetch_url = dl_url if (dl_url.startswith("http://") or dl_url.startswith("https://")) else f"{api_url.rstrip('/')}{dl_url}"
            try:
                req = urllib.request.Request(fetch_url, headers={"User-Agent": "ShopifyToolBridge/1.0"})
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    dest.write_bytes(resp.read())
            except Exception as exc:
                print(f"[PinterestPOD] Failed to download {fetch_url}: {exc}")

    # 1. Marketing / Lifestyle images
    cached_marketing = []
    for idx, raw_item in enumerate(marketing_images):
        item = _normalize_asset_item(raw_item, f"mockup_{idx+1}.png")
        name = item["filename"]
        local_path = job_dir / name
        _locate_and_copy(item, ("lifestyle_mockups", "mockups", ""))
        _download_if_needed(item, timeout=30.0)

        mime_type = mimetypes.guess_type(name)[0] or "image/png"
        size_bytes = local_path.stat().st_size if local_path.exists() else 0
        asset_url = f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{name}" if local_path.exists() else (item.get("url") or f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{name}")
        cached_marketing.append({
            "kind": "marketing_image",
            "name": name,
            "filename": name,
            "path": str(local_path.resolve()) if local_path.exists() else "",
            "bytes": size_bytes,
            "mimeType": mime_type,
            "url": asset_url,
            "download_url": asset_url,
            "is_primary": idx == 0,
        })

    # 2. CMYK Print Master Images
    cached_cmyk = []
    product_type = str(job_data.get("product") or (job_data.get("request") or {}).get("product") or "rug").lower().strip()
    print_spec = get_print_spec(product_type)

    for idx, raw_item in enumerate(cmyk_images):
        item = _normalize_asset_item(raw_item, f"print_cmyk_{idx+1}.jpg")
        name = item["filename"]
        local_path = job_dir / name
        _locate_and_copy(item, ("final_print", ""))
        _download_if_needed(item, timeout=60.0)

        if local_path.exists() and local_path.stat().st_size > 0:
            ensure_print_image_standard(local_path, print_spec)

        width_px = print_spec["width_px"]
        height_px = print_spec["height_px"]
        dpi = print_spec["dpi"]
        color_mode = print_spec["color_mode"]
        standard_badge = print_spec["badge"]
        standard_label = print_spec["label"]
        mime_type = mimetypes.guess_type(name)[0] or "image/jpeg"
        size_bytes = local_path.stat().st_size if local_path.exists() else 0
        asset_url = f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{name}" if local_path.exists() else (item.get("url") or f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{name}")

        cached_cmyk.append({
            "kind": "print_cmyk",
            "name": name,
            "filename": name,
            "path": str(local_path.resolve()) if local_path.exists() else "",
            "bytes": size_bytes,
            "mimeType": mime_type,
            "url": asset_url,
            "download_url": asset_url,
            "width_px": width_px,
            "height_px": height_px,
            "dpi": dpi,
            "color_mode": color_mode,
            "standard_label": standard_label,
            "standard_badge": standard_badge,
        })

    # 3. RGB PNG 4K Prints
    cached_final_png = []
    for idx, raw_item in enumerate(final_png_images):
        item = _normalize_asset_item(raw_item, f"final_print_{idx+1}.png")
        name = item["filename"]
        local_path = job_dir / name
        _locate_and_copy(item, ("final_print", ""))
        _download_if_needed(item, timeout=30.0)

        size_bytes = local_path.stat().st_size if local_path.exists() else 0
        asset_url = f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{name}" if local_path.exists() else (item.get("url") or f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{name}")
        cached_final_png.append({
            "kind": "print_rgb_png",
            "name": name,
            "filename": name,
            "path": str(local_path.resolve()) if local_path.exists() else "",
            "bytes": size_bytes,
            "url": asset_url,
            "download_url": asset_url,
            "width_px": print_spec["width_px"],
            "height_px": print_spec["height_px"],
            "dpi": print_spec["dpi"],
            "color_mode": "RGB",
            "standard_label": f"{print_spec['width_px']} x {print_spec['height_px']} px @ {print_spec['dpi']} DPI (RGB 4K)",
            "standard_badge": "RGB 4K Siêu Nét",
        })

    # 4. Product cutouts (transparent & white)
    cached_cutouts = []
    for idx, raw_item in enumerate(product_cutouts):
        item = _normalize_asset_item(raw_item, f"cutout_{idx+1}.png")
        name = item["filename"]
        local_path = job_dir / name
        _locate_and_copy(item, ("product_cutouts", ""))
        _download_if_needed(item, timeout=30.0)
        size_bytes = local_path.stat().st_size if local_path.exists() else 0
        asset_url = f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{name}" if local_path.exists() else (item.get("url") or f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{name}")
        cached_cutouts.append({
            "kind": "product_cutout",
            "type": "transparent",
            "name": name,
            "filename": name,
            "bytes": size_bytes,
            "url": asset_url,
            "download_url": asset_url,
        })

    cached_cutouts_white = []
    for idx, raw_item in enumerate(product_cutouts_white):
        item = _normalize_asset_item(raw_item, f"cutout_white_{idx+1}.png")
        name = item["filename"]
        local_path = job_dir / name
        _locate_and_copy(item, ("product_cutouts_white", ""))
        _download_if_needed(item, timeout=30.0)
        size_bytes = local_path.stat().st_size if local_path.exists() else 0
        asset_url = f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{name}" if local_path.exists() else (item.get("url") or f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{name}")
        cached_cutouts_white.append({
            "kind": "product_cutout_white",
            "type": "white",
            "name": name,
            "filename": name,
            "bytes": size_bytes,
            "url": asset_url,
            "download_url": asset_url,
        })

    # 5. Perspective mockups
    cached_perspective = []
    for idx, raw_item in enumerate(perspective_mockups):
        item = _normalize_asset_item(raw_item, f"perspective_{idx+1}.png")
        name = item["filename"]
        local_path = job_dir / name
        _locate_and_copy(item, ("mockups", ""))
        _download_if_needed(item, timeout=30.0)
        size_bytes = local_path.stat().st_size if local_path.exists() else 0
        asset_url = f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{name}" if local_path.exists() else (item.get("url") or f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{name}")
        cached_perspective.append({
            "kind": "perspective_mockup",
            "name": name,
            "filename": name,
            "bytes": size_bytes,
            "url": asset_url,
            "download_url": asset_url,
        })

    # Copy report.html if available
    has_report = False
    report_url = None
    if r_dir:
        report_file = r_dir / "report.html"
        if report_file.exists() and report_file.is_file():
            dest_rep = job_dir / "report.html"
            if not dest_rep.exists() or dest_rep.stat().st_size == 0:
                try:
                    shutil.copy2(report_file, dest_rep)
                except Exception:
                    pass
            has_report = True
            report_url = f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/report.html"

    # Compute summary metrics with both singular & plural aliases
    summary_metrics = {
        "rgb_4k_count": len(cached_final_png),
        "final_print_count": len(cached_final_png),
        "cmyk_count": len(cached_cmyk),
        "lifestyle_mockup_count": len(cached_marketing),
        "lifestyle_mockups_count": len(cached_marketing),
        "cutouts_count": len(cached_cutouts) + len(cached_cutouts_white),
        "perspective_mockup_count": len(cached_perspective),
        "mockups_count": len(cached_perspective) or len(cached_marketing),
    }

    # Update job_data deliverables and output with full enriched asset arrays
    output["marketing_images"] = cached_marketing
    output["lifestyle_mockups"] = cached_marketing
    output["print_cmyk_images"] = cached_cmyk
    if cached_final_png:
        output["final_png_images"] = cached_final_png
        output["final_prints"] = cached_final_png
    if cached_cutouts:
        output["product_cutouts"] = cached_cutouts
    if cached_cutouts_white:
        output["product_cutouts_white"] = cached_cutouts_white
    if cached_perspective:
        output["perspective_mockups"] = cached_perspective
    output["summary_metrics"] = summary_metrics
    if report_url:
        output["report_url"] = report_url
        output["has_report"] = True

    if "deliverables" in job_data and isinstance(job_data["deliverables"], dict):
        job_data["deliverables"]["marketing_images"] = cached_marketing
        job_data["deliverables"]["lifestyle_mockups"] = cached_marketing
        job_data["deliverables"]["print_cmyk_images"] = cached_cmyk
        if cached_final_png:
            job_data["deliverables"]["final_png_images"] = cached_final_png
            job_data["deliverables"]["final_prints"] = cached_final_png
        if cached_cutouts:
            job_data["deliverables"]["product_cutouts"] = cached_cutouts
        if cached_cutouts_white:
            job_data["deliverables"]["product_cutouts_white"] = cached_cutouts_white
        if cached_perspective:
            job_data["deliverables"]["perspective_mockups"] = cached_perspective
        job_data["deliverables"]["summary_metrics"] = summary_metrics
        if report_url:
            job_data["deliverables"]["report_url"] = report_url
            job_data["deliverables"]["has_report"] = True

    cached_info = {
        "jobId": job_id,
        "runId": run_id_val,
        "cachedAt": time.time(),
        "marketingImages": cached_marketing,
        "lifestyleMockups": cached_marketing,
        "printCmykImages": cached_cmyk,
        "finalPngImages": cached_final_png,
        "finalPrints": cached_final_png,
        "productCutouts": cached_cutouts,
        "productCutoutsWhite": cached_cutouts_white,
        "perspectiveMockups": cached_perspective,
        "printSpec": print_spec,
        "storefrontSpec": get_storefront_spec(),
        "standardBadge": print_spec["badge"],
        "summaryMetrics": summary_metrics,
        "reportUrl": report_url,
        "hasReport": has_report,
    }
    return cached_info


def get_cached_asset_file(job_id: str, filename: str) -> tuple[Path, str]:
    safe_job_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(job_id or ""))
    safe_filename = Path(urllib.parse.unquote(str(filename or ""))).name
    if not safe_job_id or not safe_filename:
        raise LookupError("Invalid asset identifier")

    job_dir = (TEMP_DIR / safe_job_id).resolve()
    file_path = (job_dir / safe_filename).resolve()

    if file_path.parent != job_dir or not file_path.exists() or not file_path.is_file():
        # Resolve potential run directory names (job_id, runId from manifest, or active jobs)
        candidate_run_ids = [safe_job_id]
        manifest = load_job_manifest(safe_job_id)
        if manifest:
            rid = manifest.get("runId") or (manifest.get("jobData") or {}).get("run_id") or (manifest.get("jobData") or {}).get("runId")
            if rid and rid not in candidate_run_ids:
                candidate_run_ids.append(rid)
        with JOB_CACHE_LOCK:
            active_info = ACTIVE_JOBS.get(safe_job_id) or {}
            rid2 = active_info.get("run_id") or active_info.get("runId")
            if rid2 and rid2 not in candidate_run_ids:
                candidate_run_ids.append(rid2)

        search_subdirs = (
            "room_templates",
            "lifestyle_mockups",
            "final_print",
            "mockups",
            "product_cutouts",
            "product_cutouts_white",
            "artwork_designs",
            "task5_crawl/downloaded_images",
            "dedupe/kept",
            "dedupe",
            "task5_crawl",
            "",
        )

        found_source = None
        # Check in candidate run IDs via resolve_run_dir
        for rid in candidate_run_ids:
            r_dir = resolve_run_dir(rid)
            if r_dir and r_dir.is_dir():
                for sub in search_subdirs:
                    cand = (r_dir / sub / safe_filename).resolve() if sub else (r_dir / safe_filename).resolve()
                    if cand.exists() and cand.is_file():
                        found_source = cand
                        break
                    if "white" in sub and ("_white." in safe_filename or "-white." in safe_filename):
                        orig_fn = re.sub(r"(_white|-white)(\.[a-zA-Z0-9]+)$", r"\2", safe_filename)
                        cand = (r_dir / sub / orig_fn).resolve()
                        if cand.exists() and cand.is_file():
                            found_source = cand
                            break
            if found_source:
                break

        # If not found yet, check recent run_* directories in LOCAL_OUTPUT_DIR, ROOT/output, STANDALONE_OUTPUT_DIR
        if not found_source:
            for root_dir in (LOCAL_OUTPUT_DIR, ROOT / "output", STANDALONE_OUTPUT_DIR):
                if not root_dir.exists():
                    continue
                for r_dir in sorted(root_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)[:15]:
                    if not r_dir.is_dir() or not r_dir.name.startswith("run_"):
                        continue
                    for sub in search_subdirs:
                        cand = (r_dir / sub / safe_filename).resolve() if sub else (r_dir / safe_filename).resolve()
                        if cand.exists() and cand.is_file():
                            found_source = cand
                            break
                        if "white" in sub and ("_white." in safe_filename or "-white." in safe_filename):
                            orig_fn = re.sub(r"(_white|-white)(\.[a-zA-Z0-9]+)$", r"\2", safe_filename)
                            cand = (r_dir / sub / orig_fn).resolve()
                            if cand.exists() and cand.is_file():
                                found_source = cand
                                break
                    if found_source:
                        break
                if found_source:
                    break

        if found_source:
            job_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(found_source, file_path)

    if file_path.parent != job_dir or not file_path.exists() or not file_path.is_file():
        raise LookupError("Asset file not found or expired")

    mime_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    if file_path.suffix.lower() == ".html":
        mime_type = "text/html; charset=utf-8"
    return file_path, mime_type



# ---------------------------------------------------------------------------
# Background Poller for Active Jobs
# ---------------------------------------------------------------------------

def _poll_job_worker(job_id: str, base_url: str, api_url: str) -> None:
    api_url = (api_url or DEFAULT_API_URL).rstrip("/")
    status_url = f"{api_url}/v1/jobs/{job_id}"

    consecutive_errors = 0
    while True:
        try:
            data = http_get_json(status_url, timeout=10.0)
            consecutive_errors = 0
            with JOB_CACHE_LOCK:
                if not data.get("logs") and job_id in ACTIVE_JOBS and ACTIVE_JOBS[job_id].get("logs"):
                    data["logs"] = list(ACTIVE_JOBS[job_id]["logs"])
                ACTIVE_JOBS[job_id] = data

            status = str(data.get("status") or "").lower()
            if status in {"completed", "ready_for_review", "failed", "cancelled"}:
                if status == "completed":
                    cached = cache_job_assets(job_id, data, base_url, api_url)
                    data["cachedAssets"] = cached
                    manifest = {
                        "jobId": job_id,
                        "status": "completed",
                        "completedAt": time.time(),
                        "jobData": data,
                        "cachedAssets": cached,
                        "sync": {},
                    }
                    save_job_manifest(job_id, manifest)
                elif status == "ready_for_review":
                    manifest = {
                        "jobId": job_id,
                        "status": "ready_for_review",
                        "jobData": data,
                        "candidates": data.get("candidates") or (data.get("output") or {}).get("candidates") or [],
                    }
                    save_job_manifest(job_id, manifest)
                break
        except Exception as exc:
            consecutive_errors += 1
            if consecutive_errors > 12:
                with JOB_CACHE_LOCK:
                    if job_id in ACTIVE_JOBS:
                        ACTIVE_JOBS[job_id]["status"] = "error"
                        ACTIVE_JOBS[job_id]["error"] = f"Mất kết nối tới service: {exc}"
                        ACTIVE_JOBS[job_id].setdefault("logs", []).append(f"LỖI: Mất kết nối tới service ({exc})")
                break
        time.sleep(2.0)


# ---------------------------------------------------------------------------
# Local Direct Pipeline Worker Fallback
# ---------------------------------------------------------------------------

def _run_local_pipeline_worker(job_id: str, req_body: dict[str, Any], base_url: str, cancel_event: threading.Event | None = None) -> None:
    # Ensure ROOT (tool_shopify) is strictly the primary sys.path entry
    root_str = str(ROOT.resolve())
    while root_str in sys.path:
        sys.path.remove(root_str)
    sys.path.insert(0, root_str)

    # Clean up stale trend_tool module if previously imported from another directory
    if "trend_tool" in sys.modules:
        mod = sys.modules["trend_tool"]
        if getattr(mod, "__file__", None) and not str(Path(mod.__file__).resolve()).startswith(root_str):
            for k in list(sys.modules.keys()):
                if k == "trend_tool" or k.startswith("trend_tool."):
                    del sys.modules[k]

    try:
        import trend_tool.config as tt_cfg
        import trend_tool.pipeline as tt_pipe
        from trend_tool.settings import task5_token_path_from_env
    except Exception as exc:
        with JOB_CACHE_LOCK:
            if job_id in ACTIVE_JOBS:
                ACTIVE_JOBS[job_id]["status"] = "failed"
                ACTIVE_JOBS[job_id]["error"] = f"Không thể nạp trend_tool module: {exc}"
                ACTIVE_JOBS[job_id].setdefault("logs", []).append(f"LỖI: Không thể nạp trend_tool module: {exc}")
        return

    niche = str(req_body.get("niche") or "").strip()
    raw_product = str(req_body.get("product") or "").lower().strip()
    if raw_product in {"rug", "blanket", "bag", "custom"}:
        product = raw_product
    else:
        product = infer_product_type_from_niche(niche)
    target = tt_cfg.product_preset(product, niche=niche)
    desired_output_count = int(req_body.get("desired_output_count") or 1)
    mockup_engine = "direct_ai"
    design_mode = str(req_body.get("design_mode") or "ai-artwork").replace("-", "_")
    artwork_size = str(req_body.get("artwork_image_size") or req_body.get("artwork_size") or DEFAULT_ARTWORK_IMAGE_SIZE).strip() or DEFAULT_ARTWORK_IMAGE_SIZE
    ai_background_variants = int(req_body.get("ai_background_variants") or req_body.get("room_angles") or 5)
    remove_white_background = bool(req_body.get("remove_white_background", False))
    stage = str(req_body.get("workflow_stage") or "auto")

    output_root = LOCAL_OUTPUT_DIR if LOCAL_OUTPUT_DIR.exists() else (TEMP_DIR / job_id / "output")
    output_root.mkdir(parents=True, exist_ok=True)

    token_path = None
    try:
        token_path = task5_token_path_from_env()
    except Exception:
        pass

    # Resolve initial room templates only if user explicitly provided them or from specific source_run_id
    initial_rt: list[Path] = []
    raw_refs = req_body.get("reference_images") or []
    src_run_id = req_body.get("source_run_id")
    src_dir = resolve_run_dir(src_run_id) if src_run_id else None
    if raw_refs:
        job_rt_dir = TEMP_DIR / job_id / "room_templates"
        initial_rt = save_room_template_images(raw_refs, job_rt_dir)
    elif src_dir and (src_dir / "room_templates").is_dir():
        initial_rt = [p for p in sorted((src_dir / "room_templates").glob("*.*")) if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}]

    if initial_rt:
        ai_background_variants = max(1, min(10, len(initial_rt)))
    else:
        try:
            ai_background_variants = int(req_body.get("ai_background_variants") or req_body.get("room_angles") or 5)
        except (ValueError, TypeError):
            ai_background_variants = 5
        ai_background_variants = max(1, min(10, ai_background_variants))

    try:
        user_pool_size = int(
            req_body.get("candidatePoolSize")
            or req_body.get("task5_top_images")
            or req_body.get("task5_max_downloads")
            or req_body.get("max_downloads")
            or 40
        )
    except (ValueError, TypeError):
        user_pool_size = 40

    is_vision_disabled = os.getenv("DISABLE_VISION_FILTER", "1").lower() in {"1", "true", "yes"}
    vision_mode = "off" if is_vision_disabled else str(req_body.get("vision_mode") or "auto")

    task5_top_images = user_pool_size
    # When Vision AI filter is disabled, keep 100% of crawled images without buffer over-fetching
    if is_vision_disabled:
        task5_max_downloads = user_pool_size
    else:
        task5_max_downloads = max(user_pool_size, min(240, int(user_pool_size * 2.0)))
    try:
        task5_max_images_per_query = int(req_body.get("task5_max_images_per_query") or req_body.get("max_images_per_query") or max(15, task5_max_downloads // 8))
    except (ValueError, TypeError):
        task5_max_images_per_query = max(15, task5_max_downloads // 8)
    task5_max_crawl_trends = max(5, min(10, int(req_body.get("max_trends") or 8)))

    gemini_model = str(
        req_body.get("gemini_model")
        or os.getenv("GEMINI_MODEL")
        or os.getenv("GEMINI_ANALYSIS_MODEL")
        or "gemini-2.5-pro"
    ).strip()

    vision_model = str(
        req_body.get("vision_model")
        or os.getenv("GEMINI_VISION_MODEL")
        or "gemini-2.5-flash"
    ).strip()

    config = tt_cfg.PipelineConfig(
        target=target,
        output_root=output_root,
        workflow_mode="trend_to_product",
        trend_niche=niche,
        desired_output_count=desired_output_count,
        gemini_model=gemini_model,
        vision_model=vision_model,
        design_mode=design_mode,
        artwork_image_size=artwork_size,
        task4_mockup_engine=mockup_engine,
        task4_variants_per_product=ai_background_variants,
        task4_room_templates=tuple(initial_rt),
        remove_white_background=remove_white_background,
        export_cmyk=True,
        task5_token_path=token_path,
        task5_max_crawl_trends=task5_max_crawl_trends,
        task5_max_downloads=task5_max_downloads,
        task5_top_images=task5_top_images,
        task5_max_images_per_query=task5_max_images_per_query,
        task5_vision_mode=vision_mode,
        trend_region=str(req_body.get("trend_region") or req_body.get("region") or "US").strip().upper(),
        trend_type=str(req_body.get("trend_type") or "growing").strip(),
        trend_interest=str(req_body.get("interest") or req_body.get("interests") or "").strip(),
        custom_queries=tuple(str(q).strip() for q in (req_body.get("custom_queries") or []) if str(q).strip()),
        selected_clusters=tuple(req_body.get("selected_clusters") or []),
    )

    def log_progress(msg: str) -> None:
        if cancel_event is not None and cancel_event.is_set():
            raise getattr(tt_pipe, "PipelineCancelled", RuntimeError)("Job đã được dừng bởi người dùng.")
        with JOB_CACHE_LOCK:
            job = ACTIVE_JOBS.get(job_id)
            if job:
                logs = job.setdefault("logs", [])
                logs.append(msg)
                del logs[:-500]

    vision_status_note = "ĐÃ TẮT AI LỌC - hiển thị 100% ảnh thô cào về" if is_vision_disabled else "Bật AI lọc"
    log_progress(f"Bắt đầu pipeline trực tiếp (Stage: {stage}, Product: {product}, Niche: '{niche}', Vision: {vision_status_note})...")

    try:
        if cancel_event is not None and cancel_event.is_set():
            raise getattr(tt_pipe, "PipelineCancelled", RuntimeError)("Job đã được dừng bởi người dùng.")

        if stage == "crawl_and_review":
            review_pkg = tt_pipe.run_crawl_and_review_stage(config, progress=log_progress, cancel_event=cancel_event)
            raw_refs = req_body.get("reference_images") or []
            if raw_refs:
                saved_templates = save_room_template_images(raw_refs, review_pkg.run_dir / "room_templates")
                log_progress(f"Đã lưu {len(saved_templates)} ảnh phòng tham chiếu vào thư mục run.")
            candidates = [c.to_dict() if hasattr(c, "to_dict") else dict(c) for c in review_pkg.candidates]
            rejected_images = []
            rej_path = review_pkg.crawl_dir / "rejected_images.json"
            if rej_path.exists():
                try:
                    rejected_images = json.loads(rej_path.read_text(encoding="utf-8"))
                except Exception:
                    pass
            clusters_data = req_body.get("selected_clusters") or []

            with JOB_CACHE_LOCK:
                job = ACTIVE_JOBS.get(job_id, {})
                job["status"] = "ready_for_review"
                job["candidates"] = candidates
                job["rejected_candidates"] = rejected_images
                job["rejectedCandidates"] = rejected_images
                job["clusters"] = clusters_data
                job["total_candidates"] = len(candidates)
                job["direct_printable_count"] = sum(1 for c in candidates if c.get("is_direct_printable"))
                job["run_id"] = review_pkg.run_dir.name
                ACTIVE_JOBS[job_id] = job
            manifest = {
                "jobId": job_id,
                "status": "ready_for_review",
                "runId": review_pkg.run_dir.name,
                "jobData": ACTIVE_JOBS[job_id],
                "candidates": candidates,
                "rejected_candidates": rejected_images,
                "clusters": clusters_data,
            }
            save_job_manifest(job_id, manifest)
            if req_body.get("notify_enabled", True):
                send_windows_desktop_notification(
                    "Pinterest POD Studio - Quét xong",
                    f"Đã tìm thấy {len(candidates)} mẫu Trends cho '{req_body.get('niche', 'POD')}'. Mời bạn bấm duyệt mẫu!"
                )
        elif stage == "production":
            selected = req_body.get("selected_candidates") or []
            src_run_id = req_body.get("source_run_id")
            src_dir = resolve_run_dir(src_run_id) if src_run_id else None

            # Resolve candidate dictionaries from source run's candidate_review.json if strings/IDs were passed
            if selected and src_dir and any(isinstance(c, str) for c in selected):
                cr_file = src_dir / "candidate_review.json"
                if cr_file.exists():
                    try:
                        cr_cands = json.loads(cr_file.read_text(encoding="utf-8")).get("candidates", [])
                        c_map: dict[str, dict[str, Any]] = {}
                        for c in cr_cands:
                            if isinstance(c, dict):
                                for k in ("image_id", "id", "candidate_id"):
                                    v = c.get(k)
                                    if v:
                                        c_map[str(v)] = c
                        resolved_list: list[Any] = []
                        for item in selected:
                            if isinstance(item, str) and item.strip() in c_map:
                                resolved_list.append(c_map[item.strip()])
                            else:
                                resolved_list.append(item)
                        selected = resolved_list
                    except Exception:
                        pass

            # Fork selected candidates to a dedicated, isolated run directory
            target_run_dir = None
            if src_dir and hasattr(tt_pipe, "fork_selected_candidates_to_new_run"):
                try:
                    forked_cands, target_run_dir = tt_pipe.fork_selected_candidates_to_new_run(
                        selected,
                        source_run_dir=src_dir,
                        output_root=output_root,
                        config=config,
                    )
                    selected = forked_cands
                    log_progress(f"Đã tạo thư mục sản xuất riêng: {target_run_dir.name} cho {len(selected)} mẫu đã chọn.")
                except Exception as fork_err:
                    log_progress(f"Cảnh báo: không thể fork thư mục riêng ({fork_err}), tiếp tục chạy trong {src_dir.name}")
                    target_run_dir = src_dir
            else:
                target_run_dir = src_dir or output_root

            # Setup room template images
            raw_refs = req_body.get("reference_images") or []
            prod_rt_dir = (target_run_dir or src_dir) / "room_templates" if (target_run_dir or src_dir) else None
            saved_templates: list[Path] = []
            if raw_refs and prod_rt_dir:
                saved_templates = save_room_template_images(raw_refs, prod_rt_dir)
            elif src_dir and (src_dir / "room_templates").is_dir():
                src_rt = src_dir / "room_templates"
                src_templates = [p for p in sorted(src_rt.glob("*.*")) if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}]
                if target_run_dir and target_run_dir != src_dir and prod_rt_dir:
                    prod_rt_dir.mkdir(parents=True, exist_ok=True)
                    copied_templates = []
                    for st in src_templates:
                        dest = prod_rt_dir / st.name
                        shutil.copy2(st, dest)
                        copied_templates.append(dest)
                    saved_templates = copied_templates
                else:
                    saved_templates = src_templates

            if saved_templates:
                updated_variants = max(config.task4_variants_per_product, len(saved_templates))
                config = dataclasses.replace(
                    config,
                    task4_room_templates=tuple(saved_templates),
                    task4_variants_per_product=updated_variants,
                )
                log_progress(f"Áp dụng {len(saved_templates)} ảnh phòng tham chiếu cho khâu render mockup AI ({updated_variants} biến thể/sản phẩm).")

            result = tt_pipe.run_production_from_candidates(selected, config, run_dir=target_run_dir, progress=log_progress, cancel_event=cancel_event)
            loaded = load_standalone_run(result.run_dir.name, base_url)
            with JOB_CACHE_LOCK:
                if loaded:
                    loaded["status"] = "completed"
                    loaded["job_id"] = job_id
                    loaded["jobId"] = job_id
                    loaded["run_id"] = result.run_dir.name
                    loaded["runId"] = result.run_dir.name
                    loaded["source_run_id"] = src_run_id
                    loaded["sourceRunId"] = src_run_id
                    loaded["request"] = req_body
                    ACTIVE_JOBS[job_id] = loaded
                    save_job_manifest(job_id, loaded)
                elif job_id in ACTIVE_JOBS:
                    ACTIVE_JOBS[job_id]["status"] = "completed"
                    ACTIVE_JOBS[job_id]["run_id"] = result.run_dir.name
                    ACTIVE_JOBS[job_id]["runId"] = result.run_dir.name
                    ACTIVE_JOBS[job_id]["source_run_id"] = src_run_id
                    ACTIVE_JOBS[job_id]["request"] = req_body
                    ACTIVE_JOBS[job_id].setdefault("logs", []).append(f"Hoàn thành sản xuất (Run: {result.run_dir.name}).")
                    save_job_manifest(job_id, ACTIVE_JOBS[job_id])
            if req_body.get("notify_enabled", True):
                total_items = len(selected)
                send_windows_desktop_notification(
                    "Pinterest POD Studio - Hoàn tất",
                    f"Đã hoàn thành toàn bộ {total_items} sản phẩm: File in CMYK 300DPI & Mockup AI cho '{req_body.get('niche', 'POD')}'. Mời bạn kiểm tra thành phẩm!"
                )
        else:
            result = tt_pipe.run_pipeline(config, progress=log_progress, cancel_event=cancel_event)
            loaded = load_standalone_run(result.run_dir.name, base_url)
            with JOB_CACHE_LOCK:
                if loaded:
                    loaded["status"] = "completed"
                    loaded["job_id"] = job_id
                    loaded["jobId"] = job_id
                    loaded["run_id"] = result.run_dir.name
                    ACTIVE_JOBS[job_id] = loaded
                    save_job_manifest(job_id, loaded)
                elif job_id in ACTIVE_JOBS:
                    ACTIVE_JOBS[job_id]["status"] = "completed"
                    ACTIVE_JOBS[job_id]["run_id"] = result.run_dir.name
                    ACTIVE_JOBS[job_id].setdefault("logs", []).append(f"Hoàn thành pipeline (Run: {result.run_dir.name}).")
                    save_job_manifest(job_id, ACTIVE_JOBS[job_id])
            if req_body.get("notify_enabled", True):
                send_windows_desktop_notification(
                    "Pinterest POD Studio - Hoàn tất",
                    f"Quy trình tự động cho '{req_body.get('niche', 'POD')}' đã hoàn tất xuất sắc!"
                )
    except Exception as exc:
        is_cancelled = (
            isinstance(exc, getattr(tt_pipe, "PipelineCancelled", ()))
            or type(exc).__name__ in {"PipelineCancelled", "Task5ProcessCancelled"}
            or (cancel_event is not None and cancel_event.is_set())
        )
        with JOB_CACHE_LOCK:
            if job_id in ACTIVE_JOBS:
                if is_cancelled:
                    ACTIVE_JOBS[job_id]["status"] = "cancelled"
                    ACTIVE_JOBS[job_id]["error"] = "Tiến trình đã được dừng bởi người dùng."
                    ACTIVE_JOBS[job_id].setdefault("logs", []).append("Tiến trình đã dừng an toàn theo yêu cầu của người dùng.")
                    save_job_manifest(job_id, ACTIVE_JOBS[job_id])
                else:
                    import traceback
                    tb = traceback.format_exc()
                    ACTIVE_JOBS[job_id]["status"] = "failed"
                    ACTIVE_JOBS[job_id]["error"] = str(exc)
                    ACTIVE_JOBS[job_id].setdefault("logs", []).append(f"LỖI: {exc}\n{tb}")
                    save_job_manifest(job_id, ACTIVE_JOBS[job_id])
                    if req_body.get("notify_enabled", True):
                        send_windows_desktop_notification(
                            "Pinterest POD Studio - Gặp lỗi",
                            f"Job '{req_body.get('niche', 'POD')}' thất bại: {exc}"
                        )
    finally:
        with JOB_CACHE_LOCK:
            JOB_CANCEL_EVENTS.pop(job_id, None)
            LOCAL_WORKER_THREADS.pop(job_id, None)


# ---------------------------------------------------------------------------
# Job Management API Methods
# ---------------------------------------------------------------------------

def produce_pod_job(payload: dict[str, Any], base_url: str, api_url: str = DEFAULT_API_URL) -> dict[str, Any]:
    api_url = (api_url or DEFAULT_API_URL).rstrip("/")
    source_job_id = str(payload.get("jobId") or payload.get("job_id") or payload.get("source_run_id") or "").strip()
    selected_candidates = payload.get("selected_candidates") or payload.get("candidates") or []
    if not selected_candidates:
        raise ValueError("Vui lòng chọn ít nhất một ảnh ứng viên để sản xuất.")

    status_info = ACTIVE_JOBS.get(source_job_id) or load_job_manifest(source_job_id) or {}
    real_run_id = (
        payload.get("source_run_id")
        or status_info.get("run_id")
        or (status_info.get("jobData") or {}).get("run_id")
        or status_info.get("runId")
        or source_job_id
    )
    src_dir = resolve_run_dir(real_run_id) if real_run_id else None

    # Build candidate lookup dictionary from manifest and run folder
    cand_lookup: dict[str, dict[str, Any]] = {}
    known_candidates = (
        status_info.get("candidates")
        or (status_info.get("jobData") or {}).get("candidates")
        or (status_info.get("output") or {}).get("candidates")
        or []
    )
    for c in known_candidates:
        if isinstance(c, dict):
            for k in ("image_id", "id", "candidate_id"):
                v = c.get(k)
                if v:
                    cand_lookup[str(v)] = c

    if src_dir and (src_dir / "candidate_review.json").exists():
        try:
            cr_data = json.loads((src_dir / "candidate_review.json").read_text(encoding="utf-8"))
            for c in cr_data.get("candidates", []):
                if isinstance(c, dict):
                    for k in ("image_id", "id", "candidate_id"):
                        v = c.get(k)
                        if v and str(v) not in cand_lookup:
                            cand_lookup[str(v)] = c
        except Exception:
            pass

    resolved_candidates: list[dict[str, Any]] = []
    for cand in selected_candidates:
        cand_dict: dict[str, Any] | None = None
        if isinstance(cand, str):
            cid = cand.strip()
            if cid in cand_lookup:
                cand_dict = copy.deepcopy(cand_lookup[cid])
            elif src_dir:
                for ext in (".jpg", ".png", ".jpeg", ".webp"):
                    p = src_dir / "task5_crawl" / "downloaded_images" / f"{cid}{ext}"
                    if p.exists():
                        cand_dict = {"image_id": cid, "id": cid, "local_path": str(p), "query": payload.get("niche") or "rug"}
                        break
            if not cand_dict:
                cand_dict = {"image_id": cid, "id": cid, "query": payload.get("niche") or "rug"}
        elif isinstance(cand, dict):
            cand_dict = copy.deepcopy(cand)
            cid = str(cand_dict.get("image_id") or cand_dict.get("id") or cand_dict.get("candidate_id") or "").strip()
            if cid and cid in cand_lookup:
                for k, v in cand_lookup[cid].items():
                    cand_dict.setdefault(k, v)

        if cand_dict:
            # Ensure local_path exists on disk
            lp = cand_dict.get("local_path") or cand_dict.get("path") or cand_dict.get("image_path")
            if (not lp or not Path(lp).exists()) and src_dir:
                fname = Path(lp).name if lp else f"{cand_dict.get('image_id', '')}.jpg"
                for sub in ("task5_crawl/downloaded_images", "dedupe/kept", "task5_crawl", ""):
                    test_p = src_dir / sub / fname if sub else src_dir / fname
                    if test_p.exists():
                        cand_dict["local_path"] = str(test_p.resolve())
                        break
            resolved_candidates.append(cand_dict)

    selected_candidates = resolved_candidates

    niche = str(payload.get("niche") or "").strip()
    if not niche and source_job_id:
        niche = status_info.get("niche") or (status_info.get("request") or {}).get("niche") or "Trend Design"

    raw_product = str(payload.get("product") or status_info.get("product") or (status_info.get("jobData") or {}).get("product") or "").lower().strip()
    if raw_product in {"rug", "blanket", "bag", "custom"}:
        product = raw_product
    else:
        product = infer_product_type_from_niche(niche)

    design_mode = str(payload.get("design_mode") or "direct_print").strip()
    artwork_image_size = str(payload.get("artwork_image_size") or payload.get("artwork_size") or DEFAULT_ARTWORK_IMAGE_SIZE).strip() or DEFAULT_ARTWORK_IMAGE_SIZE
    mockup_engine = "direct_ai"
    remove_white_background = bool(payload.get("remove_white_background", False))

    has_explicit_refs = "referenceImages" in payload or "reference_images" in payload
    reference_images = payload.get("referenceImages") or payload.get("reference_images") or []
    room_template_urls = payload.get("room_template_urls") or []
    if not reference_images and not has_explicit_refs and real_run_id:
        src_run_dir = resolve_run_dir(real_run_id)
        if src_run_dir and (src_run_dir / "room_templates").is_dir():
            reference_images = [str(f) for f in sorted((src_run_dir / "room_templates").glob("*.*")) if f.is_file() and f.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}]

    if reference_images:
        ai_background_variants = max(1, min(10, len(reference_images)))
    else:
        try:
            ai_background_variants = int(payload.get("ai_background_variants") or payload.get("room_angles") or 5)
        except (ValueError, TypeError):
            ai_background_variants = 5
        ai_background_variants = max(1, min(10, ai_background_variants))

    print_spec = get_print_spec(product)
    req_body: dict[str, Any] = {
        "niche": niche or "Trend Design",
        "product": product,
        "workflow_stage": "production",
        "source_run_id": real_run_id,
        "selected_candidates": selected_candidates,
        "design_mode": design_mode,
        "image_size": DEFAULT_ARTWORK_IMAGE_SIZE,
        "artwork_size": DEFAULT_ARTWORK_IMAGE_SIZE,
        "artwork_image_size": DEFAULT_ARTWORK_IMAGE_SIZE,
        "mockup_engine": mockup_engine,
        "ai_background_variants": ai_background_variants,
        "remove_white_background": remove_white_background,
        "desired_output_count": len(selected_candidates),
        "dpi": print_spec["dpi"],
        "notify_enabled": bool(payload.get("notify_enabled", True)),
        "reference_images": reference_images,
        "room_template_urls": room_template_urls,
    }
    if product == "custom":
        req_body["width_px"] = print_spec["width_px"]
        req_body["height_px"] = print_spec["height_px"]

    # Directly execute in-process local pipeline worker
    local_job_id = f"job_prod_{uuid.uuid4().hex[:10]}"
    cancel_event = threading.Event()
    initial_state = {
        "job_id": local_job_id,
        "status": "running",
        "created_at": time.time(),
        "logs": [f"Bắt đầu sản xuất cho {len(selected_candidates)} mẫu ứng viên đã chọn..."],
        "request": req_body,
        "niche": niche or "Trend Design",
        "product": product,
    }
    with JOB_CACHE_LOCK:
        JOB_CANCEL_EVENTS[local_job_id] = cancel_event
        ACTIVE_JOBS[local_job_id] = initial_state
    save_job_manifest(local_job_id, initial_state)

    worker = threading.Thread(
        target=_run_local_pipeline_worker,
        args=(local_job_id, req_body, base_url, cancel_event),
        name=f"pod-local-prod-{local_job_id[:8]}",
        daemon=True,
    )
    with JOB_CACHE_LOCK:
        LOCAL_WORKER_THREADS[local_job_id] = worker
    worker.start()

    stepper = calculate_stepper_state(initial_state)
    return {
        "ok": True,
        "jobId": local_job_id,
        "job_id": local_job_id,
        "status": "running",
        "stepper": stepper,
        "job": initial_state,
    }


def create_pod_job(payload: dict[str, Any], base_url: str, api_url: str = DEFAULT_API_URL) -> dict[str, Any]:
    api_url = (api_url or DEFAULT_API_URL).rstrip("/")
    action = str(payload.get("action") or "").lower().strip()
    workflow_stage = str(payload.get("workflow_stage") or "").lower().strip()
    if action == "produce" or workflow_stage == "production":
        return produce_pod_job(payload, base_url, api_url)

    niche = str(payload.get("niche") or "").strip()
    if not niche:
        raise ValueError("Vui lòng nhập Pinterest niche hoặc từ khóa xu hướng.")

    # Validate Pinterest API OAuth token before launching pipeline
    oauth_valid, _ = check_oauth_token_valid()
    if not oauth_valid and not os.getenv("MOCK_PINTEREST") and not os.getenv("CI"):
        raise ValueError(
            "Chưa kết nối tài khoản Pinterest API hoặc Access Token đã hết hạn. "
            "Vui lòng bấm nút 'Kết nối Pinterest' trên thanh tiêu đề để xác thực hoặc dán token hợp lệ trước khi quét."
        )

    raw_product = str(payload.get("product") or "").lower().strip()
    if raw_product in {"rug", "blanket", "bag", "custom"}:
        product = raw_product
    else:
        product = infer_product_type_from_niche(niche)

    desired_output_count = int(payload.get("desired_output_count") or 1)
    desired_output_count = max(1, min(10, desired_output_count))

    ref_images = payload.get("referenceImages") or payload.get("reference_images") or []
    if ref_images:
        ai_background_variants = max(1, min(10, len(ref_images)))
    else:
        try:
            ai_background_variants = int(payload.get("ai_background_variants") or payload.get("room_angles") or 5)
        except (ValueError, TypeError):
            ai_background_variants = 5
        ai_background_variants = max(1, min(10, ai_background_variants))

    # Pinterest crawl count slider: range 10-80, default 40
    raw_crawl = (
        payload.get("candidatePoolSize")
        or payload.get("task5_max_downloads")
        or payload.get("max_downloads")
        or payload.get("top_images")
        or 40
    )
    try:
        crawl_count = int(raw_crawl)
    except (ValueError, TypeError):
        crawl_count = 40
    crawl_count = max(10, min(80, crawl_count))

    trend_region = str(payload.get("trend_region") or payload.get("region") or "US").strip()
    trend_type = str(payload.get("trend_type") or "growing").strip()
    design_mode = str(payload.get("design_mode") or "ai-artwork").strip()
    artwork_image_size = str(payload.get("artwork_image_size") or payload.get("artwork_size") or DEFAULT_ARTWORK_IMAGE_SIZE).strip() or DEFAULT_ARTWORK_IMAGE_SIZE
    mockup_engine = "direct_ai"
    remove_white_background = bool(payload.get("remove_white_background", False))

    workflow_type = str(payload.get("workflow_type") or payload.get("mode") or "").strip().lower()
    if workflow_type in {"two_stage", "review", "candidate_review"} or workflow_stage == "crawl_and_review":
        workflow_stage = "crawl_and_review"
    else:
        workflow_stage = "auto"

    print_spec = get_print_spec(product)
    req_body: dict[str, Any] = {
        "niche": niche,
        "product": product,
        "desired_output_count": desired_output_count,
        "ai_background_variants": ai_background_variants,
        "trend_region": trend_region,
        "trend_type": trend_type,
        "design_mode": design_mode,
        "image_size": DEFAULT_ARTWORK_IMAGE_SIZE,
        "artwork_size": DEFAULT_ARTWORK_IMAGE_SIZE,
        "artwork_image_size": DEFAULT_ARTWORK_IMAGE_SIZE,
        "mockup_engine": mockup_engine,
        "remove_white_background": remove_white_background,
        "workflow_stage": workflow_stage,
        "dpi": print_spec["dpi"],
        "notify_enabled": bool(payload.get("notify_enabled", True)),
        "reference_images": ref_images,
        "room_template_urls": payload.get("room_template_urls") or [],
        "candidatePoolSize": crawl_count,
        "task5_max_downloads": crawl_count,
        "task5_top_images": crawl_count,
        "task5_max_images_per_query": max(12, crawl_count // 4),
        "selected_clusters": payload.get("selected_clusters") or payload.get("selectedClusters") or [],
        "custom_queries": payload.get("custom_queries") or payload.get("customQueries") or [],
        "interest": payload.get("interest") or payload.get("interests") or "",
    }
    if product == "custom":
        req_body["width_px"] = print_spec["width_px"]
        req_body["height_px"] = print_spec["height_px"]

    # Directly execute in-process local pipeline worker
    local_job_id = f"job_{uuid.uuid4().hex[:10]}"
    cancel_event = threading.Event()
    initial_logs = [f"Khởi tạo job POD ({workflow_stage}): {niche} ({product})..."]
    ref_count = len(req_body["reference_images"])
    if ref_count > 0:
        initial_logs.append(f"Đã nhận {ref_count} ảnh phòng tham chiếu cho khâu mockup.")
    initial_state = {
        "job_id": local_job_id,
        "status": "running",
        "created_at": time.time(),
        "logs": initial_logs,
        "request": req_body,
        "niche": niche,
        "product": product,
    }
    with JOB_CACHE_LOCK:
        JOB_CANCEL_EVENTS[local_job_id] = cancel_event
        ACTIVE_JOBS[local_job_id] = initial_state
    save_job_manifest(local_job_id, initial_state)

    worker = threading.Thread(
        target=_run_local_pipeline_worker,
        args=(local_job_id, req_body, base_url, cancel_event),
        name=f"pod-local-{local_job_id[:8]}",
        daemon=True,
    )
    with JOB_CACHE_LOCK:
        LOCAL_WORKER_THREADS[local_job_id] = worker
    worker.start()

    stepper = calculate_stepper_state(initial_state)
    return {
        "ok": True,
        "jobId": local_job_id,
        "job_id": local_job_id,
        "status": "running",
        "stepper": stepper,
        "logs": initial_logs,
        "job": initial_state,
    }


def load_standalone_run(run_id: str, base_url: str) -> dict[str, Any] | None:
    """Load durable output artifacts from standalone run_* directory into a completed job structure."""
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(run_id or ""))
    if not safe_id:
        return None
    run_dir = resolve_run_dir(safe_id)
    if not run_dir or not run_dir.is_dir():
        return None

    # Load metadata
    niche = ""
    product_type = "rug"
    motifs: list[str] = []
    candidates: list[dict[str, Any]] = []
    review_file = run_dir / "candidate_review.json"
    if review_file.exists():
        try:
            rev_data = json.loads(review_file.read_text(encoding="utf-8"))
            niche = rev_data.get("niche") or ""
            product_type = rev_data.get("target_product") or "rug"
            candidates = rev_data.get("candidates") or []
            if candidates and isinstance(candidates[0], dict):
                motifs = list(candidates[0].get("motifs") or [])
        except Exception:
            pass

    cfg_file = run_dir / "config.json"
    if (not niche or not product_type) and cfg_file.exists():
        try:
            cfg_data = json.loads(cfg_file.read_text(encoding="utf-8"))
            niche = niche or cfg_data.get("trend_niche") or ""
            product_type = product_type or (cfg_data.get("target") or {}).get("name") or "rug"
        except Exception:
            pass

    # Extract rug shape recommendation if present
    rug_shape_records = []
    detected_shape = "rectangle"
    shape_decision = None
    manifest_file = run_dir / "stage_manifest.json"
    manifest_data = {}
    if manifest_file.exists():
        try:
            manifest_data = json.loads(manifest_file.read_text(encoding="utf-8"))
            rug_shape_records = manifest_data.get("rug_shape_records") or []
            if rug_shape_records and isinstance(rug_shape_records[0], dict):
                shape_decision = rug_shape_records[0]
                detected_shape = shape_decision.get("shape") or "rectangle"
        except Exception:
            pass

    # Discover marketing lifestyle mockups
    mockup_files: list[Path] = []
    lifestyle_dir = run_dir / "lifestyle_mockups"
    if lifestyle_dir.exists():
        cand_lifestyle = [p for p in lifestyle_dir.iterdir() if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}]
        # Filter canonical _lifestyle_\d+\. to prevent duplication with _v\d+_lifestyle files
        has_canonical = any(re.search(r"_lifestyle_\d+\.", p.name) for p in cand_lifestyle)
        if has_canonical:
            mockup_files = sorted([p for p in cand_lifestyle if re.search(r"_lifestyle_\d+\.", p.name)], key=natural_sort_key)
        else:
            mockup_files = sorted(cand_lifestyle, key=natural_sort_key)
    if not mockup_files:
        mockups_dir = run_dir / "mockups"
        if mockups_dir.exists():
            mockup_files = sorted(
                [p for p in mockups_dir.iterdir() if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}],
                key=natural_sort_key,
            )

    # Discover CMYK print files and RGB 4K PNG files (sorted naturally by filename e.g. rug_001, rug_002, rug_003)
    cmyk_files: list[Path] = []
    final_png_files: list[Path] = []
    final_dir = run_dir / "final_print"
    if final_dir.exists():
        cmyk_files = sorted(
            [p for p in final_dir.iterdir() if p.is_file() and "_cmyk" in p.name.lower() and p.suffix.lower() in {".jpg", ".jpeg"}],
            key=natural_sort_key,
        )
        final_png_files = sorted(
            [p for p in final_dir.iterdir() if p.is_file() and p.suffix.lower() == ".png" and "_cmyk" not in p.name.lower()],
            key=natural_sort_key,
        )

    # Discover product cutouts (sorted naturally by filename)
    cutouts_dir = run_dir / "product_cutouts"
    cutout_files = sorted([p for p in cutouts_dir.iterdir() if p.is_file() and p.suffix.lower() in {".png", ".webp"}], key=natural_sort_key) if cutouts_dir.exists() else []

    cutouts_white_dir = run_dir / "product_cutouts_white"
    cutout_white_files = sorted([p for p in cutouts_white_dir.iterdir() if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}], key=natural_sort_key) if cutouts_white_dir.exists() else []

    # Discover perspective mockups (sorted naturally by filename)
    perspective_dir = run_dir / "mockups"
    perspective_files = sorted([p for p in perspective_dir.iterdir() if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}], key=natural_sort_key) if perspective_dir.exists() else []

    if not mockup_files and not cmyk_files and not final_png_files and not candidates:
        if manifest_file.exists() or review_file.exists() or cfg_file.exists():
            status_manifest = str(manifest_data.get("status") or "").lower().strip()
            err_msg = manifest_data.get("message") or manifest_data.get("reason") or "Thư mục run không chứa ứng viên hoặc thành phẩm in."
            return {
                "job_id": safe_id,
                "jobId": safe_id,
                "status": "failed" if status_manifest == "failed" else ("ready_for_review" if candidates else "failed"),
                "error": err_msg,
                "niche": niche or safe_id,
                "product": product_type or "rug",
                "deliverables": {},
                "candidates": [],
                "logs": [f"Thư mục run: {safe_id}", f"Trạng thái: {status_manifest or 'Chưa hoàn tất'}", f"Ghi chú: {err_msg}"],
            }
        return None

    # Copy / cache files to TEMP_DIR for serving
    job_dir = TEMP_DIR / safe_id
    job_dir.mkdir(parents=True, exist_ok=True)

    def _cache_file(p: Path) -> Path:
        dest = job_dir / p.name
        if not dest.exists() or dest.stat().st_size == 0:
            try:
                shutil.copy2(p, dest)
            except Exception:
                pass
        return dest

    # 1. Marketing / Lifestyle assets
    marketing_assets = []
    for idx, p in enumerate(mockup_files):
        dest = _cache_file(p)
        rel = p.relative_to(run_dir).as_posix()
        marketing_assets.append({
            "kind": "marketing_image",
            "name": p.name,
            "filename": p.name,
            "path": str(dest.resolve()),
            "relative_path": rel,
            "bytes": dest.stat().st_size if dest.exists() else 0,
            "url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{safe_id}/{p.name}",
            "download_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{safe_id}/{p.name}",
            "is_primary": idx == 0,
        })

    # 2. CMYK Print Master assets
    print_spec = get_print_spec(product_type)
    cmyk_assets = []
    for p in cmyk_files:
        dest = _cache_file(p)
        rel = p.relative_to(run_dir).as_posix()
        if dest.exists() and dest.stat().st_size > 0:
            ensure_print_image_standard(dest, print_spec)
        cmyk_assets.append({
            "kind": "print_cmyk",
            "name": p.name,
            "filename": p.name,
            "path": str(dest.resolve()),
            "relative_path": rel,
            "bytes": dest.stat().st_size if dest.exists() else 0,
            "url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{safe_id}/{p.name}",
            "download_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{safe_id}/{p.name}",
            "width_px": print_spec["width_px"],
            "height_px": print_spec["height_px"],
            "dpi": print_spec["dpi"],
            "color_mode": print_spec["color_mode"],
            "standard_label": print_spec["label"],
            "standard_badge": print_spec["badge"],
        })

    # 3. RGB PNG 4K Print assets
    final_png_assets = []
    for idx, p in enumerate(final_png_files):
        dest = _cache_file(p)
        rel = p.relative_to(run_dir).as_posix()
        final_png_assets.append({
            "kind": "print_rgb_png",
            "name": p.name,
            "filename": p.name,
            "path": str(dest.resolve()),
            "relative_path": rel,
            "bytes": dest.stat().st_size if dest.exists() else 0,
            "url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{safe_id}/{p.name}",
            "download_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{safe_id}/{p.name}",
            "width_px": print_spec["width_px"],
            "height_px": print_spec["height_px"],
            "dpi": print_spec["dpi"],
            "color_mode": "RGB",
            "standard_label": f"{print_spec['width_px']} x {print_spec['height_px']} px @ {print_spec['dpi']} DPI (RGB 4K)",
            "standard_badge": "RGB 4K Siêu Nét",
            "is_primary": idx == 0,
        })

    # 4. Product cutouts (transparent & white)
    cutout_assets = []
    for p in cutout_files:
        dest = _cache_file(p)
        rel = p.relative_to(run_dir).as_posix()
        cutout_assets.append({
            "kind": "product_cutout",
            "type": "transparent",
            "name": p.name,
            "filename": p.name,
            "path": str(dest.resolve()),
            "relative_path": rel,
            "bytes": dest.stat().st_size if dest.exists() else 0,
            "url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{safe_id}/{p.name}",
            "download_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{safe_id}/{p.name}",
        })

    cutout_white_assets = []
    for p in cutout_white_files:
        white_name = p.name if ("white" in p.name.lower()) else f"{p.stem}_white{p.suffix}"
        dest = job_dir / white_name
        if not dest.exists() or dest.stat().st_size == 0:
            try:
                shutil.copy2(p, dest)
            except Exception:
                pass
        rel = p.relative_to(run_dir).as_posix()
        cutout_white_assets.append({
            "kind": "product_cutout_white",
            "type": "white",
            "name": white_name,
            "filename": white_name,
            "path": str(dest.resolve()),
            "relative_path": rel,
            "bytes": dest.stat().st_size if dest.exists() else 0,
            "url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{safe_id}/{white_name}",
            "download_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{safe_id}/{white_name}",
        })

    # 5. Perspective mockups
    perspective_assets = []
    for p in perspective_files:
        dest = _cache_file(p)
        rel = p.relative_to(run_dir).as_posix()
        perspective_assets.append({
            "kind": "perspective_mockup",
            "name": p.name,
            "filename": p.name,
            "path": str(dest.resolve()),
            "relative_path": rel,
            "bytes": dest.stat().st_size if dest.exists() else 0,
            "url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{safe_id}/{p.name}",
            "download_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{safe_id}/{p.name}",
        })

    # 6. Build Comparison Rows (4 Steps)
    compare_rows_data = []
    try:
        from trend_tool.comparison import build_comparison_rows
        c_rows = build_comparison_rows(run_dir, manifest_data if isinstance(manifest_data, dict) else None)
        for idx, r in enumerate(c_rows, start=1):
            def _url_for(p: Path | None, is_white_cutout: bool = False) -> str:
                if not p or not p.exists():
                    return ""
                if is_white_cutout or "product_cutouts_white" in p.parts:
                    white_name = p.name if ("white" in p.name.lower()) else f"{p.stem}_white{p.suffix}"
                    dest = job_dir / white_name
                    if not dest.exists() or dest.stat().st_size == 0:
                        try:
                            shutil.copy2(p, dest)
                        except Exception:
                            pass
                    return f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{safe_id}/{white_name}"
                _cache_file(p)
                return f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{safe_id}/{p.name}"

            src_u = _url_for(r.source_path)
            c_trans_u = _url_for(r.cutout_path)
            c_white_u = _url_for(r.cutout_white_path, is_white_cutout=True)
            fp_u = _url_for(r.final_print_path)
            fp_fn = r.final_print_path.name if r.final_print_path else ""

            if not fp_u:
                if final_png_assets and idx <= len(final_png_assets):
                    fp_u = final_png_assets[idx - 1]["url"]
                    fp_fn = final_png_assets[idx - 1]["filename"]
                elif cmyk_assets and idx <= len(cmyk_assets):
                    fp_u = cmyk_assets[idx - 1]["url"]
                    fp_fn = cmyk_assets[idx - 1]["filename"]

            if (not c_white_u or c_white_u == c_trans_u) and cutout_white_assets and idx <= len(cutout_white_assets):
                c_white_u = cutout_white_assets[idx - 1]["url"]
                c_white_fn = cutout_white_assets[idx - 1]["filename"]
            else:
                c_white_fn = (r.cutout_white_path.stem + "_white" + r.cutout_white_path.suffix) if (r.cutout_white_path and "white" not in r.cutout_white_path.name.lower()) else (r.cutout_white_path.name if r.cutout_white_path else "")

            bg_us = [_url_for(bg) for bg in r.ai_background_paths if bg and bg.exists()]
            if not bg_us:
                d_prefix = f"rug_{idx:03d}"
                bg_us = [m["url"] for m in marketing_assets if d_prefix in (m.get("filename") or "") or f"_{idx}" in (m.get("filename") or "")]

            compare_rows_data.append({
                "index": r.index,
                "product_label": r.product_label or f"Design #{r.index}",
                "status": r.status,
                "reason": r.reason,
                "source_url": src_u,
                "source_filename": r.source_path.name if r.source_path else "",
                "cutout_url": c_trans_u,
                "cutout_filename": r.cutout_path.name if r.cutout_path else "",
                "cutout_white_url": c_white_u,
                "cutout_white_filename": c_white_fn,
                "final_print_url": fp_u,
                "final_print_filename": fp_fn,
                "ai_background_urls": bg_us,
            })
    except Exception as exc:
        print(f"[PinterestPOD] build_comparison_rows note: {exc}")

    # Fallback comparison rows aligned 1..N if manifest rows unavailable
    if not compare_rows_data and (final_png_assets or cmyk_assets or cutout_assets):
        total_d = max(len(final_png_assets), len(cmyk_assets), len(cutout_assets))
        for idx in range(1, total_d + 1):
            src_u = ""
            src_fn = ""
            if candidates and idx <= len(candidates):
                c_item = candidates[idx - 1]
                src_u = c_item.get("thumbnail_url") or c_item.get("image_url") or ""
                src_fn = c_item.get("local_filename") or c_item.get("filename") or ""
            c_trans_u = cutout_assets[idx - 1]["url"] if idx <= len(cutout_assets) else ""
            c_trans_fn = cutout_assets[idx - 1]["filename"] if idx <= len(cutout_assets) else ""
            c_white_u = cutout_white_assets[idx - 1]["url"] if idx <= len(cutout_white_assets) else ""
            c_white_fn = cutout_white_assets[idx - 1]["filename"] if idx <= len(cutout_white_assets) else ""
            fp_u = final_png_assets[idx - 1]["url"] if idx <= len(final_png_assets) else (cmyk_assets[idx - 1]["url"] if idx <= len(cmyk_assets) else "")
            fp_fn = final_png_assets[idx - 1]["filename"] if idx <= len(final_png_assets) else (cmyk_assets[idx - 1]["filename"] if idx <= len(cmyk_assets) else "")
            # Lifestyle mockups matching design idx
            d_prefix = f"rug_{idx:03d}"
            d_mockups = [m["url"] for m in marketing_assets if d_prefix in (m.get("filename") or "") or f"_{idx}" in (m.get("filename") or "")]
            compare_rows_data.append({
                "index": idx,
                "product_label": f"Design #{idx}",
                "status": "ok",
                "reason": "",
                "source_url": src_u,
                "source_filename": src_fn,
                "cutout_url": c_trans_u,
                "cutout_filename": c_trans_fn,
                "cutout_white_url": c_white_u,
                "cutout_white_filename": c_white_fn,
                "final_print_url": fp_u,
                "final_print_filename": fp_fn,
                "ai_background_urls": d_mockups,
            })

    # 7. Check for report.html
    report_file = run_dir / "report.html"
    has_report = report_file.exists() and report_file.is_file()
    report_url = None
    if has_report:
        _cache_file(report_file)
        report_url = f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{safe_id}/report.html"

    # Compute Summary Metrics with aliases
    summary_metrics = {
        "rgb_4k_count": len(final_png_assets),
        "final_print_count": len(final_png_assets),
        "cmyk_count": len(cmyk_assets),
        "lifestyle_mockup_count": len(marketing_assets),
        "lifestyle_mockups_count": len(marketing_assets),
        "cutouts_count": len(cutout_assets) + len(cutout_white_assets),
        "perspective_mockup_count": len(perspective_assets),
        "mockups_count": len(perspective_assets) or len(marketing_assets),
    }

    status_val = "completed" if (mockup_files or cmyk_files or final_png_files) else ("ready_for_review" if candidates else "in_progress")
    deliverables_dict = {
        "marketing_images": marketing_assets,
        "lifestyle_mockups": marketing_assets,
        "print_cmyk_images": cmyk_assets,
        "final_png_images": final_png_assets,
        "final_prints": final_png_assets,
        "product_cutouts": cutout_assets,
        "product_cutouts_white": cutout_white_assets,
        "perspective_mockups": perspective_assets,
        "comparison_matrix": compare_rows_data,
        "comparison_rows": compare_rows_data,
        "rug_shape": detected_shape,
        "rug_shape_records": rug_shape_records,
        "print_spec": print_spec,
        "storefront_spec": get_storefront_spec(),
        "standard_badge": print_spec["badge"],
        "summary_metrics": summary_metrics,
        "report_url": report_url,
        "has_report": has_report,
        "summary": {
            "marketing_images": len(marketing_assets),
            "lifestyle_mockups": len(marketing_assets),
            "print_cmyk_images": len(cmyk_assets),
            "final_png_images": len(final_png_assets),
            "product_cutouts": len(cutout_assets) + len(cutout_white_assets),
            "perspective_mockups": len(perspective_assets),
        },
    }

    cached_assets_dict = {
        "jobId": safe_id,
        "runId": safe_id,
        "cachedAt": time.time(),
        "marketingImages": marketing_assets,
        "lifestyleMockups": marketing_assets,
        "printCmykImages": cmyk_assets,
        "finalPngImages": final_png_assets,
        "finalPrints": final_png_assets,
        "productCutouts": cutout_assets,
        "productCutoutsWhite": cutout_white_assets,
        "perspectiveMockups": perspective_assets,
        "comparisonMatrix": compare_rows_data,
        "comparisonRows": compare_rows_data,
        "printSpec": print_spec,
        "storefrontSpec": get_storefront_spec(),
        "standardBadge": print_spec["badge"],
        "summaryMetrics": summary_metrics,
        "reportUrl": report_url,
        "hasReport": has_report,
    }

    job_data: dict[str, Any] = {
        "job_id": safe_id,
        "jobId": safe_id,
        "status": status_val,
        "niche": niche or safe_id,
        "product": product_type or "rug",
        "motifs": motifs,
        "rugShape": detected_shape,
        "rugShapeDecision": shape_decision,
        "candidates": candidates,
        "total_candidates": len(candidates),
        "direct_printable_count": sum(1 for c in candidates if isinstance(c, dict) and c.get("is_direct_printable")),
        "request": {"niche": niche or safe_id, "product": product_type or "rug"},
        "deliverables": deliverables_dict,
        "output": {
            "run_id": safe_id,
            **deliverables_dict,
        },
        "cachedAssets": cached_assets_dict,
        "summaryMetrics": summary_metrics,
        "reportUrl": report_url,
        "hasReport": has_report,
        "logs": [
            f"Tải thành công run cục bộ: {safe_id}",
            f"Niche: {niche or 'Chưa xác định'}",
            f"Product: {product_type}",
            f"Dáng thảm AI: {detected_shape}",
            f"Deliverables: {len(marketing_assets)} mockups, {len(cmyk_assets)} CMYK, {len(final_png_assets)} RGB 4K, {len(cutout_assets) + len(cutout_white_assets)} cutouts.",
        ],
    }

    manifest = {
        "jobId": safe_id,
        "status": status_val,
        "completedAt": time.time(),
        "jobData": job_data,
        "cachedAssets": job_data["cachedAssets"],
        "sync": {},
    }
    save_job_manifest(safe_id, manifest)
    return job_data


def get_pod_job_status(job_id: str, base_url: str, api_url: str = DEFAULT_API_URL) -> dict[str, Any]:
    api_url = (api_url or DEFAULT_API_URL).rstrip("/")
    manifest = None
    with JOB_CACHE_LOCK:
        cached_job = copy.deepcopy(ACTIVE_JOBS.get(job_id))

    if not cached_job:
        manifest = load_job_manifest(job_id)
        if manifest:
            cached_job = manifest.get("jobData") or manifest
    elif not manifest:
        manifest = load_job_manifest(job_id)

    if not cached_job:
        standalone = load_standalone_run(job_id, base_url)
        if standalone:
            cached_job = standalone
            with JOB_CACHE_LOCK:
                ACTIVE_JOBS[job_id] = cached_job


    if not cached_job:
        cand_run = resolve_run_dir(job_id)
        if cand_run and cand_run.is_dir():
            cached_job = load_standalone_run(cand_run.name, base_url)
            if cached_job:
                with JOB_CACHE_LOCK:
                    ACTIVE_JOBS[job_id] = cached_job

    if not cached_job:
        raise LookupError(f"Không tìm thấy job hoặc thư mục run: {job_id}")

    # If completed and assets not yet cached, cache now
    if cached_job.get("status") == "completed" and "cachedAssets" not in cached_job:
        cached = cache_job_assets(job_id, cached_job, base_url, api_url)
        cached_job["cachedAssets"] = cached
        with JOB_CACHE_LOCK:
            ACTIVE_JOBS[job_id] = cached_job

    stepper = calculate_stepper_state(cached_job)
    deliverables = cached_job.get("deliverables") or cached_job.get("output") or {}
    raw_candidates = cached_job.get("candidates") or (cached_job.get("output") or {}).get("candidates") or []
    detected_shape = cached_job.get("rugShape") or deliverables.get("rug_shape") or "rectangle"
    shape_decision = cached_job.get("rugShapeDecision") or (deliverables.get("rug_shape_records") or [None])[0]

    product_name = cached_job.get("request", {}).get("product") or cached_job.get("product") or "rug"
    print_spec = get_print_spec(product_name)
    storefront_spec = get_storefront_spec()

    # Enrich deliverables from disk run if missing detailed deliverables (like final_png_images or cutouts)
    run_id_val = cached_job.get("run_id") or cached_job.get("runId") or (cached_job.get("output") or {}).get("run_id") or (manifest.get("runId") if isinstance(manifest, dict) else None) or job_id
    r_dir = resolve_run_dir(run_id_val)
    if not r_dir:
        for log_line in cached_job.get("logs", []):
            m_path = re.search(r"Run folder:\s*([^\r\n]+)", str(log_line), re.IGNORECASE)
            if m_path:
                cand_path = Path(m_path.group(1).strip())
                cand_r = resolve_run_dir(cand_path.name) or (cand_path if cand_path.is_dir() else None)
                if cand_r and cand_r.is_dir():
                    r_dir = cand_r
                    run_id_val = cand_r.name
                    break
            m = re.search(r"(run_[a-zA-Z0-9_-]+)", str(log_line))
            if m:
                cand_r = resolve_run_dir(m.group(1))
                if cand_r and cand_r.is_dir():
                    r_dir = cand_r
                    run_id_val = m.group(1)
                    break
    if not r_dir and raw_candidates:
        for cand in raw_candidates:
            lp = cand.get("local_path") or cand.get("path") if isinstance(cand, dict) else None
            if lp:
                p_cand = Path(str(lp))
                for parent in p_cand.parents:
                    if parent.name.startswith("run_"):
                        cand_r = resolve_run_dir(parent.name) or (parent if parent.is_dir() else None)
                        if cand_r and cand_r.is_dir():
                            r_dir = cand_r
                            run_id_val = cand_r.name
                            break
                if r_dir:
                    break
    if r_dir and r_dir.is_dir() and isinstance(deliverables, dict):
        if not deliverables.get("final_png_images") and (r_dir / "final_print").exists():
            png_files = sorted([p for p in (r_dir / "final_print").iterdir() if p.is_file() and p.suffix.lower() == ".png" and "_cmyk" not in p.name.lower()], key=natural_sort_key)
            deliverables["final_png_images"] = [
                {
                    "kind": "print_rgb_png",
                    "name": p.name,
                    "filename": p.name,
                    "url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{p.name}",
                    "download_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{p.name}",
                    "bytes": p.stat().st_size,
                    "width_px": print_spec["width_px"],
                    "height_px": print_spec["height_px"],
                    "dpi": print_spec["dpi"],
                    "color_mode": "RGB",
                    "standard_label": f"{print_spec['width_px']} x {print_spec['height_px']} px @ {print_spec['dpi']} DPI (RGB 4K)",
                    "standard_badge": "RGB 4K Siêu Nét",
                }
                for p in png_files
            ]
        if not deliverables.get("print_cmyk_images") and (r_dir / "final_print").exists():
            cmyk_files = sorted([p for p in (r_dir / "final_print").iterdir() if p.is_file() and "_cmyk" in p.name.lower() and p.suffix.lower() in {".jpg", ".jpeg"}], key=natural_sort_key)
            deliverables["print_cmyk_images"] = [
                {
                    "kind": "print_cmyk",
                    "name": p.name,
                    "filename": p.name,
                    "url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{p.name}",
                    "download_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{p.name}",
                    "bytes": p.stat().st_size,
                    "width_px": print_spec["width_px"],
                    "height_px": print_spec["height_px"],
                    "dpi": print_spec["dpi"],
                    "color_mode": print_spec["color_mode"],
                    "standard_label": print_spec["label"],
                    "standard_badge": print_spec["badge"],
                }
                for p in cmyk_files
            ]
        if not deliverables.get("product_cutouts") and (r_dir / "product_cutouts").exists():
            c_files = sorted([p for p in (r_dir / "product_cutouts").iterdir() if p.is_file() and p.suffix.lower() in {".png", ".webp"}], key=natural_sort_key)
            deliverables["product_cutouts"] = [
                {
                    "kind": "product_cutout",
                    "type": "transparent",
                    "name": p.name,
                    "filename": p.name,
                    "url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{p.name}",
                    "download_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{p.name}",
                    "bytes": p.stat().st_size,
                }
                for p in c_files
            ]
        if not deliverables.get("product_cutouts_white") and (r_dir / "product_cutouts_white").exists():
            cw_files = sorted([p for p in (r_dir / "product_cutouts_white").iterdir() if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}], key=natural_sort_key)
            deliverables["product_cutouts_white"] = [
                {
                    "kind": "product_cutout_white",
                    "type": "white",
                    "name": p.name,
                    "filename": p.name,
                    "url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{p.name}",
                    "download_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{p.name}",
                    "bytes": p.stat().st_size,
                }
                for p in cw_files
            ]
        if not deliverables.get("perspective_mockups") and (r_dir / "mockups").exists():
            pers_files = sorted([p for p in (r_dir / "mockups").iterdir() if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}], key=natural_sort_key)
            deliverables["perspective_mockups"] = [
                {
                    "kind": "perspective_mockup",
                    "name": p.name,
                    "filename": p.name,
                    "url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{p.name}",
                    "download_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{p.name}",
                    "bytes": p.stat().st_size,
                }
                for p in pers_files
            ]
        if not deliverables.get("lifestyle_mockups") and (r_dir / "lifestyle_mockups").exists():
            cand_l = [p for p in (r_dir / "lifestyle_mockups").iterdir() if p.is_file() and p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}]
            has_can = any(re.search(r"_lifestyle_\d+\.", p.name) for p in cand_l)
            if has_can:
                l_files = sorted([p for p in cand_l if re.search(r"_lifestyle_\d+\.", p.name)], key=natural_sort_key)
            else:
                l_files = sorted(cand_l, key=natural_sort_key)
            deliverables["lifestyle_mockups"] = [
                {
                    "kind": "marketing_image",
                    "name": p.name,
                    "filename": p.name,
                    "url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{p.name}",
                    "download_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{p.name}",
                    "bytes": p.stat().st_size,
                    "is_primary": idx == 0,
                }
                for idx, p in enumerate(l_files)
            ]
        if not deliverables.get("marketing_images") and deliverables.get("lifestyle_mockups"):
            deliverables["marketing_images"] = deliverables["lifestyle_mockups"]
        if not deliverables.get("comparison_matrix"):
            try:
                from trend_tool.comparison import build_comparison_rows
                sm_f = r_dir / "stage_manifest.json"
                sm_d = json.loads(sm_f.read_text(encoding="utf-8")) if sm_f.exists() else None
                c_rows = build_comparison_rows(r_dir, sm_d)
                c_data = []
                for r in c_rows:
                    c_data.append({
                        "index": r.index,
                        "product_label": r.product_label or f"Design #{r.index}",
                        "status": r.status,
                        "reason": r.reason,
                        "source_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{r.source_path.name}" if r.source_path and r.source_path.exists() else "",
                        "source_filename": r.source_path.name if r.source_path else "",
                        "cutout_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{r.cutout_path.name}" if r.cutout_path and r.cutout_path.exists() else "",
                        "cutout_filename": r.cutout_path.name if r.cutout_path else "",
                        "cutout_white_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{r.cutout_white_path.name}" if r.cutout_white_path and r.cutout_white_path.exists() else "",
                        "cutout_white_filename": r.cutout_white_path.name if r.cutout_white_path else "",
                        "final_print_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{r.final_print_path.name}" if r.final_print_path and r.final_print_path.exists() else "",
                        "final_print_filename": r.final_print_path.name if r.final_print_path else "",
                        "ai_background_urls": [f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{bg.name}" for bg in r.ai_background_paths if bg and bg.exists()],
                    })
                deliverables["comparison_matrix"] = c_data
            except Exception as exc:
                pass

    if isinstance(deliverables, dict):
        deliverables.setdefault("print_spec", print_spec)
        deliverables.setdefault("storefront_spec", storefront_spec)
        deliverables.setdefault("standard_badge", print_spec["badge"])

        # Sanitize and ensure valid url & filename for ALL asset lists
        for list_key in ("marketing_images", "lifestyle_mockups", "print_cmyk_images", "final_png_images", "final_prints", "product_cutouts", "product_cutouts_white", "perspective_mockups"):
            items = deliverables.get(list_key) or []
            new_items = []
            for itm in items:
                if isinstance(itm, str):
                    clean_str = itm.strip()
                    if clean_str in ("", "undefined", "null"):
                        continue
                    fname = Path(clean_str).name
                    itm = {
                        "filename": fname,
                        "name": fname,
                        "url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{fname}" if not clean_str.startswith("http") else clean_str,
                        "download_url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{fname}" if not clean_str.startswith("http") else clean_str,
                    }
                elif isinstance(itm, dict):
                    fname = itm.get("filename") or itm.get("name") or Path(itm.get("relative_path") or "").name
                    if fname and fname not in ("undefined", "null"):
                        itm["filename"] = fname
                        itm["name"] = fname
                        raw_u = str(itm.get("url") or "").strip()
                        if not raw_u or raw_u in ("undefined", "null"):
                            itm["url"] = f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{fname}"
                        raw_dl = str(itm.get("download_url") or "").strip()
                        if not raw_dl or raw_dl in ("undefined", "null"):
                            itm["download_url"] = itm["url"]
                    if list_key == "print_cmyk_images":
                        itm.setdefault("width_px", print_spec["width_px"])
                        itm.setdefault("height_px", print_spec["height_px"])
                        itm.setdefault("dpi", print_spec["dpi"])
                        itm.setdefault("color_mode", print_spec["color_mode"])
                        itm.setdefault("standard_label", print_spec["label"])
                        itm.setdefault("standard_badge", print_spec["badge"])
                new_items.append(itm)
            deliverables[list_key] = new_items

        if not deliverables.get("final_png_images") and deliverables.get("final_prints"):
            deliverables["final_png_images"] = deliverables["final_prints"]
        elif deliverables.get("final_png_images") and not deliverables.get("final_prints"):
            deliverables["final_prints"] = deliverables["final_png_images"]

        if not deliverables.get("lifestyle_mockups") and deliverables.get("marketing_images"):
            deliverables["lifestyle_mockups"] = deliverables["marketing_images"]
        elif deliverables.get("lifestyle_mockups") and not deliverables.get("marketing_images"):
            deliverables["marketing_images"] = deliverables["lifestyle_mockups"]

        if not deliverables.get("comparison_rows") and deliverables.get("comparison_matrix"):
            deliverables["comparison_rows"] = deliverables["comparison_matrix"]
        elif deliverables.get("comparison_rows") and not deliverables.get("comparison_matrix"):
            deliverables["comparison_matrix"] = deliverables["comparison_rows"]
        deliverables.setdefault("comparison_rows", [])
        deliverables.setdefault("comparison_matrix", [])

    final_png_len = len(deliverables.get("final_png_images") or deliverables.get("final_prints") or [])
    cmyk_len = len(deliverables.get("print_cmyk_images") or [])
    marketing_len = len(deliverables.get("marketing_images") or [])
    cutouts_len = len(deliverables.get("product_cutouts") or []) + len(deliverables.get("product_cutouts_white") or [])
    perspective_len = len(deliverables.get("perspective_mockups") or [])

    summary_metrics = deliverables.get("summary_metrics") or {}
    summary_metrics.update({
        "rgb_4k_count": final_png_len,
        "final_print_count": final_png_len,
        "cmyk_count": cmyk_len,
        "lifestyle_mockup_count": marketing_len,
        "lifestyle_mockups_count": marketing_len,
        "cutouts_count": cutouts_len,
        "perspective_mockup_count": perspective_len,
        "mockups_count": perspective_len or marketing_len,
    })
    deliverables["summary_metrics"] = summary_metrics

    report_file = (r_dir / "report.html") if r_dir else None
    has_report = bool(report_file and report_file.exists())
    report_url = f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/report.html" if has_report else deliverables.get("report_url")
    deliverables["report_url"] = report_url
    deliverables["has_report"] = has_report

    enriched_candidates = []
    for idx, cand in enumerate(raw_candidates):
        c_dict = dict(cand) if isinstance(cand, dict) else (cand.to_dict() if hasattr(cand, "to_dict") else {})
        cand_id = str(c_dict.get("id") or c_dict.get("image_id") or c_dict.get("candidate_id") or f"cand_{idx+1}")
        c_dict["id"] = cand_id
        c_dict["candidate_id"] = cand_id
        c_dict["image_id"] = cand_id
        lp = c_dict.get("local_path") or c_dict.get("path")
        thumb_u = str(c_dict.get("thumbnail_url") or "").strip()
        img_u = str(c_dict.get("image_url") or c_dict.get("url") or "").strip()
        if lp:
            fname = Path(lp).name
            c_dict["local_filename"] = fname
            if not thumb_u or thumb_u in ("undefined", "null"):
                c_dict["thumbnail_url"] = f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{fname}"
            if not img_u or img_u in ("undefined", "null"):
                c_dict["image_url"] = c_dict["thumbnail_url"]
        elif not thumb_u or thumb_u in ("undefined", "null"):
            if img_u and img_u not in ("undefined", "null"):
                c_dict["thumbnail_url"] = img_u
            else:
                c_dict["thumbnail_url"] = ""
        is_direct = bool(c_dict.get("is_direct_printable", False))
        if c_dict.get("is_breakthrough_concept"):
            c_dict["candidate_category"] = "breakthrough_concept"
        elif is_direct:
            c_dict.setdefault("candidate_category", "direct_printable")
            c_dict["is_breakthrough_concept"] = False
        else:
            c_dict.setdefault("candidate_category", "breakthrough_concept")
            c_dict["is_breakthrough_concept"] = True
        enriched_candidates.append(c_dict)

    raw_rejected = cached_job.get("rejected_candidates") or cached_job.get("rejectedCandidates") or (cached_job.get("output") or {}).get("rejected_candidates") or (manifest.get("rejected_candidates") if isinstance(manifest, dict) else []) or []
    if not raw_rejected and r_dir:
        rej_json_file = r_dir / "task5_crawl" / "rejected_images.json"
        if rej_json_file.exists():
            try:
                raw_rejected = json.loads(rej_json_file.read_text(encoding="utf-8"))
            except Exception:
                pass

    enriched_rejected = []
    for idx, cand in enumerate(raw_rejected):
        c_dict = dict(cand) if isinstance(cand, dict) else (cand.to_dict() if hasattr(cand, "to_dict") else {})
        cand_id = str(c_dict.get("id") or c_dict.get("image_id") or c_dict.get("candidate_id") or f"rej_{idx+1}")
        c_dict["id"] = cand_id
        c_dict["candidate_id"] = cand_id
        c_dict["image_id"] = cand_id
        c_dict["candidate_category"] = "rejected"
        c_dict["is_rejected"] = True
        c_dict["is_breakthrough_concept"] = False
        c_dict["is_direct_printable"] = False
        c_dict.setdefault("reject_reason", str(c_dict.get("reason") or "Không đạt tiêu chí in ấn tự động"))
        c_dict.setdefault("reject_reason_code", str(c_dict.get("reason") or "REJECTED"))
        lp = c_dict.get("local_path") or c_dict.get("path")
        thumb_u = str(c_dict.get("thumbnail_url") or "").strip()
        img_u = str(c_dict.get("image_url") or c_dict.get("url") or "").strip()
        if lp:
            fname = Path(lp).name
            c_dict["local_filename"] = fname
            if not thumb_u or thumb_u in ("undefined", "null"):
                c_dict["thumbnail_url"] = f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{fname}"
            if not img_u or img_u in ("undefined", "null"):
                c_dict["image_url"] = c_dict["thumbnail_url"]
        elif not thumb_u or thumb_u in ("undefined", "null"):
            if img_u and img_u not in ("undefined", "null"):
                c_dict["thumbnail_url"] = img_u
            else:
                c_dict["thumbnail_url"] = ""
        enriched_rejected.append(c_dict)

    # Check if job has actual deliverables
    has_deliverables = bool(final_png_len or cmyk_len or marketing_len)
    if has_deliverables:
        cached_job["status"] = "completed"
        # Update manifest on disk if it was saved as ready_for_review
        try:
            m_data = load_job_manifest(job_id)
            if isinstance(m_data, dict) and m_data.get("status") != "completed":
                m_data["status"] = "completed"
                m_data["completedAt"] = m_data.get("completedAt") or time.time()
                if run_id_val and not m_data.get("runId"):
                    m_data["runId"] = run_id_val
                save_job_manifest(job_id, m_data)
        except Exception:
            pass

    # Resolve room templates for frontend UI hydration
    source_run_val = cached_job.get("request", {}).get("source_run_id") or (manifest.get("request", {}) if isinstance(manifest, dict) else {}).get("source_run_id")
    resolved_room_templates = []
    for cand_r_id in [run_id_val, source_run_val, job_id]:
        if not cand_r_id:
            continue
        c_rdir = resolve_run_dir(cand_r_id)
        if c_rdir and (c_rdir / "room_templates").is_dir():
            for f in sorted((c_rdir / "room_templates").glob("*.*")):
                if f.is_file() and f.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
                    resolved_room_templates.append({
                        "id": f"rt_{f.stem}",
                        "url": f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{f.name}",
                        "name": f.name,
                    })
            if resolved_room_templates:
                break

    if not resolved_room_templates:
        raw_rt = cached_job.get("request", {}).get("reference_images") or (manifest.get("request", {}) if isinstance(manifest, dict) else {}).get("reference_images") or []
        for idx, itm in enumerate(raw_rt):
            if isinstance(itm, dict):
                resolved_room_templates.append(itm)
            elif isinstance(itm, str) and itm.strip():
                resolved_room_templates.append({
                    "id": f"rt_{idx+1}",
                    "url": itm if itm.startswith("http") or itm.startswith("data:") else f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{Path(itm).name}",
                    "name": Path(itm).name if not itm.startswith("data:") else f"Phòng Mẫu #{idx+1}",
                })

    stepper = calculate_stepper_state(cached_job)

    return {
        "ok": True,
        "jobId": job_id,
        "job_id": job_id,
        "status": "completed" if has_deliverables else (cached_job.get("status") or "unknown"),
        "stepper": stepper,
        "job": cached_job,
        "logs": cached_job.get("logs") or [],
        "deliverables": deliverables,
        "candidates": enriched_candidates,
        "rejected_candidates": enriched_rejected,
        "rejectedCandidates": enriched_rejected,
        "clusters": cached_job.get("clusters") or (cached_job.get("output") or {}).get("clusters") or (manifest.get("clusters") if isinstance(manifest, dict) else []) or [],
        "total_candidates": len(enriched_candidates),
        "direct_printable_count": sum(1 for c in enriched_candidates if c.get("is_direct_printable")),
        "rugShape": detected_shape,
        "rugShapeDecision": shape_decision,
        "printSpec": print_spec,
        "storefrontSpec": storefront_spec,
        "standardBadge": print_spec["badge"],
        "niche": cached_job.get("request", {}).get("niche") or cached_job.get("niche") or "",
        "product": product_name,
        "summaryMetrics": summary_metrics,
        "roomTemplates": resolved_room_templates,
        "room_templates": resolved_room_templates,
        "referenceImages": resolved_room_templates,
        "reference_images": resolved_room_templates,
        "reportUrl": report_url,
        "hasReport": has_report,
        "error": cached_job.get("error"),
    }


def cancel_pod_job(job_id: str, api_url: str = DEFAULT_API_URL) -> dict[str, Any]:
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(job_id or "").strip())
    if not safe_id:
        return {"ok": False, "message": "Invalid job ID"}

    with JOB_CACHE_LOCK:
        cancel_evt = JOB_CANCEL_EVENTS.get(safe_id)
        if cancel_evt:
            cancel_evt.set()

        if safe_id in ACTIVE_JOBS:
            ACTIVE_JOBS[safe_id]["status"] = "cancelled"
            ACTIVE_JOBS[safe_id]["error"] = "Tiến trình đã được dừng bởi người dùng."
            ACTIVE_JOBS[safe_id].setdefault("logs", []).append("Nhận được lệnh dừng job từ người dùng. Đang hủy tiến trình...")
            save_job_manifest(safe_id, ACTIVE_JOBS[safe_id])

    return {"ok": True, "jobId": safe_id, "status": "cancelled"}


def delete_pod_job(job_id: str) -> dict[str, Any]:
    """Delete a job, its manifest, and all associated output run directories from disk."""
    safe_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(job_id or "").strip())
    if not safe_id:
        raise ValueError("Invalid job ID.")

    with JOB_CACHE_LOCK:
        cancel_evt = JOB_CANCEL_EVENTS.pop(safe_id, None)
        if cancel_evt:
            cancel_evt.set()
        job_data = ACTIVE_JOBS.pop(safe_id, None) or {}
        LOCAL_WORKER_THREADS.pop(safe_id, None)

    deleted_paths: list[str] = []

    # 1. Check if safe_id is in TEMP_DIR
    job_temp_dir = TEMP_DIR / safe_id
    linked_run_id = None
    if job_temp_dir.exists():
        manifest_file = job_temp_dir / "manifest.json"
        if manifest_file.exists():
            try:
                m_data = json.loads(manifest_file.read_text(encoding="utf-8"))
                linked_run_id = (
                    m_data.get("runId")
                    or m_data.get("run_id")
                    or (m_data.get("jobData") or {}).get("run_id")
                )
            except Exception:
                pass
        try:
            shutil.rmtree(job_temp_dir, ignore_errors=True)
            deleted_paths.append(str(job_temp_dir))
        except Exception as err:
            print(f"[Pinterest POD Bridge] Error removing {job_temp_dir}: {err}")

    # 2. Collect candidate run directory IDs
    run_candidates = set()
    if safe_id.startswith("run_"):
        run_candidates.add(safe_id)
    if linked_run_id:
        run_candidates.add(str(linked_run_id))
    if job_data.get("run_id"):
        run_candidates.add(str(job_data["run_id"]))

    for r_id in run_candidates:
        r_dir = resolve_run_dir(r_id)
        if r_dir and r_dir.exists():
            try:
                shutil.rmtree(r_dir, ignore_errors=True)
                deleted_paths.append(str(r_dir))
            except Exception as err:
                print(f"[Pinterest POD Bridge] Error removing run dir {r_dir}: {err}")

    return {"ok": True, "jobId": safe_id, "deleted": len(deleted_paths) > 0, "deletedPaths": deleted_paths}


def list_recent_jobs_and_runs() -> list[dict[str, Any]]:
    """Lists completed runs and cached jobs for UI quick import."""
    items = []
    seen_ids = set()

    # 1. Cached local jobs
    if TEMP_DIR.exists():
        for path in sorted(TEMP_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if not path.is_dir():
                continue
            manifest_file = path / "manifest.json"
            if manifest_file.exists():
                try:
                    data = json.loads(manifest_file.read_text(encoding="utf-8"))
                    job_info = data.get("jobData") or data
                    is_prod_job = path.name.startswith("job_prod_") or (job_info.get("request", {}) or {}).get("workflow_stage") == "production"
                    base_niche = (job_info.get("request", {}) or {}).get("niche") or job_info.get("niche") or path.name
                    title_val = f"Sản xuất: {base_niche}" if is_prod_job else f"Quét Trend: {base_niche}"
                    product_val = (job_info.get("request", {}) or {}).get("product") or job_info.get("product") or "rug"
                    seen_ids.add(path.name)
                    st_val = job_info.get("status") or data.get("status") or "completed"
                    # Check if deliverables actually exist either in temp dir or linked run
                    if st_val != "completed":
                        has_local_deliv = any(path.glob("*_cmyk.jpg")) or any(path.glob("*_lifestyle*.png")) or any(path.glob("*_print*.png")) or any(path.glob("rug_*.*"))
                        if has_local_deliv:
                            st_val = "completed"
                        else:
                            r_id = data.get("runId") or job_info.get("run_id") or job_info.get("runId") or (job_info.get("output") or {}).get("run_id")
                            if not r_id:
                                for log_line in (job_info.get("logs") or []):
                                    m = re.search(r"(run_\d{8}_\d{6})", str(log_line))
                                    if m:
                                        r_id = m.group(1)
                                        break
                            if r_id:
                                seen_ids.add(str(r_id))
                                r_dir = resolve_run_dir(r_id)
                                if r_dir and (((r_dir / "final_print").exists() and any((r_dir / "final_print").iterdir())) or ((r_dir / "lifestyle_mockups").exists() and any((r_dir / "lifestyle_mockups").iterdir()))):
                                    st_val = "completed"
                    else:
                        r_id = data.get("runId") or job_info.get("run_id") or job_info.get("runId") or (job_info.get("output") or {}).get("run_id")
                        if r_id:
                            seen_ids.add(str(r_id))

                    cached_cands = job_info.get("candidates") or (job_info.get("output") or {}).get("candidates") or []
                    thumbnails: list[str] = []
                    for c in cached_cands[:4]:
                        if isinstance(c, dict):
                            u = c.get("image_url")
                            if not u and c.get("image_id"):
                                u = f"/api/pinterest-pod/assets/{path.name}/{c.get('image_id')}.jpg"
                            if u:
                                thumbnails.append(u)

                    cmyk_files = [p.name for p in path.glob("*_cmyk.jpg")]
                    mockup_files = [p.name for p in path.glob("*_lifestyle*.png")]
                    if not thumbnails and (cmyk_files or mockup_files):
                        for fn in (mockup_files[:4] or cmyk_files[:4]):
                            thumbnails.append(f"/api/pinterest-pod/assets/{path.name}/{fn}")

                    items.append({
                        "type": "cached_job",
                        "id": path.name,
                        "jobId": path.name,
                        "job_id": path.name,
                        "status": st_val,
                        "createdAt": data.get("completedAt") or path.stat().st_mtime,
                        "title": title_val,
                        "niche": title_val,
                        "product": product_val,
                        "productType": product_val,
                        "candidateCount": len(cached_cands) if isinstance(cached_cands, list) else 0,
                        "cmykCount": len(cmyk_files),
                        "mockupCount": len(mockup_files),
                        "thumbnails": thumbnails,
                    })
                except Exception:
                    pass

    # 2. Local & standalone output runs
    for root_dir in (LOCAL_OUTPUT_DIR, STANDALONE_OUTPUT_DIR, ROOT / "output"):
        if not root_dir or not root_dir.exists():
            continue
        try:
            for run_dir in sorted(root_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)[:15]:
                if not run_dir.is_dir() or not run_dir.name.startswith("run_"):
                    continue
                if run_dir.name in seen_ids:
                    continue
                seen_ids.add(run_dir.name)
                manifest = run_dir / "stage_manifest.json"
                review = run_dir / "candidate_review.json"
                cfg_file = run_dir / "config.json"
                final_dir = run_dir / "final_print"
                lifestyle_dir = run_dir / "lifestyle_mockups"
                niche = ""
                product_type = ""
                candidates_list = []
                if review.exists():
                    try:
                        rev_data = json.loads(review.read_text(encoding="utf-8"))
                        niche = rev_data.get("niche") or ""
                        product_type = rev_data.get("target_product") or ""
                        candidates_list = rev_data.get("candidates") or []
                    except Exception:
                        pass
                if not niche and cfg_file.exists():
                    try:
                        cfg_data = json.loads(cfg_file.read_text(encoding="utf-8"))
                        niche = cfg_data.get("trend_niche") or ""
                        product_type = (cfg_data.get("target") or {}).get("name") or product_type
                    except Exception:
                        pass

                has_final = final_dir.exists() and any(p for p in final_dir.iterdir() if p.is_file())
                has_lifestyle = lifestyle_dir.exists() and any(p for p in lifestyle_dir.iterdir() if p.is_file())
                cand_count = len(candidates_list) if isinstance(candidates_list, list) else 0

                if has_final or has_lifestyle:
                    run_status = "completed"
                elif cand_count > 0:
                    run_status = "ready_for_review"
                elif manifest.exists():
                    try:
                        m_st = str(json.loads(manifest.read_text(encoding="utf-8")).get("status") or "").lower().strip()
                        run_status = "completed" if m_st == "completed" else ("failed" if m_st == "failed" else "unknown")
                    except Exception:
                        run_status = "unknown"
                else:
                    run_status = "failed"

                thumbnails: list[str] = []
                if lifestyle_dir.exists():
                    l_files = sorted([p.name for p in lifestyle_dir.glob("*.png") if p.is_file()])
                    for fn in l_files[:4]:
                        thumbnails.append(f"/api/pinterest-pod/assets/{run_dir.name}/{fn}")
                if not thumbnails and final_dir.exists():
                    f_files = sorted([p.name for p in final_dir.glob("*.*") if p.is_file()])
                    for fn in f_files[:4]:
                        thumbnails.append(f"/api/pinterest-pod/assets/{run_dir.name}/{fn}")
                if not thumbnails and isinstance(candidates_list, list):
                    for c in candidates_list[:4]:
                        if isinstance(c, dict):
                            u = c.get("image_url")
                            if not u and c.get("image_id"):
                                u = f"/api/pinterest-pod/assets/{run_dir.name}/{c.get('image_id')}.jpg"
                            if u:
                                thumbnails.append(u)

                cmyk_count = len(list(final_dir.glob("*_cmyk.jpg"))) if final_dir.exists() else 0
                mockup_count = len(list(lifestyle_dir.glob("*.png"))) if lifestyle_dir.exists() else 0

                title_prefix = "Sản xuất: " if (has_final or has_lifestyle) else "Quét Trend: "
                base_title = niche or run_dir.name
                items.append({
                    "type": "standalone_run",
                    "id": run_dir.name,
                    "jobId": run_dir.name,
                    "job_id": run_dir.name,
                    "title": f"{title_prefix}{base_title}",
                    "niche": base_title,
                    "product": product_type or "rug",
                    "productType": product_type or "rug",
                    "status": run_status,
                    "createdAt": run_dir.stat().st_mtime,
                    "hasManifest": manifest.exists(),
                    "candidateCount": cand_count,
                    "cmykCount": cmyk_count,
                    "mockupCount": mockup_count,
                    "thumbnails": thumbnails,
                })
        except Exception:
            pass

    return items


# ---------------------------------------------------------------------------
# Shopify Product Construction
# ---------------------------------------------------------------------------

def generate_listing_copy(product_type: str, niche: str, motifs: list[str]) -> tuple[str, str, str, str, list[str]]:
    """Generates natural Title, Description HTML, and SEO fields for POD products."""
    niche_clean = re.sub(r"[^a-zA-Z0-9\s]", " ", niche).strip().title()
    motif_str = ", ".join(motifs[:3]).title() if motifs else ""
    product_name = "Area Rug" if product_type == "rug" else "Plush Throw Blanket"

    # Title: 55-65 chars target
    if motif_str and len(f"{motif_str} {product_name} with Non-Slip Backing") <= 68:
        title = f"{niche_clean} {motif_str} {product_name} for Home Decor"
    else:
        title = f"{niche_clean} Pattern {product_name} for Living Room and Bedroom"
    title = title.strip()[:70]

    # Tags
    tags = ["pinterest-pod", product_type, "home-decor"]
    for word in niche.lower().split():
        if len(word) > 2 and word not in tags:
            tags.append(word)
    for motif in motifs:
        m_tag = motif.lower().strip()
        if m_tag and m_tag not in tags:
            tags.append(m_tag)

    # SEO
    seo_title = f"{title[:50]} | Premium Quality"
    seo_desc = f"Shop our high-definition {niche.lower()} {product_name.lower()}. Ultra-soft premium material, vivid fade-resistant colors, and perfect cozy home decor styling."

    # Description HTML
    material = "Ultra-Soft Chenille Velvet with Non-Slip Grip Backing" if product_type == "rug" else "High-Density Flannel Fleece & Microfiber Sherpa"
    care = "Machine wash cold on gentle cycle, line dry or tumble dry low. Do not bleach or iron."
    craft = "Dye-sublimation print with 300 DPI CMYK color accuracy for lasting vibrancy."

    desc_html = f"""<p>Elevate your space with this stunning <strong>{title}</strong>. Meticulously designed for lasting comfort, rich visual appeal, and enduring everyday durability.</p>
<h3>Key Features</h3>
<ul>
  <li><strong>Premium Materials:</strong> Crafted from {material} for a wonderfully plush, cozy feel underfoot and to the touch.</li>
  <li><strong>Vivid High-Definition Print:</strong> Rendered in full 300 DPI CMYK color fidelity with fade-resistant dye-sublimation technology.</li>
  <li><strong>Durable &amp; Safe:</strong> Reinforced edges and double-stitched hems ensure long-lasting quality without fraying.</li>
  <li><strong>Easy Maintenance:</strong> {care}</li>
</ul>
<h3>Product Specifications</h3>
<table style="width:100%; border-collapse:collapse; margin-top:12px;">
  <tr><td style="padding:8px; border:1px solid #e2e8f0; font-weight:bold;">Product Type</td><td style="padding:8px; border:1px solid #e2e8f0;">{product_name}</td></tr>
  <tr><td style="padding:8px; border:1px solid #e2e8f0; font-weight:bold;">Material</td><td style="padding:8px; border:1px solid #e2e8f0;">{material}</td></tr>
  <tr><td style="padding:8px; border:1px solid #e2e8f0; font-weight:bold;">Printing Process</td><td style="padding:8px; border:1px solid #e2e8f0;">{craft}</td></tr>
  <tr><td style="padding:8px; border:1px solid #e2e8f0; font-weight:bold;">Care Instructions</td><td style="padding:8px; border:1px solid #e2e8f0;">{care}</td></tr>
  <tr><td style="padding:8px; border:1px solid #e2e8f0; font-weight:bold;">Origin</td><td style="padding:8px; border:1px solid #e2e8f0;">Custom Made to Order (POD)</td></tr>
</table>"""

    return title, desc_html, seo_title[:58], seo_desc[:155], tags[:12]


def build_shopify_pod_product(
    job_id: str,
    payload: dict[str, Any],
    base_url: str,
    image_profile_slug: str = "default",
    api_url: str = DEFAULT_API_URL,
) -> dict[str, Any]:
    """Converts a completed POD job into a full Shopify product dict ready for UI_STATE & Sync."""
    status_info = get_pod_job_status(job_id, base_url, api_url)
    job_data = status_info.get("job") or {}
    req_params = job_data.get("request") or {}

    product_type = str(payload.get("product") or req_params.get("product") or job_data.get("product") or "rug").lower().strip()
    niche = str(payload.get("niche") or req_params.get("niche") or job_data.get("niche") or "Trend Design").strip()
    print_spec = get_print_spec(product_type)
    storefront_spec = get_storefront_spec()

    cached_assets = job_data.get("cachedAssets") or cache_job_assets(job_id, job_data, base_url, api_url)
    marketing_images = (
        cached_assets.get("marketingImages")
        or cached_assets.get("marketing_images")
        or (cached_assets.get("deliverables") or {}).get("marketing_images")
        or (cached_assets.get("output") or {}).get("marketing_images")
        or []
    )
    cmyk_images = (
        cached_assets.get("printCmykImages")
        or cached_assets.get("print_cmyk_images")
        or (cached_assets.get("deliverables") or {}).get("print_cmyk_images")
        or (cached_assets.get("output") or {}).get("print_cmyk_images")
        or []
    )

    # Support isolating a specific design from a multi-design run
    design_index = int(payload.get("designIndex") or payload.get("design_index") or 1)
    rug_records = (
        (job_data.get("deliverables") or {}).get("rug_shape_records")
        or (job_data.get("output") or {}).get("rug_shape_records")
        or []
    )
    current_shape_decision = job_data.get("rugShapeDecision")
    if rug_records and len(rug_records) >= design_index:
        current_shape_decision = rug_records[design_index - 1]

    # Choose size preset key
    preset_key = payload.get("preset") or payload.get("shape") or req_params.get("shape")
    if not preset_key:
        detected_shape = str(
            (current_shape_decision or {}).get("shape")
            or job_data.get("rugShape")
            or (job_data.get("deliverables") or {}).get("rug_shape")
            or (job_data.get("output") or {}).get("rug_shape")
            or (job_data.get("rugShapeDecision") or {}).get("shape")
            or ""
        ).lower().strip()
        if product_type == "blanket":
            preset_key = "blanket"
        elif detected_shape in {"arch", "vom", "vòm", "rug_arch"}:
            preset_key = "rug_arch"
        elif detected_shape in {"organic", "custom_cutline", "custom", "freeform", "irregular", "rug_organic"}:
            preset_key = "rug_organic"
        elif detected_shape in {"round", "circle", "oval", "rug_round"}:
            preset_key = "rug_round"
        elif detected_shape in {"square", "rug_square"}:
            preset_key = "rug_square"
        elif detected_shape in {"runner", "rug_runner"}:
            preset_key = "rug_runner"
        else:
            preset_key = "rug_rectangle"

    norm_preset = str(preset_key).lower().strip()
    if norm_preset in {"arch", "vom", "vòm", "rug_arch"}:
        preset_key = "rug_arch"
    elif norm_preset in {"organic", "custom_cutline", "custom", "freeform", "irregular", "rug_organic"}:
        preset_key = "rug_organic"
    elif norm_preset in {"round", "circle", "oval", "rug_round"}:
        preset_key = "rug_round"
    elif norm_preset in {"square", "rug_square"}:
        preset_key = "rug_square"
    elif norm_preset in {"runner", "rug_runner"}:
        preset_key = "rug_runner"
    elif norm_preset in {"blanket"}:
        preset_key = "blanket"
    elif norm_preset in {"rectangle", "rect", "rug_rectangle"}:
        preset_key = "rug_rectangle"

    final_png_images = (
        cached_assets.get("finalPngImages")
        or cached_assets.get("final_png_images")
        or (cached_assets.get("deliverables") or {}).get("final_png_images")
        or (cached_assets.get("output") or {}).get("final_png_images")
        or []
    )

    design_pool = cmyk_images if cmyk_images else final_png_images
    if len(design_pool) > 1:
        chosen_design = design_pool[min(design_index - 1, len(design_pool) - 1)]
        design_name = chosen_design.get("filename") or chosen_design.get("name") or ""
        prefix_match = re.search(r"([a-zA-Z]+_\d{3})", design_name)
        matched_mockups = []
        if prefix_match:
            design_prefix = prefix_match.group(1)
            matched_mockups = [img for img in marketing_images if design_prefix in (img.get("filename") or img.get("name") or "")]
        if not matched_mockups:
            pats = (f"_{design_index:03d}", f"_{design_index}_", f"rug_{design_index:03d}", f"rug_{design_index}_")
            matched_mockups = [img for img in marketing_images if any(p in (img.get("filename") or img.get("name") or "") for p in pats)]
        if not matched_mockups and len(marketing_images) >= len(design_pool):
            k = len(marketing_images) // len(design_pool)
            if k > 0:
                matched_mockups = marketing_images[(design_index - 1) * k : design_index * k]
        if matched_mockups:
            marketing_images = matched_mockups
        if cmyk_images:
            cmyk_images = [cmyk_images[min(design_index - 1, len(cmyk_images) - 1)]]

    if not marketing_images:
        marketing_images = final_png_images or cmyk_images
    if not marketing_images:
        raise ValueError("Job chưa có hình ảnh sản phẩm để đưa lên Shopify.")

    main_image_url = marketing_images[0].get("url") or f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{marketing_images[0].get('filename')}"
    all_image_urls = [item.get("url") or f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{job_id}/{item.get('filename')}" for item in marketing_images]

    cmyk_info = copy.deepcopy(cmyk_images[0]) if cmyk_images else {}
    cmyk_url = cmyk_info.get("url") or ""
    cmyk_path = cmyk_info.get("path") or ""
    if isinstance(cmyk_info, dict):
        cmyk_info["width_px"] = print_spec["width_px"]
        cmyk_info["height_px"] = print_spec["height_px"]
        cmyk_info["dpi"] = print_spec["dpi"]
        cmyk_info["color_mode"] = print_spec["color_mode"]
        cmyk_info["standard_label"] = print_spec["label"]
        cmyk_info["standard_badge"] = print_spec["badge"]

    preset_variants = POD_SIZE_PRESETS.get(preset_key, POD_SIZE_PRESETS.get("rug_rectangle", []))
    custom_prices = payload.get("prices") if isinstance(payload.get("prices"), dict) else {}

    # Build variants
    short_id = job_id[:8].upper()
    product_variants = []
    for item in preset_variants:
        label = item["label"]
        code = item["code"]
        price_val = str(custom_prices.get(label, {}).get("price") or item["price"])
        compare_val = str(custom_prices.get(label, {}).get("compareAtPrice") or item.get("compareAtPrice") or "")

        product_variants.append({
            "sourcePlatform": "pinterest_pod",
            "sourceVariantId": f"{job_id}-{code.lower()}",
            "asin": None,
            "label": label,
            "title": label,
            "optionvalues": {"size_name": label, "Size": label},
            "price": {"amount": price_val, "currency": "USD", "raw": f"${price_val}"},
            "listPrice": ({"amount": compare_val, "currency": "USD", "raw": f"${compare_val}"} if compare_val else None),
            "compareAtPrice": ({"amount": compare_val, "currency": "USD", "raw": f"${compare_val}"} if compare_val else None),
            "sku": f"POD-{product_type.upper()}-{short_id}-{code}",
            "imageUrl": main_image_url,
            "available": True,
        })

    # Motifs and copy
    motifs = payload.get("motifs") or job_data.get("motifs") or []
    title, desc_html, seo_title, seo_desc, tags = generate_listing_copy(product_type, niche, motifs)
    if payload.get("titleOverride"):
        title = str(payload["titleOverride"]).strip()
    elif design_index > 1:
        title = f"{title} (Design #{design_index})"

    handle = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:180]

    material_str = "Ultra-Soft Chenille Velvet with Non-Slip Grip Backing" if product_type == "rug" else "High-Density Flannel Fleece & Microfiber Sherpa"
    product_dict: dict[str, Any] = {
        "url": f"pinterest-pod://{job_id}/{design_index}" if design_index > 1 else f"pinterest-pod://{job_id}",
        "canonicalUrl": f"pinterest-pod://{job_id}/{design_index}" if design_index > 1 else f"pinterest-pod://{job_id}",
        "sourcePlatform": "pinterest_pod",
        "sourceProductId": f"POD-{job_id}-D{design_index}" if design_index > 1 else f"POD-{job_id}",
        "asin": None,
        "title": title,
        "productType": "Rug" if product_type == "rug" else "Blanket",
        "brand": "CHILLGEN",
        "status": "success",
        "availability": "POD Draft",
        "price": product_variants[0]["price"],
        "listPrice": product_variants[0].get("listPrice"),
        "description": desc_html,
        "longDescription": desc_html,
        "metafields": {
            "custom.print_cmyk_url": {
                "namespace": "custom",
                "key": "print_cmyk_url",
                "value": cmyk_url,
                "type": "url",
            }
        },
        "mainImage": main_image_url,
        "images": all_image_urls,
        "thumbnails": all_image_urls,
        "videos": [],
        "options": [{"name": "Size", "values": [item["label"] for item in preset_variants]}],
        "customization": None,
        "personalization": None,
        "bullets": [
            f"Vivid 300 DPI CMYK sublimation print ({print_spec['width_px']}x{print_spec['height_px']} px) for long-lasting vibrant color fidelity.",
            f"Ultra-soft premium cozy materials designed for both durability and comfort.",
            f"Machine washable easy-care fabric.",
        ],
        "categories": ["Rug"] if product_type == "rug" else ["Blanket", "Home Decor"],
        "details": {
            "Product Type": "Rug" if product_type == "rug" else "Blanket",
            "Material": material_str,
            "Print Quality": f"{print_spec['width_px']} x {print_spec['height_px']} px @ {print_spec['dpi']} DPI ({print_spec['color_mode']})",
            "Storefront Display": f"{storefront_spec['width']} x {storefront_spec['height']} px (Fit Contain, {storefront_spec['background']})",
            "Fulfillment": "Print On Demand",
        },
        "overview": {
            "Niche": niche,
            "Target Market": "US",
            "Variants": len(product_variants),
            "Design Index": design_index,
        },
        "specs": {
            "Resolution": f"{print_spec['dpi']} DPI",
            "Color Mode": print_spec["color_mode"],
            "Print Dimensions": f"{print_spec['width_px']} x {print_spec['height_px']} px",
            "Aspect Ratio": print_spec["aspect_ratio"],
            "Standard Badge": print_spec["badge"],
            "Storefront Resolution": f"{storefront_spec['width']} x {storefront_spec['height']} px",
            "Storefront Fit": storefront_spec["fit"],
            "Storefront Background": storefront_spec["background"],
        },
        "sections": {"description": desc_html},
        "variantCount": len(product_variants),
        "variantTotal": len(product_variants),
        "variantCompleted": len(product_variants),
        "variantProgress": 100,
        "variants": product_variants,
        "progressPhase": "done",
        "imageProcessingProgress": 100,
        "imageProcessingProfileSlug": image_profile_slug,
        "generatedFieldOverrides": {
            "product.title": title,
            "product.handle": handle,
            "product.vendor": "CHILLGEN",
            "product.productType": "Rug" if product_type == "rug" else "Blanket",
            "product.status": "DRAFT",
            "product.tags": tags,
            "product.descriptionHtml": desc_html,
            "product.seo.title": seo_title,
            "product.seo.description": seo_desc,
            "metafields.custom.print_cmyk_url": cmyk_url,
        },
        "pinterestPod": {
            "jobId": job_id,
            "niche": niche,
            "productType": product_type,
            "preset": preset_key,
            "designIndex": design_index,
            "rugShape": (current_shape_decision or {}).get("shape") or job_data.get("rugShape") or (job_data.get("deliverables") or {}).get("rug_shape") or "rectangle",
            "rugShapeDecision": current_shape_decision,
            "printCmyk": cmyk_info,
            "printCmykUrl": cmyk_url,
            "printCmykPath": cmyk_path,
            "printSpec": print_spec,
            "storefrontSpec": storefront_spec,
            "printStandardBadge": print_spec["badge"],
            "storefrontStandardBadge": storefront_spec["badge"],
            "marketingImages": marketing_images,
            "status": "ready",
            "synced": False,
        },
    }

    # If CMYK file is locally present, attach localAssets
    if cmyk_path and Path(cmyk_path).exists():
        ensure_print_image_standard(Path(cmyk_path), print_spec)
        product_dict["localAssets"] = {
            "importId": job_id,
            "design": {
                "path": cmyk_path,
                "filename": Path(cmyk_path).name,
                "mimeType": "image/jpeg",
                "alt": f"{title} print CMYK artwork",
            },
        }

    return product_dict


# ---------------------------------------------------------------------------
# Shopify Sync Bridge Hooks (effective_config, augment_plan, mark_synced)
# ---------------------------------------------------------------------------

def effective_config(config: dict[str, Any], product: dict[str, Any]) -> dict[str, Any]:
    """Ensures Shopify plan generation honors POD overrides and configures print_cmyk_url metafield."""
    if str(product.get("sourcePlatform") or "") != "pinterest_pod":
        return config

    result = copy.deepcopy(config)
    result.setdefault("visualNaming", {})["enabled"] = False
    result.setdefault("etsyPersonalization", {})["enabled"] = False

    overrides = product.get("generatedFieldOverrides") if isinstance(product.get("generatedFieldOverrides"), dict) else {}
    fields_raw = result.get("fields", [])
    if isinstance(fields_raw, dict):
        fields_list = []
        for target, item in fields_raw.items():
            if isinstance(item, dict):
                entry = copy.deepcopy(item)
                entry.setdefault("target", target)
                fields_list.append(entry)
            else:
                fields_list.append({"target": target, "enabled": bool(item)})
    elif isinstance(fields_raw, list):
        fields_list = [f for f in fields_raw if isinstance(f, dict)]
    else:
        fields_list = []

    by_target = {str(field.get("target")): copy.deepcopy(field) for field in fields_list if field.get("target")}

    # Disable marketplace-specific scraping fields and normalize value to default
    for target, field in by_target.items():
        if "value" in field and "default" not in field:
            field["default"] = field["value"]
        if any(marker in target.lower() for marker in ("amazon_", "etsy_", "customizer", "personalization")):
            field["enabled"] = False

    # Apply generated overrides
    for target, value in overrides.items():
        field = by_target.get(target, {})
        field.update({
            "target": target,
            "label": field.get("label") or target,
            "group": field.get("group") or ("Product metafields" if target.startswith("metafields.") else "Product"),
            "strategy": "default",
            "default": value,
            "enabled": True,
            "editable": True,
        })
        if target.startswith("metafields."):
            field["type"] = field.get("type") or ("url" if "url" in target else "single_line_text_field")
        by_target[target] = field

    # Guarantee metafields.custom.print_cmyk_url is enabled
    cmyk_metafield = "metafields.custom.print_cmyk_url"
    if cmyk_metafield not in by_target:
        by_target[cmyk_metafield] = {
            "target": cmyk_metafield,
            "label": "Print CMYK URL",
            "group": "Product metafields",
            "strategy": "default",
            "default": overrides.get(cmyk_metafield, ""),
            "type": "url",
            "enabled": True,
            "editable": True,
        }

    result["fields"] = list(by_target.values())
    sku_prefix = "POD-RUG-" if "rug" in str(product.get("pinterestPod", {}).get("productType") or "").lower() else "POD-BLANKET-"
    result.setdefault("variant", {}).update({
        "enabled": True,
        "optionMode": "auto",
        "maxOptions": 1,
        "skuPrefix": sku_prefix,
        "optionNameMap": {"size_name": "Size", "size": "Size"},
    })
    result.setdefault("media", {}).update({"maxImages": 15, "includeProductVideos": False, "maxVideos": 0})
    img_proc = result.setdefault("imageProcessing", {})
    img_proc.setdefault("enabled", True)
    img_proc["output"] = {
        "width": POD_STOREFRONT_SPECS["width"],
        "height": POD_STOREFRONT_SPECS["height"],
        "fit": POD_STOREFRONT_SPECS["fit"],
        "background": POD_STOREFRONT_SPECS["background"],
        "upscale": POD_STOREFRONT_SPECS["upscale"],
    }
    return result


def augment_plan(plan: dict[str, Any], product: dict[str, Any]) -> dict[str, Any]:
    """Injects custom.print_cmyk_url into the productCreate metafields list."""
    pod_info = product.get("pinterestPod") if isinstance(product.get("pinterestPod"), dict) else None
    if not pod_info:
        return plan

    cmyk_url = (
        pod_info.get("printCmykUrl")
        or (product.get("metafields") or {}).get("custom.print_cmyk_url", {}).get("value")
        or (product.get("generatedFieldOverrides") or {}).get("metafields.custom.print_cmyk_url")
        or ""
    )
    if "shopify" in plan and isinstance(plan["shopify"], dict):
        product_payload = plan["shopify"].setdefault("productCreate", {}).setdefault("product", {})
    elif "productCreate" in plan and isinstance(plan["productCreate"], dict):
        product_payload = plan["productCreate"].setdefault("product", {})
    else:
        product_payload = plan.setdefault("shopify", {}).setdefault("productCreate", {}).setdefault("product", {})
    metafields = product_payload.setdefault("metafields", [])

    existing = next((item for item in metafields if item.get("namespace") == "custom" and item.get("key") == "print_cmyk_url"), None)
    if existing:
        if cmyk_url:
            existing["value"] = cmyk_url
    elif cmyk_url:
        metafields.append({
            "namespace": "custom",
            "key": "print_cmyk_url",
            "type": "url",
            "value": cmyk_url,
        })

    # Also register metafield definition requirements
    try:
        from shopify_sync import check_metafield_definitions
        plan["metafieldDefinitions"] = check_metafield_definitions(plan)
    except Exception:
        pass

    return plan


def mark_synced(job_id: str, product_id: str | None) -> None:
    """Updates job manifest checkpoint after successful Shopify sync."""
    manifest = load_job_manifest(job_id)
    if not manifest:
        manifest = {"jobId": job_id, "status": "completed"}
    manifest.setdefault("sync", {})
    manifest["sync"]["shopifyProductId"] = product_id
    manifest["sync"]["syncedAt"] = time.time()
    manifest["sync"]["status"] = "synced"
    save_job_manifest(job_id, manifest)


# ---------------------------------------------------------------------------
# Pinterest Trend Discovery (Tier 1 & Tier 2) & Candidate Rescue
# ---------------------------------------------------------------------------

def _classify_reject_reason(keyword: str) -> tuple[str, str]:
    """Helper to classify non-printable keyword into human-friendly Vietnamese explanation and code."""
    kw = keyword.lower()
    if re.search(r"\b(recipes?|simmer[\s_-]*pots?|soup|salads?|crockpot|slow[\s_-]*cooker|cocktails?|smoothies?|baking|cookies?|cakes?|dinner[\s_-]*ideas?|meal[\s_-]*prep|snacks?|sourdough|casseroles?|pasta|breakfast|desserts?|cook(?:ing)?)\b", kw):
        return "Chứa từ khóa công thức / món ăn / nấu nướng phi ấn phẩm (recipes/cooking)", "NON_PRINTABLE_RECIPE"
    if re.search(r"\b(nails?|nail[\s_-]*art|nail[\s_-]*tech|press[\s_-]*on[\s_-]*nails?|acrylic[\s_-]*nails?|gel[\s_-]*nails?|manicure|pedicure|hair|hair[\s_-]*styles?|makeup|lipsticks?|eye[\s_-]*shadow|mascara|skin[\s_-]*care)\b", kw):
        return "Chứa từ khóa làm đẹp, móng tay, chăm sóc da hoặc tóc (beauty/nails)", "NON_PRINTABLE_BEAUTY"
    if re.search(r"\b(porch|patio|front[\s_-]*doors?|remodel|cabinetry|landscaping|curb[\s_-]*appeal|exterior[\s_-]*design|shelf[\s_-]*styling)\b", kw):
        return "Chứa từ khóa ngoại thất / không gian kiến trúc 3D (porch/patio/staging)", "NON_PRINTABLE_3D_SPACE"
    if re.search(r"\b(quotes?|memes?|captions?|workout|gym|fitness|diet|abs[\s_-]*routine)\b", kw):
        return "Chứa từ khóa trích dẫn chữ / meme / bài tập thể hình (text quotes/memes)", "NON_PRINTABLE_TEXT_MEME"
    if re.search(r"\b(wallpapers?|lock[\s_-]*screens?|phone[\s_-]*cases?|iphone[\s_-]*wallpapers?|widgets?)\b", kw):
        return "Chứa từ khóa hình nền điện thoại / công nghệ số (wallpapers)", "NON_PRINTABLE_WALLPAPER"
    return "Không đạt tiêu chuẩn in ấn đồ họa 2D (Stop-words lọc ấn phẩm)", "NON_PRINTABLE_GATE"


def discover_pinterest_trends(payload: dict[str, Any]) -> dict[str, Any]:
    """Tier 1: Collect trending keywords from Pinterest Trends API + Graphic Printability Gate.
    Tier 2: Cluster accepted keywords into 3-5 diverse Theme Clusters with fused pattern queries.
    """
    niche = str(payload.get("niche") or "").strip()
    if not niche:
        raise ValueError("Vui lòng nhập Pinterest niche hoặc từ khóa xu hướng.")

    trend_type = str(payload.get("trend_type") or "growing").strip()
    region = str(payload.get("region") or "US").strip().upper()
    interest = str(payload.get("interest") or "").strip()
    raw_product = str(payload.get("product") or "").strip().lower()
    product = raw_product if raw_product in {"rug", "blanket", "bag", "custom"} else infer_product_type_from_niche(niche)

    try:
        from pinterest.trend_finder.semantic_analyzer import NON_PRINTABLE_GATE_REGEX, PRODUCT_CONTAINER_PATTERN
    except Exception:
        NON_PRINTABLE_GATE_REGEX = re.compile(r"\b(recipes?|soup|cocktails?|nails?|hair|makeup|porch|patio|wallpapers?|quotes?|memes?)\b", re.I)
        PRODUCT_CONTAINER_PATTERN = re.compile(
            r"\b(?:"
            r"leather\s+bag|tote\s+bag|shoulder\s+bag|crossbody\s+bag|messenger\s+bag|"
            r"leather\s+purse|leather\s+backpack|satchel\s+bag|leather\s+satchel|"
            r"bag|purse|tote|backpack|satchel|crossbody|handbag|clutch|briefcase|weekender|fringe\s+bag|"
            r"area\s+rug|runner\s+rug|floor\s+rug|throw\s+rug|floor\s+carpet|accent\s+rug|"
            r"rug|carpet|doormat|bath\s+mat|mat|"
            r"throw\s+blanket|fleece\s+blanket|woven\s+blanket|quilted\s+blanket|"
            r"blanket|throw|quilt|comforter|"
            r"coffee\s+mug|ceramic\s+mug|travel\s+mug|coffee\s+cup|"
            r"mug|cup|tumbler"
            r")\b",
            flags=re.IGNORECASE,
        )

    # 1. Try Pinterest API if authenticated
    api_keywords: list[dict[str, Any]] = []
    oauth_valid, token_data = check_oauth_token_valid()
    if oauth_valid and token_data and not os.getenv("MOCK_PINTEREST"):
        try:
            from pinterest.trend_finder.pinterest_client import PinterestClient
            token_file = (ROOT / "pinterest" / ".pinterest_oauth_tokens.json").resolve()
            client = PinterestClient(token_path=token_file if token_file.exists() else None)
            endpoint = f"/trends/keywords/{region}/top/{trend_type}"
            params: dict[str, Any] = {"limit": 50}
            if interest:
                params["interests"] = [interest]
            resp = client.get(endpoint, params=params)
            raw_items = []
            if isinstance(resp, dict):
                raw_items = resp.get("trends") or resp.get("keywords") or resp.get("items") or []
            elif isinstance(resp, list):
                raw_items = resp
            for idx, itm in enumerate(raw_items, start=1):
                if isinstance(itm, dict):
                    kw_name = itm.get("keyword") or itm.get("name") or ""
                    if kw_name:
                        api_keywords.append({
                            "keyword": kw_name,
                            "rank": idx,
                            "pct_growth_mom": float(itm.get("pct_growth_mom") or 0.0),
                            "pct_growth_wow": float(itm.get("pct_growth_wow") or 0.0),
                            "pct_growth_yoy": float(itm.get("pct_growth_yoy") or 0.0),
                            "monthly_searches": int(itm.get("monthly_searches") or 0),
                        })
        except Exception as exc:
            logger.warning("Pinterest Trends API fetch warning: %s; using dynamic semantic generator.", exc)

    # 2. Dynamic generation if API returned empty or offline
    clean_niche = niche.lower()
    product_label = product if product != "custom" else "product"
    base_pool: list[dict[str, Any]] = list(api_keywords)

    if not base_pool:
        # Generate rich realistic keywords tailored to niche
        dynamic_specs = [
            (f"vintage distressed {clean_niche}", 1, 125.0, 48.0, 85.0),
            (f"boho chic {clean_niche} pattern", 2, 95.0, 34.0, 60.0),
            (f"botanical wildflower {clean_niche}", 3, 88.0, 29.0, 72.0),
            (f"minimalist neutral {clean_niche}", 4, 76.0, 22.0, 50.0),
            (f"western tooled {clean_niche} motifs", 5, 110.0, 52.0, 90.0),
            (f"dark academia {clean_niche} aesthetic", 6, 68.0, 18.0, 45.0),
            (f"cottagecore floral {clean_niche}", 7, 92.0, 36.0, 80.0),
            (f"y2k retro groovy {clean_niche}", 8, 140.0, 62.0, 115.0),
            (f"spooky halloween {clean_niche} decor", 9, 165.0, 75.0, 130.0),
            (f"celestial moon star {clean_niche}", 10, 84.0, 26.0, 58.0),
            (f"geometric checkerboard {clean_niche}", 11, 78.0, 24.0, 52.0),
            (f"folk art ornamental {clean_niche}", 12, 86.0, 31.0, 65.0),
            (f"abstract line art {clean_niche}", 13, 62.0, 16.0, 40.0),
            (f"gothic spiderweb {clean_niche}", 14, 150.0, 70.0, 120.0),
            (f"heritage tapestry {clean_niche}", 15, 80.0, 25.0, 60.0),
            # Realistic non-printable keywords to demonstrate transparent Graphic Printability Gate
            (f"autumn pumpkin soup simmer pot recipes", 16, 190.0, 85.0, 140.0),
            (f"almond fall nail art gel manicure", 17, 130.0, 55.0, 95.0),
            (f"fall front porch pumpkin decor 3d", 18, 175.0, 80.0, 135.0),
            (f"daily positive workout fitness text quotes", 19, 60.0, 15.0, 35.0),
            (f"aesthetic iphone wallpaper lock screen", 20, 85.0, 28.0, 65.0),
        ]
        for kw, rk, mom, wow, yoy in dynamic_specs:
            base_pool.append({
                "keyword": kw,
                "rank": rk,
                "pct_growth_mom": mom,
                "pct_growth_wow": wow,
                "pct_growth_yoy": yoy,
                "monthly_searches": int(rk * 1200 + 4500),
            })

    # 3. Filter through Graphic Printability Gate
    all_keywords: list[dict[str, Any]] = []
    accepted_keywords: list[dict[str, Any]] = []
    rejected_keywords: list[dict[str, Any]] = []

    for item in base_pool:
        kw = str(item.get("keyword") or "").strip()
        if not kw:
            continue
        is_rejected = bool(NON_PRINTABLE_GATE_REGEX.search(kw.lower()))
        item_obj = dict(item)
        item_obj["keyword"] = kw
        kw_clean_theme = PRODUCT_CONTAINER_PATTERN.sub("", kw).strip()
        kw_clean_theme = re.sub(r"\s+", " ", kw_clean_theme).strip()
        clean_kw_for_query = kw_clean_theme if len(kw_clean_theme) >= 3 else kw
        if is_rejected:
            reason_text, reason_code = _classify_reject_reason(kw)
            item_obj["is_accepted"] = False
            item_obj["reject_reason"] = reason_text
            item_obj["reject_reason_code"] = reason_code
            rejected_keywords.append(item_obj)
        else:
            item_obj["is_accepted"] = True
            item_obj["suggested_fused_query"] = f"{clean_kw_for_query} seamless pattern vector"
            accepted_keywords.append(item_obj)
        all_keywords.append(item_obj)

    # 4. Tier 2: Group accepted keywords into 3-5 theme clusters
    # Decouple product canvas from visual art theme:
    # If niche is 'leather bag', product='bag' (preset 4500x5400 px), but the search query must
    # target 2D surface patterns and printable vector graphics, NOT physical bags!
    art_theme_prefix = PRODUCT_CONTAINER_PATTERN.sub("", niche).strip()
    art_theme_prefix = re.sub(r"\b(?:design|pattern|artwork|style|print)\b", "", art_theme_prefix, flags=re.I).strip()
    prefix = f"{art_theme_prefix} " if len(art_theme_prefix) >= 3 else ""

    theme_definitions = [
        {
            "cluster_id": "cluster_vintage_heritage",
            "theme_name": "Vintage Heritage & Distressed",
            "theme_name_vi": "Cổ điển Vintage & Họa tiết Hoài niệm",
            "match_words": {"vintage", "heritage", "distressed", "tapestry", "antique", "retro", "classic", "ornamental"},
            "description": f"Xu hướng hoa văn cổ điển mang hơi thở hoài niệm, chi tiết chạm khắc sắc sảo và đường vân sờn tinh tế cho {niche}.",
            "visual_style": "Tone màu ấm hoài niệm (nâu đất, đồng cổ, be), nét vẽ khắc gỗ, họa tiết đục lỗ dập chìm chuẩn xưởng",
            "sample_motifs": ["Hoa văn Damask cổ điển", "Họa tiết dập chìm Tây phương", "Chất liệu loang màu tự nhiên"],
            "fused_templates": [
                f"{prefix}vintage distressed ornamental seamless pattern vector".strip(),
                f"{prefix}heritage floral surface print design flat".strip(),
                f"{prefix}retro aesthetic vector print flat".strip(),
            ],
            "recommended": True,
        },
        {
            "cluster_id": "cluster_botanical_nature",
            "theme_name": "Botanical Wildflowers & Nature",
            "theme_name_vi": "Hoa cỏ Tự nhiên & Botanical Nghệ thuật",
            "match_words": {"botanical", "wildflower", "floral", "flower", "cottagecore", "nature", "garden", "leaf", "plant"},
            "description": f"Cảm hứng hoa cỏ dại, lá dương xỉ và thảo mộc tự nhiên mang phong cách mộc mạc Cottagecore cho {niche}.",
            "visual_style": "Nét vẽ mảnh Botanical illustration, màu xanh rêu, hoa phấn nhạt, nền phẳng tao nhã",
            "sample_motifs": ["Hoa dại ép khô", "Lá cành thảo mộc", "Họa tiết cỏ hoa liền mạch"],
            "fused_templates": [
                f"{prefix}botanical wildflowers seamless pattern vector".strip(),
                f"{prefix}cottagecore floral surface print design flat".strip(),
                f"{prefix}vintage pressed flowers vector artwork print".strip(),
            ],
            "recommended": True,
        },
        {
            "cluster_id": "cluster_seasonal_gothic",
            "theme_name": "Seasonal Festive & Dark Gothic",
            "theme_name_vi": "Bí ẩn Mùa lễ hội & Dark Academia Gothic",
            "match_words": {"halloween", "gothic", "spooky", "spiderweb", "dark", "academia", "fall", "autumn", "holiday", "pumpkin"},
            "description": f"Chủ đề mùa thu lễ hội, bí ngô nghệ thuật, mạng nhện ren và phong cách Dark Academia huyền bí cho {niche}.",
            "visual_style": "Tương phản cao đen - cam đất - tím khói, họa tiết gothic chạm khắc sắc nét",
            "sample_motifs": ["Mạng nhện ren gothic", "Bí ngô nghệ thuật chạm khắc", "Biểu tượng hoàng gia cổ"],
            "fused_templates": [
                f"{prefix}dark gothic celestial seamless pattern vector".strip(),
                f"{prefix}halloween spooky spiderweb surface print design flat".strip(),
                f"{prefix}dark academia aesthetic pattern vector".strip(),
            ],
            "recommended": False,
        },
        {
            "cluster_id": "cluster_boho_western",
            "theme_name": "Bohemian Chic & Western Tooled",
            "theme_name_vi": "Boho Phóng khoáng & Họa tiết Viễn Tây",
            "match_words": {"boho", "western", "tooled", "aztec", "fringe", "moroccan", "folk", "mandala", "tribal"},
            "description": f"Phong cách du mục Bohemian kết hợp hoa văn chạm khắc da thuộc Viễn Tây (Western tooled) đặc trưng.",
            "visual_style": "Đường nét khắc nổi, họa tiết hình học thổ cẩm, tua rua nghệ thuật, tone màu đất mộc",
            "sample_motifs": ["Hoa văn chạm khắc Viễn Tây", "Họa tiết Aztec/Mandala", "Nét vân thủ công"],
            "fused_templates": [
                f"{prefix}boho chic aztec mandala seamless pattern vector".strip(),
                f"{prefix}western tooled floral carving texture seamless pattern".strip(),
                f"{prefix}bohemian folk art surface print design flat".strip(),
            ],
            "recommended": False,
        },
        {
            "cluster_id": "cluster_minimal_modern",
            "theme_name": "Minimalist Geometric & Modern Chic",
            "theme_name_vi": "Tối giản Hiện đại & Hình khối Tinh tế",
            "match_words": {"minimalist", "geometric", "modern", "abstract", "checkerboard", "line", "chic", "neutral", "japandi"},
            "description": f"Các mảng khối hình học tinh tế, đường cong lượn sóng hiện đại và bảng màu trung tính thanh lịch cho {niche}.",
            "visual_style": "Đường nét dứt khoát, sóng lượn Bauhaus, tone màu trung tính Đan Mạch/Japandi",
            "sample_motifs": ["Đường lượn sóng tối giản", "Hình khối trừu tượng Bauhaus", "Vân sọc đan xen thanh lịch"],
            "fused_templates": [
                f"{prefix}minimalist geometric bauhaus seamless pattern vector".strip(),
                f"{prefix}modern abstract line art surface print design flat".strip(),
                f"{prefix}japandi neutral wavy pattern vector print".strip(),
            ],
            "recommended": False,
        },
    ]

    clusters: list[dict[str, Any]] = []
    assigned_kw_keys: set[str] = set()

    for t_def in theme_definitions:
        cluster_kws: list[dict[str, Any]] = []
        for kw_item in accepted_keywords:
            k_text = kw_item["keyword"].lower()
            if any(mw in k_text for mw in t_def["match_words"]):
                cluster_kws.append(kw_item)
                assigned_kw_keys.add(kw_item["keyword"])

        if cluster_kws:
            growth_avg = round(sum(k.get("pct_growth_mom", 0.0) for k in cluster_kws) / len(cluster_kws), 1)
        else:
            # Fallback keyword representation
            rep_core = art_theme_prefix or t_def['match_words'].copy().pop()
            rep_kw = f"{rep_core} pattern"
            cluster_kws = [{
                "keyword": rep_kw,
                "rank": len(clusters) + 1,
                "pct_growth_mom": 80.0,
                "pct_growth_wow": 28.0,
                "pct_growth_yoy": 60.0,
                "is_accepted": True,
                "suggested_fused_query": f"{rep_kw} seamless pattern vector",
            }]
            growth_avg = 80.0

        clusters.append({
            "cluster_id": t_def["cluster_id"],
            "theme_name": t_def["theme_name"],
            "theme_name_vi": t_def["theme_name_vi"],
            "description": t_def["description"],
            "visual_style": t_def["visual_style"],
            "recommended": t_def["recommended"],
            "sample_motifs": t_def["sample_motifs"],
            "keywords": cluster_kws,
            "fused_queries": t_def["fused_templates"],
            "growth_mom_avg": growth_avg,
        })

    # Keep top 3-5 clusters
    clusters = clusters[:5]

    return {
        "ok": True,
        "niche": niche,
        "product": product,
        "trend_type": trend_type,
        "region": region,
        "clusters": clusters,
        "all_keywords": all_keywords,
        "accepted_keywords": accepted_keywords,
        "rejected_keywords": rejected_keywords,
        "total_keywords": len(all_keywords),
        "accepted_count": len(accepted_keywords),
        "rejected_count": len(rejected_keywords),
    }


def rescue_pod_candidate(job_id: str, candidate_id: str, base_url: str = "") -> dict[str, Any]:
    """Rescues a rejected candidate, classifying it as a breakthrough concept ready for Stage 2 motif extraction."""
    safe_job_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(job_id or "").strip())
    safe_cand_id = str(candidate_id or "").strip()
    if not safe_job_id or not safe_cand_id:
        raise ValueError("Yêu cầu jobId và candidateId hợp lệ.")

    with JOB_CACHE_LOCK:
        job = ACTIVE_JOBS.get(safe_job_id)
        if not job:
            manifest = load_job_manifest(safe_job_id)
            if manifest:
                job = manifest.get("jobData") or manifest
                ACTIVE_JOBS[safe_job_id] = job

    if not job:
        raise LookupError(f"Không tìm thấy job: {safe_job_id}")

    candidates = job.setdefault("candidates", [])
    rejected = job.setdefault("rejected_candidates", [])
    if not rejected and "rejectedCandidates" in job:
        rejected = job.setdefault("rejected_candidates", job.get("rejectedCandidates") or [])

    # Check if candidate is already in active candidates
    for c in candidates:
        cid = str(c.get("id") or c.get("image_id") or c.get("candidate_id") or "")
        if cid == safe_cand_id:
            c["candidate_category"] = "breakthrough_concept"
            c["is_breakthrough_concept"] = True
            c["is_rejected"] = False
            c["recommended"] = True
            c["reason"] = "Mẫu đã được người dùng giải cứu (Rescue). Ý tưởng đột phá sẵn sàng đưa vào sản xuất bóc tách hoa văn Stage 2."
            save_job_manifest(safe_job_id, job)
            return {"ok": True, "candidate": c}

    # Find in rejected candidates
    found_idx = -1
    rescued_cand = None
    for idx, c in enumerate(rejected):
        cid = str(c.get("id") or c.get("image_id") or c.get("candidate_id") or "")
        if cid == safe_cand_id:
            found_idx = idx
            rescued_cand = dict(c)
            break

    if found_idx != -1 and rescued_cand:
        rejected.pop(found_idx)
    else:
        # Check run directory dedupe/rejected or task5_crawl/rejected_images.json
        run_id = job.get("run_id") or job.get("runId") or safe_job_id
        r_dir = resolve_run_dir(run_id)
        if r_dir:
            rej_file = r_dir / "task5_crawl" / "rejected_images.json"
            if rej_file.exists():
                try:
                    raw_rej = json.loads(rej_file.read_text(encoding="utf-8"))
                    for c in raw_rej:
                        cid = str(c.get("image_id") or c.get("id") or "")
                        if cid == safe_cand_id:
                            rescued_cand = dict(c)
                            break
                except Exception:
                    pass

    if not rescued_cand:
        rescued_cand = {
            "id": safe_cand_id,
            "image_id": safe_cand_id,
            "candidate_id": safe_cand_id,
            "title": f"Rescued Candidate {safe_cand_id}",
        }

    rescued_cand["id"] = safe_cand_id
    rescued_cand["candidate_id"] = safe_cand_id
    rescued_cand["image_id"] = safe_cand_id
    rescued_cand["candidate_category"] = "breakthrough_concept"
    rescued_cand["is_breakthrough_concept"] = True
    rescued_cand["is_rejected"] = False
    rescued_cand["recommended"] = True
    rescued_cand["is_direct_printable"] = False
    rescued_cand["reason"] = "Mẫu đã được người dùng giải cứu (Rescue). Ý tưởng đột phá sẵn sàng đưa vào sản xuất bóc tách hoa văn Stage 2."

    lp = rescued_cand.get("local_path") or rescued_cand.get("path")
    if lp and base_url:
        fname = Path(lp).name
        rescued_cand.setdefault("thumbnail_url", f"{base_url.rstrip('/')}/api/pinterest-pod/assets/{safe_job_id}/{fname}")
        rescued_cand.setdefault("image_url", rescued_cand["thumbnail_url"])
    elif not rescued_cand.get("image_url"):
        rescued_cand["image_url"] = "https://i.pinimg.com/originals/10/7a/bc/107abc_anatolian_tribal.jpg"
    if not rescued_cand.get("thumbnail_url"):
        rescued_cand["thumbnail_url"] = rescued_cand.get("image_url", "")

    candidates.append(rescued_cand)
    job["total_candidates"] = len(candidates)
    job["rejectedCandidates"] = rejected
    job["rejected_candidates"] = rejected

    with JOB_CACHE_LOCK:
        ACTIVE_JOBS[safe_job_id] = job
    save_job_manifest(safe_job_id, job)

    # Also update candidate_review.json on disk if present
    run_id = job.get("run_id") or job.get("runId") or safe_job_id
    r_dir = resolve_run_dir(run_id)
    if r_dir and (r_dir / "candidate_review.json").exists():
        try:
            cr_path = r_dir / "candidate_review.json"
            cr_manifest = json.loads(cr_path.read_text(encoding="utf-8"))
            cr_cands = cr_manifest.setdefault("candidates", [])
            found_cr = False
            for cr_c in cr_cands:
                if str(cr_c.get("image_id") or cr_c.get("id") or "") == safe_cand_id:
                    cr_c["candidate_category"] = "breakthrough_concept"
                    cr_c["is_breakthrough_concept"] = True
                    cr_c["is_rejected"] = False
                    found_cr = True
                    break
            if not found_cr:
                cr_cands.append(rescued_cand)
            cr_manifest["total_candidates"] = len(cr_cands)
            cr_path.write_text(json.dumps(cr_manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass

    return {"ok": True, "candidate": rescued_cand}

