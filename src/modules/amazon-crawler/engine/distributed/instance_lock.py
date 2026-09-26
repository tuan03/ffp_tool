"""Prevent agents using the same local identity and spool from running together."""

from __future__ import annotations

import errno
import os
from pathlib import Path
from typing import BinaryIO


class AgentAlreadyRunningError(RuntimeError):
    pass


class AgentInstanceLock:
    def __init__(self, data_directory: Path) -> None:
        self.path = data_directory.resolve() / "agent.lock"
        self._file: BinaryIO | None = None

    def __enter__(self) -> "AgentInstanceLock":
        self.path.parent.mkdir(parents=True, exist_ok=True)
        lock_file = self.path.open("a+b")
        try:
            if lock_file.seek(0, os.SEEK_END) == 0:
                lock_file.write(b"\0")
                lock_file.flush()
            lock_file.seek(0)
            try:
                if os.name == "nt":
                    import msvcrt

                    msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                if error.errno in {errno.EACCES, errno.EAGAIN} or getattr(error, "winerror", None) in {33, 36}:
                    raise AgentAlreadyRunningError(
                        f"An FFP Amazon Crawler agent already uses {self.path.parent}."
                    ) from error
                raise
            self._file = lock_file
            return self
        except BaseException:
            lock_file.close()
            raise

    def __exit__(self, _error_type: object, _error: object, _traceback: object) -> None:
        lock_file = self._file
        self._file = None
        if lock_file is None:
            return
        try:
            lock_file.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(lock_file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)
        finally:
            lock_file.close()
