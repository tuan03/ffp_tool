"""Launch the signed, DRAIN-gated Windows Agent updater."""
from __future__ import annotations

import os
import hashlib
import json
import re
import shutil
import subprocess
from pathlib import Path


def prepare_agent_update_backup(command_id: str, project_root: Path, data_directory: Path) -> dict[str, str]:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", command_id):
        raise ValueError("Update backup command ID is invalid.")
    source = project_root.resolve()
    data_root = data_directory.resolve()
    backup_root = (data_root / "agent-update-backups" / command_id).resolve()
    if source == data_root or source in data_root.parents or data_root in source.parents:
        raise ValueError("Agent installation and durable data directories must be separate.")
    if backup_root != data_root / "agent-update-backups" / command_id:
        raise ValueError("Update backup path escaped the durable data directory.")
    if backup_root.exists():
        raise FileExistsError("An update backup already exists for this command.")

    def ignored(_directory: str, names: list[str]) -> set[str]:
        return {name for name in names if name in {".runtime", "logs", "__pycache__"}}

    size = 0
    for current, directories, files in os.walk(source, followlinks=False):
        directories[:] = [directory for directory in directories if directory not in ignored(current, directories)]
        if any((Path(current) / directory).is_symlink() for directory in directories):
            raise ValueError("Agent installation backup refuses symbolic-link directories.")
        for filename in files:
            path = Path(current) / filename
            if path.is_symlink():
                raise ValueError("Agent installation backup refuses symbolic links.")
            size += path.stat().st_size
    data_root.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(data_root).free < size + 128 * 1024 * 1024:
        raise OSError("Insufficient free disk space for the verified Agent rollback backup.")

    try:
        install_backup = backup_root / "install"
        install_backup.parent.mkdir(parents=True)
        shutil.copytree(source, install_backup, ignore=ignored, symlinks=False)
        files_manifest: list[dict[str, object]] = []
        for current, _directories, files in os.walk(install_backup):
            for filename in files:
                path = Path(current) / filename
                hasher = hashlib.sha256()
                with path.open("rb") as content:
                    for chunk in iter(lambda: content.read(1024 * 1024), b""):
                        hasher.update(chunk)
                digest = hasher.hexdigest()
                files_manifest.append({"path": path.relative_to(install_backup).as_posix(),
                    "size": path.stat().st_size, "sha256": digest})
        files_manifest.sort(key=lambda item: str(item["path"]))
        manifest_path = backup_root / "install-manifest.json"
        manifest_part = manifest_path.with_suffix(".json.part")
        manifest_part.write_text(json.dumps({"schemaVersion": 1, "files": files_manifest},
            separators=(",", ":")), encoding="utf-8")
        manifest_part.replace(manifest_path)
        manifest_hash = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
        return {"backupDirectory": str(backup_root), "installManifestPath": str(manifest_path),
            "installManifestSha256": manifest_hash}
    except Exception:
        if backup_root.exists() and backup_root.parent == data_root / "agent-update-backups":
            shutil.rmtree(backup_root)
        raise


def discard_agent_update_backup(command_id: str, data_directory: Path) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", command_id):
        raise ValueError("Update backup command ID is invalid.")
    data_root = data_directory.resolve()
    backup_root = (data_root / "agent-update-backups" / command_id).resolve()
    if backup_root.parent != data_root / "agent-update-backups" or not backup_root.exists():
        raise ValueError("Update backup cleanup path escaped the durable data directory.")
    shutil.rmtree(backup_root)


def launch_agent_update(command_id: str, target_version: str, project_root: Path,
                        config_path: Path | None, process_id: int, backup_directory: str,
                        manifest_sha256: str, database_backup_sha256: str) -> bool:
    if os.name != "nt" or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", command_id):
        return False
    if (not re.fullmatch(r"\d+\.\d+\.\d+", target_version) or config_path is None
            or not re.fullmatch(r"[a-f0-9]{64}", manifest_sha256)
            or not re.fullmatch(r"[a-f0-9]{64}", database_backup_sha256)):
        return False
    script = project_root / "scripts" / "update-agent.ps1"
    if not script.is_file():
        return False
    log_path = config_path.parent / "agent-update.log"
    arguments = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                 "-File", str(script), "-InstallDirectory", str(project_root),
                 "-ConfigPath", str(config_path), "-CommandId", command_id, "-TargetVersion", target_version,
                 "-AgentProcessId", str(process_id), "-BackupDirectory", backup_directory,
                 "-ManifestSha256", manifest_sha256, "-DatabaseBackupSha256", database_backup_sha256]
    try:
        with log_path.open("ab") as log_file:
            subprocess.Popen(arguments, cwd=str(project_root), creationflags=0x00000008 | 0x00000200,
                             close_fds=True, stdin=subprocess.DEVNULL, stdout=log_file, stderr=subprocess.STDOUT)
    except OSError:
        return False
    return True


def launch_agent_rollback(command_id: str, project_root: Path, config_path: Path | None,
                          backup_directory: str, manifest_sha256: str, process_id: int) -> bool:
    if os.name != "nt" or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", command_id):
        return False
    if config_path is None or not re.fullmatch(r"[a-f0-9]{64}", manifest_sha256):
        return False
    script = project_root / "scripts" / "rollback-agent.ps1"
    if not script.is_file():
        return False
    log_path = config_path.parent / "agent-update.log"
    arguments = ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", str(script), "-InstallDirectory", str(project_root), "-ConfigPath", str(config_path),
        "-CommandId", command_id, "-BackupDirectory", backup_directory,
        "-ManifestSha256", manifest_sha256, "-AgentProcessId", str(process_id)]
    try:
        with log_path.open("ab") as log_file:
            subprocess.Popen(arguments, cwd=str(project_root), creationflags=0x00000008 | 0x00000200,
                close_fds=True, stdin=subprocess.DEVNULL, stdout=log_file, stderr=subprocess.STDOUT)
    except OSError:
        return False
    return True
