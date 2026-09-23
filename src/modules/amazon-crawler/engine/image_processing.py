"""Bounded, cache-backed product image processing for the coordinator."""

from __future__ import annotations

import base64
import concurrent.futures
import hashlib
import json
import os
import random
import re
import shutil
import threading
import time
import urllib.request
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, ImageEnhance, ImageOps


PROCESSING_SCHEMA_VERSION = 1
DEFAULT_PROFILE_SLUG = "default"
DEFAULT_CONFIG: dict[str, Any] = {
    "slug": DEFAULT_PROFILE_SLUG,
    "name": "Default image profile",
    "enabled": False,
    "randomPixels": 100,
    "pixelDelta": 3,
    "jpegQuality": 92,
    "output": {"width": 1500, "height": 1500, "fit": "contain", "upscale": True, "background": "#ffffff"},
    "logo": {
        "enabled": False, "width": 120, "height": 60, "maxPercent": 15,
        "percentBasis": "width", "padding": 0, "position": "bottom-right", "opacity": 1.0,
    },
}


def _slug(value: Any) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().casefold()).strip("-")
    return slug[:80] or DEFAULT_PROFILE_SLUG


def _bounded_int(value: Any, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _bounded_float(value: Any, default: float, minimum: float, maximum: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    result = deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _merge(result[key], value)
        else:
            result[key] = deepcopy(value)
    return result


def normalize_profile(value: dict[str, Any] | None, slug: str | None = None) -> dict[str, Any]:
    merged = _merge(DEFAULT_CONFIG, value or {})
    # These values are derived by ImageProfileStore.load().  Removing them here
    # keeps a profile revision stable when the UI saves a profile it just read.
    merged.pop("revision", None)
    merged.pop("hasLogo", None)
    merged["slug"] = _slug(slug or merged.get("slug") or merged.get("name"))
    merged["name"] = str(merged.get("name") or merged["slug"]).strip() or merged["slug"]
    merged["enabled"] = bool(merged.get("enabled"))
    merged["randomPixels"] = _bounded_int(merged.get("randomPixels"), 100, 0, 10_000)
    merged["pixelDelta"] = _bounded_int(merged.get("pixelDelta"), 3, 1, 20)
    merged["jpegQuality"] = _bounded_int(merged.get("jpegQuality"), 92, 70, 98)
    output = merged.get("output") if isinstance(merged.get("output"), dict) else {}
    fit = str(output.get("fit") or "contain").casefold()
    background = str(output.get("background") or "#ffffff")
    merged["output"] = {
        "width": _bounded_int(output.get("width"), 1500, 100, 4000),
        "height": _bounded_int(output.get("height"), 1500, 100, 4000),
        "fit": fit if fit in {"contain", "cover"} else "contain",
        "upscale": bool(output.get("upscale", True)),
        "background": background if re.fullmatch(r"#[0-9a-fA-F]{6}", background) else "#ffffff",
    }
    logo = merged.get("logo") if isinstance(merged.get("logo"), dict) else {}
    position = str(logo.get("position") or "bottom-right")
    merged["logo"] = {
        "enabled": bool(logo.get("enabled")),
        "width": _bounded_int(logo.get("width"), 120, 1, 4000),
        "height": _bounded_int(logo.get("height"), 60, 1, 4000),
        "maxPercent": _bounded_float(logo.get("maxPercent"), 15, 1, 100),
        "percentBasis": "height" if logo.get("percentBasis") == "height" else "width",
        "padding": _bounded_int(logo.get("padding"), 0, 0, 4000),
        "position": position if position in {"top-left", "top-right", "bottom-left", "bottom-right"} else "bottom-right",
        "opacity": _bounded_float(logo.get("opacity"), 1, 0.05, 1),
    }
    return merged


class ImageProfileStore:
    def __init__(self, root: Path, *, legacy_root: Path | None = None) -> None:
        self.root = root
        self.profile_root = root / "profiles"
        self.logo_root = root / "logos"
        self.revision_root = root / "revisions"
        self.legacy_root = legacy_root
        self._lock = threading.RLock()

    def _profile_path(self, slug: str) -> Path:
        return self.profile_root / f"{_slug(slug)}.json"

    def _logo_path(self, slug: str) -> Path | None:
        directory = self.logo_root / _slug(slug)
        if not directory.exists():
            return None
        return next((path for path in directory.iterdir() if path.is_file()), None)

    def _archive(self, profile: dict[str, Any], logo_path: Path | None) -> None:
        revision_directory = self.revision_root / profile["slug"] / profile["revision"]
        revision_directory.mkdir(parents=True, exist_ok=True)
        config_path = revision_directory / "profile.json"
        if not config_path.exists():
            config_path.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")
        if logo_path is not None and not any(path.name.startswith("logo") for path in revision_directory.iterdir()):
            shutil.copyfile(logo_path, revision_directory / f"logo{logo_path.suffix.lower()}")

    def _migrate_legacy(self) -> None:
        if self.profile_root.exists() or self.legacy_root is None or not self.legacy_root.exists():
            return
        self.profile_root.mkdir(parents=True, exist_ok=True)
        for path in self.legacy_root.glob("*.json"):
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            profile = normalize_profile(raw, path.stem)
            logo = raw.get("logo") if isinstance(raw.get("logo"), dict) else {}
            asset = logo.get("asset") if isinstance(logo.get("asset"), dict) else {}
            data_url = str(asset.get("dataUrl") or "")
            match = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", data_url, re.DOTALL)
            if match:
                extension = {"image/jpeg": ".jpg", "image/webp": ".webp"}.get(match.group(1).casefold(), ".png")
                logo_dir = self.logo_root / profile["slug"]
                logo_dir.mkdir(parents=True, exist_ok=True)
                try:
                    (logo_dir / f"logo{extension}").write_bytes(base64.b64decode(match.group(2), validate=True))
                except (OSError, ValueError):
                    pass
            profile["logo"].pop("asset", None)
            self._profile_path(profile["slug"]).write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            self._migrate_legacy()
            if not self._profile_path(DEFAULT_PROFILE_SLUG).exists():
                self.save(DEFAULT_CONFIG, DEFAULT_PROFILE_SLUG)
            profiles = [self.load(path.stem) for path in sorted(self.profile_root.glob("*.json"))]
            return profiles

    def load(self, slug: str) -> dict[str, Any]:
        self._migrate_legacy()
        path = self._profile_path(slug)
        if not path.exists():
            if _slug(slug) != DEFAULT_PROFILE_SLUG:
                raise KeyError(f"Unknown image profile: {slug}")
            profile = normalize_profile(DEFAULT_CONFIG)
        else:
            profile = normalize_profile(json.loads(path.read_text(encoding="utf-8")), path.stem)
        logo_path = self._logo_path(profile["slug"])
        profile["hasLogo"] = logo_path is not None
        revision_source = json.dumps(profile, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
        if logo_path is not None:
            revision_source += hashlib.sha256(logo_path.read_bytes()).digest()
        profile["revision"] = hashlib.sha256(revision_source).hexdigest()[:16]
        self._archive(profile, logo_path)
        return profile

    def load_revision(self, slug: str, revision: str) -> dict[str, Any]:
        if not re.fullmatch(r"[a-f0-9]{16}", revision):
            raise KeyError("Invalid image profile revision.")
        path = self.revision_root / _slug(slug) / revision / "profile.json"
        if not path.exists():
            current = self.load(slug)
            if current["revision"] == revision:
                return current
            raise KeyError(f"Image profile revision {revision} was not found.")
        return json.loads(path.read_text(encoding="utf-8"))

    def save(self, value: dict[str, Any], slug: str | None = None) -> dict[str, Any]:
        profile = normalize_profile(value, slug)
        self.profile_root.mkdir(parents=True, exist_ok=True)
        temp = self._profile_path(profile["slug"]).with_suffix(".tmp")
        temp.write_text(json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(self._profile_path(profile["slug"]))
        return self.load(profile["slug"])

    def save_logo(self, slug: str, data_url: str) -> dict[str, Any]:
        profile = self.load(slug)
        match = re.match(r"^data:(image/(?:png|jpeg|webp));base64,(.+)$", data_url, re.DOTALL | re.I)
        if match is None:
            raise ValueError("Logo must be a PNG, JPEG, or WebP data URL.")
        content = base64.b64decode(match.group(2), validate=True)
        with Image.open(BytesIO(content)) as image:
            image.verify()
        extension = {"image/jpeg": ".jpg", "image/webp": ".webp"}.get(match.group(1).casefold(), ".png")
        directory = self.logo_root / profile["slug"]
        if directory.exists():
            shutil.rmtree(directory)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / f"logo{extension}").write_bytes(content)
        return self.load(profile["slug"])

    def delete(self, slug: str) -> None:
        normalized = _slug(slug)
        if normalized == DEFAULT_PROFILE_SLUG:
            raise ValueError("The default image profile cannot be deleted.")
        self._profile_path(normalized).unlink(missing_ok=True)
        shutil.rmtree(self.logo_root / normalized, ignore_errors=True)

    def logo_path(self, slug: str, revision: str | None = None) -> Path | None:
        if revision:
            directory = self.revision_root / _slug(slug) / revision
            if directory.exists():
                return next((path for path in directory.iterdir() if path.is_file() and path.name.startswith("logo")), None)
        return self._logo_path(slug)


def _image_candidates(url: str) -> list[str]:
    if "/images/I/" not in url:
        return [url]
    base = re.sub(r"\._[^/]+(?=\.[a-zA-Z]{2,5}(?:\?|$))", "", url)
    stem, extension = os.path.splitext(base.split("?", 1)[0])
    return list(dict.fromkeys([f"{stem}._SL1500_{extension}", base, f"{stem}._SL1000_{extension}", f"{stem}._SL500_{extension}"]))


def _download_image(url: str) -> bytes:
    error: Exception | None = None
    for candidate in _image_candidates(url):
        try:
            request = urllib.request.Request(candidate, headers={"User-Agent": "Mozilla/5.0", "Accept": "image/avif,image/webp,image/*,*/*;q=0.8"})
            with urllib.request.urlopen(request, timeout=30) as response:
                content = response.read(20 * 1024 * 1024 + 1)
            if len(content) > 20 * 1024 * 1024:
                raise ValueError("Image exceeds the 20 MB processing limit.")
            return content
        except Exception as caught:
            error = caught
    raise RuntimeError(f"Unable to download image {url}: {error}")


def process_image_bytes(content: bytes, profile: dict[str, Any], *, logo_content: bytes | None = None, seed: str = "") -> bytes:
    normalized = normalize_profile(profile, str(profile.get("slug") or DEFAULT_PROFILE_SLUG))
    output = normalized["output"]
    with Image.open(BytesIO(content)) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
    target = (output["width"], output["height"])
    if output["fit"] == "cover":
        image = ImageOps.fit(image, target, method=Image.Resampling.LANCZOS)
    else:
        if output["upscale"] or image.width > target[0] or image.height > target[1]:
            image.thumbnail(target, Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", target, output["background"])
        canvas.paste(image, ((target[0] - image.width) // 2, (target[1] - image.height) // 2))
        image = canvas
    if normalized["randomPixels"]:
        pixels = image.load()
        generator = random.Random(hashlib.sha256(seed.encode("utf-8")).digest())
        for _ in range(normalized["randomPixels"]):
            x = generator.randrange(image.width)
            y = generator.randrange(image.height)
            red, green, blue = pixels[x, y]
            delta = generator.choice((-normalized["pixelDelta"], normalized["pixelDelta"]))
            pixels[x, y] = tuple(max(0, min(255, channel + delta)) for channel in (red, green, blue))
    logo_config = normalized["logo"]
    if logo_config["enabled"] and logo_content:
        with Image.open(BytesIO(logo_content)) as opened_logo:
            logo = opened_logo.convert("RGBA")
        basis = image.width if logo_config["percentBasis"] == "width" else image.height
        maximum = max(1, round(basis * logo_config["maxPercent"] / 100))
        logo.thumbnail((min(logo_config["width"], maximum), min(logo_config["height"], maximum)), Image.Resampling.LANCZOS)
        if logo_config["opacity"] < 1:
            alpha = logo.getchannel("A")
            logo.putalpha(ImageEnhance.Brightness(alpha).enhance(logo_config["opacity"]))
        padding = logo_config["padding"]
        left = padding if logo_config["position"].endswith("left") else image.width - logo.width - padding
        top = padding if logo_config["position"].startswith("top") else image.height - logo.height - padding
        image.paste(logo, (max(0, left), max(0, top)), logo)
    destination = BytesIO()
    image.save(destination, format="JPEG", quality=normalized["jpegQuality"], optimize=True)
    return destination.getvalue()


def _perceptual_hash_bytes(content: bytes) -> str:
    with Image.open(BytesIO(content)) as opened:
        grayscale = ImageOps.grayscale(opened).resize((9, 8), Image.Resampling.LANCZOS)
        pixels = list(grayscale.getdata())
    bits = [
        pixels[row * 9 + column] > pixels[row * 9 + column + 1]
        for row in range(8)
        for column in range(8)
    ]
    value = sum((1 << index) for index, enabled in enumerate(bits) if enabled)
    return f"{value:016x}"


class ImageProcessingService:
    def __init__(self, root: Path, *, workers: int = 4, cache_ttl_minutes: int = 60, legacy_profile_root: Path | None = None) -> None:
        self.root = root
        self.cache_root = root / "cache"
        self.cache_root.mkdir(parents=True, exist_ok=True)
        self.profiles = ImageProfileStore(root, legacy_root=legacy_profile_root)
        self.executor = concurrent.futures.ThreadPoolExecutor(max_workers=max(1, workers), thread_name_prefix="image-processing")
        self.cache_ttl_seconds = max(1, cache_ttl_minutes) * 60
        self._locks: dict[str, threading.Lock] = {}
        self._locks_guard = threading.Lock()

    def _cache_key(self, url: str, profile: dict[str, Any]) -> str:
        value = f"{PROCESSING_SCHEMA_VERSION}\0{url}\0{profile['revision']}"
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    def _process_one(self, media: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
        url = str(media.get("url") or "")
        if not url.startswith("http"):
            raise ValueError("Product media URL must use HTTP or HTTPS.")
        key = self._cache_key(url, profile)
        output_path = self.cache_root / f"{key}.jpg"
        metadata_path = self.cache_root / f"{key}.json"
        with self._locks_guard:
            lock = self._locks.setdefault(key, threading.Lock())
        with lock:
            is_fresh = output_path.exists() and time.time() - output_path.stat().st_mtime < self.cache_ttl_seconds
            if not is_fresh:
                logo_path = self.profiles.logo_path(profile["slug"], profile["revision"])
                source_content = _download_image(url)
                processed = process_image_bytes(
                    source_content,
                    profile,
                    logo_content=logo_path.read_bytes() if logo_path else None,
                    seed=key,
                )
                temporary = output_path.with_suffix(".tmp")
                temporary.write_bytes(processed)
                temporary.replace(output_path)
                metadata_path.write_text(
                    json.dumps({"sourcePerceptualHash": _perceptual_hash_bytes(source_content)}),
                    encoding="utf-8",
                )
            try:
                source_hash = str(json.loads(metadata_path.read_text(encoding="utf-8"))["sourcePerceptualHash"])
            except (OSError, KeyError, TypeError, json.JSONDecodeError):
                source_hash = _perceptual_hash_bytes(output_path.read_bytes())
        result = deepcopy(media)
        result["processedFileToken"] = key
        result["processedContentType"] = "image/jpeg"
        result["_perceptualHash"] = source_hash
        return result

    def process_product(
        self,
        product: dict[str, Any],
        profile_slug: str,
        profile_revision: str | None = None,
    ) -> dict[str, Any]:
        profile = (
            self.profiles.load_revision(profile_slug, profile_revision)
            if profile_revision
            else self.profiles.load(profile_slug)
        )
        result = deepcopy(product)
        media = [item for item in result.get("media", []) if isinstance(item, dict) and item.get("kind", "image") != "video"]
        if not profile["enabled"]:
            result["media"] = media
            return {"product": result, "profile": profile, "processed": 0}
        futures = [self.executor.submit(self._process_one, item, profile) for item in media]
        processed_media: list[dict[str, Any]] = []
        seen_hashes: set[str] = set()
        for future in futures:
            processed = future.result()
            perceptual_hash = str(processed.pop("_perceptualHash", ""))
            if perceptual_hash and perceptual_hash in seen_hashes:
                continue
            if perceptual_hash:
                seen_hashes.add(perceptual_hash)
            processed_media.append(processed)
        result["media"] = processed_media
        return {"product": result, "profile": profile, "processed": len(processed_media)}

    def file_path(self, token: str) -> Path:
        if not re.fullmatch(r"[a-f0-9]{64}", token):
            raise KeyError("Invalid processed image token.")
        path = self.cache_root / f"{token}.jpg"
        if not path.exists():
            raise KeyError("Processed image was not found.")
        return path

    def clear_expired(self) -> int:
        removed = 0
        cutoff = time.time() - self.cache_ttl_seconds
        for path in self.cache_root.glob("*.jpg"):
            try:
                if path.stat().st_mtime < cutoff:
                    path.unlink(missing_ok=True)
                    removed += 1
            except FileNotFoundError:
                # A manual cache clear can remove the file after glob() while
                # the background expiry pass is still iterating.
                continue
        return removed

    def clear_cache(self) -> dict[str, int]:
        removed_files = 0
        removed_bytes = 0
        for path in self.cache_root.glob("*"):
            try:
                if not path.is_file():
                    continue
                removed_bytes += path.stat().st_size
                path.unlink(missing_ok=True)
                removed_files += 1
            except FileNotFoundError:
                continue
        return {"removedFiles": removed_files, "removedBytes": removed_bytes}

    def close(self) -> None:
        self.executor.shutdown(wait=False, cancel_futures=True)
