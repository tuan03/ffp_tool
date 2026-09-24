import type { DeliverablesData, PinterestPodDeliverables } from "../../types";

export interface ProductMockupItem {
  readonly url: string;
  readonly filename?: string;
  readonly scene_type: string;
  readonly scene_description: string;
}

export interface ProductGroup {
  readonly id: string;
  readonly title: string;
  readonly productType: string;
  readonly cmykUrl: string;
  readonly rgbUrl: string;
  /** Lightweight preview URL for fast thumbnail rendering (prevents GPU memory thrashing from 110-megapixel print masters) */
  readonly previewUrl?: string;
  readonly cmykFilename?: string;
  readonly label?: string;
  readonly badge?: string;
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly dpi?: number;
  readonly mockups: readonly ProductMockupItem[];
}

/**
 * Groups deliverables by product/design to enable product-centric display
 * in both the deliverables tab and the SEO handover modal.
 */
export function buildProductGroups(
  deliverables: DeliverablesData,
  seoPayload?: PinterestPodDeliverables,
  fallbackProductType: string = "bag",
): readonly ProductGroup[] {
  if (seoPayload && seoPayload.items.length > 0) {
    return seoPayload.items.map((item, idx) => {
      const mockups: ProductMockupItem[] = item.composedMockups.map((m, mIdx) => {
        const fname = m.localFilePath ? m.localFilePath.split("/").pop() : undefined;
        const matched = deliverables.lifestyle_mockups?.find((lm) => lm.url === m.mockupUrl);
        return {
          url: m.mockupUrl,
          filename: matched?.filename || fname || `mockup_${idx + 1}_${mIdx + 1}.jpg`,
          scene_type:
            m.detectedSceneType ||
            matched?.scene_type ||
            (mIdx % 2 === 0 ? "living_room" : "bedroom"),
          scene_description:
            m.detectedSceneDescription || matched?.scene_description || "Phối cảnh AI",
        };
      });

      const cmykFilename =
        item.printMaster.localFilePath?.split("/").pop() ||
        deliverables.print_cmyk_images?.[idx]?.filename ||
        `design_${idx + 1}_cmyk_300dpi.jpg`;

      const cutoutPreview = item.cutoutProduct?.whiteBgUrl || item.cutoutProduct?.transparentUrl;
      const matchedCutout = deliverables.product_cutouts_white?.[idx]?.url;
      const compRow = deliverables.comparison_rows?.[idx];
      const rowPreview = compRow?.cutout_white_url || compRow?.source_url;
      const previewUrl = cutoutPreview || matchedCutout || rowPreview || item.printMaster.rgbUrl;

      return {
        id: item.designId,
        title: item.originalPinTitle || `Sản phẩm #${idx + 1}`,
        productType: item.productType,
        cmykUrl: item.printMaster.cmykUrl,
        rgbUrl: item.printMaster.rgbUrl,
        previewUrl,
        cmykFilename,
        label: item.printMaster.label,
        badge: item.printMaster.badge,
        widthPx: item.printMaster.widthPx,
        heightPx: item.printMaster.heightPx,
        dpi: item.printMaster.dpi,
        mockups,
      };
    });
  }

  const compRows = deliverables.comparison_rows ?? [];
  if (compRows.length > 0) {
    return compRows.map((row, idx) => {
      const mockups: ProductMockupItem[] = (row.ai_background_urls ?? []).map((bgUrl, mIdx) => {
        const matched = deliverables.lifestyle_mockups?.find((lm) => lm.url === bgUrl);
        return {
          url: bgUrl,
          filename: matched?.filename || `mockup_${idx + 1}_${mIdx + 1}.jpg`,
          scene_type: matched?.scene_type || (mIdx % 2 === 0 ? "living_room" : "bedroom"),
          scene_description: matched?.scene_description || "Phối cảnh AI",
        };
      });

      const matchedCutout = deliverables.product_cutouts_white?.[idx]?.url;
      const previewUrl = row.cutout_white_url || row.source_url || matchedCutout || row.final_print_url;

      return {
        id: `design_${idx + 1}`,
        title: row.product_label || `Sản phẩm #${idx + 1}`,
        productType: fallbackProductType,
        cmykUrl: row.final_print_url,
        rgbUrl: deliverables.final_png_images?.[idx]?.url || row.final_print_url,
        previewUrl,
        cmykFilename:
          deliverables.print_cmyk_images?.[idx]?.filename || `design_${idx + 1}_cmyk_300dpi.jpg`,
        label: "CMYK 300 DPI",
        badge: "✓ Chuẩn in xưởng: 300 DPI (CMYK)",
        widthPx: fallbackProductType === "blanket" ? 10000 : 4500,
        heightPx: fallbackProductType === "blanket" ? 11000 : 5400,
        dpi: 300,
        mockups,
      };
    });
  }

  const prints = deliverables.print_cmyk_images ?? [];
  return prints.map((p, idx) => {
    const matchedCutout = deliverables.product_cutouts_white?.[idx]?.url;
    const previewUrl = matchedCutout || deliverables.final_png_images?.[idx]?.url || p.url;
    return {
      id: `design_${idx + 1}`,
      title: `Sản phẩm #${idx + 1}`,
      productType: fallbackProductType,
      cmykUrl: p.url,
      rgbUrl: deliverables.final_png_images?.[idx]?.url || p.url,
      previewUrl,
      cmykFilename: p.filename,
      label: "CMYK 300 DPI",
      badge: "✓ Chuẩn in xưởng: 300 DPI (CMYK)",
      widthPx: fallbackProductType === "blanket" ? 10000 : 4500,
      heightPx: fallbackProductType === "blanket" ? 11000 : 5400,
      dpi: 300,
      mockups: deliverables.lifestyle_mockups ?? [],
    };
  });
}
