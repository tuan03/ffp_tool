"""Additive, versioned Coordinator schema initialization."""

from sqlalchemy import Column, Integer, MetaData, Table, select, text

from .coordinator_models import Base
from . import image_profile_repository  # Register profile tables before creating metadata.

MIGRATION_VERSION = 1
MIGRATIONS = Table("crawler_schema_migrations", MetaData(), Column("version", Integer, primary_key=True))


def migrate_coordinator(engine) -> None:
    with engine.begin() as connection:
        if engine.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(821773411)"))
        MIGRATIONS.create(connection, checkfirst=True)
        versions = set(connection.scalars(select(MIGRATIONS.c.version)))
        if any(version > MIGRATION_VERSION for version in versions):
            raise RuntimeError("Coordinator database requires a newer server version.")
        if MIGRATION_VERSION not in versions:
            Base.metadata.create_all(connection)
            connection.execute(MIGRATIONS.insert().values(version=MIGRATION_VERSION))
