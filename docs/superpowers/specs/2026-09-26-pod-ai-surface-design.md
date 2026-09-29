# AI-assisted POD reference replacement

## Intent and scope

Replace only the target product's visible printable surfaces in supplied reference images. Preserve the original scene, layout, annotations, borders and occluding objects. Use the same master artwork for every output without generative redrawing of its text or motifs. No product-niche coordinate presets.

Work stays on `fix/pinterest-pod-universal-pipeline`, as explicitly requested, rather than creating a fresh branch. Implementation ownership is `src/modules/pinterest-pod` and this design documentation. No Shopify, shared configuration, dependency or public module API changes are included.

Scope updated by explicit user instruction: implement directly on the current branch, including curved surfaces and folds, without another planning approval. The implementation adds AI-estimated visible UV triangle meshes and independent per-vertex illumination for curved/folded surfaces (and shaded planar surfaces), alongside planar homographies. Unsupported or ambiguous geometry is rejected, never silently flattened. General niche independence does not imply that AI can infer every surface correctly.

## Evidence and root cause

Job `job_prod_43750dbda8` exposed three distinct failures: invalid corner ordering, disagreement between the proposed polygon and mapping, and an accepted geometric rectangle that was displaced from the real product. Pixel preservation outside that rectangle passed, but the rectangle itself was wrong. The current product analysis explicitly requests polygons and forbids bitmap masks. High model confidence is not evidence that those polygons match product boundaries.

The current compositor also deliberately omits shading to avoid transferring the old printed design. Therefore even correct geometry alone cannot establish photorealism. Existing generic mockup QA must not substitute for a reference-specific schema.

## Selected approach

Use the existing Gemini provider for semantic identification and native bitmap segmentation, then deterministic projection of the master artwork. Google documents Gemini 2.5 Flash segmentation with JSON masks and disabled thinking: https://developers.googleblog.com/conversational-image-segmentation-gemini-2-5/ . Provider availability and mask decoding must be verified against its official sample before implementation; unsupported responses fail explicitly.

Alternatives considered: polygon-only generation repeats the observed failure; a local segmentation model introduces installation and runtime requirements outside the approved scope. Whole-scene generative editing cannot enforce unchanged background pixels or exact master artwork identity.

## Processing contract

1. Identify all target printable instances and distinguish product silhouette, printable area, borders and foreground occluders. Labels describe visual relationships, not a fixed niche taxonomy.
2. Request bitmap masks for visible printable surfaces and foreground occluders. Decode masks with explicit provider bounding-box coordinate order, validated dimensions, bounded payload size and finite coordinates. Expand each crop into the reference's original pixel coordinates. Never substitute a bounding rectangle or polygon if segmentation is absent or malformed.
   Foreground objects are independently segmented and subtracted; do not rely on a product-mask prompt to create holes. Fully visible near-quadrilateral planar boundaries can be anchored to the measured mask. Skip this adjustment for cropped or externally occluded boundaries so the master is not stretched into a visible fragment.
3. Estimate artwork mapping separately from visibility. A planar homography or visible UV triangle mesh maps the master artwork; the bitmap describes only its visible editable pixels. Validate corner order, orientation, coverage, indices and positive-area UV overlap (which would repeat artwork). Do not automatically stretch mapping to cover a disagreeing mask. Cropped products with indeterminate full geometry require review.
4. Validate bitmap format, instance matching and geometry before composition and caching. Final reference-specific visual QA must check semantic target selection, border exclusion, foreground exclusion and completeness across instances. Save the edit mask and candidate for diagnostics. A model confidence field alone never approves the mask.
5. Project the original master canvas, with its existing composition and background, into each validated surface. Clip only by validated visibility and occlusion masks. Do not crop, tile or rearrange the master to make it fit. Reject incompatible or ambiguous mapping rather than inventing placement.
6. Keep the reference immutable outside the effective edit mask. Edge blending may operate only inside that mask. Save a lossless PNG before checking exact outside-mask equality.
7. Run dedicated reference QA on the master, original reference, mask overlay and composite. Require explicit assessments of artwork identity, geometry, mask correctness, occlusion preservation, old-print removal and realism. Missing fields, malformed responses or failed checks are failures, not implied passes.

## Realism boundary

Do not reuse raw source luminance as a shading layer: it contains the old artwork. Mesh illumination is an AI-estimated neutral scalar field, not copied old-print brightness. It handles broad light variation but does not reconstruct detailed weave, specular reflection or intricate cast shadows. Keep explicit lighting/material realism approval as a mandatory release check; otherwise retain the result as a diagnostic candidate only. Offline mesh tests do not establish photorealistic results on real references.

## Cache, errors and integration

Cache segmentation and geometry by reference content hash, model, prompt/schema version and target label, independently of the master artwork. Validate structural composition before cache writes and on hits. Invalidate the cache when final reference QA rejects the candidate, so retries cannot repeatedly reuse a rejected analysis. Cache invalidation prevents reuse of polygon-only analysis. Cache does not imply approval. Track master hash separately in output provenance.

Reuse the existing failed-job/review-required presentation and diagnostic artifacts. This delivery does not introduce a new manual mask editor or public endpoint. Preserve the existing publication gate: rejected or missing variants cannot become completed merely because files exist. Retry only invalid analysis within a bounded budget; do not regenerate the same deterministic composite repeatedly.

## Acceptance and verification

- Add failing deterministic tests before implementation: coordinate-order conversion, bitmap crop placement, malformed/base64 or oversized masks, foreground holes, multiple instances, degenerate homography, cropped geometry, cache invalidation, missing QA fields and rejected publication.
- Synthetic reference fixtures must prove byte-exact background preservation and unchanged protected pixels, plus source-master provenance. Fixtures must not embed production records.
- Run the Pinterest Python suite, focused TypeScript tests, `npm test`, `npm run typecheck` and `npm run build`. Run `npm run build:mock` only if mock/runtime behavior changes. Report existing environment failures separately.
- Inspect the three local references from `job_prod_43750dbda8` using saved overlay/composite comparisons. Do not commit production images. Live Gemini validation consumes quota and must be separately authorized; without it, report provider integration and visual quality as unverified.
- Passing software tests is not evidence of universal photorealism. Completion claims must distinguish implemented safeguards, offline tests and actual reviewed live outputs.

## Live verification status (2026-09-26)

The user authorized testing the three references of `job_prod_43750dbda8`. No original job files were changed and no products were published. Artifacts remain in ignored `server/temp/pinterest_pod/surface_smoke_43750dbda8*` folders.

- First pass: reference 1 returned truncated/repetitive mask JSON; reference 2 timed out; reference 3 returned a decodable mask but its product silhouette included the child/toys, and its geometry did not cover that mask. No output was approved.
- Second pass with independently requested foreground masks and bounded output/time: all three returned malformed/truncated segmentation JSON. No output was approved.
- A reference-3 control using the canonical short segmentation prompt without forced JSON returned `<start_of_mask><seg_...>` token sequences, not PNG probability masks. These must not be interpreted as usable images or guessed polygons. Native segmentation now avoids forced JSON and remains fail-closed on unsupported output.
- Offline tests validate projection, mask placement, foreground subtraction, UV anti-duplication, cache invalidation and publication rejection. They do not resolve the observed provider-format failure or prove real curved/folded surface accuracy.

The user subsequently authorized a dedicated Google `image-segmentation-001` endpoint probe on the same three images. All three requests returned HTTP 404 (`image-segmentation-001 is unavailable`) both in the configured region and in `us-central1`. No further endpoint calls were made and no dedicated-endpoint integration was activated in production code.

The live image-quality objective remains incomplete. A usable segmentation backend is required; downloading a local model or changing to another paid provider requires user direction. Do not present this change as production-validated universal photorealistic replacement. The running backend was not restarted, and the old job was not rerun or overwritten.

## Engineering handoff

- Changed scope: `reference_surfaces.py` (AI masks/geometry/cache), `surface_mesh.py` (UV sampling and duplicate-region rejection), `planar_boundary.py` (conservative mask-based planar anchoring), `reference_composite.py` (bitmap masks, occlusion protection, non-planar dispatch), `template_mockup.py` (pipeline wiring), `printability.py` (dedicated reference QA), and focused Python tests.
- Verification: 66 Pinterest Python tests passed; `npm run typecheck` and `npm run build` passed. `npm test` passed tooling/web/gateway but failed importing `engine.tests.test_distributed` and `engine.tests.test_distributed_postgres` because the existing Python environment lacks `sqlalchemy`. Existing Vite externalization/chunk-size warnings remain.
- No public TypeScript contract, route, environment setting or dependency changes. Current-branch execution and skipping further planning approvals follow explicit user instructions.
- Remaining risk: no approved live output yet; native mask format/provider availability and real curved/folded geometry/material fidelity are not resolved by passing unit tests.
