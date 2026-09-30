import type { ReviewImageScope } from "./types";

const BAG_PROMPT = `Create one photorealistic customer review photo by editing the two attached images.

Image 1 is the SCENE TEMPLATE, not the product to keep. Preserve its room, furniture, bedding, camera angle, perspective and natural lighting. Completely remove the original bag or wallet from Image 1, then reconstruct any background it covered.

Image 2 is the PRODUCT REFERENCE. Place the selected handbag (and matching wallet only when requested) into the cleared location in Image 1. Preserve the product's silhouette, handles, material, hardware, artwork, colors, printed pattern and readable branding as faithfully as possible. Match the scene's scale, perspective, contact shadows and lighting. Do not duplicate products, invent new graphics or add captions, watermarks or extra text. Return only the finished image.`;

const RUG_PROMPT = `Create one photorealistic customer review photo by editing the two attached images.

Image 1 is the SCENE TEMPLATE. Preserve its room, floor, furniture, camera angle, perspective and natural lighting. Completely remove the original rug and reconstruct the floor it covered.

Image 2 is the PRODUCT REFERENCE. Place this exact rug into the cleared area. Preserve its outline, aspect ratio, pile texture, colors, artwork, printed pattern and readable text. Match the floor plane, scale, perspective, edge contact, shadows and lighting. Do not crop, warp or recolor the design. Do not add people, extra rugs, invented motifs, captions or watermarks. Return only the finished image.`;

const BEDDING_PROMPT = `Create one photorealistic customer review photo by editing the two attached images.

Image 1 is the SCENE TEMPLATE. Preserve its bedroom, bed frame, furniture, camera angle, perspective and natural lighting. Remove the original blanket, quilt, duvet or comforter while keeping the bed geometry intact.

Image 2 is the PRODUCT REFERENCE. Dress the bed with this exact bedding product. Preserve the product type, print layout and orientation, colors, readable text, stitching and fabric texture. Create natural drape, folds, thickness and realistic shadows. Do not invent graphics or add coordinated pillows or accessories unless they are visibly part of the product reference. Do not add captions or watermarks. Return only the finished image.`;

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
