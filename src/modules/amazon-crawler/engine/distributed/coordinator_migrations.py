"""Additive, versioned Coordinator schema initialization."""

import json

from sqlalchemy import Column, Index, Integer, MetaData, Table, inspect, select, text

from .coordinator_models import (
    AmazonAsinRegistry,
    ArchivedTaskAttempt,
    Base,
    ClientRecord,
    CoordinatorState,
    CrawlJob,
    CrawlTask,
    CrawlerDlqAction,
    EtsyListingRegistry,
    EtsyOAuthCredential,
    TaskAttempt,
    UploadReceipt,
)
from .operator_authorization import OperatorAudit
from .agent_keys import AgentKey
from .agent_identity import AgentEnrollment
from .agent_assets import AgentAssetNamespace
from .agent_command_ledger import AgentCommand, AgentCommandEvent
from .global_admission_gate import GlobalAdmissionGate, GlobalAdmissionGateEvent, GLOBAL_ADMISSION_GATE_ID
from . import image_profile_repository  # Register profile tables before creating metadata.
from .fleet_circuit_breaker import STATE_KEY as FLEET_BREAKER_STATE_KEY, _default_state as default_fleet_breaker_state

MIGRATION_VERSION = 17
MIGRATIONS = Table("crawler_schema_migrations", MetaData(), Column("version", Integer, primary_key=True))


def _rebuild_sqlite_crawl_tasks_nullable_asin(connection) -> None:
    connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
    try:
        connection.exec_driver_sql(
            """
            CREATE TABLE crawl_tasks_v17 (
                id VARCHAR(40) NOT NULL PRIMARY KEY,
                job_id VARCHAR(40) NOT NULL REFERENCES crawl_jobs (id) ON DELETE CASCADE,
                ordinal INTEGER NOT NULL,
                source TEXT NOT NULL,
                source_platform VARCHAR(24) NOT NULL DEFAULT 'amazon',
                source_product_id VARCHAR(120),
                asin VARCHAR(10),
                canonical_url TEXT NOT NULL,
                status VARCHAR(32) NOT NULL,
                failure_count INTEGER NOT NULL DEFAULT 0,
                max_retry INTEGER NOT NULL DEFAULT 3,
                next_retry_at TIMESTAMP WITH TIME ZONE,
                requeue_count INTEGER NOT NULL DEFAULT 0,
                assigned_client_id VARCHAR(64) REFERENCES crawler_clients (id),
                lease_id VARCHAR(40),
                lease_expires_at TIMESTAMP WITH TIME ZONE,
                last_error JSON,
                created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                started_at TIMESTAMP WITH TIME ZONE,
                completed_at TIMESTAMP WITH TIME ZONE,
                CONSTRAINT uq_crawl_task_job_asin UNIQUE (job_id, asin),
                CONSTRAINT uq_crawl_task_job_source_product UNIQUE (job_id, source_platform, source_product_id)
            )
            """
        )
        existing_columns = {
            str(row[1])
            for row in connection.exec_driver_sql("PRAGMA table_info('crawl_tasks')").fetchall()
        }
        columns = [
            col
            for col in (
                "id",
                "job_id",
                "ordinal",
                "source",
                "source_platform",
                "source_product_id",
                "asin",
                "canonical_url",
                "status",
                "failure_count",
                "max_retry",
                "next_retry_at",
                "requeue_count",
                "assigned_client_id",
                "lease_id",
                "lease_expires_at",
                "last_error",
                "created_at",
                "started_at",
                "completed_at",
            )
            if col in existing_columns
        ]
        column_csv = ", ".join(columns)
        connection.exec_driver_sql(
            f"INSERT INTO crawl_tasks_v17 ({column_csv}) SELECT {column_csv} FROM crawl_tasks"
        )
        connection.exec_driver_sql("DROP TABLE crawl_tasks")
        connection.exec_driver_sql("ALTER TABLE crawl_tasks_v17 RENAME TO crawl_tasks")
    finally:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")


def migrate_coordinator(engine) -> None:
    if engine.dialect.name != "sqlite":
        with engine.begin() as connection:
            _migrate_coordinator_connection(engine, connection)
        return
    # SQLite ignores foreign_keys changes inside a transaction. Disable it
    # before BEGIN so rebuilding the parent table cannot cascade-delete results.
    with engine.connect() as connection:
        foreign_keys = connection.exec_driver_sql("PRAGMA foreign_keys").scalar()
        connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
        connection.commit()
        try:
            with connection.begin():
                _migrate_coordinator_connection(engine, connection)
                if connection.exec_driver_sql("PRAGMA foreign_key_check").first() is not None:
                    raise RuntimeError("Coordinator migration left invalid foreign keys")
        finally:
            connection.rollback()
            connection.exec_driver_sql(f"PRAGMA foreign_keys={1 if foreign_keys else 0}")
            connection.commit()


def _migrate_coordinator_connection(engine, connection) -> None:
    if engine.dialect.name == "postgresql":
        connection.execute(text("SELECT pg_advisory_xact_lock(821773411)"))
    MIGRATIONS.create(connection, checkfirst=True)
    versions = set(connection.scalars(select(MIGRATIONS.c.version)))
    if any(version > MIGRATION_VERSION for version in versions):
        raise RuntimeError("Coordinator database requires a newer server version.")
    if 1 not in versions:
        Base.metadata.create_all(connection)
        connection.execute(MIGRATIONS.insert().values(version=1))
    if 2 not in versions:
        UploadReceipt.__table__.create(connection, checkfirst=True)
        connection.execute(MIGRATIONS.insert().values(version=2))
    if 3 not in versions:
        OperatorAudit.__table__.create(connection, checkfirst=True)
        connection.execute(MIGRATIONS.insert().values(version=3))
    if 4 not in versions:
        AgentKey.__table__.create(connection, checkfirst=True)
        connection.execute(MIGRATIONS.insert().values(version=4))
    if 5 not in versions:
        AgentEnrollment.__table__.create(connection, checkfirst=True)
        connection.execute(MIGRATIONS.insert().values(version=5))
    if 6 not in versions:
        AgentAssetNamespace.__table__.create(connection, checkfirst=True)
        connection.execute(MIGRATIONS.insert().values(version=6))
    if 7 not in versions:
        columns = {column["name"] for column in inspect(connection).get_columns("crawler_clients")}
        additions = {
            "desired_execution_state": "VARCHAR(16) NOT NULL DEFAULT 'RUNNING'",
            "applied_execution_state": "VARCHAR(16) NOT NULL DEFAULT 'RUNNING'",
            "command_sequence": "INTEGER NOT NULL DEFAULT 0",
            "last_processed_command_sequence": "INTEGER NOT NULL DEFAULT 0",
        }
        for name, definition in additions.items():
            if name not in columns:
                connection.execute(text(f"ALTER TABLE crawler_clients ADD COLUMN {name} {definition}"))
        AgentCommand.__table__.create(connection, checkfirst=True)
        AgentCommandEvent.__table__.create(connection, checkfirst=True)
        connection.execute(MIGRATIONS.insert().values(version=7))
        versions.add(7)
    if 8 not in versions:
        GlobalAdmissionGate.__table__.create(connection, checkfirst=True)
        GlobalAdmissionGateEvent.__table__.create(connection, checkfirst=True)
        gate_exists = connection.scalar(
            select(GlobalAdmissionGate.id).where(GlobalAdmissionGate.id == GLOBAL_ADMISSION_GATE_ID)
        )
        if gate_exists is None:
            connection.execute(GlobalAdmissionGate.__table__.insert().values(
                id=GLOBAL_ADMISSION_GATE_ID, state="OPEN", scope="crawler", revision=0,
            ))
        connection.execute(MIGRATIONS.insert().values(version=8))
        versions.add(8)
    if 9 not in versions:
        columns = {column["name"] for column in inspect(connection).get_columns("crawler_clients")}
        additions = {
            "global_admission_gate_revision": "INTEGER NOT NULL DEFAULT 0",
            "global_admission_gate_state": "VARCHAR(16) NOT NULL DEFAULT 'OPEN'",
        }
        for name, definition in additions.items():
            if name not in columns:
                connection.execute(text(f"ALTER TABLE crawler_clients ADD COLUMN {name} {definition}"))
        connection.execute(MIGRATIONS.insert().values(version=9))
        versions.add(9)
    if 10 not in versions:
        client_columns = {column["name"] for column in inspect(connection).get_columns("crawler_clients")}
        client_additions = {
            "crawler_version": "VARCHAR(64) NOT NULL DEFAULT 'unknown'",
            "parser_version": "VARCHAR(64) NOT NULL DEFAULT 'unknown'",
        }
        for name, definition in client_additions.items():
            if name not in client_columns:
                connection.execute(text(f"ALTER TABLE crawler_clients ADD COLUMN {name} {definition}"))
        task_columns = {column["name"] for column in inspect(connection).get_columns("crawl_tasks")}
        task_additions = {
            "max_retry": "INTEGER NOT NULL DEFAULT 3",
            "next_retry_at": "TIMESTAMP WITH TIME ZONE",
            "requeue_count": "INTEGER NOT NULL DEFAULT 0",
        }
        for name, definition in task_additions.items():
            if name not in task_columns:
                connection.execute(text(f"ALTER TABLE crawl_tasks ADD COLUMN {name} {definition}"))
        existing_indexes = {index["name"] for index in inspect(connection).get_indexes("crawl_tasks")}
        if "ix_crawl_tasks_next_retry_at" not in existing_indexes:
            Index("ix_crawl_tasks_next_retry_at", CrawlTask.next_retry_at).create(connection)
        attempt_columns = {column["name"] for column in inspect(connection).get_columns("task_attempts")}
        attempt_additions = {
            "error_code": "VARCHAR(40)",
            "error_message": "TEXT",
            "agent_version": "VARCHAR(64) NOT NULL DEFAULT 'unknown'",
            "crawler_version": "VARCHAR(64) NOT NULL DEFAULT 'unknown'",
            "parser_version": "VARCHAR(64) NOT NULL DEFAULT 'unknown'",
            "duration_ms": "INTEGER",
            "result_checksum": "VARCHAR(64)",
            "started_at": "TIMESTAMP WITH TIME ZONE",
        }
        for name, definition in attempt_additions.items():
            if name not in attempt_columns:
                connection.execute(text(f"ALTER TABLE task_attempts ADD COLUMN {name} {definition}"))
        connection.execute(text("UPDATE task_attempts SET started_at = leased_at WHERE started_at IS NULL"))
        connection.execute(text("UPDATE crawl_tasks SET status = 'dead_letter' WHERE status = 'failed'"))
        ArchivedTaskAttempt.__table__.create(connection, checkfirst=True)
        CrawlerDlqAction.__table__.create(connection, checkfirst=True)
        connection.execute(MIGRATIONS.insert().values(version=10))
        versions.add(10)
    if 11 not in versions:
        for table_name, index_name, column in (
            ("task_attempts", "ix_task_attempts_finished_at", TaskAttempt.finished_at),
            ("archived_task_attempts", "ix_archived_task_attempts_archived_at", ArchivedTaskAttempt.archived_at),
        ):
            existing_indexes = {index["name"] for index in inspect(connection).get_indexes(table_name)}
            if index_name not in existing_indexes:
                Index(index_name, column).create(connection)
        connection.execute(MIGRATIONS.insert().values(version=11))
        versions.add(11)
    if 12 not in versions:
        columns = {column["name"] for column in inspect(connection).get_columns("crawler_clients")}
        additions = {
            "desired_agent_config": "JSON NOT NULL DEFAULT '{}'",
            "applied_agent_config": "JSON NOT NULL DEFAULT '{}'",
            "desired_config_version": "INTEGER NOT NULL DEFAULT 0",
            "applied_config_version": "INTEGER NOT NULL DEFAULT 0",
        }
        for name, definition in additions.items():
            if name not in columns:
                connection.execute(text(f"ALTER TABLE crawler_clients ADD COLUMN {name} {definition}"))
        connection.execute(MIGRATIONS.insert().values(version=12))
        versions.add(12)
    if 13 not in versions:
        client_columns = {column["name"] for column in inspect(connection).get_columns("crawler_clients")}
        key_columns = {column["name"] for column in inspect(connection).get_columns("crawler_agent_keys")}
        if "agent_group" not in client_columns:
            connection.execute(text("ALTER TABLE crawler_clients ADD COLUMN agent_group VARCHAR(80) NOT NULL DEFAULT 'default'"))
        if "agent_group" not in key_columns:
            connection.execute(text("ALTER TABLE crawler_agent_keys ADD COLUMN agent_group VARCHAR(80) NOT NULL DEFAULT 'default'"))
        existing_indexes = {index["name"] for index in inspect(connection).get_indexes("crawler_clients")}
        if "ix_crawler_clients_agent_group" not in existing_indexes:
            Index("ix_crawler_clients_agent_group", ClientRecord.agent_group).create(connection)
        connection.execute(MIGRATIONS.insert().values(version=13))
        versions.add(13)
    if 14 not in versions:
        if connection.scalar(select(CoordinatorState.key).where(CoordinatorState.key == FLEET_BREAKER_STATE_KEY)) is None:
            connection.execute(CoordinatorState.__table__.insert().values(
                key=FLEET_BREAKER_STATE_KEY, value=json.dumps(default_fleet_breaker_state()),
            ))
        connection.execute(MIGRATIONS.insert().values(version=14))
        versions.add(14)
    if 15 not in versions:
        AmazonAsinRegistry.__table__.create(connection, checkfirst=True)
        connection.execute(MIGRATIONS.insert().values(version=15))
        versions.add(15)
    if 16 not in versions:
        columns = {column["name"] for column in inspect(connection).get_columns("crawl_jobs")}
        if "archived_at" not in columns:
            connection.execute(text("ALTER TABLE crawl_jobs ADD COLUMN archived_at TIMESTAMP WITH TIME ZONE"))
        existing_indexes = {index["name"] for index in inspect(connection).get_indexes("crawl_jobs")}
        if "ix_crawl_jobs_archived_at" not in existing_indexes:
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_crawl_jobs_archived_at ON crawl_jobs (archived_at)"))
        connection.execute(MIGRATIONS.insert().values(version=16))
        versions.add(16)
    if 17 not in versions:
        task_columns_info = {column["name"]: column for column in inspect(connection).get_columns("crawl_tasks")}
        if "source_platform" not in task_columns_info:
            connection.execute(
                text("ALTER TABLE crawl_tasks ADD COLUMN source_platform VARCHAR(24) NOT NULL DEFAULT 'amazon'")
            )
        if "source_product_id" not in task_columns_info:
            connection.execute(text("ALTER TABLE crawl_tasks ADD COLUMN source_product_id VARCHAR(120)"))
        connection.execute(
            text(
                "UPDATE crawl_tasks SET source_product_id = asin "
                "WHERE source_product_id IS NULL AND asin IS NOT NULL"
            )
        )
        asin_col = inspect(connection).get_columns("crawl_tasks")
        asin_nullable = next((bool(col.get("nullable")) for col in asin_col if col["name"] == "asin"), True)
        if not asin_nullable:
            if engine.dialect.name == "postgresql":
                connection.execute(text("ALTER TABLE crawl_tasks ALTER COLUMN asin DROP NOT NULL"))
            elif engine.dialect.name == "sqlite":
                _rebuild_sqlite_crawl_tasks_nullable_asin(connection)
        existing_task_indexes = {index["name"] for index in inspect(connection).get_indexes("crawl_tasks")}
        existing_task_uniques = {
            constraint["name"] for constraint in inspect(connection).get_unique_constraints("crawl_tasks")
            if constraint.get("name")
        }
        for index in CrawlTask.__table__.indexes:
            if index.name and index.name not in existing_task_indexes:
                index.create(connection, checkfirst=True)
        if (
            "uq_crawl_task_job_source_product" not in existing_task_uniques
            and "uq_crawl_task_job_source_product" not in existing_task_indexes
        ):
            connection.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_crawl_task_job_source_product "
                    "ON crawl_tasks (job_id, source_platform, source_product_id)"
                )
            )
        EtsyListingRegistry.__table__.create(connection, checkfirst=True)
        EtsyOAuthCredential.__table__.create(connection, checkfirst=True)
        connection.execute(MIGRATIONS.insert().values(version=17))
        versions.add(17)
