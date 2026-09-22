/**
 * Checks whether a buffer has valid WebP magic bytes:
 * Bytes 0..3: 'RIFF' (0x52 0x49 0x46 0x46)
 * Bytes 8..11: 'WEBP' (0x57 0x45 0x42 0x50)
 */
export function isWebpBuffer(buffer: unknown): boolean {
  if (!buffer) {
    return false;
  }

  if (Buffer.isBuffer(buffer)) {
    if (buffer.length < 12) return false;
    const riff = buffer.subarray(0, 4).toString("ascii");
    const webp = buffer.subarray(8, 12).toString("ascii");
    return riff === "RIFF" && webp === "WEBP";
  }

  if (buffer instanceof Uint8Array) {
    if (buffer.length < 12) return false;
    const slice = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const riff = slice.subarray(0, 4).toString("ascii");
    const webp = slice.subarray(8, 12).toString("ascii");
    return riff === "RIFF" && webp === "WEBP";
  }

  return false;
}

/**
 * Deterministic valid 1x1 WebP binary fixture for testing (42 bytes).
 */
export const VALID_1X1_WEBP_BUFFER: Buffer = Buffer.from(
  "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
  "base64",
);
