"""Launch a replacement agent process for a durable RESTART_AGENT command."""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path


def launch_replacement_agent(command_id: str, project_root: Path) -> bool:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", command_id):
        return False
    arguments = [sys.executable]
    if not bool(getattr(sys, "frozen", False)):
        arguments.append(sys.argv[0])
    arguments.extend(sys.argv[1:])
    arguments.extend(["--restart-command-id", command_id])
    try:
        if os.name == "nt":
            flags = getattr(subprocess, "DETACHED_PROCESS", 0x00000008) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0x00000200)
            subprocess.Popen(arguments, cwd=str(project_root), creationflags=flags, close_fds=True)
        else:
            subprocess.Popen(arguments, cwd=str(project_root), start_new_session=True, close_fds=True)
    except OSError:
        return False
    return True
