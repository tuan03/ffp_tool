"""Read compact Amazon identities from the authoritative shared SEO worker queue."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from sqlalchemy import bindparam, inspect, text
from sqlalchemy.orm import Session


@dataclass(frozen=True)
class ActiveSeoIdentity:
    job_id: str
    source_key: str
    asins: frozenset[str]
    owner_item_id: str


def load_active_seo_identities(
    session: Session, store_id: str, *, asins: set[str] | None = None,
) -> list[ActiveSeoIdentity]:
    if not store_id or (asins is not None and not asins):
        return []
    connection = session.connection()
    inspector = inspect(connection)
    # Standalone crawler/test databases may not have the Gateway schema yet.
    if not inspector.has_table("gpt_jobs") or not inspector.has_table("seo_worker_jobs"):
        return []
    if inspector.has_table("seo_pipeline_asins") and inspector.has_table("seo_pipeline_identities"):
        # The projection is committed with the job, including legacy backfill. Read only
        # exact candidates, never the large SEO input/checkpoints/original snapshots.
        query = text(f"""
            SELECT i.job_id,i.source_key,i.owner_item_id,a.asin FROM seo_pipeline_asins a
            JOIN seo_pipeline_identities i ON i.job_id=a.job_id
            JOIN seo_worker_jobs w ON w.job_id=a.job_id JOIN gpt_jobs j ON j.id=a.job_id
            WHERE a.store_id=:store_id AND w.pipeline_active=true AND j.status!='CANCELLED'
            {"AND a.asin IN :asins" if asins is not None else ""}
        """)
        parameters: dict[str, str | list[str]] = {"store_id": store_id}
        if asins is not None:
            query = query.bindparams(bindparam("asins", expanding=True))
            parameters["asins"] = sorted(asins)
        aliases_by_job: dict[str, set[str]] = {}
        metadata: dict[str, tuple[str, str]] = {}
        for row in session.execute(query, parameters).mappings():
            job_id = str(row["job_id"])
            aliases_by_job.setdefault(job_id, set()).add(str(row["asin"]))
            metadata[job_id] = (str(row["source_key"]), str(row["owner_item_id"]))
        return [ActiveSeoIdentity(job_id, metadata[job_id][0], frozenset(aliases), metadata[job_id][1])
                for job_id, aliases in aliases_by_job.items()]
    # Compatibility for standalone SQLite tests and a pre-upgrade Gateway. Once the
    # atomic projection migration commits, the hot path above never parses payloads.
    if connection.dialect.name == "postgresql":
        identity_projection = """
            COALESCE(j.payload::jsonb#>'{execution,originalSnapshot}', j.payload::jsonb->'original')
        """
        projection = f"""
            COALESCE(j.payload::jsonb#>>'{{execution,sourceIdentity}}', j.payload::jsonb->>'sourceIdentity') AS source_key,
            jsonb_build_object(
                'asin', ({identity_projection})->'asin',
                'parentAsin', ({identity_projection})->'parentAsin',
                'sourceVariants', jsonb_path_query_array(({identity_projection}), '$.sourceVariants[*].asin'),
                'crawlerPipelineItemId', ({identity_projection})->'crawlerPipelineItemId'
            ) AS identity
        """
    else:
        projection = """
            COALESCE(json_extract(j.payload,'$.execution.sourceIdentity'), json_extract(j.payload,'$.sourceIdentity')) AS source_key,
            COALESCE(json_extract(j.payload,'$.execution.originalSnapshot'), json_extract(j.payload,'$.original')) AS identity
        """
    rows = session.execute(text(f"""
        SELECT j.id, {projection}
        FROM gpt_jobs j JOIN seo_worker_jobs w ON w.job_id=j.id
        WHERE j.store_id=:store_id AND w.pipeline_active=true AND j.status!='CANCELLED'
    """), {"store_id": store_id})
    identities: list[ActiveSeoIdentity] = []
    for row in rows.mappings():
        snapshot = row["identity"]
        if isinstance(snapshot, str):
            snapshot = json.loads(snapshot)
        if not isinstance(snapshot, dict):
            continue
        primary = str(snapshot.get("asin") or "").strip().upper()
        parent = str(snapshot.get("parentAsin") or "").strip().upper()
        aliases = {primary} if re.fullmatch(r"[A-Z0-9]{10}", primary) else set()
        for variant in snapshot.get("sourceVariants") or []:
            alias = variant.get("asin") if isinstance(variant, dict) else variant
            alias = str(alias or "").strip().upper()
            if re.fullmatch(r"[A-Z0-9]{10}", alias) and alias != parent:
                aliases.add(alias)
        if asins is not None:
            aliases.intersection_update(asins)
        identities.append(ActiveSeoIdentity(
            job_id=str(row["id"]), source_key=str(row["source_key"] or ""),
            asins=frozenset(aliases), owner_item_id=str(snapshot.get("crawlerPipelineItemId") or ""),
        ))
    return identities


def match_active_seo_jobs(
    identities: list[ActiveSeoIdentity], asins: set[str], *, owner_item_id: str = "",
) -> list[str]:
    matches = [identity for identity in identities
               if (not owner_item_id or identity.owner_item_id != owner_item_id) and asins & identity.asins]
    covered = set().union(*(identity.asins for identity in matches))
    # A mixed product containing a genuinely new variant must not be discarded.
    return sorted({identity.job_id for identity in matches}) if asins and asins <= covered else []
