import type { ReviewImageScope } from "./types";

const BAG_PROMPT = `Create one photorealistic customer review photo by editing the two attached images.

Image 1 is the SCENE TEMPLATE, not the product to keep. Preserve its room, furniture, bedding, camera angle, perspective and natural lighting. Completely remove the original bag or wallet from Image 1, then reconstruct any background it covered.

Image 2 is the PRODUCT REFERENCE. Place the selected handbag (and matching wallet only when requested) into the cleared location in Image 1. Preserve the product's silhouette, handles, material, hardware, artwork, colors and printed pattern as faithfully as possible.

PERSONALIZATION RULE: Inspect Image 2 for a customer-specific name printed on the product, such as a standalone first name. If one is present, replace every occurrence of that personalized customer name with a different natural first name of similar length; never reuse the original name. Use the same replacement name on the handbag and matching wallet when both display the personalization. Recreate it in the same position, capitalization, font style, size, color, outline and print perspective so it looks factory-printed. Preserve all other readable text, slogans, branding and artwork exactly as shown. If the product has no personalized customer name, do not add one.

Match the scene's scale, perspective, contact shadows and lighting. Do not duplicate products, invent new graphics or add captions, watermarks or extra text. Return only the finished image.`;

const RUG_PROMPT = `Create one photorealistic customer review photo by editing the two attached images.

Image 1 is the SCENE TEMPLATE. Preserve its room, floor, furniture, camera angle, perspective and natural lighting. Completely remove the original rug and reconstruct the floor it covered.

Image 2 is the PRODUCT REFERENCE. Place this exact rug into the cleared area. Preserve its outline, aspect ratio, pile texture, colors, artwork and printed pattern.

PERSONALIZATION RULE: Inspect Image 2 for a customer-specific name printed on the rug, including a first name, surname or full name. If one is present, replace every occurrence of that personalized customer name with a different natural name of similar length; never reuse the original name. Use the same replacement name across the entire rug wherever the original name appears. Recreate it in the same position, capitalization, font style, size, color, outline, spacing and floor perspective so it remains part of the original printed design. Preserve all other readable text, numbers, slogans, branding and artwork exactly as shown. If the rug has no personalized customer name, do not add one.

Match the floor plane, scale, perspective, edge contact, shadows and lighting. Do not crop, warp or recolor the design. Do not add people, extra rugs, invented motifs, captions, watermarks or extra text. Return only the finished image.`;

const BEDDING_PROMPT = `Create one photorealistic customer review photo by editing the two attached images.

Image 1 is the SCENE TEMPLATE. Image 1 is the only source of scene composition. Keep its exact aspect ratio, crop, camera position, camera angle, perspective, bed geometry, room, furniture, walls, floor, background objects, lighting and everyday imperfections. Replace only the visible surfaces occupied by the original blanket, quilt, duvet, comforter and matching pillowcases. The final image must look like the same photograph as Image 1 after its bedding was changed.

If Image 1 is a close-up with little or no room visible, keep that same close-up composition. Do not zoom out or invent a wider bedroom, additional furniture or a cleaner catalog setting.

Image 2 is the PRODUCT DESIGN REFERENCE only, never a scene reference. Extract the bedding type, print layout and orientation, colors, stitching and fabric texture, then transfer that design onto the existing bedding surfaces and folds from Image 1. Ignore the surroundings in Image 2 completely. Do not copy or reuse any room, bed frame, furniture, background, camera angle, crop or staging from Image 2, even when Image 2 is a polished product mockup.

PERSONALIZATION RULE: Inspect Image 2 for a customer-specific name printed on the bedding, such as a surname or first name. If one is present, replace every occurrence of that personalized customer name with a different natural name of similar length; never reuse the original name. Use the same replacement name across the comforter and pillowcases wherever the original name appears. Recreate it in the same position, capitalization, font style, size, color, outline and fabric perspective so it looks printed into the original design. Preserve all other readable text, numbers, player numbers, slogans and artwork exactly as shown. If the product has no personalized customer name, do not add one.

Preserve the drape, folds, thickness, occlusion and contact shadows established by Image 1. Do not invent graphics or add coordinated pillows or accessories outside the bedding positions already present in Image 1. Before returning, verify that the framing and every non-bedding scene element still come from Image 1 rather than Image 2. Do not add captions or watermarks. Return only the finished image.`;

const GENERIC_PROMPT = `Create one photorealistic customer review photo by editing the two attached images. Image 1 is the scene template: preserve its environment, camera angle, perspective and lighting while removing the old product. Image 2 is the product reference: place that exact product into the cleared scene while preserving its shape, colors, artwork, text and material. Match scale, perspective, contact shadows and lighting. Do not invent details, captions or watermarks. Return only the finished image.`;

export interface ReviewImageStorePreset {
  readonly prompt: string;
  readonly scope: ReviewImageScope;
  readonly supportsBagSet: boolean;
  readonly productLabel: string;
}

export function getReviewImageStorePreset(storeId: string): ReviewImageStorePreset {
  if (storeId === "preaureum") return { prompt: BAG_PROMPT, scope: "main", supportsBagSet: true, productLabel: "túi hoặc bộ túi–ví" };
  if (storeId === "capozen") return { prompt: RUG_PROMPT, scope: "single", supportsBagSet: false, productLabel: "thảm" };
  if (storeId === "jeminise") return { prompt: BEDDING_PROMPT, scope: "single", supportsBagSet: false, productLabel: "chăn hoặc bộ bedding" };
  return { prompt: GENERIC_PROMPT, scope: "single", supportsBagSet: false, productLabel: "sản phẩm" };
}

function shuffle(values: readonly string[], random: () => number): string[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex]!, shuffled[index]!];
  }
  return shuffled;
}

export function buildTemplateSequence(names: readonly string[], count: number, random: () => number = Math.random): readonly string[] {
  if (names.length === 0 || count <= 0) return [];
  const sequence: string[] = [];
  while (sequence.length < count) sequence.push(...shuffle(names, random));
  return sequence.slice(0, count);
}
