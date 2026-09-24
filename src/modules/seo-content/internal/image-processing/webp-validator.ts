/**
 * Checks whether a buffer has valid WebP magic bytes:
 * Bytes 0..3: 'RIFF' (0x52 0x49 0x46 0x46)
 * Bytes 8..11: 'WEBP' (0x57 0x45 0x42 0x50)
 */
export function isWebpBuffer(buffer: unknown): boolean {
  if (!buffer) {
    return false;
  }

  if (
    buffer instanceof Uint8Array ||
    (typeof Buffer !== "undefined" && typeof Buffer.isBuffer === "function" && Buffer.isBuffer(buffer))
  ) {
    const bytes = buffer as Uint8Array;
    if (bytes.length < 12) return false;
    return (
      bytes[0] === 0x52 && // 'R'
      bytes[1] === 0x49 && // 'I'
      bytes[2] === 0x46 && // 'F'
      bytes[3] === 0x46 && // 'F'
      bytes[8] === 0x57 && // 'W'
      bytes[9] === 0x45 && // 'E'
      bytes[10] === 0x42 && // 'B'
      bytes[11] === 0x50 // 'P'
    );
  }

  return false;
}

/**
 * Deterministic valid 1x1 WebP binary fixture for testing (42 bytes).
 */
const VALID_1X1_WEBP_BASE64 =
  "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";

function createValid1x1WebpBuffer(): Buffer {
  if (typeof Buffer !== "undefined" && typeof Buffer.from === "function") {
    return Buffer.from(VALID_1X1_WEBP_BASE64, "base64");
  }

  if (typeof atob === "function") {
    const binary = atob(VALID_1X1_WEBP_BASE64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes as unknown as Buffer;
  }

  return new Uint8Array(42) as unknown as Buffer;
}

export const VALID_1X1_WEBP_BUFFER: Buffer = createValid1x1WebpBuffer();
