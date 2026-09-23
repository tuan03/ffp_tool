import type { SerializedSeoOutput, SmokeStageTrace } from "./e2e-smoke-helpers";

export interface StageSnapshot {
  readonly stageName: SmokeStageTrace["stageName"];
  readonly effectiveNiche?: string;
  readonly summary: Record<string, unknown>;
}

export interface SmokeRunSummary {
  readonly startedAt: string;
  readonly completedAt: string;
  readonly durationMs: number;
  readonly input: {
    readonly title: string;
    readonly niche: string;
    readonly siteDomain?: string;
    readonly imageCount: number;
  };
  readonly environment: {
    readonly googleCloudProject?: string;
    readonly searchProvider?: string;
  };
  readonly stageTraces: readonly StageSnapshot[];
  readonly output?: SerializedSeoOutput;
  readonly error?: string;
}

interface ContentResult {
  readonly productTitle?: string;
  readonly productDescription?: string;
  readonly productSeoTitle?: string;
  readonly productSeoDescription?: string;
  readonly productHandle?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordAt(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const candidate = value[key];
  return isRecord(candidate) ? candidate : {};
}

function stringsAt(value: Record<string, unknown>, key: string): readonly string[] {
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

function recordsAt(value: Record<string, unknown>, key: string): readonly Record<string, unknown>[] {
  const candidate = value[key];
  return Array.isArray(candidate) ? candidate.filter(isRecord) : [];
}

function stringAt(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate : undefined;
}

function displayAt(value: Record<string, unknown>, key: string): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" || typeof candidate === "number" ? String(candidate) : undefined;
}

function truncate(value: string, maxLength = 180): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function renderEmpty(label = "Not available from this run"): string {
  return `<span class="empty">${escapeHtml(label)}</span>`;
}

function renderChips(values: readonly string[], className = "chip", limit = 12): string {
  if (values.length === 0) return renderEmpty();
  const visible = values.slice(0, limit);
  const overflow = values.length - visible.length;
  return `${visible.map((value) => `<span class="${className}">${escapeHtml(value)}</span>`).join("")}${
    overflow > 0 ? `<span class="${className} muted">+${overflow} more</span>` : ""
  }`;
}

function renderMetric(label: string, value: string | undefined): string {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong>${value ? escapeHtml(value) : "—"}</strong></div>`;
}

function humanizeQuerySource(value: string | undefined): string {
  const labels: Readonly<Record<string, string>> = {
    buyer_intent_seed: "Grounded buyer-intent seed",
    niche_seed: "Niche seed",
    google_autocomplete: "Google suggestion",
    scene_context_seed: "Scene discovery only",
  };
  return labels[value ?? ""] ?? "Seed";
}

function humanizeConflictReason(value: string): string {
  const labels: Readonly<Record<string, string>> = {
    scene_context_only: "Scene-only context · blocked",
    category_conflict: "Physical product mismatch",
    semantic_drift_irrelevant: "Not supported by product evidence",
    exact_duplicate: "Duplicate keyword",
    search_intent_mismatch: "Search intent mismatch",
    existing_url_cannibalization: "Existing product conflict",
    semantic_duplicate: "Near-duplicate keyword",
    low_specificity_generic: "Too generic",
  };
  return labels[value] ?? value.replace(/_/g, " ");
}

function renderKeywordList(title: string, values: readonly string[], tone: "approved" | "discarded" | "neutral" = "neutral"): string {
  return `<div class="keyword-panel ${tone}">
    <div class="panel-label">${escapeHtml(title)} <span>${values.length}</span></div>
    <div class="chips">${renderChips(values, `chip ${tone}`, 18)}</div>
  </div>`;
}

/**
 * The model output is untrusted. Escape everything first, then restore only the
 * tiny formatting vocabulary the product-description contract intentionally uses.
 */
function renderSafeRichText(value: string): string {
  const escaped = escapeHtml(value).replace(/&amp;((?:amp|quot|apos|nbsp)|#(?:\d+|x[\da-f]+));/gi, "&$1;");
  return escaped
    .replace(/&lt;(\/?)p&gt;/gi, "<$1p>")
    .replace(/&lt;(\/?)ul&gt;/gi, "<$1ul>")
    .replace(/&lt;(\/?)ol&gt;/gi, "<$1ol>")
    .replace(/&lt;(\/?)li&gt;/gi, "<$1li>")
    .replace(/&lt;(\/?)strong&gt;/gi, "<$1strong>")
    .replace(/&lt;(\/?)em&gt;/gi, "<$1em>")
    .replace(/&lt;br\s*\/??&gt;/gi, "<br>");
}

function renderLengthMeter(value: string, maxLength: number): string {
  const length = [...value].length;
  const percentage = Math.min((length / maxLength) * 100, 100);
  const state = length > maxLength ? "over" : length >= maxLength * 0.7 ? "good" : "low";
  return `<div class="length-meter ${state}" aria-label="${length} of ${maxLength} characters">
    <span style="width:${percentage.toFixed(1)}%"></span><small>${length}/${maxLength}</small>
  </div>`;
}

function renderB1(summary: Record<string, unknown>): string {
  const understanding = recordAt(summary, "productUnderstanding");
  const typography = recordAt(understanding, "typography");
  const visibleTexts = stringsAt(typography, "visibleTexts");
  return `<div class="stage-layout b1-layout">
    <div class="evidence-scope"><span class="scope-safe">Product-safe evidence</span><span class="scope-scene">Scene context is discovery-only</span></div>
    <div class="insight-grid">
      ${renderMetric("Định danh phôi sản phẩm", stringAt(understanding, "physicalProductIdentity"))}
      ${renderMetric("Typography", visibleTexts.length ? `${visibleTexts.length} text snippets` : undefined)}
      ${renderMetric("Thực thể thị giác", stringAt(understanding, "visualEntities"))}
      ${renderMetric("Bối cảnh không gian", stringAt(understanding, "sceneContext"))}
    </div>
    <div class="field-group product-evidence"><h3>Typography — chữ hiển thị trên sản phẩm</h3><div class="chips">${renderChips(visibleTexts, "chip blue")}</div><p class="runtime-note">${escapeHtml(stringAt(typography, "styleSummary") ?? "Unknown")}</p></div>
    <div class="field-group product-evidence"><h3>Visual entities — chi tiết thiết kế của sản phẩm</h3><p class="runtime-note">${escapeHtml(stringAt(understanding, "visualEntities") ?? "Unknown")}</p></div>
    <div class="field-group scene-evidence"><h3>Bối cảnh không gian</h3><p class="scene-note"><strong>Chỉ phục vụ khám phá keyword.</strong> Không được dùng như một product claim trong B5.</p><p class="runtime-note">${escapeHtml(stringAt(understanding, "sceneContext") ?? "Unknown")}</p></div>
  </div>`;
}

function renderB2(summary: Record<string, unknown>): string {
  const context = recordAt(summary, "shoppingContext");
  return `<div class="stage-layout context-layout">
    <section class="grounded-context"><div class="panel-label">Grounded product context</div>
      <div class="field-group"><h3>Target audience</h3><div class="chips">${renderChips(stringsAt(context, "targetAudience"), "chip blue")}</div></div>
      <div class="field-group"><h3>Best occasions</h3><div class="chips">${renderChips(stringsAt(context, "suitableOccasions"), "chip pink")}</div></div>
      <div class="field-group"><h3>Use cases</h3><div class="chips">${renderChips(stringsAt(context, "useCases"), "chip purple")}</div></div>
      ${renderKeywordList("Buyer-intent keyword seeds", stringsAt(context, "buyerIntentKeywords"), "neutral")}
    </section>
    <aside class="discovery-panel"><div class="panel-label">Contextual discovery only</div><p>Derived from B1 scene context. These clues are isolated from B5 product facts.</p><h3>Audience hints</h3><div class="chips">${renderChips(stringsAt(context, "contextualAudienceHints"), "chip discovery")}</div><h3>Scene search seeds</h3><div class="chips">${renderChips(stringsAt(context, "sceneSearchSeeds"), "chip discovery")}</div></aside>
  </div>`;
}

function renderB3(summary: Record<string, unknown>): string {
  const research = recordAt(summary, "searchResearch");
  const sources = recordAt(research, "querySources");
  const probeGroups = new Map<string, Array<{ query: string; kind: string }>>();
  for (const probe of recordsAt(research, "autocompleteProbes")) {
    const query = stringAt(probe, "query");
    const parentSeed = stringAt(probe, "parentSeed");
    const kind = stringAt(probe, "kind");
    if (!query || !parentSeed || (kind !== "original" && kind !== "gemini_variant")) {
      continue;
    }
    const group = probeGroups.get(parentSeed) ?? [];
    group.push({ query, kind });
    probeGroups.set(parentSeed, group);
  }
  const suggestedQueries = stringsAt(research, "suggestedQueries");
  const probeRows = probeGroups.size === 0
    ? renderEmpty("Google Autocomplete was not queried in this run")
    : Array.from(probeGroups.entries()).map(([seed, probes]) => `<section class="probe-group">
      <h3>${escapeHtml(seed)}</h3>
      <div class="chips">${probes.map((probe) => `<span class="chip ${probe.kind === "gemini_variant" ? "discovery" : "blue"}">${escapeHtml(probe.query)} <small>${probe.kind === "gemini_variant" ? "Gemini probe" : "Seed gốc"}</small></span>`).join("")}</div>
    </section>`).join("");
  const queryRows = suggestedQueries.length === 0
    ? renderEmpty()
    : suggestedQueries
      .slice(0, 16)
      .map((query, index) => `<li><span class="rank">${index + 1}</span><strong>${escapeHtml(query)}</strong><span class="source">${escapeHtml(humanizeQuerySource(stringAt(sources, query)))}</span></li>`)
      .join("");
  return `<div class="stage-layout">
    ${renderKeywordList("Seed keywords", stringsAt(research, "seedKeywords"), "neutral")}
    <div class="query-panel"><div class="panel-label">Google Autocomplete queries <span>${Array.from(probeGroups.values()).reduce((count, probes) => count + probes.length, 0)}</span></div><p class="runtime-note"><strong>Query thăm dò:</strong> Gemini probes only expand Google discovery. They do not enter B4 as direct SEO keywords.</p><div class="probe-groups">${probeRows}</div></div>
    <div class="query-panel"><div class="panel-label">Search suggestions <span>${suggestedQueries.length}</span></div><ol class="query-list">${queryRows}</ol></div>
  </div>`;
}

function renderB4(summary: Record<string, unknown>): string {
  const conflict = recordAt(summary, "conflictResult");
  const approved = stringsAt(conflict, "approvedKeywords");
  const discarded = stringsAt(conflict, "discardedKeywords");
  const reasons = recordAt(conflict, "conflictReasons");
  const reasonRows = Object.entries(reasons)
    .slice(0, 8)
    .map(([keyword, reason]) => `<li><strong>${escapeHtml(keyword)}</strong><span>${escapeHtml(humanizeConflictReason(typeof reason === "string" ? reason : "filtered"))}</span></li>`)
    .join("");
  return `<div class="stage-layout">
    <div class="conflict-grid">
      ${renderKeywordList("Approved for content", approved, "approved")}
      ${renderKeywordList("Filtered out", discarded, "discarded")}
    </div>
    ${reasonRows ? `<details class="details"><summary>Why keywords were filtered</summary><ul class="reason-list">${reasonRows}</ul></details>` : ""}
  </div>`;
}

function contentResultAt(summary: Record<string, unknown>): ContentResult {
  return recordAt(summary, "contentResult") as ContentResult;
}

function renderB5(summary: Record<string, unknown>, productUnderstanding: Record<string, unknown>): string {
  const content = contentResultAt(summary);
  const metadata = recordAt(summary, "contentGenerationMetadata");
  const typography = recordAt(productUnderstanding, "typography");
  const title = content.productTitle ?? "";
  const seoTitle = content.productSeoTitle ?? "";
  const seoDescription = content.productSeoDescription ?? "";
  return `<div class="stage-layout content-layout">
    <div class="content-hero">
      <span class="eyebrow">Primary keyword</span>
      <strong>${escapeHtml(stringAt(metadata, "primaryKeyword") ?? "Not available")}</strong>
      <span class="handle">/products/${escapeHtml(content.productHandle ?? "—")}</span>
    </div>
    <div class="seo-preview">
      <div class="preview-label">SEO preview</div>
      <h3>${title ? escapeHtml(seoTitle) : "Not available"}</h3>
      <span class="preview-url">example-store.com/products/${escapeHtml(content.productHandle ?? "")}</span>
      <p>${seoDescription ? escapeHtml(seoDescription) : "Not available"}</p>
    </div>
    <div class="seo-metrics">
      <div><span>SEO title</span>${renderLengthMeter(seoTitle, 70)}</div>
      <div><span>SEO description</span>${renderLengthMeter(seoDescription, 160)}</div>
    </div>
    <div class="field-group"><h3>Supporting keywords</h3><div class="chips">${renderChips(stringsAt(metadata, "secondaryKeywords"), "chip purple")}</div></div>
    <section class="safe-evidence"><div><span class="panel-label">Bằng chứng sản phẩm an toàn cho copy</span><p>B5 only receives physical product identity, typography and visual entities. Scene context is intentionally excluded.</p></div><div class="safe-evidence-grid">${renderMetric("Physical identity", stringAt(productUnderstanding, "physicalProductIdentity"))}${renderMetric("Typography", stringsAt(typography, "visibleTexts").length ? `${stringsAt(typography, "visibleTexts").length} text snippets` : undefined)}${renderMetric("Visual design", stringAt(productUnderstanding, "visualEntities") ? "Included from B1" : undefined)}</div></section>
    <article class="description-preview"><div class="panel-label">Product description preview</div><div class="rich-text">${content.productDescription ? renderSafeRichText(content.productDescription) : renderEmpty()}</div></article>
  </div>`;
}

function conversionIssueFor(metadata: Record<string, unknown>, imageIndex: number): Record<string, unknown> | undefined {
  const issues = metadata.issues;
  if (!Array.isArray(issues)) return undefined;
  return issues.find((issue) => isRecord(issue) && issue.imageIndex === imageIndex) as Record<string, unknown> | undefined;
}

function safeImageUrl(value: string): string {
  return /^(?:https?:|file:|images\/)/i.test(value) ? value : "";
}

function renderB6(summary: Record<string, unknown>, artifactUrls: ReadonlyMap<string, string>): string {
  const metadata = recordAt(summary, "imageProcessingMetadata");
  const imageResult = recordAt(summary, "imageResult");
  const processedImages = Array.isArray(imageResult.processedImages)
    ? imageResult.processedImages.filter(isRecord)
    : [];
  const imageCards = processedImages.map((image, index) => {
    const webp = recordAt(image, "webp");
    const filename = stringAt(webp, "filename") ?? "output.webp";
    const issue = conversionIssueFor(metadata, index);
    const state = artifactUrls.has(filename) ? "Converted WebP" : issue ? "Source WebP fallback" : "WebP output";
    const note = stringAt(issue ?? {}, "message");
    const previewUrl = safeImageUrl(artifactUrls.get(filename) ?? stringAt(image, "sourceUrl") ?? "");
    const preview = previewUrl
      ? `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(stringAt(image, "alt") ?? "")}" loading="lazy" />`
      : `<div class="asset-placeholder">WEBP</div>`;
    return `<article class="asset-row"><div class="asset-preview">${preview}</div><div class="asset-copy"><strong>${index + 1}. ${escapeHtml(filename)}</strong><span class="conversion-state ${issue ? "fallback" : "converted"}">${state}</span><p>${escapeHtml(stringAt(image, "alt") ?? "No alt text")}</p>${note ? `<small>${escapeHtml(note)}</small>` : ""}</div></article>`;
  }).join("");
  const processed = processedImages.length;
  return `<div class="stage-layout"><div class="insight-grid compact">
    ${renderMetric("Input images", displayAt(metadata, "totalImages"))}
    ${renderMetric("Converted to WebP", displayAt(metadata, "convertedImages"))}
    ${renderMetric("Conversion failures", displayAt(metadata, "failedConversions"))}
    ${renderMetric("Output assets", processed ? String(processed) : undefined)}
  </div>
  ${stringAt(metadata, "converter") ? `<div class="runtime-note">Processed with <strong>${escapeHtml(stringAt(metadata, "converter") ?? "")}</strong></div>` : ""}
  <section class="asset-gallery"><div class="panel-label">B6 asset and accessibility check</div>${imageCards || renderEmpty("No image output was created")}</section>
  </div>`;
}

function stageCopy(stageName: StageSnapshot["stageName"]): { readonly title: string; readonly subtitle: string } {
  const stages = {
    b1: { title: "Vision & product understanding", subtitle: "What the product image reveals" },
    b2: { title: "Shopping context", subtitle: "Who it is for and why they buy" },
    b3: { title: "Search research", subtitle: "Keyword discovery and query signals" },
    b4: { title: "Keyword quality gate", subtitle: "Keep relevant terms, discard conflicts" },
    b5: { title: "SEO content", subtitle: "Product copy ready for the storefront" },
    b6: { title: "Image optimisation", subtitle: "WebP assets and accessible alt text" },
  } as const;
  return stages[stageName];
}

function renderStageBody(
  trace: StageSnapshot,
  productUnderstanding: Record<string, unknown>,
  artifactUrls: ReadonlyMap<string, string>,
): string {
  switch (trace.stageName) {
    case "b1": return renderB1(trace.summary);
    case "b2": return renderB2(trace.summary);
    case "b3": return renderB3(trace.summary);
    case "b4": return renderB4(trace.summary);
    case "b5": return renderB5(trace.summary, productUnderstanding);
    case "b6": return renderB6(trace.summary, artifactUrls);
  }
}

function renderStageCards(traces: readonly StageSnapshot[], artifactUrls: ReadonlyMap<string, string>): string {
  if (traces.length === 0) return `<section class="stage-card empty-stage">No stage finished before this run stopped.</section>`;
  const b1Trace = traces.find((trace) => trace.stageName === "b1");
  const productUnderstanding = recordAt(b1Trace?.summary ?? {}, "productUnderstanding");
  return traces.map((trace) => {
    const copy = stageCopy(trace.stageName);
    return `<section class="stage-card stage-${trace.stageName}">
      <header class="stage-header"><span class="stage-id">${trace.stageName.toUpperCase()}</span><div><h2>${copy.title}</h2><p>${copy.subtitle}</p></div>${trace.effectiveNiche ? `<span class="niche-pill">${escapeHtml(trace.effectiveNiche)}</span>` : ""}</header>
      ${renderStageBody(trace, productUnderstanding, artifactUrls)}
    </section>`;
  }).join("\n");
}

function renderDelivery(summary: SmokeRunSummary): string {
  if (!summary.output) return "";
  return `<section class="delivery-card"><div class="delivery-header"><div><span class="eyebrow">Final delivery</span><h2>Ready-to-review storefront assets</h2></div><span class="delivery-count">${summary.output.images.length} WebP ${summary.output.images.length === 1 ? "asset" : "assets"}</span></div>
    <div class="final-content"><div><span class="eyebrow">Product title</span><strong>${escapeHtml(summary.output.productTitle)}</strong></div><div><span class="eyebrow">Handle</span><strong>/products/${escapeHtml(summary.output.productHandle)}</strong></div></div>
  </section>`;
}

export function renderSmokeReport(summary: SmokeRunSummary, artifactUrls: ReadonlyMap<string, string>): string {
  const isFailed = Boolean(summary.error);
  const status = isFailed ? "Run needs attention" : "B1 → B6 completed";
  const activeStages = new Set(summary.stageTraces.map((trace) => trace.stageName));
  const effectiveNiche = [...summary.stageTraces].reverse().find((trace) => trace.effectiveNiche)?.effectiveNiche ?? summary.input.niche;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SEO Content B1–B6 Smoke Report</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #e8eefc; background: #0b1020; }
    * { box-sizing: border-box; } body { margin: 0; min-width: 320px; background: radial-gradient(circle at 14% -10%, #273d81 0, transparent 30rem), radial-gradient(circle at 90% 0, #1a604e 0, transparent 28rem), #0b1020; }
    main { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 54px 0 72px; } h1, h2, h3, p { margin: 0; } h1 { font-size: clamp(2rem, 5vw, 3.45rem); letter-spacing: -.045em; max-width: 750px; } h2 { font-size: 1.18rem; letter-spacing: -.02em; } h3 { font-size: .9rem; color: #9eb0d1; font-weight: 600; margin-bottom: 10px; } strong { color: #fff; } .eyebrow, .panel-label { display: block; color: #92a7d3; font-size: .69rem; font-weight: 800; text-transform: uppercase; letter-spacing: .12em; }
    .hero { padding: 8px 0 26px; } .hero p { margin-top: 12px; color: #afbdd9; font-size: 1rem; }.status { display: inline-flex; align-items: center; gap: 8px; margin-top: 22px; padding: 8px 12px; border: 1px solid #3a556d; border-radius: 100px; background: #122037; color: #bdebd5; font-size: .84rem; font-weight: 750; }.status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: #4be49c; box-shadow: 0 0 14px #4be49c; }.status.failed { color: #ffc2ce; }.status.failed::before { background: #fb7185; box-shadow: 0 0 14px #fb7185; }
    .overview { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 18px 0; }.overview-card { min-height: 94px; padding: 16px; border: 1px solid rgba(136, 161, 210, .24); border-radius: 16px; background: rgba(20, 31, 53, .83); box-shadow: 0 16px 38px rgba(0,0,0,.12); }.overview-card span { display: block; color: #99abd0; font-size: .76rem; margin-bottom: 8px; }.overview-card strong { display: block; font-size: 1.03rem; overflow-wrap: anywhere; }.overview-card.primary { background: linear-gradient(135deg, #203f88, #1a2961); border-color: #5577cf; }
    .runtime-line { margin: 13px 2px 0; color: #91a6cc; font-size: .78rem; }.timeline { display: flex; align-items: center; gap: 7px; padding: 17px; margin: 18px 0 28px; border: 1px solid #2c3e62; border-radius: 16px; background: rgba(14, 23, 42, .78); overflow-x: auto; }.timeline span { display: flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 42px; height: 28px; border: 1px solid #394c71; border-radius: 8px; color: #8091b3; font-size: .73rem; font-weight: 800; }.timeline span.active { color: #eaf2ff; border-color: #6293ff; background: #2757c8; }.timeline i { flex: 1 0 14px; min-width: 14px; height: 1px; background: #34486b; }
    .stage-card, .delivery-card { margin-top: 18px; border: 1px solid #2e4265; border-radius: 19px; background: rgba(19, 30, 52, .91); overflow: hidden; box-shadow: 0 18px 50px rgba(0,0,0,.17); }.stage-card { border-left: 4px solid #4d7cff; }.stage-b2 { border-left-color: #cb72e7; }.stage-b3 { border-left-color: #38c9b2; }.stage-b4 { border-left-color: #f1b85b; }.stage-b5 { border-left-color: #fa7fa0; }.stage-b6 { border-left-color: #60c2ff; }.stage-header { display: flex; align-items: center; gap: 13px; padding: 20px 22px; border-bottom: 1px solid #2a3c5b; background: linear-gradient(90deg, rgba(40, 65, 116, .34), transparent); }.stage-header p { margin-top: 4px; color: #93a5c9; font-size: .82rem; }.stage-id { display: inline-flex; align-items: center; justify-content: center; width: 43px; height: 34px; border-radius: 10px; background: #2659ce; color: #fff; font-size: .81rem; font-weight: 900; }.stage-b2 .stage-id { background: #9e45bb; }.stage-b3 .stage-id { background: #147d70; }.stage-b4 .stage-id { background: #ae7214; }.stage-b5 .stage-id { background: #c3486a; }.stage-b6 .stage-id { background: #1b76b3; }.niche-pill { margin-left: auto; max-width: 35%; padding: 7px 10px; border: 1px solid #405a86; border-radius: 100px; background: #142643; color: #c6d9fb; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .77rem; }
    .stage-layout { padding: 21px 22px; }.insight-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }.insight-grid.compact { grid-template-columns: repeat(4, minmax(0, 1fr)); }.metric { padding: 13px; min-height: 71px; border-radius: 12px; background: #101b32; border: 1px solid #273b60; }.metric span { display: block; color: #8fa3cb; font-size: .73rem; margin-bottom: 6px; }.metric strong { font-size: .92rem; overflow-wrap: anywhere; }.field-group { margin-top: 18px; }.chips { display: flex; flex-wrap: wrap; gap: 7px; }.chip { display: inline-flex; align-items: center; max-width: 100%; padding: 6px 9px; border-radius: 8px; background: #243554; color: #dce8ff; font-size: .78rem; overflow-wrap: anywhere; }.chip.blue { background: #193c77; color: #cfe2ff; }.chip.purple { background: #3e2d72; color: #e2d9ff; }.chip.pink { background: #682f55; color: #ffd7ea; }.chip.discovery { background: #5a441a; color: #ffe2a2; }.chip.approved { background: #153f35; color: #bff5d8; }.chip.discarded { background: #5a313c; color: #ffc9d5; }.chip.muted { color: #9caed0; background: #243149; }.empty { color: #8798b9; font-size: .84rem; font-style: italic; }.evidence-scope { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }.scope-safe, .scope-scene, .conversion-state { display: inline-flex; align-items: center; width: fit-content; padding: 5px 8px; border-radius: 100px; font-size: .69rem; font-weight: 800; letter-spacing: .02em; }.scope-safe { background: #163e35; color: #b5f1d3; border: 1px solid #337968; }.scope-scene { background: #4a3518; color: #ffe1a3; border: 1px solid #886526; }.product-evidence { border-left: 2px solid #3a70be; padding-left: 12px; }.scene-evidence { border-left: 2px solid #c59136; padding-left: 12px; }.scene-note { margin-bottom: 10px; color: #f0cf91; font-size: .79rem; line-height: 1.45; }
    .keyword-panel, .query-panel, .description-preview, .grounded-context, .discovery-panel, .safe-evidence, .asset-gallery { padding: 15px; border: 1px solid #2a3f64; border-radius: 13px; background: #101b32; }.keyword-panel.approved { border-color: #2e705d; background: linear-gradient(145deg, #112a27, #101b32); }.keyword-panel.discarded { border-color: #71404b; background: linear-gradient(145deg, #321f2a, #101b32); }.panel-label { margin-bottom: 10px; }.panel-label span { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; margin-left: 5px; padding: 0 5px; border-radius: 100px; background: #273c62; color: #d8e5ff; font-size: .68rem; }.keyword-panel .chips { max-height: 128px; overflow: auto; padding-right: 4px; }.context-layout { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(230px, .6fr); gap: 14px; }.grounded-context .field-group:first-of-type, .discovery-panel h3:first-of-type { margin-top: 0; }.discovery-panel { border-color: #765d29; background: linear-gradient(145deg, #2d2518, #101b32); }.discovery-panel p { color: #e6d3a5; font-size: .81rem; line-height: 1.45; margin-bottom: 16px; }.discovery-panel h3 { margin-top: 17px; }.conflict-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }.query-panel { margin-top: 15px; }.probe-groups { display: grid; gap: 9px; }.probe-group { padding: 10px; border: 1px solid #263b5e; border-radius: 9px; background: #0c172c; }.probe-group h3 { margin-bottom: 8px; color: #dbe7ff; font-size: .8rem; }.probe-group .chip small { margin-left: 5px; color: #a6c7e8; font-size: .66rem; font-weight: 800; }.query-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 0; margin: 0; list-style: none; }.query-list li { display: flex; align-items: center; gap: 8px; padding: 8px; border: 1px solid #263b5e; border-radius: 9px; background: #0c172c; min-width: 0; }.query-list strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .79rem; }.rank { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 21px; height: 21px; border-radius: 7px; background: #194d65; color: #bbf1fa; font-size: .68rem; font-weight: 800; }.source { margin-left: auto; color: #8fa4c7; font-size: .64rem; white-space: nowrap; }.details { margin-top: 14px; color: #bbcbe9; }.details summary { cursor: pointer; color: #a7c4ff; font-size: .83rem; }.reason-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 12px 0 0; margin: 0; list-style: none; }.reason-list li { padding: 9px; border-radius: 8px; background: #121d32; }.reason-list strong, .reason-list span { display: block; font-size: .75rem; }.reason-list span { margin-top: 4px; color: #92a5c8; }
    .content-layout { display: grid; grid-template-columns: minmax(200px, .7fr) minmax(0, 1.3fr); gap: 14px; }.content-hero { display: flex; flex-direction: column; justify-content: center; gap: 9px; min-height: 175px; padding: 19px; border: 1px solid #704354; border-radius: 14px; background: linear-gradient(145deg, #3d2032, #20192d); }.content-hero strong { font-size: 1.25rem; overflow-wrap: anywhere; }.handle { color: #f3bdd0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .76rem; }.seo-preview { padding: 19px; border: 1px solid #37548c; border-radius: 14px; background: linear-gradient(145deg, #102646, #121e34); }.seo-preview h3 { margin-top: 7px; color: #a6c9ff; font-size: 1.12rem; }.preview-url { display: block; margin-top: 7px; color: #83c894; font-size: .77rem; }.seo-preview p { margin-top: 8px; color: #d6e1f8; line-height: 1.45; font-size: .87rem; }.seo-metrics { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }.seo-metrics > div > span { display: block; margin-bottom: 7px; color: #9eb0d1; font-size: .78rem; }.length-meter { position: relative; height: 18px; border-radius: 100px; overflow: hidden; background: #21314e; }.length-meter > span { display: block; height: 100%; background: linear-gradient(90deg, #5262c9, #5dcdba); }.length-meter.low > span { background: #596a8a; }.length-meter.over > span { background: #e2617c; }.length-meter small { position: absolute; inset: 0 7px 0 auto; display: flex; align-items: center; color: #f6f8ff; font-size: .66rem; font-weight: 800; text-shadow: 0 1px 2px #000; }.content-layout > .field-group, .content-layout > .description-preview { grid-column: 1 / -1; margin-top: 0; }.safe-evidence { grid-column: 1 / -1; margin: 0; border-color: #337968; background: linear-gradient(145deg, #112d28, #101b32); }.safe-evidence p { margin-top: 7px; color: #bde6d5; font-size: .8rem; line-height: 1.45; }.safe-evidence-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }.safe-evidence .metric { min-height: 0; background: rgba(8, 31, 28, .68); border-color: #2f6258; }.description-preview { background: #0b1528; }.rich-text { color: #e7efff; line-height: 1.65; font-size: .92rem; }.rich-text p:first-child { margin-top: 0; }.rich-text p { margin: 12px 0; }.rich-text ul, .rich-text ol { padding-left: 22px; }.rich-text li { margin: 5px 0; }.runtime-note { margin-top: 14px; padding: 10px 12px; border-radius: 9px; background: #15233d; color: #b8cbea; font-size: .8rem; }.asset-gallery { margin-top: 15px; }.asset-row { display: grid; grid-template-columns: 78px minmax(0, 1fr); gap: 12px; padding: 11px 0; border-top: 1px solid #2b4265; }.asset-row:first-of-type { border-top: 0; }.asset-preview { width: 78px; height: 78px; overflow: hidden; border: 1px solid #365c7c; border-radius: 10px; background: #eaf1fc; }.asset-preview img { width: 100%; height: 100%; display: block; object-fit: contain; }.asset-placeholder { display: grid; width: 100%; height: 100%; place-items: center; color: #38566e; font-size: .73rem; font-weight: 900; }.asset-copy { min-width: 0; }.asset-row strong { display: block; font-size: .84rem; overflow-wrap: anywhere; }.asset-row p, .asset-row small { display: block; margin-top: 6px; color: #b6c9e6; font-size: .78rem; }.asset-row small { color: #e7b8c2; }.conversion-state { margin-top: 6px; background: #173e37; color: #baf3db; border: 1px solid #337568; }.conversion-state.fallback { background: #4a3518; color: #ffe1a3; border-color: #856124; }
    .delivery-card { padding: 22px; border-color: #345d82; background: linear-gradient(145deg, #10243a, #13213a 45%, #14203a); }.delivery-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }.delivery-header h2 { margin-top: 5px; font-size: 1.28rem; }.delivery-count { padding: 8px 11px; border: 1px solid #42688b; border-radius: 100px; color: #c7e8ff; background: #102b46; font-size: .76rem; white-space: nowrap; }.final-content { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 17px 0; }.final-content > div { padding: 12px; border: 1px solid #2a4b6e; border-radius: 11px; background: rgba(8, 21, 39, .58); }.final-content strong { display: block; margin-top: 6px; font-size: .92rem; overflow-wrap: anywhere; }.gallery { display: grid; grid-template-columns: repeat(auto-fit, minmax(275px, 1fr)); gap: 12px; }.image-card { display: grid; grid-template-columns: 112px 1fr; gap: 13px; padding: 11px; border: 1px solid #2e506e; border-radius: 13px; background: #0b172a; }.image-preview { position: relative; width: 112px; height: 112px; overflow: hidden; border-radius: 9px; background: #e9f0f9; }.image-preview img { width: 100%; height: 100%; object-fit: contain; display: block; }.image-preview > span { position: absolute; top: 6px; left: 6px; display: flex; align-items: center; justify-content: center; min-width: 22px; height: 22px; padding: 0 5px; border-radius: 7px; background: #195e9e; color: white; font-size: .7rem; font-weight: 850; }.image-placeholder { display: grid; place-items: center; width: 100%; height: 100%; color: #31516e; font-weight: 900; }.image-copy { min-width: 0; display: flex; flex-direction: column; justify-content: center; gap: 9px; }.image-copy strong { font-size: .83rem; overflow-wrap: anywhere; }.image-copy p { color: #c1d2ef; font-size: .82rem; line-height: 1.35; }.empty-stage { padding: 20px; color: #aab9d3; }
    .error { margin-top: 16px; padding: 15px; border: 1px solid #8c4655; border-radius: 13px; background: #3b1f2a; color: #ffd8df; line-height: 1.45; }.error strong { display: block; margin-bottom: 5px; color: #fff; }
    @media (max-width: 760px) { main { width: min(100% - 22px, 1180px); padding-top: 30px; }.overview, .insight-grid, .insight-grid.compact, .content-layout, .seo-metrics, .safe-evidence, .context-layout, .conflict-grid, .final-content { grid-template-columns: 1fr 1fr; }.content-hero, .seo-preview, .content-layout > .field-group, .content-layout > .description-preview, .safe-evidence { grid-column: 1 / -1; }.safe-evidence-grid { grid-template-columns: 1fr; }.query-list, .reason-list { grid-template-columns: 1fr; }.niche-pill { display: none; } }
    @media (max-width: 480px) { .overview, .insight-grid, .insight-grid.compact, .seo-metrics, .conflict-grid, .final-content { grid-template-columns: 1fr; }.stage-header, .delivery-header { align-items: flex-start; }.delivery-header { flex-direction: column; }.stage-layout, .stage-header, .delivery-card { padding: 16px; }.image-card { grid-template-columns: 88px 1fr; }.image-preview { width: 88px; height: 88px; } }
  </style>
</head>
<body>
  <main>
    <header class="hero"><span class="eyebrow">Manual smoke test · ${escapeHtml(summary.startedAt)}</span><h1>SEO Content pipeline, made readable.</h1><p>Visual trace of the B1 → B6 workflow for <strong>${escapeHtml(summary.input.title)}</strong>.</p><span class="status ${isFailed ? "failed" : ""}">${status} · ${(summary.durationMs / 1000).toFixed(1)}s</span></header>
    <section class="overview" aria-label="Run overview">
      <article class="overview-card primary"><span>Effective niche</span><strong>${escapeHtml(effectiveNiche)}</strong></article>
      <article class="overview-card"><span>Manual fallback niche</span><strong>${escapeHtml(summary.input.niche)}</strong></article>
      <article class="overview-card"><span>Storefront domain</span><strong>${escapeHtml(summary.input.siteDomain ?? "Not supplied")}</strong></article>
      <article class="overview-card"><span>Images</span><strong>${summary.input.imageCount} supplied · ${summary.output?.images.length ?? 0} WebP</strong></article>
    </section>
    <p class="runtime-line">Runtime: <strong>${escapeHtml(summary.environment.googleCloudProject ?? "Gemini project not configured")}</strong>${summary.environment.searchProvider ? ` · Search: <strong>${escapeHtml(summary.environment.searchProvider)}</strong>` : ""}</p>
    <nav class="timeline" aria-label="Pipeline stages">${(["b1", "b2", "b3", "b4", "b5", "b6"] as const).map((stage, index) => `<span class="${activeStages.has(stage) ? "active" : ""}">${stage.toUpperCase()}</span>${index < 5 ? "<i></i>" : ""}`).join("")}</nav>
    ${summary.error ? `<aside class="error"><strong>Run stopped early</strong>${escapeHtml(summary.error)}</aside>` : ""}
    ${renderStageCards(summary.stageTraces, artifactUrls)}
    ${renderDelivery(summary)}
  </main>
</body>
</html>`;
}
