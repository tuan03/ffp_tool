import type { CustomizationNormalizerOutput } from "../types";

export const customizationNormalizerMockData: CustomizationNormalizerOutput = {
  version: "1.0.0",
  jobId: "mock-crawl-job-12345",
  status: "completed",
  startedAt: "2026-09-21T12:00:00.000Z",
  completedAt: "2026-09-21T12:02:00.000Z",
  settings: {
    profileSlug: "default",
  },
  products: [
    {
      id: "product-custom-1",
      parentAsin: "B0MOCK001",
      title: "Custom Monogram Leather Bag - Black",
      media: [
        {
          url: "https://m.media-amazon.com/images/I/mock-main-image.jpg",
          kind: "image",
          alt: "Custom Monogram Leather Bag - Black - Image 1",
          friendlyFileName: "media-custom-monogram-leather-bag-black-img-1-a1b2c3.jpg",
        },
      ],
      customization: {
        hasCustomization: true,
        optionGroups: [
          {
            id: "opt-group-1",
            label: "Color Option",
            options: [
              {
                id: "color-black",
                label: "Classic Black",
                thumbnailImage: {
                  url: "https://m.media-amazon.com/images/S/mock-thumb-black.jpg",
                  alt: "Color Option - Classic Black (Thumbnail)",
                  friendlyFileName: "thumbnail-color-option-classic-black-d4e5f6.jpg",
                },
              },
            ],
          },
        ],
        assets: [
          {
            url: "https://m.media-amazon.com/images/S/mock-base-preview.png",
            roles: ["base"],
            alt: "Custom Monogram Leather Bag - Black - Base Preview",
            friendlyFileName: "base-custom-monogram-leather-bag-black-base-prev-789abc.png",
          },
        ],
      },
    },
    {
      id: "product-standard-2",
      parentAsin: "B0MOCK002",
      title: "Standard Travel Duffle Bag - Brown",
      media: [
        {
          url: "https://m.media-amazon.com/images/I/mock-duffle.jpg",
          kind: "image",
        },
      ],
      customization: null,
    },
  ],
  normalizationSummary: {
    totalProducts: 2,
    customizedProducts: 1,
    untouchedProducts: 1,
    normalizedAssetsCount: 3,
  },
};
