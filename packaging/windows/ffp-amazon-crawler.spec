# -*- mode: python ; coding: utf-8 -*-

import os
from pathlib import Path


repository_root = Path(SPECPATH).parents[1]
amazon_root = repository_root / "src" / "modules" / "amazon-crawler"
browser_root = Path(os.environ["PLAYWRIGHT_BROWSERS_PATH"])

analysis = Analysis(
    [str(repository_root / "scripts" / "amazon-crawler-agent.py")],
    pathex=[str(amazon_root)],
    binaries=[],
    datas=[(str(browser_root), "ms-playwright")],
    hiddenimports=["engine.distributed.client_main", "pystray._win32"],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
python_archive = PYZ(analysis.pure)

executable = EXE(
    python_archive,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="FFPAmazonCrawlerAgent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

collection = COLLECT(
    executable,
    analysis.binaries,
    analysis.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="FFPAmazonCrawlerAgent",
)
