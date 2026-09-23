import { exec } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { createDefaultProductImageAnalyzer } from "../internal/stages/b1-product-understanding";
import { createB1ProductUnderstandingStage } from "../internal/stages/b1-product-understanding";
import { createB2ShoppingContextStage } from "../internal/stages/b2-shopping-context";
import { createB3SearchSuggestionsStage } from "../internal/stages/b3-search-suggestions";
import { executeB4ConflictControl } from "../internal/stages/b4-conflict-control";
import { executeB5ContentGeneration } from "../internal/stages/b5-content-generation";
import { executeB6ImageProcessing } from "../internal/stages/b6-image-processing";
import {
  DeterministicTestWebpConverter,
  SharpWebpConverter,
  type WebpConverter,
} from "../internal/image-processing";
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getBinarySize(data?: Buffer | Uint8Array | Blob): number | undefined {
  if (!data) return undefined;
  if ("byteLength" in data && typeof data.byteLength === "number") {
    return data.byteLength;
  }
  if ("length" in data && typeof data.length === "number") {
    return data.length;
  }
  if ("size" in data && typeof data.size === "number") {
    return data.size;
  }
  return undefined;
}

async function main(): Promise<void> {
  console.log("\n=======================================================");
  console.log("  🎨 [SEO Module] Visual Inspector: Pipeline B1 → B6   ");
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

  const startTime = Date.now();

  console.log("⏳ [1/6] Đang thực thi Stage B1 (Product Understanding)...");
  const b1Analyzer = createDefaultProductImageAnalyzer();
  const b1Stage = createB1ProductUnderstandingStage({ imageAnalyzer: b1Analyzer });
  const initialContext = createInitialContext(sampleInput);
  const b1Context = await b1Stage.execute(initialContext);

  const pu = b1Context.productUnderstanding;
  if (!pu) {
    console.error("❌ Không nhận được kết quả ProductUnderstanding từ B1!");
    process.exit(1);
  }

  console.log("⏳ [2/6] Đang thực thi Stage B2 (Shopping Context & Buyer Intent)...");
  const b2Stage = createB2ShoppingContextStage();
  const b2Context = await b2Stage.execute(b1Context);

  const sc = b2Context.shoppingContext;
  if (!sc) {
    console.error("❌ Không nhận được kết quả ShoppingContext từ B2!");
    process.exit(1);
  }

  console.log("⏳ [3/6] Đang thực thi Stage B3 (Search Suggestions & Google Autocomplete)...");
  const b3Stage = createB3SearchSuggestionsStage();
  const b3Context = await b3Stage.execute(b2Context);

  const sr = b3Context.searchResearch;
  if (!sr) {
    console.error("❌ Không nhận được kết quả SearchResearch từ B3!");
    process.exit(1);
  }

  console.log("⏳ [4/6] Đang thực thi Stage B4 (Conflict Control & Deduplication)...");
  const b4Context = await executeB4ConflictControl(b3Context);

  const cr = b4Context.conflictResult;
  if (!cr) {
    console.error("❌ Không nhận được kết quả ConflictResult từ B4!");
    process.exit(1);
  }

  console.log("⏳ [5/6] Đang thực thi Stage B5 (SEO Content Generation)...");
  const b5Context = await executeB5ContentGeneration(b4Context);

  const content = b5Context.contentResult;
  const contentMeta = b5Context.contentGenerationMetadata;
  if (!content) {
    console.error("❌ Không nhận được kết quả ContentResult từ B5!");
    process.exit(1);
  }

  console.log("⏳ [6/6] Đang thực thi Stage B6 (Image Processing & Alt Text Optimization)...");
  let webpConverter: WebpConverter = new DeterministicTestWebpConverter();
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (s: string) => Promise<unknown>;
    await dynamicImport("sharp");
    webpConverter = new SharpWebpConverter();
  } catch {
    webpConverter = new DeterministicTestWebpConverter();
  }

  const b6Context = await executeB6ImageProcessing(b5Context, {
    processorOptions: {
      webpConverter,
    },
  });

  const imgResult = b6Context.imageResult;
  const imgMeta = b6Context.imageProcessingMetadata;
  if (!imgResult) {
    console.error("❌ Không nhận được kết quả ImageProcessingResult từ B6!");
    process.exit(1);
  }

  const durationMs = Date.now() - startTime;
  console.log(`✅ Toàn bộ pipeline B1 → B6 hoàn tất sau ${durationMs}ms!\n`);

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
  cr.approvedKeywords.slice(0, 10).forEach((kw, idx) => {
    console.log(`   ${idx + 1}. "${kw}"`);
  });
  if (cr.approvedKeywords.length > 10) {
    console.log(`   ... và ${cr.approvedKeywords.length - 10} từ khóa khác.`);
  }
  console.log(`🚫 Từ khóa bị loại (Discarded):     ${cr.discardedKeywords.length} từ khóa`);
  cr.discardedKeywords.slice(0, 5).forEach((kw, idx) => {
    const reason = cr.conflictReasons[kw] || "unknown";
    console.log(`   ${idx + 1}. "${kw}" -> [${reason}]`);
  });
  console.log("--------------------------------------------------------------------\n");

  console.log("----------------- KẾT QUẢ B5: CONTENT GENERATION -------------------");
  console.log(`🏷️  Tiêu đề sản phẩm (Title):         "${content.productTitle}"`);
  console.log(`🔍 SEO Meta Title:                     "${content.productSeoTitle}" (${content.productSeoTitle.length}/70 chars)`);
  console.log(`📝 SEO Meta Description:               "${content.productSeoDescription}" (${content.productSeoDescription.length}/160 chars)`);
  console.log(`🔗 Handle / URL Slug:                  "/products/${content.productHandle}"`);
  console.log(`🎯 Từ khóa chính (Primary Keyword):    "${contentMeta?.primaryKeyword || "n/a"}"`);
  console.log(`🤖 Generator:                          ${contentMeta?.generator || "heuristic"}`);
  console.log("--------------------------------------------------------------------\n");

  console.log("----------------- KẾT QUẢ B6: IMAGE PROCESSING ---------------------");
  console.log(`🖼️  Tổng số ảnh xử lý:                 ${imgResult.processedImages.length} ảnh`);
  console.log(`📊 Thống kê chuyển đổi:               Thành công: ${imgMeta?.convertedImages ?? 0}, Thất bại/Chưa hỗ trợ: ${imgMeta?.failedConversions ?? 0}, Converter: ${imgMeta?.converter ?? "n/a"}`);
  imgResult.processedImages.forEach((img, idx) => {
    const altCharCount = [...img.alt].length;
    console.log(`   [Ảnh ${idx + 1}]`);
    console.log(`   - Tên file SEO:                     ${img.webp.filename}`);
    console.log(`   - Nguồn gốc:                        ${img.sourceUrl}`);
    const byteSize = getBinarySize(img.webp.data);
    if (byteSize !== undefined) {
      console.log(`   - Dung lượng WebP:                  ${byteSize} bytes (~${Math.max(1, Math.round(byteSize / 1024))} KB)`);
    }
    console.log(`   - Alt Text tối ưu:                  "${img.alt}" (${altCharCount}/125 chars)`);
  });
  if (imgMeta?.issues && imgMeta.issues.length > 0) {
    console.log(`⚠️  Vấn đề/Cảnh báo:                   ${imgMeta.issues.length} vấn đề`);
    imgMeta.issues.forEach((iss) => {
      console.log(`   - [${iss.code}] ${iss.message || ""}`);
    });
  }
  console.log("--------------------------------------------------------------------\n");

  const seoTitleLen = content.productSeoTitle.length;
  const seoDescLen = content.productSeoDescription.length;

  const htmlContent = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>B1 → B6 Full Pipeline Visual Inspection - SEO Content</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 min-h-screen py-10 px-4">
  <div class="max-w-6xl mx-auto">
    <header class="mb-8 border-b border-slate-800 pb-6 flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold bg-gradient-to-r from-blue-400 via-indigo-400 via-purple-400 to-emerald-400 bg-clip-text text-transparent">
          B1 → B6 End-to-End Pipeline Visual Inspector
        </h1>
        <p class="text-slate-400 text-sm mt-1">Ảnh (B1) &bull; Ngữ cảnh (B2) &bull; Autocomplete (B3) &bull; Khử trùng lặp (B4) &bull; Tạo nội dung SEO (B5) &bull; Tối ưu ảnh & Alt (B6)</p>
      </div>
      <div class="text-right text-xs text-slate-400 bg-slate-800/80 px-4 py-2 rounded-lg border border-slate-700">
        <div>Tổng thời gian: <span class="font-mono text-emerald-400 font-semibold">${durationMs}ms</span></div>
        <div>Môi trường: <span class="font-mono text-sky-400">${process.env.GOOGLE_CLOUD_PROJECT ? "Vertex AI Gemini" : "Heuristic Fallback"}</span></div>
        <div>Engine B5: <span class="font-mono text-purple-400">${contentMeta?.generator || "heuristic"}</span></div>
      </div>
    </header>

    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <!-- Cột trái: Ảnh sản phẩm, Input & Tóm tắt nhanh -->
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
            <div class="text-slate-400 font-semibold uppercase tracking-wider text-[11px]">Thông tin đầu vào:</div>
            <div><span class="text-slate-400">Tiêu đề gốc:</span> <span class="text-slate-200 font-medium">${sampleInput.title}</span></div>
            <div><span class="text-slate-400">Niche:</span> <span class="px-2 py-0.5 rounded bg-indigo-900/60 text-indigo-300 font-medium">${sampleInput.niche || "(không có)"}</span></div>
          </div>

          <div class="mt-4 pt-4 border-t border-slate-700/60 text-xs space-y-2">
            <div class="text-slate-400 font-semibold uppercase tracking-wider text-[11px]">Điểm nhấn SEO (B5 & B6):</div>
            <div class="flex items-center justify-between">
              <span class="text-slate-400">Từ khóa chính:</span>
              <span class="font-medium text-emerald-400 font-mono text-[11px]">${contentMeta?.primaryKeyword || "n/a"}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-slate-400">SEO Title:</span>
              <span class="px-1.5 py-0.5 rounded font-mono text-[10px] ${seoTitleLen <= 70 ? "bg-emerald-950 text-emerald-300 border border-emerald-800" : "bg-rose-950 text-rose-300 border border-rose-800"}">${seoTitleLen}/70</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-slate-400">Meta Desc:</span>
              <span class="px-1.5 py-0.5 rounded font-mono text-[10px] ${seoDescLen <= 160 ? "bg-emerald-950 text-emerald-300 border border-emerald-800" : "bg-rose-950 text-rose-300 border border-rose-800"}">${seoDescLen}/160</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-slate-400">Ảnh WebP + Alt:</span>
              <span class="px-1.5 py-0.5 rounded font-mono text-[10px] bg-sky-950 text-sky-300 border border-sky-800">${imgResult.processedImages.length} ảnh tối ưu</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Cột phải: Toàn bộ dữ liệu 6 stages B1 -> B6 -->
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

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 max-h-64 overflow-y-auto pr-1">
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
        </div>

        <!-- Card B4: Conflict Control & Deduplication -->
        <div class="bg-slate-800 rounded-2xl p-5 border border-slate-700 shadow-xl">
          <div class="flex items-center justify-between border-b border-slate-700 pb-3 mb-4">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-300 text-[11px] font-bold border border-cyan-800">
                B4
              </span>
              <h2 class="text-base font-bold text-slate-100">Kiểm soát xung đột & Khử trùng lặp (Conflict Control)</h2>
            </div>
            <span class="text-xs text-slate-400">
              Duyệt: <strong class="text-emerald-400">${cr.approvedKeywords.length}</strong> &bull; Loại: <strong class="text-rose-400">${cr.discardedKeywords.length}</strong>
            </span>
          </div>

          <!-- Approved Keywords -->
          <div class="mb-4">
            <div class="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span>✅</span> Từ khóa được phê duyệt (Approved Keywords)
            </div>
            <div class="flex flex-wrap gap-2">
              ${cr.approvedKeywords.slice(0, 14).map((kw, i) => {
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
              ${cr.approvedKeywords.length > 14 ? `<span class="px-2 py-1 text-xs text-slate-400 italic">+${cr.approvedKeywords.length - 14} từ khóa khác</span>` : ""}
            </div>
          </div>

          <!-- Discarded Keywords with Reason -->
          <div>
            <div class="text-xs font-semibold text-rose-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span>🚫</span> Từ khóa bị loại trừ / Xung đột (Discarded with Reasons)
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
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
        </div>

        <!-- SECTION B5 -->
        <div class="border-b border-slate-800 pb-2 pt-4">
          <span class="px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-bold uppercase tracking-wider">
            Bước B5: SEO Content Generation (Title, Meta, Handle & HTML Description)
          </span>
        </div>

        <!-- B5 Content Details -->
        <div class="bg-slate-800 rounded-2xl p-5 border border-slate-700 shadow-xl space-y-4">
          <!-- Product Title & URL Handle -->
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div class="p-3.5 rounded-xl bg-slate-900 border border-slate-700/80">
              <div class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Tiêu đề sản phẩm (Product Title)</div>
              <div class="text-sm font-bold text-slate-100">${escapeHtml(content.productTitle)}</div>
            </div>
            <div class="p-3.5 rounded-xl bg-slate-900 border border-slate-700/80">
              <div class="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">URL Handle (Shopify Slug)</div>
              <div class="text-sm font-mono text-indigo-400 truncate">/products/${content.productHandle}</div>
            </div>
          </div>

          <!-- SEO Meta Title & Description -->
          <div class="space-y-3">
            <div class="p-3.5 rounded-xl bg-slate-900 border border-slate-700/80">
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">SEO Meta Title (Google Search)</span>
                <span class="px-2 py-0.5 rounded font-mono text-[10px] ${seoTitleLen <= 70 ? "bg-emerald-950 text-emerald-300 border border-emerald-800" : "bg-rose-950 text-rose-300 border border-rose-800"}">
                  ${seoTitleLen} / 70 ký tự
                </span>
              </div>
              <div class="text-sm font-semibold text-emerald-300 font-mono">${escapeHtml(content.productSeoTitle)}</div>
            </div>

            <div class="p-3.5 rounded-xl bg-slate-900 border border-slate-700/80">
              <div class="flex items-center justify-between mb-1.5">
                <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider">SEO Meta Description</span>
                <span class="px-2 py-0.5 rounded font-mono text-[10px] ${seoDescLen <= 160 ? "bg-emerald-950 text-emerald-300 border border-emerald-800" : "bg-rose-950 text-rose-300 border border-rose-800"}">
                  ${seoDescLen} / 160 ký tự
                </span>
              </div>
              <div class="text-xs text-slate-300 leading-relaxed">${escapeHtml(content.productSeoDescription)}</div>
            </div>
          </div>

          <!-- HTML Product Description Preview -->
          <div class="p-4 rounded-xl bg-slate-900/90 border border-slate-700/80">
            <div class="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <span>📄</span> Xem trước mô tả HTML sản phẩm (Shopify Formatted Content)
            </div>
            <div class="prose prose-invert max-w-none text-xs text-slate-300 space-y-2.5 bg-slate-950 p-4 rounded-xl border border-slate-800">
              ${content.productDescription}
            </div>
          </div>
        </div>

        <!-- SECTION B6 -->
        <div class="border-b border-slate-800 pb-2 pt-4">
          <span class="px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-bold uppercase tracking-wider">
            Bước B6: Image Processing & Alt Text Optimization (${imgResult.processedImages.length} ảnh)
          </span>
        </div>

        <!-- B6 Image Gallery & Alt Optimization -->
        <div class="bg-slate-800 rounded-2xl p-5 border border-slate-700 shadow-xl space-y-4">
          <div class="flex items-center justify-between border-b border-slate-700/80 pb-3">
            <h2 class="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <span class="text-lg">🖼️</span> Bộ sưu tập ảnh sản phẩm chuẩn SEO (WebP & Alt Text)
            </h2>
            <div class="flex items-center gap-2 text-xs font-mono">
              <span class="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                Thành công: ${imgMeta?.convertedImages ?? 0}
              </span>
              ${(imgMeta?.failedConversions ?? 0) > 0 ? `<span class="px-2 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-800">Lỗi/Chưa hỗ trợ: ${imgMeta?.failedConversions}</span>` : ""}
              <span class="px-2 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800">
                Converter: ${imgMeta?.converter ?? "unavailable"}
              </span>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-3">
            ${imgResult.processedImages
              .map((img) => {
                const altLen = [...img.alt].length;
                const isSafeLen = altLen <= 125;
                const previewSrc = img.sourceUrl.startsWith("file://")
                  ? img.sourceUrl.replace(/\\/g, "/")
                  : img.sourceUrl;
                const byteSize = getBinarySize(img.webp.data);
                const dataSize = byteSize !== undefined ? `${Math.max(1, Math.round(byteSize / 1024))} KB` : undefined;
                return `
                <div class="p-4 rounded-xl bg-slate-900 border border-slate-700/80 flex flex-col sm:flex-row gap-4 items-start">
                  <div class="w-20 h-20 rounded-lg bg-slate-950 border border-slate-800 overflow-hidden flex items-center justify-center shrink-0">
                    <img src="${previewSrc}"
                         alt="${escapeHtml(img.alt)}"
                         class="max-h-full max-w-full object-contain">
                  </div>
                  <div class="flex-1 min-w-0 space-y-2">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <span class="font-mono text-xs text-sky-400 font-semibold truncate" title="${img.webp.filename}">
                        📁 ${escapeHtml(img.webp.filename)}
                      </span>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-sky-950 text-sky-300 border border-sky-800">
                          WEBP
                        </span>
                        ${dataSize ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300 border border-slate-700">${dataSize}</span>` : ""}
                      </div>
                    </div>

                    <!-- Alt Text -->
                    <div class="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 space-y-1">
                      <div class="flex items-center justify-between">
                        <span class="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Alt Text (Chuẩn SEO & Tiếp cận):</span>
                        <span class="px-1.5 py-0.2 rounded font-mono text-[10px] ${isSafeLen ? "bg-emerald-950 text-emerald-300 border border-emerald-800" : "bg-rose-950 text-rose-300 border border-rose-800"}">
                          ${altLen} / 125 ký tự
                        </span>
                      </div>
                      <p class="text-xs text-slate-200 font-medium">"${escapeHtml(img.alt)}"</p>
                    </div>
                  </div>
                </div>`;
              })
              .join("")}
          </div>

          ${
            imgMeta?.issues && imgMeta.issues.length > 0
              ? `
              <div class="p-3 rounded-xl bg-amber-950/30 border border-amber-800/50 text-xs text-amber-200 space-y-1">
                <div class="font-semibold flex items-center gap-1.5">
                  <span>ℹ️</span> Ghi chú xử lý (${imgMeta.issues.length}):
                </div>
                <ul class="list-disc list-inside space-y-0.5 text-amber-300/80 text-[11px]">
                  ${imgMeta.issues.map((iss) => `<li>[${iss.code}] ${escapeHtml(iss.message || "")}</li>`).join("")}
                </ul>
              </div>`
              : ""
          }

          <p class="text-[11px] text-slate-400 pt-2 border-t border-slate-700/60">
            ℹ️ Quy chuẩn B6: Tên file SEO tất định (\`\${handle}-\${index + 1}.webp\`), Alt text chuẩn độ dài (&le;125 ký tự), độc nhất qua gallery, tích hợp từ khóa chính và thực thể thị giác chân thực từ B1.
          </p>
        </div>

      </div>
    </div>

    <footer class="mt-12 text-center text-xs text-slate-400 border-t border-slate-800 pt-6">
      FFP Tool &bull; Module SEO + Content &bull; End-to-End Visual Inspector B1 &rarr; B6
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
      console.log(`🚀 Đã tự động mở giao diện trực quan B1 → B6 trên trình duyệt của bạn!`);
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
