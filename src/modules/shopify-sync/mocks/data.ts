import type { ShopifySyncBatchInput, ShopifySyncBatchOutput } from "../types";

export const shopifySyncMockData: ShopifySyncBatchInput = {
  jobId: "mock-shopify-sync-job-1",
  products: [
    {
      id: "mock-product-custom-1",
      amazonAsin: "B0CHILD001",
      amazonParentAsin: "B0PARENT01",
      title: "Custom Christian Leather Handbag For Women - C01",
      descriptionHtml: "<p>Faith-inspired handbag with personalized details.</p>",
      vendor: "FFP Store",
      productType: "Custom Handbag",
      tags: ["has-customizer", "leather-bag"],
      media: [
        {
          originalSource: "https://m.media-amazon.com/images/I/71xyzSample.jpg",
          alt: "Custom Christian Leather Handbag For Women - C01 - Image 1",
          mediaContentType: "IMAGE",
          friendlyFileName: "media-custom-christian-leather-handbag-c01-img-1-a1b2c3.jpg",
        },
      ],
      variants: [
        {
          title: "Medium / Without Matching Wallet",
          price: "49.99",
          sku: "C01-MED-NOWALLET",
          optionValues: [
            { optionName: "Size", name: "Medium" },
            { optionName: "Wallet", name: "No" },
          ],
        },
        {
          title: "Large / With Matching Wallet",
          price: "69.99",
          sku: "C01-LRG-WALLET",
          optionValues: [
            { optionName: "Size", name: "Large" },
            { optionName: "Wallet", name: "Yes" },
          ],
        },
      ],
      customization: {
        hasCustomization: true,
        textInputs: [
          {
            id: "custom_name",
            label: "Custom Name",
            required: true,
          },
        ],
        assets: [
          {
            url: "https://m.media-amazon.com/images/I/61baseSample.jpg",
            alt: "Custom Christian Leather Handbag For Women - C01 - Base Preview",
            friendlyFileName: "base-custom-christian-leather-handbag-c01-base-d4e5f6.jpg",
            roles: ["base"],
          },
          {
            url: "https://m.media-amazon.com/images/I/41thumbSample.jpg",
            alt: "Matching Leather Long Wallet - Yes (Thumbnail)",
            friendlyFileName: "thumbnail-matching-leather-long-wallet-yes-789abc.jpg",
            roles: ["thumbnail"],
          },
        ],
      },
    },
    {
      id: "mock-product-standard-2",
      title: "Custom Christian Leather Handbag For Women - C06",
      descriptionHtml: "<p>Standard Christian Handbag without customization.</p>",
      vendor: "FFP Store",
      productType: "Standard Handbag",
      tags: ["leather-bag"],
      media: [
        {
          originalSource: "https://m.media-amazon.com/images/I/71stdSample.jpg",
          alt: "Custom Christian Leather Handbag For Women - C06 - Image 1",
          mediaContentType: "IMAGE",
          friendlyFileName: "media-handbag-c06-img-1-def123.jpg",
        },
      ],
      variants: [
        {
          title: "Default",
          price: "39.99",
          sku: "C06-DEF",
        },
      ],
      customization: null,
    },
  ],
};

export const mockShopifySyncExpectedOutput: ShopifySyncBatchOutput = {
  jobId: "mock-shopify-sync-job-1",
  totalProducts: 2,
  successfulProducts: 2,
  failedProducts: 0,
  totalAssetsUploaded: 2,
  results: [
    {
      success: true,
      sourceId: "mock-product-custom-1",
      productId: "gid://shopify/Product/mock-custom-1",
      productHandle: "custom-christian-leather-handbag-for-women-c01",
      title: "Custom Christian Leather Handbag For Women - C01",
      variantsCount: 2,
      mediaCount: 1,
      assetsUploadedCount: 2,
      metafieldSet: true,
      dryRun: true,
      warnings: [],
    },
    {
      success: true,
      sourceId: "mock-product-standard-2",
      productId: "gid://shopify/Product/mock-standard-2",
      productHandle: "custom-christian-leather-handbag-for-women-c06",
      title: "Custom Christian Leather Handbag For Women - C06",
      variantsCount: 1,
      mediaCount: 1,
      assetsUploadedCount: 0,
      metafieldSet: false,
      dryRun: true,
      warnings: [],
    },
  ],
};
