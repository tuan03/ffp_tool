import { isWebpBuffer, VALID_1X1_WEBP_BUFFER } from "./webp-validator";

export interface WebpConversionOptions {
  readonly quality?: number;
  readonly effort?: number;
  readonly maxInputPixels?: number;
}

export interface WebpConverter {
  convert(input: Buffer, options?: WebpConversionOptions): Promise<Buffer>;
}

export class ImageConversionUnavailableError extends Error {
  constructor(message: string = "WebP conversion is unavailable in this environment") {
    super(message);
    this.name = "ImageConversionUnavailableError";
  }
}

export class WebpValidationError extends Error {
  constructor(message: string = "Converted image did not produce valid WebP format") {
    super(message);
    this.name = "WebpValidationError";
  }
}

/**
 * Deterministic WebP converter for tests and zero-network execution.
 * Always produces a valid WebP buffer without requiring external native dependencies.
 */
export class DeterministicTestWebpConverter implements WebpConverter {
  async convert(input: Buffer): Promise<Buffer> {
    if (!input || input.length === 0) {
      throw new Error("Cannot convert empty buffer to WebP");
    }
    // Return a fresh clone of the valid WebP fixture
    return Buffer.from(VALID_1X1_WEBP_BUFFER);
  }
}

/**
 * Throws ImageConversionUnavailableError when WebP conversion is attempted without an available backend.
 */
export class UnavailableWebpConverter implements WebpConverter {
  async convert(_input?: Buffer, _options?: WebpConversionOptions): Promise<Buffer> {
    throw new ImageConversionUnavailableError();
  }
}

/**
 * Production WebP converter using sharp if installed.
 */
export class SharpWebpConverter implements WebpConverter {
  private sharpModule: unknown;

  constructor(sharpModule?: unknown) {
    this.sharpModule = sharpModule;
  }

  async convert(input: Buffer, options?: WebpConversionOptions): Promise<Buffer> {
    let sharp = this.sharpModule;
    if (!sharp) {
      try {
        const dynamicImport = new Function("specifier", "return import(specifier)") as (
          specifier: string,
        ) => Promise<unknown>;
        const mod = (await dynamicImport("sharp")) as { default?: unknown } | unknown;
        sharp = typeof mod === "object" && mod !== null && "default" in mod ? mod.default : mod;
      } catch {
        throw new ImageConversionUnavailableError("Sharp library is not available");
      }
    }

    if (typeof sharp !== "function") {
      throw new ImageConversionUnavailableError("Sharp instance is invalid");
    }

    try {
      const pipeline = (sharp as (b: Buffer, opts?: unknown) => {
        rotate(): {
          webp(o?: unknown): {
            toBuffer(): Promise<Buffer>;
          };
        };
      })(input, {
        limitInputPixels: options?.maxInputPixels ?? 50_000_000,
      });

      const output = await pipeline
        .rotate()
        .webp({
          quality: options?.quality ?? 82,
          effort: options?.effort ?? 4,
        })
        .toBuffer();

      if (!isWebpBuffer(output)) {
        throw new WebpValidationError();
      }

      return output;
    } catch (err) {
      if (err instanceof WebpValidationError || err instanceof ImageConversionUnavailableError) {
        throw err;
      }
      throw new Error(
        `Sharp conversion failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
