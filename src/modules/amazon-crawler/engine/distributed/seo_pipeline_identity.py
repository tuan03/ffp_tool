"""Read compact Amazon identities from the authoritative shared SEO worker queue."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

from sqlalchemy import inspect, text
from sqlalchemy.orm import Session


@dataclass(frozen=True)
class ActiveSeoIdentity:
    job_id: str
    source_key: str
    asins: frozenset[str]
    owner_item_id: str


def load_active_seo_identities(session: Session, store_id: str) -> list[ActiveSeoIdentity]:
    if not store_id:
        return []
    connection = session.connection()
    inspector = inspect(connection)
    # Standalone crawler/test databases may not have the Gateway schema yet.
    if not inspector.has_table("gpt_jobs") or not inspector.has_table("seo_worker_jobs"):
        return []
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
