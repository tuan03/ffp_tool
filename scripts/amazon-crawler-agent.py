"""Development and PyInstaller entry point for the Windows crawler agent."""

from __future__ import annotations

import os
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
AMAZON_CRAWLER_ROOT = REPOSITORY_ROOT / "src" / "modules" / "amazon-crawler"
if AMAZON_CRAWLER_ROOT.is_dir():
    sys.path.insert(0, str(AMAZON_CRAWLER_ROOT))
PINTEREST_POD_ROOT = REPOSITORY_ROOT / "src" / "modules" / "pinterest-pod" / "server"
if PINTEREST_POD_ROOT.is_dir():
    sys.path.insert(0, str(PINTEREST_POD_ROOT))

# In local development via `npm run dev:agent`, default coordinator to 127.0.0.1:8766 if not configured
config_file = REPOSITORY_ROOT / "config" / "amazon-crawler-agent.json"
if not getattr(sys, "frozen", False) and not config_file.is_file() and not os.environ.get("AMAZON_COORDINATOR_URL"):
    os.environ["AMAZON_COORDINATOR_URL"] = "http://127.0.0.1:8766"

from engine.distributed.client_main import main


if __name__ == "__main__":
    raise SystemExit(main())
