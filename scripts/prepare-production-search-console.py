"""Preserve VPS OAuth configuration and prepare disabled Search Console rollout."""

import argparse
import os
from pathlib import Path
import re
import secrets
import sys
import tempfile
from urllib.parse import urlparse

KEYS = ("SEO_PERFORMANCE_ENABLED", "GSC_CLIENT_ID", "GSC_CLIENT_SECRET",
        "GSC_REDIRECT_URI", "GSC_TOKEN_ENCRYPTION_KEY")
PATTERN = re.compile(r"^\s*(?:export\s+)?(" + "|".join(KEYS) + r")\s*=(.*)$")


def settings(contents: str) -> dict[str, str]:
    values = {}
    for line in contents.splitlines():
        match = PATTERN.match(line)
        if not match:
            continue
        key, value = match.groups()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
        if any(character in value for character in ("'", "\n", "\r", "\\", "\x00")):
            raise ValueError("Invalid dotenv value")
        values[key] = value
    return values


def prepare(env_path: Path, previous_path: Path, redirect_uri: str) -> None:
    contents = env_path.read_text(encoding="utf-8")
    values = settings(contents)
    # ENV_FILE is not a rotation mechanism. Preserve explicit empty credentials
    # too, so a removed credential cannot be restored by stale CI configuration.
    values.update(settings(previous_path.read_text(encoding="utf-8")))
    values["SEO_PERFORMANCE_ENABLED"] = values.get("SEO_PERFORMANCE_ENABLED") or "false"
    values["GSC_REDIRECT_URI"] = values.get("GSC_REDIRECT_URI") or redirect_uri
    values["GSC_TOKEN_ENCRYPTION_KEY"] = values.get("GSC_TOKEN_ENCRYPTION_KEY") or secrets.token_hex(32)
    if values["SEO_PERFORMANCE_ENABLED"] not in ("true", "false"):
        raise ValueError("Invalid feature flag")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", values["GSC_TOKEN_ENCRYPTION_KEY"]):
        raise ValueError("Invalid encryption key")
    uri = urlparse(values["GSC_REDIRECT_URI"])
    if uri.scheme != "https" or not uri.hostname or uri.username or uri.password or uri.query or uri.fragment or uri.path != "/api/seo-performance/oauth/callback":
        raise ValueError("Invalid callback")
    lines = [line for line in contents.splitlines() if not PATTERN.match(line)]
    lines.extend(f"{key}='{values.get(key, '')}'" for key in KEYS)
    descriptor, temporary = tempfile.mkstemp(prefix=".gsc-env-", dir=env_path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            output.write("\n".join(lines) + "\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, env_path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--previous-env-file", type=Path, required=True)
    parser.add_argument("--redirect-uri", required=True)
    args = parser.parse_args()
    try:
        prepare(args.env_file, args.previous_env_file, args.redirect_uri)
    except (ValueError, OSError):
        print("Search Console environment preparation failed; verify configuration securely on the VPS.", file=sys.stderr)
        sys.exit(1)
