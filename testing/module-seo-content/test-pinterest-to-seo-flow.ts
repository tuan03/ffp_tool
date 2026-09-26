import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { loadServerEnvironment } from "../../src/config/server-environment";
import { handoverPinterestToSeo } from "../../src/modules/orchestrator";
import type {
  PinterestPodDeliverables,
  PodDeliverableItem,
} from "../../src/modules/pinterest-pod";
import type { SeoContentOutput } from "../../src/modules/seo-content";
import { loadSmokePipelineRuntime } from "./runtime-loader";
import { serializeSeoOutput } from "./e2e-smoke-helpers";

const executeFile = promisify(execFile);

// 2 File ảnh thực tế trên đĩa của người dùng
const PHOTO_1_PATH = "D:\\D-Downloads\\shopify-download\\2aOboR1HqOz2K68UN8nL3svqGDv5rriTXu6RHCeu.jpg";
const PHOTO_2_PATH = "D:\\D-Downloads\\shopify-download\\2aOboR1HqP2Rxa3TACpxVCs1NBJ9PbSUbOabODgG.jpg";

interface StageExecutionTrace {
  readonly stageName: string;
  readonly durationMs: number;
  readonly description: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function renderHtmlReport(params: {
  readonly workflowId: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly deliverables: PinterestPodDeliverables;
  readonly seoOutput: SeoContentOutput;
  readonly stageTraces: readonly StageExecutionTrace[];
  readonly photo1Info: { readonly path: string; readonly size: number; readonly base64: string };
  readonly photo2Info: { readonly path: string; readonly size: number; readonly base64: string };
}): string {
  const {
    workflowId,
    startedAt,
    durationMs,
    deliverables,
    seoOutput,
    stageTraces,
    photo1Info,
    photo2Info,
  } = params;

  const item = deliverables.items[0];
  const inputJsonString = JSON.stringify(deliverables, null, 2);
  const outputJsonString = JSON.stringify(seoOutput, null, 2);

  const seoTitleLen = seoOutput.productSeoTitle?.length ?? 0;
  const seoDescLen = seoOutput.productSeoDescription?.length ?? 0;
  const wordCount = seoOutput.aeo_quick_summary
    ? seoOutput.aeo_quick_summary.split(/\s+/).filter(Boolean).length
    : 0;

  return `<!DOCTYPE html>
<html lang="vi" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pinterest POD ➔ SEO Content Pipeline Report | ${escapeHtml(item.designId)}</title>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f293d;
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.15);
      --success: #10b981;
      --warning: #f59e0b;
      --text-main: #f3f4f6;
      --text-muted: #9ca3af;
      --code-bg: #0d111c;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      line-height: 1.5;
      padding-bottom: 60px;
    }
    .container {
      max-width: 1280px;
      margin: 0 auto;
      padding: 0 20px;
    }
    /* Sticky Top Header */
    header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: rgba(9, 13, 22, 0.88);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--card-border);
      padding: 16px 0;
      margin-bottom: 28px;
    }
    .header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 16px;
    }
    .title-group h1 {
      font-size: 1.35rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
      background: linear-gradient(135deg, #a5b4fc, #e0e7ff);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .title-group p {
      font-size: 0.85rem;
      color: var(--text-muted);
    }
    .badge-group {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
    }
    .badge-success {
      background: rgba(16, 185, 129, 0.15);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .badge-flow {
      background: rgba(99, 102, 241, 0.15);
      color: #a5b4fc;
      border: 1px solid rgba(99, 102, 241, 0.3);
    }
    .badge-neutral {
      background: #1f2937;
      color: #d1d5db;
      border: 1px solid #374151;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: currentColor;
      box-shadow: 0 0 8px currentColor;
    }
    /* Section & Cards */
    section {
      margin-bottom: 32px;
    }
    .section-title {
      font-size: 1.15rem;
      font-weight: 700;
      color: #e5e7eb;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
    }
    /* Pipeline Stepper */
    .stepper {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
      margin-bottom: 24px;
    }
    .step-item {
      background: #131b2e;
      border: 1px solid #23314d;
      border-radius: 10px;
      padding: 12px 14px;
      position: relative;
    }
    .step-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }
    .step-id {
      font-weight: 700;
      font-size: 0.85rem;
      color: #818cf8;
    }
    .step-time {
      font-size: 0.75rem;
      color: #34d399;
      font-weight: 600;
    }
    .step-desc {
      font-size: 0.75rem;
      color: #94a3b8;
    }
    /* Visual Gallery (2 Ảnh Thật) */
    .gallery-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 20px;
    }
    .image-card {
      background: #111827;
      border: 1px solid var(--card-border);
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .image-preview-wrapper {
      position: relative;
      background: #000;
      aspect-ratio: 1 / 1;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .image-preview-wrapper img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: transform 0.3s ease;
    }
    .image-preview-wrapper:hover img {
      transform: scale(1.03);
    }
    .image-tag {
      position: absolute;
      top: 12px;
      left: 12px;
      background: rgba(17, 24, 39, 0.85);
      backdrop-filter: blur(6px);
      border: 1px solid rgba(255, 255, 255, 0.15);
      color: #fff;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 600;
    }
    .image-meta {
      padding: 16px;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .image-meta h4 {
      font-size: 0.95rem;
      color: #f9fafb;
    }
    .meta-row {
      font-size: 0.8rem;
      color: #9ca3af;
      word-break: break-all;
    }
    .meta-row strong {
      color: #d1d5db;
    }
    .alt-box {
      background: #1a2234;
      border-left: 3px solid var(--accent);
      padding: 8px 12px;
      border-radius: 0 6px 6px 0;
      font-size: 0.8rem;
      color: #cbd5e1;
    }
    /* Google SERP Preview */
    .serp-card {
      background: #ffffff;
      color: #202124;
      border-radius: 12px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      font-family: Arial, sans-serif;
    }
    .serp-site {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #202124;
      margin-bottom: 4px;
    }
    .serp-favicon {
      width: 18px;
      height: 18px;
      background: #ea4335;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-size: 11px;
      font-weight: bold;
    }
    .serp-url {
      font-size: 13px;
      color: #4d5156;
    }
    .serp-title {
      font-size: 20px;
      color: #1a0dab;
      line-height: 1.3;
      margin-bottom: 4px;
      font-weight: 400;
      text-decoration: none;
      cursor: pointer;
    }
    .serp-title:hover {
      text-decoration: underline;
    }
    .serp-desc {
      font-size: 14px;
      color: #4d5156;
      line-height: 1.5;
    }
    .char-meter {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.75rem;
      color: #6b7280;
      margin-top: 6px;
    }
    .char-meter.ok {
      color: #059669;
    }
    /* Spec Grid */
    .spec-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .spec-cell {
      background: #151e30;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 10px 14px;
    }
    .spec-cell .label {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .spec-cell .value {
      font-size: 0.9rem;
      font-weight: 600;
      color: #f3f4f6;
      margin-top: 2px;
    }
    /* Chips */
    .chip-group {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 10px 0;
    }
    .chip {
      background: #1e293b;
      border: 1px solid #334155;
      color: #94a3b8;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.8rem;
    }
    .chip-accent {
      background: rgba(99, 102, 241, 0.15);
      border-color: rgba(99, 102, 241, 0.35);
      color: #c7d2fe;
    }
    /* AEO Callout */
    .aeo-box {
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(168, 85, 247, 0.1));
      border: 1px solid rgba(139, 92, 246, 0.3);
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 16px;
    }
    .aeo-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .aeo-title {
      font-size: 0.9rem;
      font-weight: 700;
      color: #c084fc;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .aeo-text {
      font-size: 0.9rem;
      color: #e2e8f0;
      line-height: 1.6;
    }
    /* FAQ Accordion */
    .faq-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .faq-item {
      background: #141d2f;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      overflow: hidden;
    }
    .faq-q {
      padding: 12px 16px;
      font-weight: 600;
      font-size: 0.9rem;
      color: #f1f5f9;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .faq-a {
      padding: 0 16px 14px 16px;
      font-size: 0.85rem;
      color: #cbd5e1;
      line-height: 1.5;
    }
    /* Code block */
    .code-container {
      position: relative;
      background: var(--code-bg);
      border: 1px solid var(--card-border);
      border-radius: 8px;
      overflow: hidden;
    }
    .code-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 14px;
      background: #151c2e;
      border-bottom: 1px solid var(--card-border);
      font-size: 0.75rem;
      color: #94a3b8;
    }
    .code-actions {
      display: flex;
      gap: 8px;
    }
    pre {
      padding: 16px;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.8rem;
      color: #cbd5e1;
      max-height: 380px;
      line-height: 1.45;
    }
    /* Buttons */
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.2s ease;
    }
    .btn-primary {
      background: var(--accent);
      color: #fff;
    }
    .btn-primary:hover {
      background: #4f46e5;
    }
    .btn-secondary {
      background: #1f293d;
      color: #e5e7eb;
      border: 1px solid #374151;
    }
    .btn-secondary:hover {
      background: #2b3952;
    }
    .rich-desc {
      background: #141d2f;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      padding: 18px;
      font-size: 0.9rem;
      line-height: 1.6;
      color: #e2e8f0;
    }
    .rich-desc p {
      margin-bottom: 12px;
    }
    .rich-desc ul, .rich-desc ol {
      margin-left: 20px;
      margin-bottom: 12px;
    }
    .rich-desc li {
      margin-bottom: 4px;
    }
    .rich-desc strong {
      color: #fff;
    }
  </style>
</head>
<body>

  <!-- Top Sticky Header -->
  <header>
    <div class="container header-content">
      <div class="title-group">
        <h1>
          <span>⚡ Pinterest POD ➔ SEO Content Pipeline Flow</span>
        </h1>
        <p>Thực thi End-to-End với 2 file ảnh thật trên đĩa &amp; Deliverables chuẩn CONTRACT_PINTEREST_POD_TO_SEO.md</p>
      </div>
      <div class="badge-group">
        <span class="badge badge-success"><span class="dot"></span> SUCCESS (200 OK)</span>
        <span class="badge badge-flow">Pinterest POD ➔ Orchestrator ➔ SEO</span>
        <span class="badge badge-neutral">⏱️ ${durationMs} ms</span>
        <span class="badge badge-neutral">🆔 ${escapeHtml(workflowId)}</span>
      </div>
    </div>
  </header>

  <main class="container">

    <!-- Stepper B1 -> B6 -->
    <section>
      <div class="stepper">
        ${stageTraces.map((st) => `
          <div class="step-item">
            <div class="step-header">
              <span class="step-id">${escapeHtml(st.stageName.toUpperCase())}</span>
              <span class="step-time">✔ ${st.durationMs}ms</span>
            </div>
            <div class="step-desc">${escapeHtml(st.description)}</div>
          </div>
        `).join("")}
      </div>
    </section>

    <!-- SECTION 1: Visual Image Gallery (2 Ảnh Thật) -->
    <section>
      <h2 class="section-title">🖼️ 1. Hình Ảnh Thực Tế Nạp Vào Pipeline (Stage B1 &amp; B6)</h2>
      <div class="gallery-grid">

        <!-- Ảnh 1: Lifestyle Mockup -->
        <article class="image-card">
          <div class="image-preview-wrapper">
            <img src="${photo1Info.base64}" alt="Lifestyle Mockup: Thảm tròn Halloween" />
            <span class="image-tag">Mockup 1: Lifestyle Scene</span>
          </div>
          <div class="image-meta">
            <h4>${escapeHtml(item.composedMockups?.[0]?.detectedSceneDescription ?? "Lifestyle Mockup")}</h4>
            <div class="meta-row"><strong>Phối cảnh:</strong> ${escapeHtml(item.composedMockups?.[0]?.detectedSceneType ?? "fall entryway porch")}</div>
            <div class="meta-row"><strong>Local File:</strong> <code>${escapeHtml(photo1Info.path)}</code> (${formatBytes(photo1Info.size)})</div>
            <div class="alt-box">
              <strong>B6 Optimized Alt Text:</strong><br>
              ${escapeHtml(seoOutput.images?.[0]?.alt ?? "Đang cập nhật")}
            </div>
            <div class="meta-row"><strong>Shopify WebP Asset:</strong> <code>${escapeHtml(seoOutput.images?.[0]?.webp?.filename ?? "output-1.webp")}</code></div>
          </div>
        </article>

        <!-- Ảnh 2: Size Chart -->
        <article class="image-card">
          <div class="image-preview-wrapper">
            <img src="${photo2Info.base64}" alt="Specification Size Chart" />
            <span class="image-tag">Mockup 2: Size &amp; Specs Chart</span>
          </div>
          <div class="image-meta">
            <h4>${escapeHtml(item.composedMockups?.[1]?.detectedSceneDescription ?? "Specification Size Chart")}</h4>
            <div class="meta-row"><strong>Phối cảnh:</strong> ${escapeHtml(item.composedMockups?.[1]?.detectedSceneType ?? "specification size chart")}</div>
            <div class="meta-row"><strong>Local File:</strong> <code>${escapeHtml(photo2Info.path)}</code> (${formatBytes(photo2Info.size)})</div>
            <div class="alt-box">
              <strong>B6 Optimized Alt Text:</strong><br>
              ${escapeHtml(seoOutput.images?.[1]?.alt ?? "Đang cập nhật")}
            </div>
            <div class="meta-row"><strong>Shopify WebP Asset:</strong> <code>${escapeHtml(seoOutput.images?.[1]?.webp?.filename ?? "output-2.webp")}</code></div>
          </div>
        </article>

      </div>
    </section>

    <!-- SECTION 2: Pinterest POD Deliverables (Input Contract) -->
    <section>
      <h2 class="section-title">📦 2. Gói Bàn Giao Từ Pinterest POD (Input Payload)</h2>
      <div class="card">
        <div class="spec-grid">
          <div class="spec-cell">
            <div class="label">Design ID</div>
            <div class="value">${escapeHtml(item.designId)}</div>
          </div>
          <div class="spec-cell">
            <div class="label">Candidate ID</div>
            <div class="value">${escapeHtml(item.sourceCandidateId ?? "—")}</div>
          </div>
          <div class="spec-cell">
            <div class="label">Product Type</div>
            <div class="value" style="color: #6ee7b7;">${escapeHtml(item.productType ?? "rug")}</div>
          </div>
          <div class="spec-cell">
            <div class="label">Print Master (300 DPI)</div>
            <div class="value">${item.printMaster?.widthPx ?? 6000} x ${item.printMaster?.heightPx ?? 6000} px</div>
          </div>
        </div>

        <div style="margin-bottom: 12px;">
          <span style="font-size: 0.8rem; color: #94a3b8; font-weight: 600;">Original Pin Title:</span>
          <p style="font-size: 0.95rem; font-weight: 600; color: #f9fafb;">${escapeHtml(item.originalPinTitle)}</p>
        </div>

        <div style="margin-bottom: 16px;">
          <span style="font-size: 0.8rem; color: #94a3b8; font-weight: 600;">Pinterest Trend Keywords:</span>
          <div class="chip-group">
            ${(item.trendKeywords ?? []).map((kw) => `<span class="chip chip-accent"># ${escapeHtml(kw)}</span>`).join("")}
          </div>
        </div>

        <!-- Raw Input JSON Box -->
        <div class="code-container">
          <div class="code-header">
            <span>RAW INPUT JSON (CONTRACT_PINTEREST_POD_TO_SEO.md)</span>
            <div class="code-actions">
              <button class="btn btn-secondary" onclick="copyToClipboard('input-json', this)">📋 Copy Input JSON</button>
            </div>
          </div>
          <pre id="input-json">${escapeHtml(inputJsonString)}</pre>
        </div>
      </div>
    </section>

    <!-- SECTION 3: SEO Content Outputs -->
    <section>
      <h2 class="section-title">🚀 3. Thành Phẩm Tối Ưu Hóa SEO &amp; AEO (Pipeline Output)</h2>

      <!-- Product Title -->
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span style="font-size: 0.8rem; color: #818cf8; font-weight: 700; text-transform: uppercase;">Optimized Product Title</span>
          <button class="btn btn-secondary" onclick="copyText('${escapeHtml(seoOutput.productTitle).replace(/'/g, "\\'")}', this)">📋 Copy Title</button>
        </div>
        <h3 style="font-size: 1.2rem; color: #fff; font-weight: 700;">${escapeHtml(seoOutput.productTitle)}</h3>
        <span class="char-meter ok">Độ dài: ${seoOutput.productTitle.length} ký tự (chuẩn eCommerce)</span>
      </div>

      <!-- Google SERP Snippet Preview -->
      <div class="serp-card">
        <div class="serp-site">
          <span class="serp-favicon">S</span>
          <div>
            <div>Your Shopify Store</div>
            <div class="serp-url">https://yourstore.com/products/${escapeHtml(seoOutput.productHandle)}</div>
          </div>
        </div>
        <a class="serp-title" href="#serp">${escapeHtml(seoOutput.productSeoTitle)}</a>
        <div class="serp-desc">${escapeHtml(seoOutput.productSeoDescription)}</div>
        <div style="display: flex; gap: 16px; margin-top: 10px; border-top: 1px solid #eee; padding-top: 8px;">
          <span class="char-meter ${seoTitleLen <= 70 ? "ok" : ""}">SEO Title: ${seoTitleLen}/70 ký tự</span>
          <span class="char-meter ${seoDescLen <= 160 ? "ok" : ""}">Meta Description: ${seoDescLen}/160 ký tự</span>
        </div>
      </div>

      <!-- Product Description Rendered HTML -->
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span style="font-size: 0.85rem; color: #94a3b8; font-weight: 700;">Product Description (Rendered Storefront Preview)</span>
          <button class="btn btn-secondary" onclick="copyText(document.getElementById('raw-desc-content').innerText, this)">📋 Copy Description HTML</button>
        </div>
        <div class="rich-desc">
          ${seoOutput.productDescription}
        </div>
        <details style="margin-top: 14px;">
          <summary style="font-size: 0.8rem; color: #818cf8; cursor: pointer; padding: 4px 0;">Xem mã nguồn HTML thô</summary>
          <div class="code-container" style="margin-top: 8px;">
            <pre id="raw-desc-content">${escapeHtml(seoOutput.productDescription)}</pre>
          </div>
        </details>
      </div>

      <!-- AEO Suite (Answer Engine Optimization) -->
      <div class="card">
        <div class="aeo-box">
          <div class="aeo-header">
            <span class="aeo-title">🤖 AEO AI Quick Summary (Cho SearchGPT, Perplexity &amp; Gemini)</span>
            <span class="badge badge-neutral">${wordCount} words</span>
          </div>
          <p class="aeo-text">${escapeHtml(seoOutput.aeo_quick_summary ?? "—")}</p>
        </div>

        <div style="margin-top: 18px;">
          <h4 style="font-size: 0.95rem; color: #e2e8f0; margin-bottom: 12px; font-weight: 700;">❓ FAQ Schema (${seoOutput.aeo_faq?.length ?? 0} câu hỏi trả lời trực tiếp)</h4>
          <div class="faq-list">
            ${(seoOutput.aeo_faq ?? []).map((faq) => `
              <div class="faq-item">
                <div class="faq-q"><span>${escapeHtml(faq.question)}</span></div>
                <div class="faq-a">${escapeHtml(faq.answer)}</div>
              </div>
            `).join("")}
          </div>
        </div>

        ${seoOutput.aeo_json_ld ? `
          <div style="margin-top: 18px;">
            <div class="code-container">
              <div class="code-header">
                <span>JSON-LD FAQ SCHEMA.ORG</span>
                <button class="btn btn-secondary" onclick="copyToClipboard('json-ld-box', this)">📋 Copy JSON-LD</button>
              </div>
              <pre id="json-ld-box">${escapeHtml(seoOutput.aeo_json_ld)}</pre>
            </div>
          </div>
        ` : ""}
      </div>

      <!-- Raw Output JSON Box -->
      <div class="card">
        <div class="code-container">
          <div class="code-header">
            <span>RAW OUTPUT JSON (SEO CONTENT PIPELINE B1 -> B6)</span>
            <div class="code-actions">
              <button class="btn btn-secondary" onclick="copyToClipboard('output-json', this)">📋 Copy Output JSON</button>
              <button class="btn btn-primary" onclick="downloadJsonFile()">💾 Tải về JSON</button>
            </div>
          </div>
          <pre id="output-json">${escapeHtml(outputJsonString)}</pre>
        </div>
      </div>

    </section>

  </main>

  <script>
    function copyToClipboard(elementId, btn) {
      const text = document.getElementById(elementId).innerText;
      copyText(text, btn);
    }

    function copyText(text, btn) {
      navigator.clipboard.writeText(text).then(() => {
        const originalText = btn.innerText;
        btn.innerText = "✅ Đã chép!";
        btn.style.background = "#059669";
        btn.style.color = "#fff";
        setTimeout(() => {
          btn.innerText = originalText;
          btn.style.background = "";
          btn.style.color = "";
        }, 2000);
      }).catch(err => {
        alert("Không thể chép vào clipboard: " + err);
      });
    }

    function downloadJsonFile() {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(document.getElementById('output-json').innerText);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute("href", dataStr);
      downloadAnchor.setAttribute("download", "pinterest-pod-seo-output-${escapeHtml(item.designId)}.json");
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    }
  </script>
</body>
</html>`;
}

async function main(): Promise<void> {
  console.log("================================================================================");
  console.log(" 🎃 PINTEREST POD ➔ SEO CONTENT PIPELINE FLOW TEST");
  console.log("================================================================================");

  // 1. Kiểm tra 2 file ảnh thật trên ổ đĩa
  console.log("\n[1/5] Kiểm tra 2 file ảnh thật trên ổ đĩa của người dùng...");
  if (!fs.existsSync(PHOTO_1_PATH)) {
    throw new Error(`Không tìm thấy file ảnh 1 tại: ${PHOTO_1_PATH}`);
  }
  if (!fs.existsSync(PHOTO_2_PATH)) {
    throw new Error(`Không tìm thấy file ảnh 2 tại: ${PHOTO_2_PATH}`);
  }

  const stat1 = await fsp.stat(PHOTO_1_PATH);
  const stat2 = await fsp.stat(PHOTO_2_PATH);
  console.log(`  ✔ Ảnh 1: ${PHOTO_1_PATH} (${formatBytes(stat1.size)})`);
  console.log(`  ✔ Ảnh 2: ${PHOTO_2_PATH} (${formatBytes(stat2.size)})`);

  // Nạp ảnh sang Base64 data URI để nhúng vào HTML report (tự chứa, xem offline mượt mà)
  const [buffer1, buffer2] = await Promise.all([
    fsp.readFile(PHOTO_1_PATH),
    fsp.readFile(PHOTO_2_PATH),
  ]);
  const photo1Base64 = `data:image/jpeg;base64,${buffer1.toString("base64")}`;
  const photo2Base64 = `data:image/jpeg;base64,${buffer2.toString("base64")}`;

  // 2. Chuẩn bị payload chuẩn 100% CONTRACT_PINTEREST_POD_TO_SEO.md
  console.log("\n[2/5] Đóng gói payload chuẩn CONTRACT_PINTEREST_POD_TO_SEO.md...");
  const deliverables: PinterestPodDeliverables = {
    workflowId: "wf_pinterest_pod_halloween_2026",
    success: true,
    productType: "rug",
    totalProduced: 1,
    items: [
      {
        designId: "design_halloween_round_rug_01",
        sourceCandidateId: "cand_pinterest_halloween_8829103",
        productType: "rug",
        originalPinTitle: "Cute Halloween Pumpkin and Ghost Pattern Round Rug for Fall Entryway",
        trendKeywords: [
          "halloween rug",
          "jack o lantern decor",
          "spooky cute home aesthetic",
          "fall front porch mat",
          "ghost pattern area rug",
        ],
        printMaster: {
          cmykUrl: "/api/pinterest-pod/assets/wf_halloween_01/design_halloween_cmyk_300dpi.jpg",
          rgbUrl: "/api/pinterest-pod/assets/wf_halloween_01/design_halloween_rgb_4k.png",
          localFilePath: PHOTO_1_PATH,
          widthPx: 6000,
          heightPx: 6000,
          dpi: 300,
        },
        cutoutProduct: {
          transparentUrl: "/api/pinterest-pod/assets/wf_halloween_01/design_halloween_cutout.png",
          whiteBgUrl: "/api/pinterest-pod/assets/wf_halloween_01/design_halloween_white.jpg",
          localFilePath: PHOTO_1_PATH,
        },
        composedMockups: [
          {
            referenceImageId: "ref_fall_porch_01",
            mockupUrl: "/api/pinterest-pod/assets/wf_halloween_01/mockup_fall_porch.jpg",
            localFilePath: PHOTO_1_PATH,
            detectedSceneType: "fall entryway porch",
            detectedSceneDescription: "Cozy fall front porch with pumpkins, autumn leaves, and a welcoming round Halloween rug",
          },
          {
            referenceImageId: "ref_size_chart_02",
            mockupUrl: "/api/pinterest-pod/assets/wf_halloween_01/mockup_size_chart.jpg",
            localFilePath: PHOTO_2_PATH,
            detectedSceneType: "specification size chart",
            detectedSceneDescription: "Product dimensions and size guide chart showing Small (3x5 ft), Medium (4x6 ft), and Large (5x8 ft) round rug options",
          },
        ],
      },
    ],
  };
  console.log(`  ✔ Deliverables: 1 item ("design_halloween_round_rug_01"), 2 mockups with localFilePath`);

  // 3. Khởi tạo pipeline runtime có trace tiến trình B1 -> B6
  console.log("\n[3/5] Khởi động Pipeline SEO Content & Trace Stages (B1 -> B6)...");
  loadServerEnvironment();
  const pipelineRuntime = await loadSmokePipelineRuntime();

  const stageTraces: StageExecutionTrace[] = [];
  const stageDescriptions: Record<string, string> = {
    b1: "Product Understanding (Đọc byte ảnh thật từ localFilePath & phân tích thực thể thị giác)",
    b2: "Shopping Context (Trích xuất target audience, ngữ cảnh mua sắm & seed từ khóa)",
    b3: "Search Suggestions (Thu thập từ khóa gợi ý Google Autocomplete theo ngữ cảnh)",
    b4: "Conflict Control (Đánh giá mức độ liên quan ngữ nghĩa & chống xung đột ăn thịt từ khóa)",
    b5: "Content Generation (Sinh Title, HTML Description, AEO Summary & FAQ Schema)",
    b6: "Image Processing (Tối ưu hóa Alt Text & Chuyển đổi định dạng ảnh sang WebP)",
  };

  const tracedPipeline = pipelineRuntime.createSeoPipeline({
    siteNicheResolver: pipelineRuntime.siteNicheResolver,
    stages: pipelineRuntime.stages.map((stage) => ({
      name: stage.name,
      async execute(context) {
        const start = Date.now();
        console.log(`  ▶ [${stage.name.toUpperCase()}] Bắt đầu thực thi: ${stageDescriptions[stage.name] ?? stage.name}...`);
        const nextContext = await stage.execute(context);
        const duration = Date.now() - start;
        console.log(`  ✔ [${stage.name.toUpperCase()}] Hoàn tất (${duration}ms)`);
        stageTraces.push({
          stageName: stage.name,
          durationMs: duration,
          description: stageDescriptions[stage.name] ?? stage.name,
        });
        return nextContext;
      },
    })),
  });

  // 4. Kích hoạt chuyển giao qua handoverPinterestToSeo trong Orchestrator
  console.log("\n[4/5] Kích hoạt Orchestrator handoverPinterestToSeo...");
  const startTime = Date.now();
  const handoverResult = await handoverPinterestToSeo(
    {
      deliverables,
      concurrency: 1,
    },
    {
      seoRunner: async (seoInput) => {
        return tracedPipeline.execute(seoInput);
      },
    },
  );
  const totalDuration = Date.now() - startTime;

  console.log(`\n  ✔ Hoàn tất chuyển giao và thực thi pipeline trong ${totalDuration}ms`);
  console.log(`  ✔ Trạng thái: Tổng số: ${handoverResult.total}, Thành công: ${handoverResult.successful}, Thất bại: ${handoverResult.failed}`);

  const itemResult = handoverResult.items[0];
  if (!itemResult || !itemResult.success || !itemResult.seoOutput) {
    throw new Error(`Thực thi SEO thất bại cho item: ${itemResult?.error ?? "Unknown error"}`);
  }

  const seoOutput = itemResult.seoOutput;
  console.log(`\n--- KẾT QUẢ SEO CONTENT ---`);
  console.log(`  Product Title: "${seoOutput.productTitle}"`);
  console.log(`  SEO Title: "${seoOutput.productSeoTitle}"`);
  console.log(`  Handle: "${seoOutput.productHandle}"`);
  console.log(`  AEO Quick Summary: "${seoOutput.aeo_quick_summary?.slice(0, 80)}..."`);
  console.log(`  FAQ Items: ${seoOutput.aeo_faq?.length ?? 0} câu hỏi`);
  console.log(`  Processed Images: ${seoOutput.images.length} ảnh WebP`);

  // 5. Kết xuất Báo cáo Web HTML và Tóm tắt JSON
  console.log("\n[5/5] Kết xuất Giao diện Web Báo Cáo HTML Trực Quan...");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runDirectory = path.join(process.cwd(), "testing", "module-seo-content", "output", `pinterest-pod-flow-${timestamp}`);
  await fsp.mkdir(runDirectory, { recursive: true });

  // Lưu file ảnh WebP nếu có binary data
  const imagesDir = path.join(runDirectory, "images");
  await fsp.mkdir(imagesDir, { recursive: true });
  for (const img of seoOutput.images) {
    if (img.webp.data && (Buffer.isBuffer(img.webp.data) || img.webp.data instanceof Uint8Array)) {
      const filename = path.basename(img.webp.filename);
      await fsp.writeFile(path.join(imagesDir, filename), img.webp.data);
    }
  }

  const reportHtml = renderHtmlReport({
    workflowId: deliverables.workflowId,
    startedAt: new Date(startTime).toISOString(),
    durationMs: totalDuration,
    deliverables,
    seoOutput,
    stageTraces,
    photo1Info: { path: PHOTO_1_PATH, size: stat1.size, base64: photo1Base64 },
    photo2Info: { path: PHOTO_2_PATH, size: stat2.size, base64: photo2Base64 },
  });

  const reportHtmlPath = path.join(runDirectory, "report.html");
  const summaryJsonPath = path.join(runDirectory, "summary.json");

  const summaryData = {
    workflowId: deliverables.workflowId,
    timestamp: new Date().toISOString(),
    durationMs: totalDuration,
    status: "success",
    photoFiles: [
      { path: PHOTO_1_PATH, sizeBytes: stat1.size, scene: "fall entryway porch" },
      { path: PHOTO_2_PATH, sizeBytes: stat2.size, scene: "specification size chart" },
    ],
    stageTraces,
    deliverablesInput: deliverables,
    seoOutput: serializeSeoOutput(seoOutput),
  };

  await fsp.writeFile(reportHtmlPath, reportHtml, "utf8");
  await fsp.writeFile(summaryJsonPath, JSON.stringify(summaryData, null, 2), "utf8");

  console.log(`  ✔ Báo cáo HTML đã tạo tại: ${reportHtmlPath}`);
  console.log(`  ✔ File summary JSON tại:   ${summaryJsonPath}`);

  // Mở trình duyệt web trừ khi có cờ --no-open
  const shouldOpen = !process.argv.includes("--no-open");
  if (shouldOpen) {
    console.log(`\n🚀 Đang mở trình duyệt xem báo cáo: ${reportHtmlPath}`);
    if (process.platform === "win32") {
      try {
        await executeFile("cmd.exe", ["/c", "start", "", reportHtmlPath]);
      } catch (err) {
        console.warn("  (Không thể tự mở trình duyệt tự động, vui lòng mở thủ công link trên)");
      }
    }
  } else {
    console.log(`\n(Cờ --no-open được kích hoạt, bỏ qua bước mở trình duyệt)`);
  }

  console.log("\n================================================================================");
  console.log(" ✅ TEST HOÀN TẤT THÀNH CÔNG RỰC RỠ!");
  console.log(` Link báo cáo: file:///${reportHtmlPath.replace(/\\/g, "/")}`);
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("\n❌ LỖI TRONG QUÁ TRÌNH CHẠY TEST:", err);
  process.exit(1);
});
