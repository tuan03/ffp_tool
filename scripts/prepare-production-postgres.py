"""Prepare persistent production database credentials without logging secrets."""

import argparse
import os
from pathlib import Path
import re
import secrets
import sys
import tempfile
from urllib.parse import quote


DATABASE_KEYS = (
    "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD",
    "AUTO_SEO_DATABASE_URL", "DATABASE_URL",
)
SETTING_PATTERN = re.compile(r"^\s*(?:export\s+)?(" + "|".join(DATABASE_KEYS) + r")\s*=(.*)$")


def read_settings(contents: str) -> dict[str, str]:
    settings = {}
    for line in contents.splitlines():
        match = SETTING_PATTERN.match(line)
        if not match:
            continue
        key, value = match.groups()
        value = value.strip()
        if value.startswith("'") and value.endswith("'"):
            value = value[1:-1]
        elif value.startswith('"') and value.endswith('"'):
            value = value[1:-1]
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
        # Single-quoted dotenv values prevent Compose from expanding passwords containing '$'.
        if any(character in value for character in ("'", "\n", "\r", "\\")):
            raise ValueError(f"Unsupported dotenv characters in {key}; use a URL-safe credential.")
        settings[key] = value
    return settings


def prepare_environment(env_path: Path, previous_path: Path, has_existing_volume: bool) -> None:
    contents = env_path.read_text(encoding="utf-8")
    settings = read_settings(contents)
    previous = read_settings(previous_path.read_text(encoding="utf-8"))
    # An existing volume was initialized with these credentials. ENV_FILE is not a rotation mechanism.
    settings.update({key: value for key, value in previous.items() if value})
    settings["POSTGRES_DB"] = settings.get("POSTGRES_DB") or "ffp_tool"
    settings["POSTGRES_USER"] = settings.get("POSTGRES_USER") or "ffp_tool"
    if not settings.get("POSTGRES_PASSWORD"):
        if has_existing_volume:
            raise ValueError("POSTGRES_PASSWORD is missing for an existing PostgreSQL volume; restore its credentials before deploying.")
        settings["POSTGRES_PASSWORD"] = secrets.token_hex(32)
    if settings["POSTGRES_PASSWORD"] in {"change_me", "ffp_secure_password_change_me"}:
        raise ValueError("Replace the example POSTGRES_PASSWORD before deploying.")
    if not settings.get("AUTO_SEO_DATABASE_URL"):
        username = quote(settings["POSTGRES_USER"], safe="")
        password = quote(settings["POSTGRES_PASSWORD"], safe="")
        database = quote(settings["POSTGRES_DB"], safe="")
        settings["AUTO_SEO_DATABASE_URL"] = settings.get("DATABASE_URL") or f"postgresql://{username}:{password}@database:5432/{database}"

    lines = [line for line in contents.splitlines() if not SETTING_PATTERN.match(line)]
    lines.extend(f"{key}='{settings[key]}'" for key in DATABASE_KEYS if settings.get(key))
    prepared = "\n".join(lines) + "\n"
    # Replace atomically and keep credentials private even if deployment is interrupted.
    descriptor, temporary_path = tempfile.mkstemp(prefix=".postgres-env-", dir=env_path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            output.write(prepared)
        os.chmod(temporary_path, 0o600)
        os.replace(temporary_path, env_path)
    finally:
        if os.path.exists(temporary_path):
            os.unlink(temporary_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--previous-env-file", type=Path, required=True)
    parser.add_argument("--has-existing-volume", action="store_true")
    arguments = parser.parse_args()
    try:
        prepare_environment(arguments.env_file, arguments.previous_env_file, arguments.has_existing_volume)
    except (ValueError, OSError):
        # Do not print file contents, credentials, or connection strings on failures.
        print("PostgreSQL environment preparation failed. Check dotenv syntax and restore POSTGRES_PASSWORD for an existing PostgreSQL volume; never rotate it by replacing ENV_FILE.", file=sys.stderr)
        sys.exit(1)
    print("PostgreSQL environment prepared; persistent credentials preserved.")


if __name__ == "__main__":
    main()
