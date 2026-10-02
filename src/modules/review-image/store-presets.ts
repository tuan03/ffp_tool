import type { ReviewImageScope } from "./types";

const BAG_PROMPT = `Create one photorealistic customer review photo by editing the two attached images.

Image 1 is the SCENE TEMPLATE, not the product to keep. Preserve its room, furniture, bedding, camera angle, perspective and natural lighting. Completely remove the original bag or wallet from Image 1, then reconstruct any background it covered.

Image 2 is the PRODUCT REFERENCE. Place the selected handbag (and matching wallet only when requested) into the cleared location in Image 1. Preserve the product's silhouette, handles, material, hardware, artwork, colors and printed pattern as faithfully as possible.

PERSONALIZATION RULE: Inspect Image 2 for a customer-specific name printed on the product, such as a standalone first name. If one is present, replace every occurrence of that personalized customer name with a different natural first name of similar length; never reuse the original name. Use the same replacement name on the handbag and matching wallet when both display the personalization. Recreate it in the same position, capitalization, font style, size, color, outline and print perspective so it looks factory-printed. Preserve all other readable text, slogans, branding and artwork exactly as shown. If the product has no personalized customer name, do not add one.

Match the scene's scale, perspective, contact shadows and lighting. Do not duplicate products, invent new graphics or add captions, watermarks or extra text. Return only the finished image.`;

const RUG_PROMPT = `Edit Image 1 to create one photorealistic customer review photo: remove its original rugs completely, then insert the actual rug product from Image 2 into that same scene.

Image 1 is the SCENE TEMPLATE. Image 1 is the only source of scene composition. Keep its exact aspect ratio, crop, camera position, camera angle, perspective, room, furniture, walls, floor material, background objects, natural lighting and everyday imperfections. Completely remove every original rug from Image 1, including its artwork, text, edges and shadows, and reconstruct the floor it covered. Do not use the removed rug's footprint, dimensions, silhouette or proportions as a target for the replacement product. The final image must look like the same photograph as Image 1 with only its rug products replaced.

If Image 1 is a close-up showing only a small area of floor, keep that same close-up composition. Do not zoom out or invent a wider room, extra furniture or a different setting.

Image 2 is the PRODUCT REFERENCE only, never a scene reference. Image 2 is the only source of the rug's physical geometry and design. Isolate the actual rug product from Image 2 and insert that product into the cleared Image 1 scene. Ignore the surroundings in Image 2 completely. Do not copy or reuse any room, floor, furniture, background, camera angle, crop or staging from Image 2, even when Image 2 is a polished product mockup. Do not merely repaint or transfer the Image 2 artwork onto the Image 1 rug, keep the template rug, or blend the two products.

The number of rugs must come only from Image 2, never from Image 1. If Image 2 shows one rug, insert exactly one rug; if it shows a matching rug set, preserve that set and each rug's relative size. Preserve the exact product count, intrinsic dimensions and proportions, length-to-width ratio, outline, corner shape and radius, border width, edge binding, thickness, pile texture, colors, artwork and printed layout shown in Image 2. Treat any visible size or dimensional relationship in Image 2 as authoritative.

GEOMETRY LOCK: Place the Image 2 rug naturally on the floor without forcing it into the area or shape previously occupied by the Image 1 rug. If their shapes or dimensions differ, reconstruct all newly exposed floor and allow the replacement rug to occupy a different footprint. You may rotate and apply realistic floor-plane perspective, but preserve the original length-to-width ratio and uniform scale of the Image 2 product. Do not stretch, compress, widen, shorten, crop or reshape the Image 2 rug to resemble or fit the template rug under any circumstances. Do not rearrange, reflow, duplicate, remove or add design elements to make the artwork fit a different shape.

PHYSICAL SCALE: Preserving length-to-width ratio is not enough: also preserve the product's intended real-world size. Do not shrink the product to fit the cleared template footprint, the visible free floor area, or the old rug's dimensions. A large area rug or play mat must remain a large floor covering, not become a small runner or doormat. Use supplied or clearly visible length and width measurements first. Otherwise, use recognizable furniture or other objects in Image 2 as physical scale cues only, without importing them into the output background. Do not use pixel dimensions or percentage of image occupied as a physical measurement, since close-ups and camera distance change apparent size. If reliable measurements are absent, retain a plausible full-size product for its category; do not invent exact centimeter or inch measurements.

Fit the product into the scene at that physical scale using Image 1's floor perspective and credible relationships to its furniture. If a full-size rug cannot be fully visible within the template's existing crop, allow the rug to extend beyond the frame or naturally beneath furniture instead of miniaturizing it. Preserve the product's complete intrinsic shape and artwork; normal camera framing may hide edges, but never cut off or redesign the physical rug itself. This scale rule takes priority over requests to show the whole product or keep it inside the removed rug's area. Keep the background and camera framing from Image 1.

PERSONALIZATION RULE: Inspect Image 2 for a customer-specific name printed on the rug, including a first name, surname or full name. If one is present, replace every occurrence of that personalized customer name with a different natural name of similar length; never reuse the original name. Use the same replacement name across the entire rug wherever the original name appears. Recreate it in the same position, capitalization, font style, size, color, outline, spacing and floor perspective so it remains part of the original printed design. Preserve all other readable text, numbers, slogans, branding and artwork exactly as shown. If the rug has no personalized customer name, do not add one.

Match the floor plane, natural placement, edge contact, shadows and lighting without changing the product geometry. Before returning, verify that the background, framing and every non-rug scene element still come from Image 1, no original template rug remains, and the inserted rugs come only from Image 2. Compare the finished rug against Image 2 and verify that its rectified silhouette, proportions, dimensions, border and artwork layout still match Image 2 rather than the removed rug in Image 1. Do not recolor the design or add people, extra rugs, invented motifs, captions, watermarks or extra text. Return only the finished image.`;

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
