import type { SeoContentImageOutput } from "../../types";
import type {
  ImageArtifactLocation,
  ImageProcessingInput,
  ImageProcessingIssue,
  ImageProcessingMetadata,
} from "./image-processing-types";

import { generateAltText } from "./alt-text-generator";
import type { ImageArtifactSink } from "./image-artifact-sink";
import type { ImageSourceLoader } from "./image-source-loader";
import { DefaultImageSourceLoader } from "./image-source-loader";
import type { WebpConverter } from "./webp-converter";
import {
  DeterministicTestWebpConverter,
  SharpWebpConverter,
  UnavailableWebpConverter,
} from "./webp-converter";
import { generateWebpFilename } from "./webp-filename-generator";

export interface ImageProcessingResultWithMetadata {
  readonly processedImages: readonly SeoContentImageOutput[];
  readonly metadata: ImageProcessingMetadata;
}

export interface ImageProcessorOptions {
  readonly sourceLoader?: ImageSourceLoader;
  readonly webpConverter?: WebpConverter;
  readonly artifactSink?: ImageArtifactSink;
  readonly strictConversion?: boolean;
}

export interface ImageProcessor {
  process(input: ImageProcessingInput): Promise<ImageProcessingResultWithMetadata>;
}

export class DefaultImageProcessor implements ImageProcessor {
  private readonly sourceLoader: ImageSourceLoader;
  private readonly webpConverter: WebpConverter;
  private readonly artifactSink?: ImageArtifactSink;
  private readonly strictConversion: boolean;

  constructor(options: ImageProcessorOptions = {}) {
    this.sourceLoader = options.sourceLoader ?? new DefaultImageSourceLoader();
    this.webpConverter = options.webpConverter ?? new SharpWebpConverter();
    this.artifactSink = options.artifactSink;
    this.strictConversion = options.strictConversion ?? false;
  }

  async process(input: ImageProcessingInput): Promise<ImageProcessingResultWithMetadata> {
    if (!input.images || input.images.length === 0) {
      return {
        processedImages: [],
        metadata: {
          totalImages: 0,
          convertedImages: 0,
          failedConversions: 0,
          converter: this.getConverterType(),
          issues: [],
        },
      };
    }

    const processedImages: SeoContentImageOutput[] = [];
    const issues: ImageProcessingIssue[] = [];
    const previousAlts: string[] = [];
    let convertedCount = 0;

    for (let i = 0; i < input.images.length; i++) {
      const sourceImage = input.images[i];

      // 1. Generate filename
      const filename = generateWebpFilename({
        productHandle: input.productHandle,
        productTitle: input.productTitle,
        primaryKeyword: input.primaryKeyword,
        index: i,
      });

      // 2. Generate alt text
      const alt = generateAltText({
        sourceAlt: sourceImage.alt,
        sourceTitle: input.sourceTitle,
        productTitle: input.productTitle,
        primaryKeyword: input.primaryKeyword,
        secondaryKeywords: input.secondaryKeywords,
        productCategory: input.productCategory,
        entities: input.entities,
        dominantColors: input.dominantColors,
        visualStyle: input.visualStyle,
        imageIndex: i,
        previousAlts,
      });
      previousAlts.push(alt);

      // 3. Convert image to WebP
      let webpData: Buffer | undefined;
      let localFilePath: string | undefined = sourceImage.localFilePath;
      let url: string | undefined = sourceImage.url;

      try {
        const loaded = await this.sourceLoader.load(sourceImage);
        const converted = await this.webpConverter.convert(loaded.buffer);
        convertedCount++;
        webpData = converted;

        if (this.artifactSink) {
          const location: ImageArtifactLocation = await this.artifactSink.save(filename, converted);
          if (location.localFilePath) localFilePath = location.localFilePath;
          if (location.url) url = location.url;
          if (location.data) webpData = location.data;
        }
      } catch (err) {
        issues.push({
          imageIndex: i,
          sourceUrl: sourceImage.url,
          code: "conversion_failed",
          message: err instanceof Error ? err.message : String(err),
        });

        if (this.strictConversion) {
          throw err;
        }
        // In lenient mode: preserve filename and pointers, but do not fabricate fake WebP bytes
        webpData = undefined;
      }

      processedImages.push({
        sourceUrl: sourceImage.url,
        alt,
        webp: {
          filename,
          localFilePath,
          url,
          data: webpData,
        },
      });
    }

    const metadata: ImageProcessingMetadata = {
      totalImages: input.images.length,
      convertedImages: convertedCount,
      failedConversions: issues.length,
      converter: this.getConverterType(),
      issues,
    };

    return {
      processedImages,
      metadata,
    };
  }

  private getConverterType(): "test" | "sharp" | "unavailable" {
    if (this.webpConverter instanceof DeterministicTestWebpConverter) {
      return "test";
    }
    if (this.webpConverter instanceof UnavailableWebpConverter) {
      return "unavailable";
    }
    return "sharp";
  }
}

/** Generates SEO alt text without downloading, converting, or writing images. */
export class AltOnlyImageProcessor implements ImageProcessor {
  async process(input: ImageProcessingInput): Promise<ImageProcessingResultWithMetadata> {
    const previousAlts: string[] = [];
    const processedImages = input.images.map((sourceImage, index) => {
      const alt = generateAltText({
        sourceAlt: sourceImage.alt,
        sourceTitle: input.sourceTitle,
        productTitle: input.productTitle,
        primaryKeyword: input.primaryKeyword,
        secondaryKeywords: input.secondaryKeywords,
        productCategory: input.productCategory,
        entities: input.entities,
        dominantColors: input.dominantColors,
        visualStyle: input.visualStyle,
        imageIndex: index,
        previousAlts,
      });
      previousAlts.push(alt);
      return {
        sourceUrl: sourceImage.url,
        alt,
        webp: {
          filename: generateWebpFilename({
            productHandle: input.productHandle,
            productTitle: input.productTitle,
            primaryKeyword: input.primaryKeyword,
            index,
          }),
          url: sourceImage.url,
        },
      };
    });
    return {
      processedImages,
      metadata: {
        totalImages: processedImages.length,
        convertedImages: 0,
        failedConversions: 0,
        converter: "unavailable",
        issues: [],
      },
    };
  }
}
