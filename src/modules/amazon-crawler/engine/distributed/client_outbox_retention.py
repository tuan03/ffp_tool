"""Durable quarantine without deleting upload payloads or referenced files."""
import json

from .protocol import utc_iso


def quarantine_row(connection, result_id: str, reason: str) -> None:
    connection.execute("INSERT OR IGNORE INTO outbox_quarantine VALUES (?,?,?)", (result_id, reason, utc_iso()))


def block_attempt(connection, task_id: str, lease_id: str, reason: str) -> None:
    connection.execute("INSERT OR IGNORE INTO outbox_blocks VALUES ('task',?,?,?)", (task_id, lease_id, reason))
    for table in ("pending_results", "pending_products"):
        for row in connection.execute(f"SELECT result_id FROM {table} WHERE task_id=? AND lease_id=?", (task_id, lease_id)):
            quarantine_row(connection, row[0], reason)


def row_job_id(connection, row) -> str:
    try:
        payload = json.loads(row["payload_json"])
        job_id = str(payload.get("jobId") or "")
    except (ValueError, TypeError, AttributeError):
        job_id = ""
    if not job_id:
        lease = connection.execute("SELECT job_id FROM leases WHERE task_id=? AND lease_id=?", (row["task_id"], row["lease_id"])).fetchone()
        job_id = str(lease[0]) if lease else ""
    return job_id


def block_job(connection, job_id: str, reason: str) -> None:
    connection.execute("INSERT OR IGNORE INTO outbox_blocks VALUES ('job',?,'',?)", (job_id, reason))
    for table in ("pending_results", "pending_products"):
        for row in connection.execute(f"SELECT * FROM {table}").fetchall():
            if row_job_id(connection, row) == job_id:
                block_attempt(connection, row["task_id"], row["lease_id"], reason)
    for lease in connection.execute("SELECT task_id,lease_id FROM leases WHERE job_id=?", (job_id,)).fetchall():
        block_attempt(connection, lease[0], lease[1], reason)


def blocked_reason(connection, task_id: str, lease_id: str, job_id: str) -> str | None:
    row = connection.execute("""SELECT reason FROM outbox_blocks WHERE
        (scope='task' AND scope_id=? AND lease_id=?) OR (scope='job' AND scope_id=?) LIMIT 1""",
        (task_id, lease_id, job_id)).fetchone()
    return str(row[0]) if row else None
