"""Relational profile metadata; image binaries remain in the runtime volume."""

from copy import deepcopy
from typing import Any

from sqlalchemy import JSON, String, select
from sqlalchemy.orm import Mapped, mapped_column, sessionmaker

from .coordinator_models import Base


class ImageProfileRecord(Base):
    __tablename__ = "crawler_image_profiles"
    slug: Mapped[str] = mapped_column(String(128), primary_key=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)


class ImageProfileRevision(Base):
    __tablename__ = "crawler_image_profile_revisions"
    slug: Mapped[str] = mapped_column(String(128), primary_key=True)
    revision: Mapped[str] = mapped_column(String(16), primary_key=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON)


class ImageProfileRepository:
    def __init__(self, sessions: sessionmaker) -> None:
        self.sessions = sessions

    def slugs(self) -> list[str]:
        with self.sessions() as session:
            return list(session.scalars(select(ImageProfileRecord.slug).order_by(ImageProfileRecord.slug)))

    def read(self, slug: str, revision: str | None = None) -> dict[str, Any] | None:
        with self.sessions() as session:
            row = session.get(ImageProfileRevision, (slug, revision)) if revision else session.get(ImageProfileRecord, slug)
            return deepcopy(row.payload) if row else None

    def write(self, slug: str, payload: dict[str, Any], revision: str | None = None) -> None:
        from sqlalchemy.dialects.postgresql import insert as postgres_insert
        from sqlalchemy.dialects.sqlite import insert as sqlite_insert

        with self.sessions.begin() as session:
            insert = postgres_insert if session.bind.dialect.name == "postgresql" else sqlite_insert
            table = ImageProfileRevision if revision else ImageProfileRecord
            values = {"slug": slug, "payload": deepcopy(payload)}
            if revision:
                values["revision"] = revision
            statement = insert(table).values(**values)
            if revision:
                statement = statement.on_conflict_do_nothing(index_elements=["slug", "revision"])
            else:
                statement = statement.on_conflict_do_update(index_elements=["slug"], set_={"payload": statement.excluded.payload})
            session.execute(statement)

    def delete(self, slug: str) -> None:
        with self.sessions.begin() as session:
            row = session.get(ImageProfileRecord, slug)
            if row:
                session.delete(row)
