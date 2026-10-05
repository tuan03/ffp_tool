"""Compatibility entry point; canonical build also runs automatically after npm builds."""
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parent.parent
subprocess.run(["node", "scripts/build-seo-agent-pack.mjs"], cwd=root, check=True)
