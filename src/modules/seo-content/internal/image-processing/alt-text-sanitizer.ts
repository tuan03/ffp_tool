/**
 * Cleans and sanitizes raw alt text:
 * - Strips HTML tags
 * - Strips control characters
 * - Strips URLs
 * - Collapses consecutive spaces and trims
 */
export function cleanAltText(raw: string): string {
  if (!raw || typeof raw !== "string") {
    return "";
  }

  let text = raw;
  // 1. Strip HTML tags
  text = text.replace(/<[^>]*>/g, " ");
  // 2. Strip control characters (0x00 - 0x1F, 0x7F)
  text = text.replace(/[\x00-\x1F\x7F]/g, " ");
  // 3. Remove URLs
  text = text.replace(/https?:\/\/\S+/gi, " ");
  // 4. Collapse consecutive spaces
  text = text.replace(/\s+/g, " ").trim();

  return text;
}

/**
 * Accurately measures character length taking into account surrogate pairs and emoji.
 */
export function characterLength(text: string): number {
  return Array.from(text).length;
}

const PLACEHOLDER_PATTERN =
  /^(img|dsc|photo|image|picture|product[-_\s]?image|untitled)[-_0-9\s]*$/i;
const FILENAME_EXTENSION_PATTERN = /\.(jpg|jpeg|png|webp|gif|bmp|svg|tiff)$/i;

/**
 * Checks whether the candidate alt text is a meaningless placeholder,
 * raw filename, or pure digits/symbols.
 */
export function isPlaceholderAlt(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) {
    return true;
  }
  if (FILENAME_EXTENSION_PATTERN.test(trimmed)) {
    return true;
  }
  if (PLACEHOLDER_PATTERN.test(trimmed)) {
    return true;
  }
  if (/^[\d\s\-_.]+$/.test(trimmed)) {
    return true;
  }
  return false;
}
