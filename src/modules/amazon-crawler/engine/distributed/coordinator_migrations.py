"""Additive, versioned Coordinator schema initialization."""

import json

from sqlalchemy import Column, Index, Integer, MetaData, Table, inspect, select, text

from .coordinator_models import ArchivedTaskAttempt, Base, ClientRecord, CoordinatorState, CrawlTask, CrawlerDlqAction, TaskAttempt, UploadReceipt
from .operator_authorization import OperatorAudit
from .agent_keys import AgentKey
from .agent_identity import AgentEnrollment
from .agent_assets import AgentAssetNamespace
from .agent_command_ledger import AgentCommand, AgentCommandEvent
from .global_admission_gate import GlobalAdmissionGate, GlobalAdmissionGateEvent, GLOBAL_ADMISSION_GATE_ID
from . import image_profile_repository  # Register profile tables before creating metadata.
from .fleet_circuit_breaker import STATE_KEY as FLEET_BREAKER_STATE_KEY, _default_state as default_fleet_breaker_state

MIGRATION_VERSION = 14
MIGRATIONS = Table("crawler_schema_migrations", MetaData(), Column("version", Integer, primary_key=True))


def migrate_coordinator(engine) -> None:
    with engine.begin() as connection:
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
