"""Additive, versioned Coordinator schema initialization."""

from sqlalchemy import Column, Integer, MetaData, Table, select, text

from .coordinator_models import Base, UploadReceipt
from .operator_authorization import OperatorAudit
from .agent_keys import AgentKey
from .agent_identity import AgentEnrollment
from .agent_assets import AgentAssetNamespace
from . import image_profile_repository  # Register profile tables before creating metadata.

MIGRATION_VERSION = 6
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
