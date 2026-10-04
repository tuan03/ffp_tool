"""Preserve or create the private tokens required by production services."""

import argparse
import os
from pathlib import Path
import re
import secrets
import sys
import tempfile


TOKEN_KEYS = (
    "REVIEW_IMAGE_BRIDGE_TOKEN",
    "REVIEW_IMAGE_EXTENSION_TOKEN",
    "SHOPIFY_PIPELINE_TOKEN",
)
TOKEN_PATTERN = re.compile(r"^\s*(?:export\s+)?(" + "|".join(TOKEN_KEYS) + r")\s*=(.*)$")


def read_tokens(contents: str) -> dict[str, str]:
    tokens = {}
    for line in contents.splitlines():
        match = TOKEN_PATTERN.match(line)
        if not match:
            continue
        key, value = match.groups()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].rstrip()
        if any(character in value for character in ("'", "\n", "\r", "\\", "\x00")):
            raise ValueError("Invalid service token")
        tokens[key] = value
    return tokens


def prepare_tokens(env_path: Path, previous_path: Path) -> None:
    contents = env_path.read_text(encoding="utf-8")
    tokens = read_tokens(contents)
    # Tokens already used by browser extensions and workers must remain stable
    # even when a stale GitHub ENV_FILE is applied during a later deployment.
    tokens.update({key: value for key, value in read_tokens(previous_path.read_text(encoding="utf-8")).items() if value})
    for key in TOKEN_KEYS:
        if len(tokens.get(key, "")) < 24:
            tokens[key] = secrets.token_urlsafe(32)

    lines = [line for line in contents.splitlines() if not TOKEN_PATTERN.match(line)]
    lines.extend(f"{key}='{tokens[key]}'" for key in TOKEN_KEYS)
    descriptor, temporary_path = tempfile.mkstemp(prefix=".service-token-env-", dir=env_path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as output:
            output.write("\n".join(lines) + "\n")
        os.chmod(temporary_path, 0o600)
        os.replace(temporary_path, env_path)
    finally:
        if os.path.exists(temporary_path):
            os.unlink(temporary_path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--previous-env-file", type=Path, required=True)
    arguments = parser.parse_args()
    try:
        prepare_tokens(arguments.env_file, arguments.previous_env_file)
    except (ValueError, OSError):
        print("Production service token preparation failed; verify the private dotenv configuration.", file=sys.stderr)
        sys.exit(1)
    print("Production service tokens prepared and preserved.")


if __name__ == "__main__":
    main()
