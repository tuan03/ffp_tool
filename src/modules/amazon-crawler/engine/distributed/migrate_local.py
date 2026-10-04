"""Explicit offline SQLite import into an empty or equivalent PostgreSQL database.

Run with writers stopped. Dry-run is the default; --apply creates a SQLite
backup first and imports all relational tables in one transaction. Asset files
must already be copied into the target durable runtime volume.
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import MetaData, and_, create_engine, select

from .coordinator_models import Base
from .coordinator_migrations import migrate_coordinator
from .global_admission_gate import GlobalAdmissionGate
from .image_profile_repository import ImageProfileRecord, ImageProfileRevision
from ..image_processing import normalize_profile


def canonical(row):
    def convert(value):
        if isinstance(value, datetime):
            return (value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)).isoformat()
        raise TypeError("Unsupported migration value")
    return json.dumps(dict(row), sort_keys=True, default=convert)


def import_relational_rows(reader, writer):
    """Caller owns the transaction: any conflict must roll back the whole import."""
    source_metadata = MetaData()
    source_metadata.reflect(reader)
    counts = {}
    for table in Base.metadata.sorted_tables:
        old_table = source_metadata.tables.get(table.name)
        if old_table is None:
            continue
        counts[table.name] = 0
        for row in reader.execute(select(old_table)).mappings():
            values = {column.name: row[column.name] for column in table.columns if column.name in row}
            key = and_(*(column == values[column.name] for column in table.primary_key))
            existing = writer.execute(select(table).where(key)).mappings().first()
            if existing is not None:
                if canonical({name: existing[name] for name in values}) != canonical(values):
                    is_pristine_admission_seed = (
                        table.name == GlobalAdmissionGate.__tablename__
                        and existing.get("state") == "OPEN"
                        and existing.get("scope") == "crawler"
                        and existing.get("revision") == 0
                        and existing.get("actor") is None
                        and existing.get("reason") is None
                        and existing.get("request_id") is None
                    )
                    if is_pristine_admission_seed:
                        writer.execute(table.update().where(key).values(**values))
                    else:
                        raise ValueError(f"Conflicting target row in {table.name}; import aborted.")
            else:
                writer.execute(table.insert().values(**values))
            counts[table.name] += 1
    return counts


def import_profile_files(root, writer):
    """Import normalized profile files without changing binary paths or source files."""
    count = 0
    for path in sorted((root / "profiles").glob("*.json")):
        payload = normalize_profile(json.loads(path.read_text(encoding="utf-8")), path.stem)
        if payload["slug"] != path.stem:
            raise ValueError("Profile filename is not a canonical slug.")
        values = {"slug": path.stem, "payload": payload}
        table = ImageProfileRecord.__table__
        existing = writer.execute(select(table).where(table.c.slug == path.stem)).mappings().first()
        if existing and canonical(existing) != canonical(values):
            raise ValueError("Conflicting current image profile; import aborted.")
        if not existing:
            writer.execute(table.insert().values(**values))
        count += 1
    for path in sorted((root / "revisions").glob("*/*/profile.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        slug, revision = path.parent.parent.name, path.parent.name
        if not re.fullmatch(r"[a-f0-9]{16}", revision) or payload.get("slug") != slug or payload.get("revision") != revision:
            raise ValueError("Invalid archived image profile identity.")
        table = ImageProfileRevision.__table__
        values = {"slug": slug, "revision": revision, "payload": payload}
        existing = writer.execute(select(table).where(table.c.slug == slug, table.c.revision == revision)).mappings().first()
        if existing and canonical(existing) != canonical(values):
            raise ValueError("Conflicting archived image profile; import aborted.")
        if not existing:
            writer.execute(table.insert().values(**values))
        count += 1
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--backup-directory", type=Path, required=True)
    parser.add_argument("--profiles-root", type=Path, help="Normalized image runtime root containing profiles/, revisions/ and logos/.")
    parser.add_argument("--confirm-writers-stopped", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.confirm_writers_stopped:
        raise ValueError("Stop writers and pass --confirm-writers-stopped.")
    target_url = os.environ.get("AMAZON_COORDINATOR_DATABASE_URL", "")
    if not target_url.startswith(("postgresql:", "postgresql+")):
        raise ValueError("Configure AMAZON_COORDINATOR_DATABASE_URL for PostgreSQL.")
    source = args.source.resolve(strict=True)
    if args.profiles_root:
        args.profiles_root = args.profiles_root.resolve(strict=True)
        if args.backup_directory.resolve().is_relative_to(args.profiles_root):
            raise ValueError("Backup directory must be outside the image runtime root.")
    args.backup_directory.mkdir(parents=True, exist_ok=True)
    snapshot = args.backup_directory / (source.name + ".snapshot")
    if snapshot.exists():
        raise ValueError("Use a new backup directory to preserve earlier snapshots.")
    with sqlite3.connect(source.as_uri() + "?mode=ro", uri=True) as original:
        with sqlite3.connect(snapshot) as backup:
            original.backup(backup)
    digest = hashlib.sha256(snapshot.read_bytes()).hexdigest()
    profile_snapshot = args.backup_directory / "image-profiles"
    if args.profiles_root:
        shutil.copytree(args.profiles_root, profile_snapshot)
    legacy = create_engine(f"sqlite:///{snapshot}")
    target = create_engine(target_url)
    try:
        migrate_coordinator(target)
        with legacy.connect() as reader, target.connect() as writer:
            transaction = writer.begin()
            try:
                counts = import_relational_rows(reader, writer)
                if args.profiles_root:
                    counts["imageProfileFiles"] = import_profile_files(profile_snapshot, writer)
                if args.apply:
                    transaction.commit()
                else:
                    transaction.rollback()
            except Exception:
                transaction.rollback()
                raise
        report = {"formatVersion": 1, "applied": args.apply, "sourceSnapshotSha256": digest, "counts": counts}
        (args.backup_directory / "migration-manifest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report))
    finally:
        legacy.dispose()
        target.dispose()


if __name__ == "__main__":
    try:
        main()
    except Exception:
        raise SystemExit("Coordinator import failed. Source preserved; inspect configuration and target conflicts without logging credentials.") from None
