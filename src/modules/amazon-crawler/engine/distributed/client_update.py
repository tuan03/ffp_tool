"""Launch the signed, DRAIN-gated Windows Agent updater."""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path


def launch_agent_update(command_id: str, target_version: str, project_root: Path,
                        config_path: Path | None, process_id: int) -> bool:
    if os.name != "nt" or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", command_id):
        return False
    if not re.fullmatch(r"\d+\.\d+\.\d+", target_version) or config_path is None:
        return False
    script = project_root / "scripts" / "update-agent.ps1"
    if not script.is_file():
        return False
    log_path = config_path.parent / "agent-update.log"
    arguments = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                 "-File", str(script), "-InstallDirectory", str(project_root),
                 "-ConfigPath", str(config_path), "-CommandId", command_id, "-TargetVersion", target_version,
                 "-AgentProcessId", str(process_id)]
    try:
        with log_path.open("ab") as log_file:
            subprocess.Popen(arguments, cwd=str(project_root), creationflags=0x00000008 | 0x00000200,
                             close_fds=True, stdin=subprocess.DEVNULL, stdout=log_file, stderr=subprocess.STDOUT)
    except OSError:
        return False
    return True
