"""Durable identity, leases, and offline result spool for a client agent."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import uuid
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()
from .protocol import utc_iso, payload_checksum
from .client_outbox_migrations import migrate_outbox
from .client_outbox_retention import block_attempt, block_job, blocked_reason, quarantine_row, row_job_id
from ..observability import safe_fields


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
CREATE TABLE IF NOT EXISTS cancel_intents (
    job_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_commands (
    command_id TEXT PRIMARY KEY,
    sequence INTEGER NOT NULL UNIQUE,
    command_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    acknowledged_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    error TEXT
);
CREATE TABLE IF NOT EXISTS telemetry_spool (
    event_id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS telemetry_spool_created ON telemetry_spool(created_at);
"""


class ClientStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.storage_fault = False
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as connection:
            migrate_outbox(connection, path)
            connection.commit()
            connection.executescript(SCHEMA)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        return connection

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = None
        try:
            connection = self._connect()
            with connection:
                yield connection
        except (OSError, sqlite3.Error):
            self.storage_fault = True
            raise
        finally:
            if connection is not None:
                connection.close()

    def self_test_database_integrity(self) -> bool:
        """Run SQLite's read-only quick check without changing agent state."""
        with self._connection() as connection:
            return connection.execute("PRAGMA quick_check").fetchone()[0] == "ok"

    def client_id(self) -> str:
        with self._connection() as connection:
            row = connection.execute("SELECT client_id FROM agent_identity WHERE singleton = 1").fetchone()
            if row:
                return str(row["client_id"])
            client_id = uuid.uuid4().hex
            connection.execute("INSERT INTO agent_identity(singleton, client_id) VALUES (1, ?)", (client_id,))
            connection.commit()
            return client_id

    def begin_enrollment(self, protected_credential: str) -> str:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT value FROM agent_state WHERE key='enrollment_request'").fetchone()
            request_id = str(row[0]) if row else uuid.uuid4().hex
            connection.execute("INSERT OR REPLACE INTO agent_state VALUES ('enrollment_request', ?)", (request_id,))
            connection.execute("INSERT OR REPLACE INTO agent_state VALUES ('protected_credential', ?)", (protected_credential,))
            return request_id

    def enrollment_state(self) -> tuple[str, str]:
        with self._connection() as connection:
            rows = dict(connection.execute("SELECT key,value FROM agent_state WHERE key IN ('protected_credential','enrollment_request')").fetchall())
            if len(rows) != 2:
                raise ValueError("AGENT_NEED_ENROLLMENT")
            return rows["protected_credential"], rows["enrollment_request"]

    def accept_enrollment(self, agent_id: str) -> None:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = connection.execute("SELECT client_id FROM agent_identity WHERE singleton=1").fetchone()
            if current and current[0] != agent_id:
                # Never rewrite envelopes or silently orphan pending work from the old identity.
                tables = ("leases", "cancel_intents", "telemetry_spool", "pending_results", "pending_products")
                for table in tables:
                    if connection.execute(f"SELECT 1 FROM {table} LIMIT 1").fetchone():
                        raise ValueError("AGENT_REBIND_REQUIRED")
            connection.execute("INSERT OR REPLACE INTO agent_identity VALUES (1, ?)", (agent_id,))

    def spool_telemetry(self, event: dict[str, Any], *, maximum: int = 10000) -> None:
        payload = json.dumps(safe_fields(event), ensure_ascii=False, separators=(",", ":"))
        if len(payload.encode("utf-8")) > 4096:
            self.count_telemetry_dropped()
            return
        with self._connection() as connection:
            connection.execute("INSERT OR IGNORE INTO telemetry_spool VALUES (?,?,?)", (event["eventId"], payload, time.time()))
            count = connection.execute("SELECT COUNT(*) FROM telemetry_spool").fetchone()[0]
            excess = max(0, count - maximum)
            if excess:
                connection.execute("DELETE FROM telemetry_spool WHERE event_id IN (SELECT event_id FROM telemetry_spool ORDER BY created_at LIMIT ?)", (excess,))
                self._count_dropped(connection, excess)

    @staticmethod
    def _count_dropped(connection, amount: int) -> None:
        connection.execute("INSERT INTO agent_state VALUES ('telemetry_dropped',?) ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+CAST(excluded.value AS INTEGER)", (str(amount),))

    def count_telemetry_dropped(self) -> None:
        with self._connection() as connection:
            self._count_dropped(connection, 1)

    def pending_telemetry(self, limit: int = 64) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute("SELECT payload_json FROM telemetry_spool ORDER BY created_at LIMIT ?", (max(1, min(limit, 64)),)).fetchall()
        return [json.loads(row[0]) for row in rows]

    def telemetry_status(self) -> dict[str, int]:
        with self._connection() as connection:
            backlog = connection.execute("SELECT COUNT(*) FROM telemetry_spool").fetchone()[0]
            dropped = connection.execute("SELECT value FROM agent_state WHERE key='telemetry_dropped'").fetchone()
        return {"backlog": backlog, "dropped": int(dropped[0]) if dropped else 0}

    def acknowledge_telemetry(self, event_ids: list[str]) -> None:
        with self._connection() as connection:
            connection.executemany("DELETE FROM telemetry_spool WHERE event_id=?", [(event_id,) for event_id in event_ids[:64]])

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

    def uploading_assignments(self) -> list[dict[str, Any]]:
        """Renew completed attempts until their final durable receipt arrives."""
        with self._connection() as connection:
            rows = connection.execute("""
                SELECT l.payload_json FROM leases l
                WHERE l.status='completed_pending_upload' AND EXISTS (
                    SELECT 1 FROM pending_results r
                    WHERE r.task_id=l.task_id AND r.lease_id=l.lease_id
                    AND r.result_id NOT IN (SELECT result_id FROM outbox_quarantine)
                )
            """).fetchall()
        return [json.loads(row["payload_json"]) for row in rows]

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
        """Retire assignment authority, retaining every unacknowledged upload."""
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            leases = connection.execute("SELECT lease_id FROM leases WHERE task_id=? UNION SELECT lease_id FROM pending_results WHERE task_id=? UNION SELECT lease_id FROM pending_products WHERE task_id=?", (task_id, task_id, task_id)).fetchall()
            for lease in leases:
                block_attempt(connection, task_id, lease[0], "task_discarded")
            connection.execute("DELETE FROM leases WHERE task_id = ?", (task_id,))
            connection.commit()

    def discard_job(self, job_id: str) -> None:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            block_job(connection, job_id, "job_discarded")
            connection.execute("DELETE FROM leases WHERE job_id=?", (job_id,))
            connection.commit()

    def clear_orphaned_jobs(self, valid_job_ids: set[str]) -> int:
        """Remove orphan assignments; quarantine uploads instead of deleting them."""
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            leases = {
                str(row["task_id"]): str(row["job_id"])
                for row in connection.execute("SELECT task_id, job_id FROM leases").fetchall()
            }
            orphaned_job_ids = set(leases.values()) - valid_job_ids
            for table_name in ("pending_products", "pending_results"):
                rows = connection.execute(f"SELECT * FROM {table_name}").fetchall()
                for row in rows:
                    job_id = row_job_id(connection, row)
                    if job_id in valid_job_ids:
                        continue
                    block_attempt(connection, row["task_id"], row["lease_id"], "orphaned_job")
                    if job_id:
                        orphaned_job_ids.add(job_id)
            for job_id in orphaned_job_ids:
                block_job(connection, job_id, "orphaned_job")
                connection.execute("DELETE FROM leases WHERE job_id=?", (job_id,))
            cancel_intent_job_ids = {
                str(row["job_id"])
                for row in connection.execute("SELECT job_id FROM cancel_intents").fetchall()
            }
            for job_id in cancel_intent_job_ids - valid_job_ids:
                connection.execute("DELETE FROM cancel_intents WHERE job_id=?", (job_id,))
                orphaned_job_ids.add(job_id)
            connection.commit()
        return len(orphaned_job_ids)

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

    def product_invalidation_generation(self) -> int:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT value FROM agent_state WHERE key='product_invalidation_generation'"
            ).fetchone()
        try:
            return max(0, int(row["value"])) if row else 0
        except (TypeError, ValueError):
            return 0

    def temporary_cleanup_generation(self) -> int:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT value FROM agent_state WHERE key='temporary_cleanup_generation'"
            ).fetchone()
        try:
            return max(0, int(row["value"])) if row else 0
        except (TypeError, ValueError):
            return 0

    def set_temporary_cleanup_generation(self, generation: int) -> None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT value FROM agent_state WHERE key='temporary_cleanup_generation'"
            ).fetchone()
            current_generation = max(0, int(row["value"])) if row else 0
            connection.execute(
                "INSERT OR REPLACE INTO agent_state(key, value) VALUES ('temporary_cleanup_generation', ?)",
                (str(max(current_generation, generation)),),
            )
            connection.commit()

    def set_product_invalidation_generation(self, generation: int) -> None:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT value FROM agent_state WHERE key='product_invalidation_generation'"
            ).fetchone()
            current_generation = max(0, int(row["value"])) if row else 0
            connection.execute(
                "INSERT OR REPLACE INTO agent_state(key, value) VALUES ('product_invalidation_generation', ?)",
                (str(max(current_generation, generation)),),
            )
            connection.commit()

    def cancel_job(self, job_id: str) -> None:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            block_job(connection, job_id, "job_cancelled")
            connection.execute("UPDATE leases SET status='cancelled', updated_at=? WHERE job_id=?", (utc_iso(), job_id))
            connection.commit()

    def cancel_task(self, task_id: str) -> None:
        with self._connection() as connection:
            connection.execute(
                "UPDATE leases SET status='cancelled', updated_at=? WHERE task_id=?",
                (utc_iso(), task_id),
            )
            connection.commit()

    def is_task_cancelled(self, task_id: str) -> bool:
        with self._connection() as connection:
            row = connection.execute("SELECT status FROM leases WHERE task_id=?", (task_id,)).fetchone()
        return bool(row and row["status"] == "cancelled")

    def spool_result(self, *, task_id: str, lease_id: str, checksum: str, payload: dict[str, Any]) -> None:
        if self.storage_fault:
            raise OSError("Outbox storage failure requires operator recovery before accepting new results")
        now = utc_iso()
        with self._connection() as connection:
            self._spool(connection, "pending_results", task_id, lease_id, checksum, payload)
            connection.execute(
                "UPDATE leases SET status='completed_pending_upload', updated_at=? WHERE task_id=? AND lease_id=? AND status!='cancelled'",
                (now, task_id, lease_id),
            )
            connection.commit()

    def remote_execution_state(self) -> str:
        with self._connection() as connection:
            rows = dict(connection.execute(
                "SELECT key,value FROM agent_state WHERE key IN ('remote_execution_state','last_processed_command_sequence')"
            ).fetchall())
        state = str(rows.get("remote_execution_state", "RUNNING"))
        return state if state in {"RUNNING", "PAUSED", "DRAINING", "DRAINED"} else "RUNNING"

    def global_admission_gate(self) -> dict[str, Any]:
        with self._connection() as connection:
            rows = dict(connection.execute(
                "SELECT key,value FROM agent_state WHERE key IN ('global_admission_gate_revision','global_admission_gate_state')"
            ).fetchall())
        try:
            revision = max(0, int(rows.get("global_admission_gate_revision", "0")))
        except (TypeError, ValueError):
            revision = 0
        state = str(rows.get("global_admission_gate_state", "OPEN"))
        return {"revision": revision, "state": state if state in {"OPEN", "STOPPED"} else "OPEN"}

    def apply_global_admission_gate(self, revision: int, state: str) -> dict[str, Any]:
        if revision < 0 or state not in {"OPEN", "STOPPED"}:
            raise ValueError("Global admission gate update is invalid.")
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = dict(connection.execute(
                "SELECT key,value FROM agent_state WHERE key IN ('global_admission_gate_revision','global_admission_gate_state')"
            ).fetchall())
            try:
                current_revision = max(0, int(current.get("global_admission_gate_revision", "0")))
            except (TypeError, ValueError):
                current_revision = 0
            if revision >= current_revision:
                connection.execute("INSERT OR REPLACE INTO agent_state(key,value) VALUES('global_admission_gate_revision',?)",
                                   (str(revision),))
                connection.execute("INSERT OR REPLACE INTO agent_state(key,value) VALUES('global_admission_gate_state',?)",
                                   (state,))
            connection.commit()
        return self.global_admission_gate()

    def reconcile_remote_execution_state(self, execution_state: str) -> None:
        if execution_state not in {"RUNNING", "PAUSED", "DRAINING", "DRAINED"}:
            raise ValueError("Remote execution state is invalid.")
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("INSERT OR REPLACE INTO agent_state(key,value) VALUES('remote_execution_state',?)",
                               (execution_state,))
            connection.commit()

    def last_processed_command_sequence(self) -> int:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT value FROM agent_state WHERE key='last_processed_command_sequence'"
            ).fetchone()
        try:
            return max(0, int(row["value"])) if row else 0
        except (TypeError, ValueError):
            return 0

    def begin_server_command(self, command: dict[str, Any]) -> dict[str, Any]:
        command_id = str(command.get("commandId") or "")
        command_type = str(command.get("type") or "")
        try:
            sequence = int(command.get("sequence"))
        except (TypeError, ValueError):
            raise ValueError("Invalid command sequence.") from None
        if not command_id or command_type not in {
            "PAUSE", "RESUME", "RELOAD_CONFIG", "DRAIN", "RUN_SELF_TEST", "PURGE_PENDING_TASKS", "PURGE_ALL_LOCAL_TASKS",
            "RESTART_WORKERS", "RESTART_AGENT", "UPDATE_AGENT", "ROLLBACK_AGENT",
        }:
            raise ValueError("Unsupported or malformed server command.")
        expires_at = str(command.get("expiresAt") or "")
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            last_sequence = self._read_agent_state(connection, "last_processed_command_sequence", 0)
            existing = connection.execute(
                "SELECT * FROM agent_commands WHERE command_id=? OR sequence=?",
                (command_id, sequence),
            ).fetchone()
            if sequence <= last_sequence:
                if existing is None or str(existing["command_id"]) != command_id:
                    return {"decision": "gap", "expectedSequence": last_sequence + 1}
                return {"decision": "duplicate", "status": str(existing["status"]), "sequence": sequence}
            if sequence != last_sequence + 1:
                return {"decision": "gap", "expectedSequence": last_sequence + 1}
            if existing is not None:
                if str(existing["command_id"]) != command_id or str(existing["command_type"]) != command_type:
                    raise ValueError("Command sequence conflicts with its durable receipt.")
                if str(existing["status"]) in {"SUCCESS", "FAILED", "EXPIRED"}:
                    return {"decision": "duplicate", "status": str(existing["status"]), "sequence": sequence}
                return {"decision": "resume", "status": str(existing["status"]), "sequence": sequence}
            try:
                expiry = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            except ValueError:
                raise ValueError("Command expiry is invalid.") from None
            now = datetime.now(timezone.utc)
            if expiry.tzinfo is None:
                raise ValueError("Command expiry must include a timezone.")
            if expiry <= now:
                connection.execute(
                    "INSERT INTO agent_commands(command_id,sequence,command_type,payload_json,expires_at,status,created_at,completed_at) VALUES(?,?,?,?,?,?,?,?)",
                    (command_id, sequence, command_type, json.dumps(command.get("payload") or {}, separators=(",", ":")),
                     expires_at, "EXPIRED", str(command.get("createdAt") or utc_iso()), utc_iso()),
                )
                connection.execute("INSERT OR REPLACE INTO agent_state(key,value) VALUES('last_processed_command_sequence',?)", (str(sequence),))
                connection.commit()
                return {"decision": "expired", "status": "EXPIRED", "sequence": sequence}
            connection.execute(
                "INSERT INTO agent_commands(command_id,sequence,command_type,payload_json,expires_at,status,created_at,acknowledged_at) VALUES(?,?,?,?,?,?,?,?)",
                (command_id, sequence, command_type, json.dumps(command.get("payload") or {}, separators=(",", ":")),
                 expires_at, "ACKED", str(command.get("createdAt") or utc_iso()), utc_iso()),
            )
            connection.commit()
        return {"decision": "process", "status": "ACKED", "sequence": sequence}

    def set_server_command_running(self, command_id: str) -> None:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "UPDATE agent_commands SET status='RUNNING', started_at=COALESCE(started_at,?) WHERE command_id=? AND status IN ('ACKED','RUNNING')",
                (utc_iso(), command_id),
            )
            connection.commit()

    def complete_server_command(self, command_id: str, sequence: int, status: str, execution_state: str | None,
                                error: str | None = None) -> None:
        if status not in {"SUCCESS", "FAILED", "EXPIRED"}:
            raise ValueError("Command completion status is invalid.")
        if execution_state is not None and execution_state not in {"RUNNING", "PAUSED", "DRAINING", "DRAINED"}:
            raise ValueError("Remote execution state is invalid.")
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            last_sequence = self._read_agent_state(connection, "last_processed_command_sequence", 0)
            if sequence != last_sequence + 1:
                raise ValueError("Command completion sequence is not contiguous.")
            if execution_state is not None and status == "SUCCESS":
                connection.execute("INSERT OR REPLACE INTO agent_state(key,value) VALUES('remote_execution_state',?)", (execution_state,))
            connection.execute(
                "UPDATE agent_commands SET status=?, completed_at=?, error=? WHERE command_id=?",
                (status, utc_iso(), error, command_id),
            )
            connection.execute("INSERT OR REPLACE INTO agent_state(key,value) VALUES('last_processed_command_sequence',?)", (str(sequence),))
            connection.commit()

    def drain_command(self) -> dict[str, Any] | None:
        with self._connection() as connection:
            rows = dict(connection.execute(
                "SELECT key,value FROM agent_state WHERE key IN ('drain_command_id','drain_command_sequence','drain_state')"
            ).fetchall())
        if rows.get("drain_state") not in {"DRAINING", "DRAINED"} or not rows.get("drain_command_id"):
            return None
        try:
            sequence = int(rows.get("drain_command_sequence", "0"))
        except (TypeError, ValueError):
            raise ValueError("Stored drain command is corrupt.") from None
        return {"commandId": rows["drain_command_id"], "sequence": sequence, "state": rows["drain_state"]}

    def set_drain_command(self, command_id: str, sequence: int, state: str) -> None:
        if not command_id or sequence < 1 or state not in {"DRAINING", "DRAINED"}:
            raise ValueError("Drain command state is invalid.")
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("INSERT OR REPLACE INTO agent_state(key,value) VALUES('drain_command_id',?)", (command_id,))
            connection.execute("INSERT OR REPLACE INTO agent_state(key,value) VALUES('drain_command_sequence',?)", (str(sequence),))
            connection.execute("INSERT OR REPLACE INTO agent_state(key,value) VALUES('drain_state',?)", (state,))
            connection.execute("INSERT OR REPLACE INTO agent_state(key,value) VALUES('remote_execution_state',?)", (state,))
            connection.commit()

    def clear_drain_command(self) -> None:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("INSERT OR REPLACE INTO agent_state(key,value) VALUES('drain_state','IDLE')")
            connection.commit()

    def complete_drain_command(self, command_id: str, sequence: int) -> None:
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            last_sequence = self._read_agent_state(connection, "last_processed_command_sequence", 0)
            local_command = connection.execute(
                "SELECT status FROM agent_commands WHERE command_id=? AND sequence=?", (command_id, sequence),
            ).fetchone()
            if sequence != last_sequence + 1 or local_command is None or local_command["status"] not in {"ACKED", "RUNNING"}:
                connection.rollback()
                raise ValueError("Drain command completion is not contiguous or durable.")
            now = utc_iso()
            connection.execute("UPDATE agent_commands SET status='SUCCESS',completed_at=? WHERE command_id=?", (now, command_id))
            for key, value in (("drain_state", "DRAINED"), ("remote_execution_state", "DRAINED"),
                               ("last_processed_command_sequence", str(sequence))):
                connection.execute("INSERT OR REPLACE INTO agent_state(key,value) VALUES(?,?)", (key, value))
            connection.commit()

    def drain_outbox_count(self) -> int:
        return int(self.drain_outbox_counts()["total"])

    def drain_outbox_counts(self) -> dict[str, int]:
        with self._connection() as connection:
            counts = {
                "results": int(connection.execute("SELECT COUNT(*) FROM pending_results WHERE result_id NOT IN (SELECT result_id FROM outbox_quarantine)").fetchone()[0]),
                "products": int(connection.execute("SELECT COUNT(*) FROM pending_products WHERE result_id NOT IN (SELECT result_id FROM outbox_quarantine)").fetchone()[0]),
                "telemetry": int(connection.execute("SELECT COUNT(*) FROM telemetry_spool").fetchone()[0]),
                "cancelIntents": int(connection.execute("SELECT COUNT(*) FROM cancel_intents").fetchone()[0]),
                "quarantined": int(connection.execute("SELECT COUNT(*) FROM outbox_quarantine").fetchone()[0]),
            }
        # Quarantined records retain their payload and have not been ACKed by
        # the server; they must continue to block a lossless DRAIN.
        counts["total"] = (counts["results"] + counts["products"] + counts["telemetry"]
                           + counts["cancelIntents"] + counts["quarantined"])
        return counts

    def agent_update_journal(self) -> dict[str, str] | None:
        with self._connection() as connection:
            rows = dict(connection.execute(
                "SELECT key,value FROM agent_state WHERE key GLOB 'update_journal_*'"
            ).fetchall())
        prefix = "update_journal_"
        journal = {key[len(prefix):]: value for key, value in rows.items()}
        return journal or None

    def backup_agent_database(self, command_id: str, backup_directory: Path) -> dict[str, str]:
        if not command_id or any(character not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-" for character in command_id):
            raise ValueError("Agent update backup command ID is invalid.")
        expected_directory = (self.path.parent / "agent-update-backups" / command_id).resolve()
        if backup_directory.resolve() != expected_directory:
            raise ValueError("Agent update database backup must use its command-scoped data directory.")
        destination = backup_directory / "agent.sqlite3"
        destination.parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as source:
            backup = sqlite3.connect(destination)
            try:
                source.backup(backup)
                if backup.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                    raise sqlite3.DatabaseError("Agent update database backup failed integrity verification.")
            finally:
                backup.close()
        digest = _sha256_file(destination)
        return {"databaseBackupPath": str(destination.resolve()), "databaseBackupSha256": digest}

    def restore_agent_update_database(self, command_id: str, backup_path: Path, expected_sha256: str) -> None:
        if (not command_id or any(character not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-" for character in command_id)
                or len(expected_sha256) != 64 or any(character not in "0123456789abcdef" for character in expected_sha256)):
            raise ValueError("Agent rollback backup identity is invalid.")
        backup = backup_path.resolve()
        backup_root = (self.path.parent / "agent-update-backups" / command_id).resolve()
        if backup.parent != backup_root or backup.name != "agent.sqlite3" or not backup.is_file():
            raise ValueError("Agent rollback database backup is outside its command-scoped directory.")
        digest = _sha256_file(backup)
        if digest != expected_sha256:
            raise ValueError("Agent rollback database backup checksum mismatch.")

        temporary_path = backup_root / f"agent.sqlite3.restore-{uuid.uuid4().hex}.part"
        failed_current_path = backup_root / f"agent.sqlite3.failed-current-{uuid.uuid4().hex}"
        current = sqlite3.connect(self.path, timeout=30)
        current.row_factory = sqlite3.Row
        try:
            checkpoint = current.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
            if checkpoint is not None and int(checkpoint[0]) != 0:
                raise sqlite3.OperationalError("Agent database is still busy; rollback was not applied.")
            current_commands = [dict(row) for row in current.execute("SELECT * FROM agent_commands").fetchall()]
            current_state = [tuple(row) for row in current.execute("SELECT key,value FROM agent_state").fetchall()]
            backup_connection = sqlite3.connect(backup)
            restored = sqlite3.connect(temporary_path)
            try:
                backup_connection.backup(restored)
                restored.row_factory = sqlite3.Row
                if restored.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                    raise sqlite3.DatabaseError("Agent rollback backup failed integrity verification.")
                backup_columns = {str(row[1]) for row in restored.execute("PRAGMA table_info(agent_commands)")}
                required_columns = {"command_id", "sequence", "command_type", "status"}
                if not required_columns.issubset(backup_columns):
                    raise sqlite3.DatabaseError("Agent rollback snapshot lacks the stable command identity fields.")
                for row in current_commands:
                    columns = [name for name in row if name in backup_columns]
                    placeholders = ",".join("?" for _ in columns)
                    names = ",".join(f'"{name}"' for name in columns)
                    restored.execute(f"INSERT OR REPLACE INTO agent_commands({names}) VALUES ({placeholders})",
                        [row[name] for name in columns])
                for key, value in current_state:
                    restored.execute("INSERT OR REPLACE INTO agent_state(key,value) VALUES(?,?)", (key, value))
                restored.commit()
                if restored.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                    raise sqlite3.DatabaseError("Restored Agent database failed integrity verification.")
            finally:
                backup_connection.close()
                restored.close()

            failed_snapshot = sqlite3.connect(failed_current_path)
            try:
                current.backup(failed_snapshot)
            finally:
                failed_snapshot.close()
            current.close()
            for suffix in ("-wal", "-shm"):
                sidecar = Path(str(self.path) + suffix)
                if sidecar.exists():
                    sidecar.unlink()
            os.replace(self.path, failed_current_path.with_suffix(".pre-restore"))
            try:
                os.replace(temporary_path, self.path)
            except OSError:
                os.replace(failed_current_path.with_suffix(".pre-restore"), self.path)
                raise
        except Exception:
            if current:
                current.close()
            if temporary_path.exists():
                temporary_path.unlink()
            raise

    def save_agent_update_journal(self, journal: dict[str, str]) -> None:
        allowed = {"commandId", "targetVersion", "previousVersion", "stage", "clientId", "selfTestStatus",
            "backupDirectory", "installManifestPath", "installManifestSha256", "databaseBackupPath", "databaseBackupSha256"}
        if (set(journal) != allowed or any(not isinstance(value, str) or not value for value in journal.values())
                or journal.get("stage") not in {"INSTALLING", "ACKED", "FAILED", "ROLLBACK_INSTALLING", "ROLLED_BACK"}
                or journal.get("selfTestStatus") not in {"PENDING", "PASS", "FAIL"}):
            raise ValueError("Agent update journal is malformed.")
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute("DELETE FROM agent_state WHERE key GLOB 'update_journal_*'")
            connection.executemany(
                "INSERT INTO agent_state(key,value) VALUES(?,?)",
                [(f"update_journal_{key}", value) for key, value in journal.items()],
            )
            connection.commit()

    def server_command_status(self, command_id: str) -> str | None:
        with self._connection() as connection:
            row = connection.execute("SELECT status FROM agent_commands WHERE command_id=?", (command_id,)).fetchone()
        return str(row["status"]) if row else None

    def agent_runtime_config(self) -> tuple[int, dict[str, Any] | None]:
        with self._connection() as connection:
            rows = dict(connection.execute(
                "SELECT key,value FROM agent_state WHERE key IN ('agent_runtime_config_version','agent_runtime_config')"
            ).fetchall())
        try:
            version = max(0, int(rows.get("agent_runtime_config_version", "0")))
            value = json.loads(rows["agent_runtime_config"]) if "agent_runtime_config" in rows else None
        except (TypeError, ValueError, json.JSONDecodeError):
            raise ValueError("Stored agent runtime configuration is corrupt.") from None
        if value is not None and not isinstance(value, dict):
            raise ValueError("Stored agent runtime configuration is corrupt.")
        return version, value

    def save_agent_runtime_config(self, version: int, config: dict[str, Any]) -> None:
        if version < 1:
            raise ValueError("Agent config version must be positive.")
        encoded = json.dumps(config, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        with self._connection() as connection:
            connection.execute("BEGIN IMMEDIATE")
            current = int(self._read_agent_state(connection, "agent_runtime_config_version", 0))
            if version < current:
                raise ValueError("Agent config version cannot move backwards.")
            connection.execute("INSERT OR REPLACE INTO agent_state(key,value) VALUES('agent_runtime_config',?)", (encoded,))
            connection.execute("INSERT OR REPLACE INTO agent_state(key,value) VALUES('agent_runtime_config_version',?)", (str(version),))
            connection.commit()

    def server_command_history(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT command_id,sequence,command_type,status,created_at,acknowledged_at,started_at,completed_at,error FROM agent_commands ORDER BY sequence DESC LIMIT ?",
                (max(1, min(200, int(limit))),),
            ).fetchall()
        return [dict(row) for row in reversed(rows)]

    @staticmethod
    def _read_agent_state(connection: sqlite3.Connection, key: str, default: int) -> int:
        row = connection.execute("SELECT value FROM agent_state WHERE key=?", (key,)).fetchone()
        try:
            return max(0, int(row["value"])) if row else default
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _spool(connection, table: str, task_id: str, lease_id: str, checksum: str, payload: dict[str, Any], product_key: str | None = None) -> None:
        connection.execute("INSERT OR IGNORE INTO " + table +
            "(result_id,task_id,lease_id,checksum,payload_json,created_at,updated_at" +
            (",product_key" if product_key is not None else "") + ") VALUES (?,?,?,?,?,?,?" +
            (",?" if product_key is not None else "") + ")",
            (uuid.uuid4().hex, task_id, lease_id, checksum, json.dumps(payload, ensure_ascii=False), utc_iso(), utc_iso()) +
            ((product_key,) if product_key is not None else ()))
        row = connection.execute("SELECT result_id,task_id,lease_id,checksum,payload_json FROM " + table +
            " WHERE task_id=? AND lease_id=?" + (" AND product_key=?" if product_key is not None else ""),
            (task_id, lease_id) + ((product_key,) if product_key is not None else ())).fetchone()
        if row is None or row["checksum"] != checksum or payload_checksum(json.loads(row["payload_json"])) != payload_checksum(payload):
            raise ValueError("Outbox content conflict for an existing attempt")
        reason = blocked_reason(connection, task_id, lease_id, row_job_id(connection, row))
        if reason:
            quarantine_row(connection, row["result_id"], reason)

    def pending_results(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                "SELECT result_id, task_id, lease_id, checksum, payload_json, attempts FROM pending_results WHERE result_id NOT IN (SELECT result_id FROM outbox_quarantine) ORDER BY created_at, rowid LIMIT ?",
                (limit,),
            ).fetchall()
        return [
            {
                "resultId": row["result_id"], "taskId": row["task_id"], "leaseId": row["lease_id"], "checksum": row["checksum"],
                "payload": json.loads(row["payload_json"]), "attempts": row["attempts"],
            }
            for row in rows
        ]

    def upload_counts(self) -> dict[str, int]:
        """Count the entire spool without decoding potentially large product payloads."""
        with self._connection() as connection:
            return {
                "products": int(connection.execute("SELECT COUNT(*) FROM pending_products").fetchone()[0]),
                "results": int(connection.execute("SELECT COUNT(*) FROM pending_results").fetchone()[0]),
            }

    def dashboard_upload_counts(self) -> dict[str, int]:
        """Separate deliverable uploads from retained quarantine records for operator display."""
        with self._connection() as connection:
            return {
                "products": int(connection.execute(
                    "SELECT COUNT(*) FROM pending_products WHERE result_id NOT IN (SELECT result_id FROM outbox_quarantine)"
                ).fetchone()[0]),
                "results": int(connection.execute(
                    "SELECT COUNT(*) FROM pending_results WHERE result_id NOT IN (SELECT result_id FROM outbox_quarantine)"
                ).fetchone()[0]),
                "quarantined": int(connection.execute("SELECT COUNT(*) FROM outbox_quarantine").fetchone()[0]),
            }

    def dashboard_local_tasks(self) -> list[dict[str, Any]]:
        """Small lease metadata used to reconcile the local dashboard at startup."""
        with self._connection() as connection:
            rows = connection.execute("SELECT payload_json, status FROM leases").fetchall()
        return [{"assignment": json.loads(row["payload_json"]), "status": row["status"]} for row in rows]

    def spool_product(
        self,
        *,
        task_id: str,
        product_key: str,
        lease_id: str,
        checksum: str,
        payload: dict[str, Any],
    ) -> None:
        if self.storage_fault:
            raise OSError("Outbox storage failure requires operator recovery before accepting new products")
        with self._connection() as connection:
            self._spool(connection, "pending_products", task_id, lease_id, checksum, payload, product_key)
            connection.commit()

    def pending_products(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._connection() as connection:
            rows = connection.execute(
                """SELECT result_id, task_id, product_key, lease_id, checksum, payload_json, attempts
                   FROM pending_products WHERE result_id NOT IN (SELECT result_id FROM outbox_quarantine) ORDER BY created_at, rowid LIMIT ?""",
                (limit,),
            ).fetchall()
        return [
            {
                "resultId": row["result_id"],
                "taskId": row["task_id"],
                "productKey": row["product_key"],
                "leaseId": row["lease_id"],
                "checksum": row["checksum"],
                "payload": json.loads(row["payload_json"]),
                "attempts": row["attempts"],
            }
            for row in rows
        ]

    def acknowledge_product(self, result_id: str) -> None:
        with self._connection() as connection:
            connection.execute(
                "DELETE FROM pending_products WHERE result_id=? AND result_id NOT IN (SELECT result_id FROM outbox_quarantine)",
                (result_id,),
            )
            connection.commit()

    def has_pending_products(self, task_id: str, lease_id: str | None = None) -> bool:
        with self._connection() as connection:
            row = connection.execute(
                "SELECT 1 FROM pending_products WHERE task_id=?" + (" AND lease_id=?" if lease_id is not None else "") + " LIMIT 1",
                (task_id, lease_id) if lease_id is not None else (task_id,),
            ).fetchone()
        return row is not None

    def has_uploadable_products(self, task_id: str, lease_id: str | None = None) -> bool:
        with self._connection() as connection:
            row = connection.execute(
                """SELECT 1 FROM pending_products
                   WHERE task_id=?"""
                + (" AND lease_id=?" if lease_id is not None else "")
                + " AND result_id NOT IN (SELECT result_id FROM outbox_quarantine) LIMIT 1",
                (task_id, lease_id) if lease_id is not None else (task_id,),
            ).fetchone()
        return row is not None

    def product_failed(self, result_id: str, error: str) -> None:
        with self._connection() as connection:
            connection.execute(
                """UPDATE pending_products
                   SET attempts=attempts+1, last_error=?, updated_at=?
                   WHERE result_id=?""",
                (error[:2000], utc_iso(), result_id),
            )
            connection.commit()

    def acknowledge_result(self, result_id: str) -> None:
        with self._connection() as connection:
            connection.execute("DELETE FROM leases WHERE EXISTS (SELECT 1 FROM pending_results r WHERE r.result_id=? AND r.task_id=leases.task_id AND r.lease_id=leases.lease_id AND r.result_id NOT IN (SELECT result_id FROM outbox_quarantine))", (result_id,))
            connection.execute("DELETE FROM pending_results WHERE result_id=? AND result_id NOT IN (SELECT result_id FROM outbox_quarantine)", (result_id,))
            connection.commit()

    def result_failed(self, result_id: str, error: str) -> None:
        with self._connection() as connection:
            connection.execute(
                "UPDATE pending_results SET attempts=attempts+1, last_error=?, updated_at=? WHERE result_id=?",
                (error[:2000], utc_iso(), result_id),
            )
            connection.commit()

    def quarantine_attempt(self, task_id: str, lease_id: str, reason: str) -> None:
        with self._connection() as connection:
            block_attempt(connection, task_id, lease_id, reason)

    def is_upload_pending(self, result_id: str) -> bool:
        with self._connection() as connection:
            return connection.execute("SELECT 1 FROM (SELECT result_id FROM pending_results UNION ALL SELECT result_id FROM pending_products) WHERE result_id=? AND result_id NOT IN (SELECT result_id FROM outbox_quarantine)", (result_id,)).fetchone() is not None

    def quarantined_uploads(self) -> list[dict[str, str]]:
        """Metadata only; never expose retained product payloads in diagnostics."""
        with self._connection() as connection:
            return [dict(row) for row in connection.execute("SELECT result_id AS resultId,reason,created_at AS createdAt FROM outbox_quarantine ORDER BY created_at,result_id")]

    def outbox_usage(self) -> dict[str, Any]:
        """Count retained payload bytes (including quarantine), without decoding."""
        with self._connection() as connection:
            row = connection.execute("""SELECT COUNT(*) AS records,
                COALESCE(SUM(length(CAST(payload_json AS BLOB))),0) AS bytes,
                MIN(created_at) AS oldest FROM (
                    SELECT payload_json,created_at FROM pending_results UNION ALL
                    SELECT payload_json,created_at FROM pending_products)""").fetchone()
            return dict(row)
