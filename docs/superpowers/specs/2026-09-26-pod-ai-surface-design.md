# AI-assisted POD reference replacement

## Intent and scope

Replace only the target product's visible printable surfaces in supplied reference images. Preserve the original scene, layout, annotations, borders and occluding objects. Use the same master artwork for every output without generative redrawing of its text or motifs. No product-niche coordinate presets.

Work stays on `fix/pinterest-pod-universal-pipeline`, as explicitly requested, rather than creating a fresh branch. Implementation ownership is `src/modules/pinterest-pod` and this design documentation. No Shopify, shared configuration, dependency or public module API changes are included.

This first delivery supports validated planar surfaces, including partial occlusion. Curved surfaces, cloth folds and ambiguous cropped geometry require review and are not silently approximated. General niche independence does not imply universal geometry support.

## Evidence and root cause

Job `job_prod_43750dbda8` exposed three distinct failures: invalid corner ordering, disagreement between the proposed polygon and mapping, and an accepted geometric rectangle that was displaced from the real product. Pixel preservation outside that rectangle passed, but the rectangle itself was wrong. The current product analysis explicitly requests polygons and forbids bitmap masks. High model confidence is not evidence that those polygons match product boundaries.

The current compositor also deliberately omits shading to avoid transferring the old printed design. Therefore even correct geometry alone cannot establish photorealism. Existing generic mockup QA must not substitute for a reference-specific schema.

## Selected approach

Use the existing Gemini provider for semantic identification and native bitmap segmentation, then deterministic projection of the master artwork. Google documents Gemini 2.5 Flash segmentation with JSON masks and disabled thinking: https://developers.googleblog.com/conversational-image-segmentation-gemini-2-5/ . Provider availability and mask decoding must be verified against its official sample before implementation; unsupported responses fail explicitly.

Alternatives considered: polygon-only generation repeats the observed failure; a local segmentation model introduces installation and runtime requirements outside the approved scope. Whole-scene generative editing cannot enforce unchanged background pixels or exact master artwork identity.

## Processing contract

1. Identify all target printable instances and distinguish product silhouette, printable area, borders and foreground occluders. Labels describe visual relationships, not a fixed niche taxonomy.
2. Request bitmap masks for visible printable surfaces and foreground occluders. Decode masks with explicit provider bounding-box coordinate order, validated dimensions, bounded payload size and finite coordinates. Expand each crop into the reference's original pixel coordinates. Never substitute a bounding rectangle or polygon if segmentation is absent or malformed.
3. Estimate artwork mapping separately from visibility. A planar homography describes the complete product surface; the bitmap describes only its visible editable pixels. Validate corner order, orientation, conditioning and coverage. Do not automatically stretch the quad to cover a disagreeing mask. Cropped products with indeterminate full geometry require review.
4. Review masks against the reference before composing. Check semantic target selection, border exclusion, foreground exclusion and completeness across instances. Save an overlay for diagnostics. A model confidence field alone never approves the mask.
5. Project the original master canvas, with its existing composition and background, into each validated surface. Clip only by validated visibility and occlusion masks. Do not crop, tile or rearrange the master to make it fit. Reject incompatible or ambiguous mapping rather than inventing placement.
6. Keep the reference immutable outside the effective edit mask. Edge blending may operate only inside that mask. Save a lossless PNG before checking exact outside-mask equality.
7. Run dedicated reference QA on the master, original reference, mask overlay and composite. Require explicit assessments of artwork identity, geometry, mask correctness, occlusion preservation, old-print removal and realism. Missing fields, malformed responses or failed checks are failures, not implied passes.

## Realism boundary

Do not reuse raw source luminance as a shading layer: it contains the old artwork. This delivery must not claim that flat projection is photorealistic. Keep realism as a mandatory release check; otherwise retain the result as a diagnostic candidate only. Material/shading decomposition and curved-surface rendering are separate follow-up work requiring a validated method, not an unverified generative fallback hidden in this change.

## Cache, errors and integration

Cache segmentation and geometry by reference content hash, provider/model, prompt and schema versions, independently of the master artwork. Cache invalidation prevents reuse of polygon-only analysis. Cache does not imply approval. Track master hash separately in output provenance.

Reuse the existing failed-job/review-required presentation and diagnostic artifacts. This delivery does not introduce a new manual mask editor or public endpoint. Preserve the existing publication gate: rejected or missing variants cannot become completed merely because files exist. Retry only invalid analysis within a bounded budget; do not regenerate the same deterministic composite repeatedly.

## Acceptance and verification

- Add failing deterministic tests before implementation: coordinate-order conversion, bitmap crop placement, malformed/base64 or oversized masks, foreground holes, multiple instances, degenerate homography, cropped geometry, cache invalidation, missing QA fields and rejected publication.
- Synthetic reference fixtures must prove byte-exact background preservation and unchanged protected pixels, plus source-master provenance. Fixtures must not embed production records.
- Run the Pinterest Python suite, focused TypeScript tests, `npm test`, `npm run typecheck` and `npm run build`. Run `npm run build:mock` only if mock/runtime behavior changes. Report existing environment failures separately.
- Inspect the three local references from `job_prod_43750dbda8` using saved overlay/composite comparisons. Do not commit production images. Live Gemini validation consumes quota and must be separately authorized; without it, report provider integration and visual quality as unverified.
- Passing software tests is not evidence of universal photorealism. Completion claims must distinguish implemented safeguards, offline tests and actual reviewed live outputs.
