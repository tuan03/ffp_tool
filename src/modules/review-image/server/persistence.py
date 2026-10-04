"""Versioned Review Studio state in the shared PostgreSQL database."""
from copy import deepcopy
import time
import uuid

from sqlalchemy import JSON, Column, Integer, MetaData, String, Table, delete, select, text, update

metadata = MetaData()
records = Table("review_studio_records", metadata,
                Column("kind", String(32), primary_key=True),
                Column("key", String(300), primary_key=True), Column("payload", JSON, nullable=False))
versions = Table("review_studio_schema", metadata, Column("version", Integer, primary_key=True))


class ReviewRepository:
    def __init__(self, engine):
        self.engine = engine

    def initialize(self):
        with self.engine.begin() as connection:
            if self.engine.dialect.name == "postgresql":
                connection.execute(text("SELECT pg_advisory_xact_lock(821773412)"))
            metadata.create_all(connection)
            current = list(connection.scalars(select(versions.c.version)))
            if any(version > 1 for version in current):
                raise RuntimeError("Review Studio schema requires a newer server")
            if not current:
                connection.execute(versions.insert().values(version=1))

    def ready(self):
        with self.engine.connect() as connection:
            connection.execute(select(versions.c.version)).one()

    def get(self, kind, key):
        with self.engine.connect() as connection:
            return deepcopy(connection.scalar(select(records.c.payload).where(records.c.kind == kind, records.c.key == key)))

    def all(self, kind):
        with self.engine.connect() as connection:
            return list(connection.scalars(select(records.c.payload).where(records.c.kind == kind)))

    def put(self, kind, key, payload):
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        insert = pg_insert if self.engine.dialect.name == "postgresql" else sqlite_insert
        statement = insert(records).values(kind=kind, key=key, payload=deepcopy(payload))
        with self.engine.begin() as connection:
            connection.execute(statement.on_conflict_do_update(index_elements=["kind", "key"], set_={"payload": statement.excluded.payload}))

    def remove(self, kind, key):
        with self.engine.begin() as connection:
            connection.execute(delete(records).where(records.c.kind == kind, records.c.key == key))

    def recover(self):
        # An external browser/Shopify write may have succeeded before the process died.
        # Never automatically replay such an operation.
        for job in self.all("job"):
            if job["status"] in {"queued", "running"}:
                job.update(status="failed", error="Server restart interrupted this job; inspect ChatGPT before creating another image.", finished_at=time.time())
                self.put("job", job["job_id"], job)
        for upload in self.all("upload"):
            if upload["status"] == "running":
                upload.update(status="uncertain", error="Server restart: verify Shopify Files before retrying.")
                self.put("upload", upload["jobId"], upload)

    def enqueue_upload(self, job_id, store_id, output_name):
        from sqlalchemy.dialects.postgresql import insert as pg_insert
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert
        insert = pg_insert if self.engine.dialect.name == "postgresql" else sqlite_insert
        payload = {"jobId": job_id, "storeId": store_id, "outputName": output_name, "status": "queued"}
        with self.engine.begin() as connection:
            connection.execute(insert(records).values(kind="upload", key=job_id, payload=payload).on_conflict_do_nothing())
            stored = connection.scalar(select(records.c.payload).where(records.c.kind == "upload", records.c.key == job_id))
            if stored["storeId"] != store_id:
                raise ValueError("Upload belongs to another store")
            return stored

    def claim_upload(self):
        with self.engine.begin() as connection:
            candidates = connection.execute(select(records).where(records.c.kind == "upload").with_for_update(skip_locked=True)).mappings()
            for row in candidates:
                payload = dict(row["payload"])
                if payload["status"] == "running" and time.time() - payload.get("claimedAt", 0) > 300:
                    payload.update(status="uncertain", error="Worker acknowledgement expired. Inspect Shopify Files before retrying.")
                    connection.execute(update(records).where(records.c.kind == "upload", records.c.key == row["key"]).values(payload=payload))
                if payload["status"] != "queued":
                    continue
                payload.update(status="running", attemptId=uuid.uuid4().hex, claimedAt=time.time())
                connection.execute(update(records).where(records.c.kind == "upload", records.c.key == row["key"]).values(payload=payload))
                return payload
        return None

    def finish_upload(self, job_id, attempt_id, result=None):
        with self.engine.begin() as connection:
            payload = connection.scalar(select(records.c.payload).where(records.c.kind == "upload", records.c.key == job_id).with_for_update())
            if not payload or payload.get("attemptId") != attempt_id or payload["status"] not in {"running", "completed", "uncertain"}:
                raise ValueError("Stale upload attempt")
            if payload["status"] == "completed":
                return payload
            payload = dict(payload)
            payload.update(status="completed" if result else "uncertain", result=result)
            if not result:
                payload["error"] = "Upload outcome is uncertain. Inspect Shopify Files; automatic retries are disabled."
            connection.execute(update(records).where(records.c.kind == "upload", records.c.key == job_id).values(payload=payload))
            return payload
