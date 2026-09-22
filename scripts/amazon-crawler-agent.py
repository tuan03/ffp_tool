"""Development and PyInstaller entry point for the Windows crawler agent."""

from __future__ import annotations

import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
AMAZON_CRAWLER_ROOT = REPOSITORY_ROOT / "src" / "modules" / "amazon-crawler"
if AMAZON_CRAWLER_ROOT.is_dir():
    sys.path.insert(0, str(AMAZON_CRAWLER_ROOT))

from engine.distributed.client_main import main


if __name__ == "__main__":
    raise SystemExit(main())
