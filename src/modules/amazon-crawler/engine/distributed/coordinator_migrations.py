"""Additive, versioned Coordinator schema initialization."""

from sqlalchemy import Column, Integer, MetaData, Table, inspect, select, text

from .coordinator_models import Base, UploadReceipt
from .operator_authorization import OperatorAudit
from .agent_keys import AgentKey
from .agent_identity import AgentEnrollment
from .agent_assets import AgentAssetNamespace
from .agent_command_ledger import AgentCommand, AgentCommandEvent
from .global_admission_gate import GlobalAdmissionGate, GlobalAdmissionGateEvent, GLOBAL_ADMISSION_GATE_ID
from . import image_profile_repository  # Register profile tables before creating metadata.

MIGRATION_VERSION = 9
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
