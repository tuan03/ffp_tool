"""Versioned, lossless migration of the agent's local upload spool."""
from contextlib import closing
from pathlib import Path
import sqlite3
import uuid


def _create_outbox(connection, table: str) -> None:
    product = table == "pending_products"
    connection.execute(f"""CREATE TABLE {table} (
        result_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        {"product_key TEXT NOT NULL," if product else ""}
        lease_id TEXT NOT NULL,
        checksum TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(task_id, lease_id{", product_key" if product else ""})
    )""")


def _backup(path: Path) -> None:
    target = path.with_name(f"{path.name}.pre-outbox-v1-{uuid.uuid4().hex}.bak")
    partial = target.with_suffix(".bak.part")
    # A separate reader includes committed WAL data. The migration writer holds
    # BEGIN IMMEDIATE, so no other writer can change the pre-migration snapshot.
    with closing(sqlite3.connect(path)) as source, closing(sqlite3.connect(partial)) as backup:
        source.backup(backup)
        if backup.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise RuntimeError("Outbox backup integrity check failed")
    partial.rename(target)


def migrate_outbox(connection: sqlite3.Connection, path: Path) -> None:
    connection.execute("BEGIN IMMEDIATE")
    version = connection.execute("PRAGMA user_version").fetchone()[0]
    if version > 1:
        raise RuntimeError("Agent database requires a newer agent version")
    if version == 1:
        return
    tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    legacy = [table for table in ("pending_results", "pending_products") if table in tables]
    if legacy:
        _backup(path)
    for table in ("pending_results", "pending_products"):
        if table in legacy:
            connection.execute(f"ALTER TABLE {table} RENAME TO {table}_legacy_task06")
        _create_outbox(connection, table)
        if table in legacy:
            columns = "task_id," + ("product_key," if table == "pending_products" else "") + "lease_id,checksum,payload_json,attempts,last_error,created_at,updated_at"
            rows = connection.execute(f"SELECT {columns} FROM {table}_legacy_task06").fetchall()
            connection.executemany(
                f"INSERT INTO {table}(result_id,{columns}) VALUES ({','.join('?' for _ in range(len(columns.split(',')) + 1))})",
                [(uuid.uuid4().hex, *row) for row in rows],
            )
            connection.execute(f"DROP TABLE {table}_legacy_task06")
    connection.execute("PRAGMA user_version=1")
