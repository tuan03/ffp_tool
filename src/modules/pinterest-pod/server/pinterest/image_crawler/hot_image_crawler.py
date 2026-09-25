from __future__ import annotations

import argparse
import collections
import html
import logging
import os
import sys
from pathlib import Path

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from pinterest.image_crawler.dedupe import dedupe_candidates
    from pinterest.image_crawler.discovery import load_trend_package, provider_from_name
    from pinterest.image_crawler.downloader import Downloader
    from pinterest.image_crawler.ranker import rank_images
    from pinterest.image_crawler.vision_filter import ProductVisionFilter
    from pinterest.shared.cache import JsonCache
    from pinterest.shared.models import ImageCandidate, RankedImage, SearchResult
    from pinterest.shared.product_policy import ProductPolicy, generate_product_policy, infer_product_policy
    from pinterest.shared.utils import configure_logging, dataclass_to_dict, env, html_page, utc_now_iso, write_csv, write_json
    from pinterest.trend_finder.semantic_analyzer import build_smart_queries
else:
    from .dedupe import dedupe_candidates
    from .discovery import load_trend_package, provider_from_name
    from .downloader import Downloader
    from .ranker import rank_images
    from .vision_filter import ProductVisionFilter
    from ..shared.cache import JsonCache
    from ..shared.models import ImageCandidate, RankedImage, SearchResult
    from ..shared.product_policy import ProductPolicy, generate_product_policy, infer_product_policy
    from ..shared.utils import configure_logging, dataclass_to_dict, env, html_page, utc_now_iso, write_csv, write_json
    from ..trend_finder.semantic_analyzer import build_smart_queries


LOG = logging.getLogger("pinterest.crawler")


def collect_results(
    *,
    package_path: str,
    output_dir: Path,
    provider_name: str,
    max_images_per_query: int,
    max_trends: int,
    max_queries_per_trend: int,
    timeout: int,
    locale: str,
    max_downloads: int | None = None,
) -> tuple[list[SearchResult], dict]:
    package = load_trend_package(package_path)
    provider = provider_from_name(provider_name, timeout=timeout)
    audit = {
        "provider": provider_name,
        "package": package_path,
        "niche": package.niche,
        "region": package.region,
        "queries": [],
        "errors": [],
    }
    results: list[SearchResult] = []
    early_exit_threshold = max(35, int((max_downloads or 40) * 1.8)) if max_downloads else None

    for trend in package.trends[:max_trends]:
        trend_queries = list(trend.queries) if trend.queries else build_smart_queries(trend.trend, package.niche)
        for query in sorted(trend_queries, key=lambda item: item.priority)[:max_queries_per_trend]:
            LOG.info("Search: [%s] %s", trend.trend_id, query.query)
            try:
                found = provider.search(
                    query=query.query,
                    trend=trend,
                    limit=max_images_per_query,
                    region=package.region,
                    locale=locale,
                )
                results.extend(found)
                audit["queries"].append(
                    {
                        "trend_id": trend.trend_id,
                        "trend": trend.trend,
                        "query": query.query,
                        "count": len(found),
                    }
                )
                if early_exit_threshold and len(results) >= early_exit_threshold:
                    LOG.info("Đã thu thập đủ %d kết quả tìm kiếm cho mục tiêu %d ảnh. Dừng tìm kiếm sớm (Early-exit).", len(results), max_downloads)
                    break
            except Exception as exc:
                LOG.warning("Search failed for %r: %s", query.query, exc)
                audit["queries"].append(
                    {
                        "trend_id": trend.trend_id,
                        "trend": trend.trend,
                        "query": query.query,
                        "count": 0,
                        "error": str(exc),
                    }
                )
                audit["errors"].append({"query": query.query, "error": str(exc)})

    by_url: dict[str, SearchResult] = {}
    for result in results:
        by_url.setdefault(result.image_url, result)

    # Interleave results across trends (Round-Robin) to prevent the first trend from starving subsequent trends
    results_by_trend: dict[str, list[SearchResult]] = {}
    for result in by_url.values():
        t_key = result.trend_id or "default"
        results_by_trend.setdefault(t_key, []).append(result)

    interleaved: list[SearchResult] = []
    trend_lists = list(results_by_trend.values())
    max_len = max((len(lst) for lst in trend_lists), default=0)
    for i in range(max_len):
        for lst in trend_lists:
            if i < len(lst):
                interleaved.append(lst[i])

    results = interleaved
    write_json(output_dir / "raw_results.json", {"audit": audit, "results": results})
    return results, {"package": package, "audit": audit}


def build_candidates(
    *,
    results: list[SearchResult],
    package_path: str,
    output_dir: Path,
    max_downloads: int,
    timeout: int,
    dhash_distance: int,
) -> tuple[list[ImageCandidate], list[ImageCandidate], dict]:
    package = load_trend_package(package_path)
    trends = {trend.trend_id: trend for trend in package.trends}
    downloader = Downloader(output_dir, timeout=timeout)

    downloaded: list[ImageCandidate] = []
    stats = {
        "raw_results": len(results),
        "download_requested": min(max_downloads, len(results)),
        "downloaded": 0,
        "download_failed": 0,
        "dedupe_kept": 0,
        "dedupe_rejected": 0,
    }
    target_count = min(max_downloads, len(results))
    LOG.info("Starting download of up to %d candidate images...", target_count)
    for idx, result in enumerate(results, start=1):
        if len(downloaded) >= max_downloads:
            LOG.info("Đã tải đủ số lượng mục tiêu (%d/%d ảnh). Dừng tải sớm (Early-exit).", len(downloaded), max_downloads)
            break
        trend = trends.get(result.trend_id)
        if trend is None:
            continue
        candidate = downloader.result_to_candidate(result, trend)
        candidate = downloader.download(candidate)
        has_file = bool(candidate.local_path and Path(candidate.local_path).is_file())
        if candidate.download_error or not has_file:
            stats["download_failed"] += 1
            LOG.warning(
                "Image %d download error (%s): %s",
                idx,
                candidate.image_id[:8],
                candidate.download_error or "File missing on disk",
            )
        else:
            stats["downloaded"] += 1
            if len(downloaded) % 3 == 0 or len(downloaded) == target_count:
                LOG.info("Downloaded %d/%d images (%s)", len(downloaded), target_count, candidate.image_id[:10])
            downloaded.append(candidate)

    LOG.info("Download finished: %d succeeded, %d failed. Deduping...", stats["downloaded"], stats["download_failed"])
    kept, rejected = dedupe_candidates(downloaded, dhash_distance=dhash_distance)
    stats["dedupe_kept"] = len(kept)
    stats["dedupe_rejected"] = len(rejected)
    LOG.info("Deduplication complete: %d unique images kept, %d duplicates rejected.", len(kept), len(rejected))
    write_json(output_dir / "image_candidates.json", kept)
    return kept, rejected, stats


def export_hot_images_csv(path: Path, images: list[RankedImage]) -> None:
    write_csv(
        path,
        [dataclass_to_dict(item) for item in images],
        [
            "rank",
            "image_score",
            "trend",
            "query",
            "product_role",
            "product_confidence",
            "product_visibility",
            "trend_relevance",
            "commercial_quality",
            "trend_strength",
            "semantic_fit",
            "source",
            "pin_url",
            "image_url",
            "local_path",
            "main_subject",
            "target_product_type",
            "detected_product",
            "reason",
        ],
    )


def render_report(path: Path, *, images: list[RankedImage], metadata: dict) -> None:
    report_dir = path.parent.resolve()
    cards = []
    for item in images:
        if item.local_path:
            local_path = Path(item.local_path)
            if not local_path.is_absolute():
                local_path = (Path.cwd() / local_path).resolve()
            img_src = os.path.relpath(local_path, report_dir).replace("\\", "/")
        else:
            img_src = item.image_url
        img = html.escape(img_src)
        cards.append(
            f"""
<article class="card">
  <img src="{img}" alt="{html.escape(item.trend)}">
  <div class="pad">
    <div class="score">#{item.rank} · {item.image_score:.1f}</div>
    <div><strong>{html.escape(item.trend)}</strong></div>
    <div class="muted">{html.escape(item.query)}</div>
    <p>{html.escape(item.detected_product or item.aesthetic or item.reason)}</p>
    <div>
      <span class="pill">{html.escape(item.product_role)}</span>
      <span class="pill">visibility {item.product_visibility:.0f}</span>
      <span class="pill">trend {item.trend_relevance:.0f}</span>
    </div>
  </div>
</article>
"""
        )
    body = f"""
<header>
  <h1>Hot Product Images</h1>
  <div class="muted">Input: {html.escape(str(metadata.get("input")))} · Generated: {html.escape(str(metadata.get("generated_at")))}</div>
</header>
<main>
  <div class="grid">{''.join(cards)}</div>
</main>
"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html_page("Hot Product Images", body), encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Crawl/download/rank hot product images from a trend_package.json contract.")
    parser.add_argument("--input", required=True, help="Path to trend_package.json")
    parser.add_argument("--output", default="crawl_output")
    parser.add_argument("--provider", choices=["auto", "pinterest-browser"], default="pinterest-browser")
    parser.add_argument("--max-images-per-query", type=int, default=12)
    parser.add_argument("--max-trends", type=int, default=5)
    parser.add_argument("--max-queries-per-trend", type=int, default=6)
    parser.add_argument("--max-downloads", type=int, default=40)
    parser.add_argument("--top-images", type=int, default=30)
    parser.add_argument("--min-image-score", type=float, default=20.0)
    parser.add_argument("--accepted-product-roles", nargs="+", default=["PRIMARY"], choices=["PRIMARY", "SECONDARY", "INCIDENTAL", "UNVERIFIED"])
    parser.add_argument("--min-product-visibility", type=float, default=75.0)
    parser.add_argument("--min-trend-relevance", type=float, default=70.0)
    parser.add_argument("--product-focus", default="auto", help="Target product focus. Can be auto or any product phrase, e.g. blanket, leather-bag, ceramic-mug.")
    parser.add_argument("--dhash-distance", type=int, default=5)
    parser.add_argument("--locale", default=env("PINTEREST_LOCALE", "en-US"))
    parser.add_argument("--timeout", type=int, default=int(env("PINTEREST_TIMEOUT", "30") or 30))
    parser.add_argument("--vision-mode", choices=["auto", "required", "off"], default="auto")
    parser.add_argument("--crawl-purpose", choices=["product", "inspiration"], default="product")
    parser.add_argument("--vision-model", default=env("GEMINI_VISION_MODEL", "gemini-2.5-flash"))
    parser.add_argument("--gemini-backend", choices=["auto", "enterprise", "api-key"], default="auto")
    parser.add_argument("--vision-batch-size", type=int, default=5)
    parser.add_argument("--no-vision-cache", action="store_true")
    parser.add_argument("--refresh-vision-cache", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    configure_logging(args.verbose)
    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    results, context = collect_results(
        package_path=args.input,
        output_dir=output_dir,
        provider_name=args.provider,
        max_images_per_query=max(1, args.max_images_per_query),
        max_trends=max(1, args.max_trends),
        max_queries_per_trend=max(1, args.max_queries_per_trend),
        timeout=args.timeout,
        locale=args.locale,
        max_downloads=max(1, args.max_downloads),
    )

    candidates, download_rejected, download_stats = build_candidates(
        results=results,
        package_path=args.input,
        output_dir=output_dir,
        max_downloads=max(1, args.max_downloads),
        timeout=args.timeout,
        dhash_distance=max(0, args.dhash_distance),
    )

    package = context["package"]
    is_vision_disabled = (
        args.vision_mode == "off"
        or env("DISABLE_VISION_FILTER", "").lower() in {"1", "true", "yes"}
    )
    if is_vision_disabled:
        LOG.info("Vision AI filter is disabled: using inferred product policy without calling Gemini.")
        product_policy = infer_product_policy(package.niche, args.product_focus)
    else:
        product_policy = generate_product_policy(
            niche=package.niche,
            product_focus=args.product_focus,
            model=args.vision_model,
            backend=args.gemini_backend,
            output_path=output_dir / "product_policy.json",
        )
    if args.crawl_purpose == "inspiration" and (product_policy.require_physical_product or product_policy.require_floor_textile):
        product_policy = ProductPolicy(
            policy_id=product_policy.policy_id,
            display_name=product_policy.display_name,
            target_keywords=product_policy.target_keywords,
            accepted_types=product_policy.accepted_types,
            excluded_types=product_policy.excluded_types,
            require_floor_textile=False,
            require_physical_product=False,
            reject_collage=product_policy.reject_collage,
        )

    vision = ProductVisionFilter(
        niche=package.niche,
        model=args.vision_model,
        backend=args.gemini_backend,
        batch_size=args.vision_batch_size,
        cache=JsonCache(output_dir / ".vision_cache.json", enabled=not args.no_vision_cache),
        refresh_cache=args.refresh_vision_cache,
        mode=args.vision_mode,
        product_focus=args.product_focus,
        product_policy=product_policy,
        crawl_purpose=args.crawl_purpose,
    )
    LOG.info("Starting Gemini Vision AI analysis for %d unique candidate image(s)...", len(candidates))
    vision_results = vision.analyze(candidates)
    LOG.info("Vision AI analysis finished. Successfully analyzed %d images.", len(vision_results))
    write_json(output_dir / "product_vision_analysis.json", vision_results)
    role_counts = collections.Counter(result.product_role for result in vision_results.values())
    subject_counts = collections.Counter(result.main_subject or "unknown" for result in vision_results.values())
    product_type_counts = collections.Counter(result.target_product_type or "unknown" for result in vision_results.values())
    accepted_role_counts = collections.Counter(
        result.product_role
        for result in vision_results.values()
        if result.accepted
    )
    LOG.info("Ranking candidates and applying direct-print classification...")

    effective_top_images = len(candidates) if is_vision_disabled else max(1, args.top_images)
    hot_images, vision_rejected = rank_images(
        candidates=candidates,
        vision_results=vision_results,
        top_images=effective_top_images,
        min_score=0.0 if is_vision_disabled else args.min_image_score,
        accepted_roles=set(args.accepted_product_roles) if not is_vision_disabled else {"PRIMARY", "SECONDARY", "INCIDENTAL", "UNVERIFIED"},
        min_product_visibility=0.0 if is_vision_disabled else args.min_product_visibility,
        min_trend_relevance=0.0 if is_vision_disabled else args.min_trend_relevance,
        niche=package.niche,
        product_focus=args.product_focus,
        product_policy=product_policy,
        crawl_purpose=args.crawl_purpose,
    )
    rejected = [
        *[dataclass_to_dict(item) for item in download_rejected],
        *vision_rejected,
    ]
    metadata = {
        "generated_at": utc_now_iso(),
        "input": args.input,
        "provider": args.provider,
        "vision_mode": args.vision_mode,
        "product_focus": args.product_focus,
        "crawl_purpose": args.crawl_purpose,
        "product_policy": {
            **product_policy.to_dict(),
        },
        "policy": {
            "accepted_product_roles": args.accepted_product_roles,
            "min_product_visibility": args.min_product_visibility,
            "min_trend_relevance": args.min_trend_relevance,
            "min_image_score": args.min_image_score,
            "product_focus": args.product_focus,
            "product_policy": product_policy.policy_id,
            "crawl_purpose": args.crawl_purpose,
            "require_physical_product": product_policy.require_physical_product,
            "reject_collage": product_policy.reject_collage,
        },
        "counts": {
            "raw_results": len(results),
            "image_candidates": len(candidates),
            "hot_product_images": len(hot_images),
            "rejected_images": len(rejected),
        },
        "download_stats": download_stats,
        "gate_stats": {
            "vision_roles": dict(role_counts),
            "main_subjects": dict(subject_counts),
            "product_types": dict(product_type_counts),
            "accepted_roles": dict(accepted_role_counts),
            "vision_accepted": sum(1 for result in vision_results.values() if result.accepted),
            "vision_rejected": sum(1 for result in vision_results.values() if not result.accepted),
            "policy_reject_reasons": dict(collections.Counter(item.get("reason") or "UNKNOWN" for item in vision_rejected)),
        },
        "discovery_audit": context["audit"],
    }
    write_json(output_dir / "crawl_manifest.json", metadata)
    write_json(output_dir / "hot_product_images.json", hot_images)
    export_hot_images_csv(output_dir / "hot_product_images.csv", hot_images)
    write_json(output_dir / "rejected_images.json", rejected)
    render_report(output_dir / "hot_product_images_report.html", images=hot_images, metadata=metadata)

    LOG.info("DONE: %s", output_dir / "hot_product_images_report.html")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
