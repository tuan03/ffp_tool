import { exec } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { createDefaultProductImageAnalyzer } from "../internal/stages/b1-product-understanding";
import { createB1ProductUnderstandingStage } from "../internal/stages/b1-product-understanding";
import { createB2ShoppingContextStage } from "../internal/stages/b2-shopping-context";
import { createB3SearchSuggestionsStage } from "../internal/stages/b3-search-suggestions";
import { executeB4ConflictControl } from "../internal/stages/b4-conflict-control";
import { createInitialContext } from "../internal/pipeline-context";
import type { SeoContentInput } from "../types";


const COLOR_HEX_MAP: Record<string, string> = {
  black: "#111827",
  white: "#F9FAFB",
  cream: "#FFFDD0",
  orange: "#F97316",
  navy: "#1E3A8A",
  red: "#EF4444",
  pink: "#EC4899",
  purple: "#8B5CF6",
  green: "#10B981",
  brown: "#78350F",
  beige: "#F5F5DC",
  gold: "#EAB308",
  silver: "#9CA3AF",
  gray: "#6B7280",
};

async function main(): Promise<void> {
  console.log("\n=======================================================");
  console.log("  🎨 [SEO Module] Visual Inspector: Stage B1, B2, B3 & B4  ");
  console.log("=======================================================\n");

  const argImage = process.argv[2];
  const targetImage =
    argImage ||
    "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=800&auto=format&fit=crop&q=60";

  const isLocalFile = Boolean(argImage && !argImage.startsWith("http") && !argImage.startsWith("data:"));
  const isCustomInput = Boolean(process.argv[3]);
  const customTitle = process.argv[3]?.trim() || "Vintage Halloween Black Cat T-Shirt";
  const customNiche = process.argv[4]?.trim() || (isCustomInput ? "" : "halloween");
  const customDescription = process.argv[5]?.trim() || (isCustomInput ? "" : "Soft cotton t-shirt with vintage black cat graphic and spooky retro text.");
  const derivedHandle = customTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const sampleInput: SeoContentInput = {
    title: customTitle,
    description: customDescription,
    niche: customNiche,
    handle: derivedHandle,
    images: [
      {
        url: isLocalFile ? `file://${path.resolve(targetImage)}` : targetImage,
        localFilePath: isLocalFile ? path.resolve(targetImage) : undefined,
        alt: customTitle,
      },
    ],
  };

  console.log("📌 Thông tin kiểm thử đầu vào:");
  console.log(`   - Tiêu đề (Title):       ${sampleInput.title}`);
  console.log(`   - Ngành hàng (Niche):    ${sampleInput.niche}`);
  console.log(`   - Đường dẫn ảnh (Image): ${targetImage}`);
  console.log(`   - Đọc qua file local:    ${isLocalFile ? "CÓ (Node.js fs)" : "KHÔNG (URL/Web)"}`);
  console.log(`   - Google Cloud Project:  ${process.env.GOOGLE_CLOUD_PROJECT || "(Chế độ Fallback Heuristic)"}\n`);

  console.log("⏳ Đang thực thi Stage B1 (Product Understanding)...");
  const startTime = Date.now();

  const b1Analyzer = createDefaultProductImageAnalyzer();
  const b1Stage = createB1ProductUnderstandingStage({ imageAnalyzer: b1Analyzer });
  const initialContext = createInitialContext(sampleInput);
  const b1Context = await b1Stage.execute(initialContext);

  const pu = b1Context.productUnderstanding;
  if (!pu) {
    console.error("❌ Không nhận được kết quả ProductUnderstanding từ B1!");
    process.exit(1);
  }

  console.log("⏳ Đang thực thi Stage B2 (Shopping Context & Buyer Intent)...");
  const b2Stage = createB2ShoppingContextStage();
  const b2Context = await b2Stage.execute(b1Context);

  const sc = b2Context.shoppingContext;
  if (!sc) {
    console.error("❌ Không nhận được kết quả ShoppingContext từ B2!");
    process.exit(1);
  }

  console.log("⏳ Đang thực thi Stage B3 (Search Suggestions & Google Autocomplete)...");
  const b3Stage = createB3SearchSuggestionsStage();
  const b3Context = await b3Stage.execute(b2Context);

  const sr = b3Context.searchResearch;
  if (!sr) {
    console.error("❌ Không nhận được kết quả SearchResearch từ B3!");
    process.exit(1);
  }

  console.log("⏳ Đang thực thi Stage B4 (Conflict Control & Deduplication)...");
  const b4Context = await executeB4ConflictControl(b3Context);

  const cr = b4Context.conflictResult;
  if (!cr) {
    console.error("❌ Không nhận được kết quả ConflictResult từ B4!");
    process.exit(1);
  }

  const durationMs = Date.now() - startTime;
  console.log(`✅ Phân tích hoàn tất B1, B2, B3 & B4 sau ${durationMs}ms!\n`);

  console.log("----------------- KẾT QUẢ B1: PRODUCT UNDERSTANDING -----------------");
  console.log(`🔤 OCR Texts (Chữ trên thiết kế): [${pu.ocrTexts.map((t) => `"${t}"`).join(", ")}]`);
  console.log(`🏷️  Thực thể nhận diện (Entities):   [${pu.detectedEntities.join(", ")}]`);
  console.log(`🎨 Gam màu chủ đạo (Colors):         [${pu.dominantColors.join(", ")}]`);
  console.log(`🖌️  Phong cách thị giác (Style):      "${pu.visualStyle}"`);
  console.log(`📦 Phân loại sản phẩm (Category):    "${pu.productCategory}"`);
  console.log("--------------------------------------------------------------------\n");

  console.log("----------------- KẾT QUẢ B2: SHOPPING CONTEXT ---------------------");
  console.log(`👥 Đối tượng khách hàng (Audience):  [${sc.targetAudience.join(", ")}]`);
  console.log(`🎁 Dịp mua sắm / tặng quà (Occasion):[${sc.suitableOccasions.join(", ")}]`);
  console.log(`🛋️  Công năng / Sử dụng (Use Cases):  [${sc.useCases.join(", ")}]`);
  console.log(`🎯 Hạt giống ý định (Intent Seeds):  [${sc.buyerIntentKeywords.length} seeds]`);
  console.log("--------------------------------------------------------------------\n");

  console.log("----------------- KẾT QUẢ B3: SEARCH SUGGESTIONS -------------------");
  console.log(`🌱 Hạt giống đã tra cứu (Seeds):     [${sr.seedKeywords.join(", ")}]`);
  console.log(`🔍 Số gợi ý thu thập (Suggestions):  ${sr.suggestedQueries.length} truy vấn`);
  console.log(`📋 Mẫu 10 gợi ý hàng đầu:`);
  sr.suggestedQueries.slice(0, 10).forEach((q, idx) => {
    const src = sr.querySources[q] || "unknown";
    console.log(`   ${idx + 1}. "${q}" (${src})`);
  });
  console.log("--------------------------------------------------------------------\n");

  console.log("----------------- KẾT QUẢ B4: CONFLICT CONTROL ---------------------");
  console.log(`🎯 Từ khóa được duyệt (Approved):   ${cr.approvedKeywords.length} từ khóa`);
  cr.approvedKeywords.forEach((kw, idx) => {
    console.log(`   ${idx + 1}. "${kw}"`);
  });
  console.log(`🚫 Từ khóa bị loại (Discarded):     ${cr.discardedKeywords.length} từ khóa`);
  cr.discardedKeywords.slice(0, 10).forEach((kw, idx) => {
    const reason = cr.conflictReasons[kw] || "unknown";
    console.log(`   ${idx + 1}. "${kw}" -> [${reason}]`);
  });
  console.log("--------------------------------------------------------------------\n");


  const htmlContent = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>B1, B2 & B3 Visual Inspection - SEO Content</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen py-10 px-4">
  <div class="max-w-6xl mx-auto">
    <header class="mb-8 border-b border-slate-800 pb-6 flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold bg-gradient-to-r from-blue-400 via-indigo-400 to-emerald-400 bg-clip-text text-transparent">
          B1, B2 & B3 Visual Pipeline Inspector
        </h1>
        <p class="text-slate-400 text-sm mt-1">Ảnh (B1) &bull; Ngữ cảnh mua sắm (B2) &bull; Gợi ý tìm kiếm Google Autocomplete (B3)</p>
      </div>
      <div class="text-right text-xs text-slate-400 bg-slate-800/80 px-4 py-2 rounded-lg border border-slate-700">
        <div>Thời gian xử lý: <span class="font-mono text-emerald-400 font-semibold">${durationMs}ms</span></div>
        <div>Môi trường: <span class="font-mono text-sky-400">${process.env.GOOGLE_CLOUD_PROJECT ? "Vertex AI Gemini" : "Heuristic Fallback"}</span></div>
      </div>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <!-- Cột trái: Ảnh sản phẩm & Input -->
      <div class="lg:col-span-4 flex flex-col gap-4">
        <div class="bg-slate-800 rounded-2xl p-4 border border-slate-700 shadow-xl sticky top-6">
          <div class="text-xs uppercase font-semibold tracking-wider text-slate-400 mb-3 flex items-center gap-2">
            <svg class="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
            Hình ảnh sản phẩm gốc
          </div>
          <div class="rounded-xl overflow-hidden bg-slate-950 flex items-center justify-center border border-slate-800 aspect-square">
            <img src="${isLocalFile ? "file:///" + path.resolve(targetImage).replace(/\\/g, "/") : targetImage}"
                 alt="Input Preview"
                 class="max-h-full max-w-full object-contain hover:scale-105 transition-transform duration-300">
          </div>
          <div class="mt-3 text-[11px] text-slate-400 truncate font-mono bg-slate-900/60 p-2 rounded border border-slate-800" title="${targetImage}">
            ${targetImage}
          </div>

          <div class="mt-4 pt-4 border-t border-slate-700/60 text-xs space-y-2">
            <div class="text-slate-400 font-semibold uppercase tracking-wider text-[11px]">Thông tin đính kèm:</div>
            <div><span class="text-slate-400">Tiêu đề:</span> <span class="text-slate-200 font-medium">${sampleInput.title}</span></div>
            <div><span class="text-slate-400">Niche:</span> <span class="px-2 py-0.5 rounded bg-indigo-900/60 text-indigo-300 font-medium">${sampleInput.niche || "(không có)"}</span></div>
          </div>
        </div>
      </div>

      <!-- Cột phải: Dữ liệu B1, B2, B3 & B4 -->
      <div class="lg:col-span-8 space-y-6">
        
        <!-- SECTION B1 -->
        <div class="border-b border-slate-800 pb-2">
          <span class="px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 text-xs font-bold uppercase tracking-wider">
            Bước B1: Product Understanding
          </span>
        </div>

        <!-- 1. OCR Texts -->
        <div class="bg-slate-800 rounded-2xl p-5 border border-slate-700 shadow-xl">
          <div class="flex items-center justify-between mb-2">
            <h2 class="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <span class="text-lg">🔤</span> Chữ in trên thiết kế (OCR Texts)
            </h2>
            <span class="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300 font-mono">
              ${pu.ocrTexts.length} chuỗi
            </span>
          </div>
          ${
            pu.ocrTexts.length > 0
              ? `<div class="flex flex-wrap gap-2 mt-2">
                  ${pu.ocrTexts
                    .map(
                      (text) =>
                        `<span class="px-3 py-1 rounded-xl bg-amber-500/20 text-amber-200 border border-amber-500/40 text-sm font-semibold tracking-wide shadow-sm">"${text}"</span>`,
                    )
                    .join("")}
                </div>`
              : `<p class="text-xs text-slate-400 italic bg-slate-900/40 p-2.5 rounded-xl border border-dashed border-slate-700">
                  Không phát hiện văn bản hoặc chữ in nào trên ảnh.
                </p>`
          }
        </div>

        <!-- 2. Entities, Colors, Style, Category -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <!-- Dominant Colors -->
          <div class="bg-slate-800 rounded-2xl p-4 border border-slate-700 shadow-xl sm:col-span-2">
            <h2 class="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-2">
              <span>🎨</span> Gam màu chủ đạo (Dominant Colors)
            </h2>
            <div class="flex flex-wrap gap-2">
              ${
                pu.dominantColors.length > 0
                  ? pu.dominantColors
                      .map((color) => {
                        const hex = COLOR_HEX_MAP[color.toLowerCase()] || "#94A3B8";
                        const isLight = ["white", "cream", "yellow", "beige"].includes(
                          color.toLowerCase(),
                        );
                        return `
                        <div class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700 text-xs">
                          <span class="w-3.5 h-3.5 rounded-full border ${isLight ? "border-slate-500" : "border-slate-400/30"}" style="background-color: ${hex}"></span>
                          <span class="font-medium capitalize text-slate-200">${color}</span>
                        </div>`;
                      })
                      .join("")
                  : `<span class="text-xs text-slate-500 italic">Không có dữ liệu màu</span>`
              }
            </div>
          </div>

          <!-- Style -->
          <div class="bg-slate-800 rounded-2xl p-4 border border-slate-700 shadow-xl">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
              <span>🖌️</span> Phong cách trực quan
            </h2>
            <div class="text-base font-bold text-sky-400 capitalize">${pu.visualStyle}</div>
          </div>

          <!-- Category -->
          <div class="bg-slate-800 rounded-2xl p-4 border border-slate-700 shadow-xl">
            <h2 class="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
              <span>📦</span> Phân loại sản phẩm
            </h2>
            <div class="text-base font-bold text-emerald-400 capitalize">${pu.productCategory}</div>
          </div>
        </div>

        <!-- SECTION B2 -->
        <div class="border-b border-slate-800 pb-2 pt-4">
          <span class="px-3 py-1 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 text-xs font-bold uppercase tracking-wider">
            Bước B2: Shopping Context & Buyer Intent
          </span>
        </div>

        <!-- B2 Details Grid -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <!-- Audience -->
          <div class="bg-slate-800 rounded-2xl p-4 border border-slate-700 shadow-xl">
            <h3 class="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-2">
              <span>👥</span> Khách hàng mục tiêu
            </h3>
            <ul class="text-xs space-y-1 text-slate-200">
              ${sc.targetAudience.map((a) => `<li class="flex items-center gap-1.5"><span class="text-purple-400">&bull;</span> ${a}</li>`).join("")}
            </ul>
          </div>

          <!-- Occasions -->
          <div class="bg-slate-800 rounded-2xl p-4 border border-slate-700 shadow-xl">
            <h3 class="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-2">
              <span>🎁</span> Dịp mua / tặng
            </h3>
            <ul class="text-xs space-y-1 text-slate-200">
              ${sc.suitableOccasions.map((o) => `<li class="flex items-center gap-1.5"><span class="text-pink-400">&bull;</span> ${o}</li>`).join("")}
            </ul>
          </div>

          <!-- Use Cases -->
          <div class="bg-slate-800 rounded-2xl p-4 border border-slate-700 shadow-xl">
            <h3 class="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-2">
              <span>🛋️</span> Công năng sử dụng
            </h3>
            <ul class="text-xs space-y-1 text-slate-200">
              ${sc.useCases.map((u) => `<li class="flex items-center gap-1.5"><span class="text-amber-400">&bull;</span> ${u}</li>`).join("")}
            </ul>
          </div>
        </div>

        <!-- SECTION B3 -->
        <div class="border-b border-slate-800 pb-2 pt-4">
          <span class="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold uppercase tracking-wider">
            Bước B3: Google Autocomplete Suggestions (${sr.suggestedQueries.length} truy vấn thực tế)
          </span>
        </div>

        <!-- B3 Suggestions Grid -->
        <div class="bg-slate-800 rounded-2xl p-5 border border-slate-700 shadow-xl">
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <span class="text-lg">🔍</span> Gợi ý tìm kiếm mở rộng (Live Google Autocomplete)
            </h2>
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono font-semibold">
              ${sr.suggestedQueries.length} kết quả
            </span>
          </div>
          
          <div class="mb-3 text-xs text-slate-400">
            <span class="text-slate-300 font-semibold">Hạt giống tra cứu:</span> ${sr.seedKeywords.map((s) => `<span class="px-2 py-0.5 rounded bg-slate-900 text-slate-300 font-mono mr-1">${s}</span>`).join("")}
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 max-h-96 overflow-y-auto pr-1">
            ${sr.suggestedQueries
              .map(
                (q, i) => {
                  const source = sr.querySources[q] || "google_autocomplete";
                  const isGoogle = source === "google_autocomplete";
                  return `
                  <div class="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-900 border border-slate-700/80 text-xs font-medium text-slate-200 hover:border-emerald-500/50 transition-colors">
                    <div class="flex items-center gap-2 truncate">
                      <span class="font-mono text-emerald-400 text-[11px]">${i + 1}.</span>
                      <span class="truncate">"${q}"</span>
                    </div>
                    <span class="text-[10px] px-1.5 py-0.5 rounded font-mono shrink-0 ml-2 ${isGoogle ? "bg-emerald-950 text-emerald-300 border border-emerald-800" : "bg-purple-950 text-purple-300 border border-purple-800"}">
                      ${source}
                    </span>
                  </div>`;
                },
              )
              .join("")}
          </div>
          <p class="text-[11px] text-slate-400 mt-3 pt-3 border-t border-slate-700/60">
            ℹ️ Toàn bộ gợi ý trên được thu thập trực tiếp từ Google Autocomplete API kèm nguồn gốc xuất xứ (provenance), sẵn sàng làm đầu vào cho Bước B4 kiểm soát trùng lặp / cannibalization.
          </p>
        </div>

        <!-- Card B4: Conflict Control & Deduplication -->
        <div class="bg-slate-800 rounded-2xl p-5 border border-slate-700 shadow-xl">
          <div class="flex items-center justify-between border-b border-slate-700 pb-3 mb-4">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 text-[11px] font-bold border border-cyan-800">
                B4
              </span>
              <h2 class="text-base font-bold text-slate-100">Kiểm soát xung đột từ khóa & Khử trùng lặp (Conflict Control)</h2>
            </div>
            <span class="text-xs text-slate-400">
              Duyệt: <strong class="text-emerald-400">${cr.approvedKeywords.length}</strong> &bull; Loại: <strong class="text-rose-400">${cr.discardedKeywords.length}</strong>
            </span>
          </div>

          <!-- Approved Keywords -->
          <div class="mb-4">
            <div class="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span>✅</span> Từ khóa được phê duyệt (Approved Keywords & Relevance Scores)
            </div>
            <div class="flex flex-wrap gap-2">
              ${cr.approvedKeywords.map((kw, i) => {
                const score = cr.relevanceScores?.[kw];
                const scoreBadge = score !== undefined
                  ? `<span class="px-1.5 py-0.2 rounded bg-emerald-900/80 text-[10px] font-mono text-emerald-300">rel: ${score}</span>`
                  : "";
                return `
                <div class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-950/70 border border-emerald-700/60 text-xs font-medium text-emerald-200">
                  <span class="text-[10px] font-mono text-emerald-400 font-bold">#${i + 1}</span>
                  <span>${kw}</span>
                  ${scoreBadge}
                </div>`;
              }).join("")}
            </div>
          </div>

          <!-- Keyword Semantic Clusters -->
          ${
            cr.keywordClusters && cr.keywordClusters.length > 0
              ? `<div class="mb-4 pt-3 border-t border-slate-700/60">
                  <div class="text-xs font-semibold text-cyan-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <span>🧬</span> Phân cụm ngữ nghĩa (Semantic Clusters for Stage B5)
                  </div>
                  <div class="space-y-2">
                    ${cr.keywordClusters
                      .map((cluster, ci) => `
                      <div class="p-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs">
                        <div class="flex items-center justify-between text-cyan-300 font-semibold mb-1">
                          <span>Cụm #${ci + 1} Đại diện: "${cluster.representative}"</span>
                          <span class="text-[10px] text-slate-400 font-mono">${cluster.members.length} từ khóa</span>
                        </div>
                        <div class="flex flex-wrap gap-1 mt-1">
                          ${cluster.members
                            .map((m) => `
                            <span class="px-2 py-0.5 rounded text-[11px] font-mono ${
                              m === cluster.representative
                                ? "bg-cyan-950 text-cyan-200 border border-cyan-700/60"
                                : "bg-slate-800 text-slate-400 line-through opacity-75"
                            }">
                              ${m}
                            </span>
                          `).join("")}
                        </div>
                      </div>
                    `).join("")}
                  </div>
                </div>`
              : ""
          }

          <!-- Discarded Keywords with Reason -->
          <div>
            <div class="text-xs font-semibold text-rose-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span>🚫</span> Từ khóa bị loại trừ / Xung đột (Discarded with Reasons)
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
              ${cr.discardedKeywords.map((kw) => {
                const reason = cr.conflictReasons[kw] || "unknown";
                return `
                <div class="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-300">
                  <span class="truncate font-medium line-through opacity-70">${kw}</span>
                  <span class="text-[10px] px-2 py-0.5 rounded font-mono shrink-0 ml-2 bg-rose-950 text-rose-300 border border-rose-800/80">
                    ${reason}
                  </span>
                </div>`;
              }).join("")}
            </div>
          </div>

          <p class="text-[11px] text-slate-400 mt-3 pt-3 border-t border-slate-700/60">
            ℹ️ Động cơ Hybrid Vector lọc chính xác qua 8 cấp ưu tiên: exact_duplicate &rarr; brand_conflict &rarr; existing_url_cannibalization &rarr; category_conflict &rarr; search_intent_mismatch &rarr; semantic_drift &rarr; semantic_duplicate &rarr; low_specificity.
          </p>
        </div>

      </div>
    </div>

    <footer class="mt-12 text-center text-xs text-slate-400 border-t border-slate-800 pt-6">
      FFP Tool &bull; Module SEO + Content &bull; Visual Inspector B1, B2, B3 & B4
    </footer>
  </div>
</body>

</html>`;

  const outputPath = path.resolve(process.cwd(), "b1-visual-preview.html");
  fs.writeFileSync(outputPath, htmlContent, "utf-8");

  console.log(`📄 Đã tạo file xem trực quan tại:`);
  console.log(`   👉 ${outputPath}`);

  const openCmd = process.platform === "win32" ? `start "" "${outputPath}"` : `open "${outputPath}"`;
  exec(openCmd, (err) => {
    if (!err) {
      console.log(`🚀 Đã tự động mở giao diện trực quan B1, B2, B3 & B4 trên trình duyệt của bạn!`);
    } else {
      console.log(`💡 Bạn có thể mở trực tiếp file sau bằng trình duyệt: ${outputPath}`);
    }
    console.log("=======================================================\n");
  });
}

main().catch((err) => {
  console.error("Lỗi khi chạy Visual Inspector:", err);
  process.exit(1);
});
