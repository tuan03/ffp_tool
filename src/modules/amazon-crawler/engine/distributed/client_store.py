"""Durable identity, leases, and offline result spool for a client agent."""

from __future__ import annotations

import json
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from .protocol import utc_iso


SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=FULL;
CREATE TABLE IF NOT EXISTS agent_identity (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    client_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS leases (
    task_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    lease_id TEXT NOT NULL,
    settings_fingerprint TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_results (
    task_id TEXT PRIMARY KEY,
    lease_id TEXT NOT NULL,
    checksum TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_products (
    task_id TEXT NOT NULL,
    product_key TEXT NOT NULL,
    lease_id TEXT NOT NULL,
    checksum TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(task_id, product_key)
);
CREATE TABLE IF NOT EXISTS cancel_intents (
    job_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class ClientStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as connection:
            connection.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        return connection

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def client_id(self) -> str:
        with self._connection() as connection:
            row = connection.execute("SELECT client_id FROM agent_identity WHERE singleton = 1").fetchone()
            if row:
                return str(row["client_id"])
            client_id = uuid.uuid4().hex
            connection.execute("INSERT INTO agent_identity(singleton, client_id) VALUES (1, ?)", (client_id,))
            connection.commit()
            return client_id

    def save_assignment(self, assignment: dict[str, Any]) -> None:
        now = utc_iso()
        with self._connection() as connection:
            connection.execute(
                """INSERT INTO leases(task_id, job_id, lease_id, settings_fingerprint, payload_json, status, updated_at)
                   VALUES (?, ?, ?, ?, ?, 'leased', ?)
                   ON CONFLICT(task_id) DO UPDATE SET
                     job_id=excluded.job_id, lease_id=excluded.lease_id,
                     settings_fingerprint=excluded.settings_fingerprint,
                     payload_json=excluded.payload_json, status='leased', updated_at=excluded.updated_at""",
                (
                    assignment["taskId"], assignment["jobId"], assignment["leaseId"],
                    assignment["settingsFingerprint"], json.dumps(assignment, ensure_ascii=False), now,
                ),
            )
            connection.commit()

    def recover_assignments(self) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT payload_json FROM leases WHERE status IN ('leased', 'running') ORDER BY updated_at"
            ).fetchall()
        return [json.loads(row["payload_json"]) for row in rows]

    def local_tasks(self) -> list[dict[str, str]]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT task_id, job_id, lease_id, status FROM leases ORDER BY updated_at"
            ).fetchall()
        return [
            {
                "taskId": str(row["task_id"]),
                "jobId": str(row["job_id"]),
                "leaseId": str(row["lease_id"]),
                "status": str(row["status"]),
            }
            for row in rows
        ]

    def assignment(self, task_id: str) -> dict[str, Any] | None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT payload_json FROM leases WHERE task_id=?",
                (task_id,),
            ).fetchone()
        return json.loads(row["payload_json"]) if row else None

    def mark_running(self, task_ids: list[str]) -> None:
        if not task_ids:
            return
        placeholders = ",".join("?" for _ in task_ids)
        with self._connection() as connection:
            connection.execute(
                f"UPDATE leases SET status='running', updated_at=? WHERE task_id IN ({placeholders})",
                (utc_iso(), *task_ids),
            )
            connection.commit()

    def complete_lease(self, task_id: str) -> None:
        with self._connection() as connection:
            connection.execute("DELETE FROM leases WHERE task_id = ?", (task_id,))
            connection.commit()

    def discard_task(self, task_id: str) -> None:
        """Remove local state after the coordinator confirms a task no longer exists."""
        with self._connection() as connection:
            connection.execute("DELETE FROM pending_products WHERE task_id = ?", (task_id,))
            connection.execute("DELETE FROM pending_results WHERE task_id = ?", (task_id,))
            connection.execute("DELETE FROM leases WHERE task_id = ?", (task_id,))
            connection.commit()

    def discard_job(self, job_id: str) -> None:
        with self._connection() as connection:
            task_rows = connection.execute(
                "SELECT task_id FROM leases WHERE job_id=?",
                (job_id,),
            ).fetchall()
            task_ids = [str(row["task_id"]) for row in task_rows]
            for task_id in task_ids:
                connection.execute("DELETE FROM pending_products WHERE task_id=?", (task_id,))
                connection.execute("DELETE FROM pending_results WHERE task_id=?", (task_id,))
            connection.execute("DELETE FROM leases WHERE job_id=?", (job_id,))
            connection.commit()

    def add_cancel_intent(self, job_id: str) -> None:
        if not job_id:
            return
        with self._connection() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO cancel_intents(job_id, created_at) VALUES (?, ?)",
                (job_id, utc_iso()),
            )
            connection.commit()

    def cancel_intents(self) -> list[str]:
        with self._connection() as connection:
            rows = connection.execute("SELECT job_id FROM cancel_intents ORDER BY created_at").fetchall()
        return [str(row["job_id"]) for row in rows]

    def acknowledge_cancel_intents(self, job_ids: list[str]) -> None:
        if not job_ids:
            return
        placeholders = ",".join("?" for _ in job_ids)
        with self._connection() as connection:
            connection.execute(
                f"DELETE FROM cancel_intents WHERE job_id IN ({placeholders})",
                tuple(job_ids),
            )
            connection.commit()

    def is_paused(self) -> bool:
        with self._connection() as connection:
            row = connection.execute("SELECT value FROM agent_state WHERE key='paused'").fetchone()
        return bool(row and row["value"] == "1")

    def set_paused(self, is_paused: bool) -> None:
        with self._connection() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO agent_state(key, value) VALUES ('paused', ?)",
                ("1" if is_paused else "0",),
            )
            connection.commit()

    def cache_generation(self) -> int:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT value FROM agent_state WHERE key='cache_generation'"
            ).fetchone()
        if row is None:
            return 0
        try:
            return max(0, int(row["value"]))
        except (TypeError, ValueError):
            return 0

    def set_cache_generation(self, generation: int) -> None:
        with self._connection() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO agent_state(key, value) VALUES ('cache_generation', ?)",
                (str(max(0, int(generation))),),
            )
            connection.commit()

    def cancel_job(self, job_id: str) -> None:
        with self._connection() as connection:
            connection.execute("UPDATE leases SET status='cancelled', updated_at=? WHERE job_id=?", (utc_iso(), job_id))
            connection.commit()

    def is_task_cancelled(self, task_id: str) -> bool:
        with self._connection() as connection:
            row = connection.execute("SELECT status FROM leases WHERE task_id=?", (task_id,)).fetchone()
        return bool(row and row["status"] == "cancelled")

    def spool_result(self, *, task_id: str, lease_id: str, checksum: str, payload: dict[str, Any]) -> None:
        now = utc_iso()
        with self._connection() as connection:
            connection.execute(
                """INSERT INTO pending_results(task_id, lease_id, checksum, payload_json, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT(task_id) DO UPDATE SET
                     lease_id=excluded.lease_id, checksum=excluded.checksum,
                     payload_json=excluded.payload_json, updated_at=excluded.updated_at""",
                (task_id, lease_id, checksum, json.dumps(payload, ensure_ascii=False), now, now),
            )
            connection.execute(
                "UPDATE leases SET status='completed_pending_upload', updated_at=? WHERE task_id=?",
                (now, task_id),
            )
            connection.commit()

    def pending_results(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT task_id, lease_id, checksum, payload_json, attempts FROM pending_results ORDER BY created_at LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {
                "taskId": row["task_id"], "leaseId": row["lease_id"], "checksum": row["checksum"],
                "payload": json.loads(row["payload_json"]), "attempts": row["attempts"],
            }
            for row in rows
        ]

    def spool_product(
        self,
        *,
        task_id: str,
        product_key: str,
        lease_id: str,
        checksum: str,
        payload: dict[str, Any],
    ) -> None:
        now = utc_iso()
        with self._connection() as connection:
            connection.execute(
                """INSERT INTO pending_products(
                       task_id, product_key, lease_id, checksum, payload_json, created_at, updated_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(task_id, product_key) DO UPDATE SET
                     lease_id=excluded.lease_id, checksum=excluded.checksum,
                     payload_json=excluded.payload_json, attempts=0, last_error=NULL,
                     updated_at=excluded.updated_at""",
                (
                    task_id,
                    product_key,
                    lease_id,
                    checksum,
                    json.dumps(payload, ensure_ascii=False),
                    now,
                    now,
                ),
            )
            connection.commit()

    def pending_products(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                """SELECT task_id, product_key, lease_id, checksum, payload_json, attempts
                   FROM pending_products ORDER BY created_at LIMIT ?""",
                (limit,),
            ).fetchall()
        return [
            {
                "taskId": row["task_id"],
                "productKey": row["product_key"],
                "leaseId": row["lease_id"],
                "checksum": row["checksum"],
                "payload": json.loads(row["payload_json"]),
                "attempts": row["attempts"],
            }
            for row in rows
        ]

    def acknowledge_product(self, task_id: str, product_key: str) -> None:
        with self._connection() as connection:
            connection.execute(
                "DELETE FROM pending_products WHERE task_id=? AND product_key=?",
                (task_id, product_key),
            )
            connection.commit()

    def has_pending_products(self, task_id: str) -> bool:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT 1 FROM pending_products WHERE task_id=? LIMIT 1",
                (task_id,),
            ).fetchone()
        return row is not None

    def product_failed(self, task_id: str, product_key: str, error: str) -> None:
        with self._connection() as connection:
            connection.execute(
                """UPDATE pending_products
                   SET attempts=attempts+1, last_error=?, updated_at=?
                   WHERE task_id=? AND product_key=?""",
                (error[:2000], utc_iso(), task_id, product_key),
            )
            connection.commit()

    def acknowledge_result(self, task_id: str) -> None:
        with self._connection() as connection:
            connection.execute("DELETE FROM pending_results WHERE task_id=?", (task_id,))
            connection.execute("DELETE FROM leases WHERE task_id=?", (task_id,))
            connection.commit()

    def result_failed(self, task_id: str, error: str) -> None:
        with self._connect() as connection:
            connection.execute(
                "UPDATE pending_results SET attempts=attempts+1, last_error=?, updated_at=? WHERE task_id=?",
                (error[:2000], utc_iso(), task_id),
            )
            connection.commit()
