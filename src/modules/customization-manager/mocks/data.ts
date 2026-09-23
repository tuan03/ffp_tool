import type { ProductCustomization } from "../../customization-normalizer";
import type {
  CleanOrphanAssetsOutput,
  CloneCustomizationOutput,
  CreateCustomizationOutput,
  DeleteCustomizationOutput,
  ReadCustomizationOutput,
  UpdateCustomizationOutput,
} from "../types";

export const mockCustomizationConfig: ProductCustomization = {
  hasCustomization: true,
  formUrl: "https://example.com/customizer/sample-product",
  surfaces: [
    {
      name: "Front Surface",
      surfaceId: "surface_front",
      previewUrl: "https://cdn.shopify.com/s/files/1/0001/mockup_front.png",
      fileId: "gid://shopify/MediaImage/9001",
      placements: [
        {
          name: "Center Chest",
          placementId: "center_chest",
          allowedTypes: ["text", "image"],
        },
      ],
    },
    {
      name: "Back Surface",
      surfaceId: "surface_back",
      previewUrl: "https://cdn.shopify.com/s/files/1/0001/mockup_back.png",
      fileId: "gid://shopify/MediaImage/9002",
      placements: [
        {
          name: "Upper Back",
          placementId: "upper_back",
          allowedTypes: ["text"],
        },
      ],
    },
  ],
  optionGroups: [
    {
      id: "group_color",
      label: "Choose Color",
      required: true,
      defaultOptionId: "color_black",
      options: [
        {
          id: "color_black",
          label: "Black",
          thumbnailImage: {
            url: "https://cdn.shopify.com/s/files/1/0001/thumb_black.png",
            alt: "Black Swatch",
          },
        },
        {
          id: "color_white",
          label: "White",
          thumbnailImage: {
            url: "https://cdn.shopify.com/s/files/1/0001/thumb_white.png",
            alt: "White Swatch",
          },
        },
      ],
    },
    {
      id: "group_font",
      label: "Font Family",
      required: false,
      options: [
        { id: "font_helvetica", label: "Helvetica" },
        { id: "font_times", label: "Times New Roman" },
      ],
    },
  ],
  assets: [
    {
      url: "https://cdn.shopify.com/s/files/1/0001/mockup_front.png",
      alt: "Front Mockup",
      roles: ["preview"],
    },
    {
      url: "https://cdn.shopify.com/s/files/1/0001/mockup_back.png",
      alt: "Back Mockup",
      roles: ["preview"],
    },
    {
      url: "https://cdn.shopify.com/s/files/1/0001/thumb_black.png",
      alt: "Black Thumbnail",
      roles: ["swatch"],
    },
    {
      url: "https://cdn.shopify.com/s/files/1/0001/thumb_white.png",
      alt: "White Thumbnail",
      roles: ["swatch"],
    },
  ],
};

export const mockReadOutput: ReadCustomizationOutput = {
  productId: "gid://shopify/Product/1234567890",
  exists: true,
  metafieldId: "gid://shopify/Metafield/mf-sample-1",
  customization: mockCustomizationConfig,
  byteSize: 1850,
  trackedFileIds: [
    "gid://shopify/MediaImage/9001",
    "gid://shopify/MediaImage/9002",
  ],
  warnings: [],
};

export const mockCreateOutput: CreateCustomizationOutput = {
  productId: "gid://shopify/Product/1234567890",
  success: true,
  metafieldId: "gid://shopify/Metafield/mf-sample-1",
  byteSize: 1850,
  trackedFileIds: [
    "gid://shopify/MediaImage/9001",
    "gid://shopify/MediaImage/9002",
  ],
  warnings: [],
};

export const mockUpdateOutput: UpdateCustomizationOutput = {
  productId: "gid://shopify/Product/1234567890",
  success: true,
  metafieldId: "gid://shopify/Metafield/mf-sample-1",
  byteSize: 1850,
  deletedFileIds: [],
  warnings: [],
};

export const mockDeleteOutput: DeleteCustomizationOutput = {
  productId: "gid://shopify/Product/1234567890",
  success: true,
  deletedFileIds: [
    "gid://shopify/MediaImage/9001",
    "gid://shopify/MediaImage/9002",
  ],
  warnings: [],
};

export const mockCloneOutput: CloneCustomizationOutput = {
  sourceProductId: "gid://shopify/Product/1234567890",
  targetProductId: "gid://shopify/Product/9876543210",
  success: true,
  metafieldId: "gid://shopify/Metafield/mf-sample-2",
  byteSize: 1850,
};

export const mockCleanOrphanAssetsOutput: CleanOrphanAssetsOutput = {
  scannedCount: 15,
  orphanCount: 3,
  orphanFileIds: [
    "gid://shopify/MediaImage/9991",
    "gid://shopify/MediaImage/9992",
    "gid://shopify/MediaImage/9993",
  ],
  deletedFileIds: [
    "gid://shopify/MediaImage/9991",
    "gid://shopify/MediaImage/9992",
    "gid://shopify/MediaImage/9993",
  ],
  isDryRun: false,
};
