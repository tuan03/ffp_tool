import type { AmazonCrawlerOutput, AmazonCrawlerProduct, AmazonCrawlerSettings, AmazonFinalVariant } from "../types";

const MOCK_SETTINGS: AmazonCrawlerSettings = {
  profileSlug: "default",
  imageProfileSlug: "default",
  applyJeminisePreset: false,
  productThreads: 3,
  variantThreads: 8,
  urllibThreads: 12,
  browserProfiles: 4,
  browserTabs: 2,
  headless: false,
  amazonZip: "10001",
  captchaTimeoutSeconds: 180,
  maxMatrixVariants: 500,
};

function mockDiagnostics(): AmazonCrawlerProduct["diagnostics"] {
  return { fetchMode: "http", attempts: 1, captchaEncountered: false, locationFallbackUsed: false, matrixSwept: false, cacheHit: false };
}

function createJeminiseMockVariants(): AmazonFinalVariant[] {
  const pillowValues = [
    ["I don't need pillowcases", "P0"], ["1 Pillowcase (20\" x 30\")", "P1"],
    ["2 Pillowcases (20\" x 30\")", "P2"], ["2 Pillowcases + 1 Add Sheet", "P2S"],
    ["4 Pillowcases (20\" x 30\")", "P4"],
  ] as const;
  const types = [
    { name: "Duvet cover", code: "DV", pillows: { P0: 0, P1: 10, P2: 20 }, sizes: [["US Twin (68\" x 88\")", "TW", 34.9], ["US Full (78\" x 88\")", "FU", 44.9], ["US Queen (88\" x 88\")", "QU", 49.9], ["US King (104\" x 88\")", "KI", 59.9]] as const },
    { name: "Quilt", code: "QT", pillows: { P0: 0, P1: 10, P2: 20 }, sizes: [["Throw (60\" x 70\")", "TH", 46.9], ["Twin (68\" x 86\")", "TW", 61.9], ["Full (80\" x 90\")", "FU", 71.9], ["Queen (90\" x 90\")", "QU", 81.9], ["King (102\" x 91\")", "KI", 91.9]] as const },
    { name: "Comforter", code: "CF", pillows: { P0: 0, P1: 10, P2: 15, P2S: 45, P4: 25 }, sizes: [["Twin (173 x 218 cm)", "TW", 64.9], ["Full (200 x 230 cm)", "FU", 79.9], ["Queen (228 x 228 cm)", "QU", 94.9], ["King (228 x 264 cm)", "KI", 109.9]] as const },
  ] as const;
  const variants: AmazonFinalVariant[] = [];
  for (const beddingType of types) {
    for (const [sizeName, sizeCode, basePrice] of beddingType.sizes) {
      for (const [pillowName, pillowCode] of pillowValues) {
        if (!(pillowCode in beddingType.pillows)) continue;
        const pillowPrice = beddingType.pillows[pillowCode as keyof typeof beddingType.pillows];
        const amount = basePrice + pillowPrice;
        variants.push({
          id: `jeminise_bedding_v2:${beddingType.code}:${sizeCode}:${pillowCode}`,
          sku: `AMZ-MOCK-${beddingType.code}-${sizeCode}-${pillowCode}`,
          sourceAsin: null,
          options: { "Choose type": beddingType.name, "Choose size": sizeName, "PILLOWCASES (Purchase SEPARATELY)": pillowName },
          price: { raw: `$${amount.toFixed(2)}`, amount, currency: "USD" },
          surcharge: null,
          metadata: { preset: "jeminise_bedding_v2" },
        });
      }
    }
  }
  return variants;
}

const regularMockProduct: AmazonCrawlerProduct = {
  id: "mock-regular", parentAsin: "B0MOCK1001", canonicalUrl: "https://www.amazon.com/dp/B0MOCK1001",
  sourceTitle: "Amazon Ceramic Mug", title: "Amazon Ceramic Mug", description: "Amazon source description", bulletPoints: ["Amazon source data"], categories: ["Home & Kitchen", "Mugs"], productDetails: { Material: "Ceramic" }, media: [],
  sourceVariants: [{ asin: "B0MOCK1001", url: "https://www.amazon.com/dp/B0MOCK1001", options: {}, price: { raw: "$14.99", amount: 14.99, currency: "USD" }, media: [], customizationFingerprint: null, priceInference: { isInferred: false, sourceAsins: [] }, warnings: [] }],
  variants: [{ id: "B0MOCK1001-default", sku: "B0MOCK1001", sourceAsin: "B0MOCK1001", options: {}, price: { raw: "$14.99", amount: 14.99, currency: "USD" }, surcharge: null, metadata: {} }],
  variantMatrix: { dimensions: {}, expectedCount: 1, discoveredCount: 1, complete: true, safetyCap: 500 }, customization: null,
  splitContext: { attribute: null, value: null, groupKey: "mock-regular", sourceAsins: ["B0MOCK1001"] }, preset: null, warnings: [], diagnostics: mockDiagnostics(),
};

const matrixMockProduct: AmazonCrawlerProduct = {
  ...structuredClone(regularMockProduct),
  id: "mock-matrix-ocean", parentAsin: "B0MOCK2001", canonicalUrl: "https://www.amazon.com/dp/B0MOCK2001", sourceTitle: "Pattern Throw", title: "Pattern Throw - Ocean",
  sourceVariants: [
    { ...structuredClone(regularMockProduct.sourceVariants[0]), asin: "B0MOCK2002", options: { Design: "Ocean", Color: "Blue" } },
    { ...structuredClone(regularMockProduct.sourceVariants[0]), asin: "B0MOCK2003", options: { Design: "Ocean", Color: "Navy" } },
  ],
  variants: [
    { ...structuredClone(regularMockProduct.variants[0]), id: "mock-blue", sku: "B0MOCK2002", sourceAsin: "B0MOCK2002", options: { Color: "Blue" } },
    { ...structuredClone(regularMockProduct.variants[0]), id: "mock-navy", sku: "B0MOCK2003", sourceAsin: "B0MOCK2003", options: { Color: "Navy" } },
  ],
  variantMatrix: { dimensions: { Color: ["Blue", "Navy"] }, expectedCount: 4, discoveredCount: 2, complete: false, safetyCap: 500 },
  splitContext: { attribute: "Design", value: "Ocean", groupKey: "mock-matrix-ocean", sourceAsins: ["B0MOCK2002", "B0MOCK2003"] },
  warnings: ["Variant matrix is incomplete (mock scenario)."],
};

const jeminiseMockVariants = createJeminiseMockVariants();
const jeminiseMockProduct: AmazonCrawlerProduct = {
  ...structuredClone(regularMockProduct),
  id: "mock-jeminise", parentAsin: "B0MOCK3001", canonicalUrl: "https://www.amazon.com/dp/B0MOCK3001", sourceTitle: "Personalized Comforter", title: "Personalized Comforter - Floral",
  sourceVariants: [{ ...structuredClone(regularMockProduct.sourceVariants[0]), asin: "B0MOCK3001", options: { Design: "Floral" } }],
  variants: jeminiseMockVariants,
  splitContext: { attribute: "Design", value: "Floral", groupKey: "mock-jeminise", sourceAsins: ["B0MOCK3001"] },
  preset: "jeminise_bedding_v2",
};

export const amazonCrawlerMockOutput: AmazonCrawlerOutput = {
  version: "1.0",
  jobId: "mock-amazon-job",
  status: "completed",
  startedAt: "2026-01-01T00:00:00.000Z",
  completedAt: "2026-01-01T00:00:01.000Z",
  settings: MOCK_SETTINGS,
  products: [
    regularMockProduct,
    {
      id: "mock-parent-design-starry-night",
      parentAsin: "B0MOCK0001",
      canonicalUrl: "https://www.amazon.com/dp/B0MOCK0001",
      sourceTitle: "Personalized Bedding Set",
      title: "Personalized Bedding Set - Starry Night",
      description: "Amazon source description",
      bulletPoints: ["Soft microfiber", "Amazon Customize eligible"],
      categories: ["Home & Kitchen", "Bedding"],
      productDetails: { Material: "Microfiber" },
      media: [{ url: "https://m.media-amazon.com/images/I/mock.jpg", kind: "image" }],
      sourceVariants: [
        {
          asin: "B0MOCK0002",
          url: "https://www.amazon.com/dp/B0MOCK0002",
          options: { Design: "Starry Night", Size: "Queen" },
          price: { raw: "$39.99", amount: 39.99, currency: "USD" },
          media: [],
          customizationFingerprint: "mock-customization",
          priceInference: { isInferred: false, sourceAsins: [] },
          warnings: [],
        },
      ],
      variants: [
        {
          id: "mock-queen-no-print",
          sku: "B0MOCK0002-QUEEN-NONE",
          sourceAsin: "B0MOCK0002",
          options: { Size: "Queen", "Gift Box": "None" },
          price: { raw: "$39.99", amount: 39.99, currency: "USD" },
          surcharge: { raw: "$0.00", amount: 0, currency: "USD" },
          metadata: { customization: true },
        },
        {
          id: "mock-queen-premium-box",
          sku: "B0MOCK0002-QUEEN-PREMIUM",
          sourceAsin: "B0MOCK0002",
          options: { Size: "Queen", "Gift Box": "Premium" },
          price: { raw: "$44.99", amount: 44.99, currency: "USD" },
          surcharge: { raw: "+$5.00", amount: 5, currency: "USD" },
          metadata: { customization: true },
        },
      ],
      variantMatrix: {
        dimensions: { Design: ["Starry Night", "Ocean"], Size: ["Queen"] },
        expectedCount: 2,
        discoveredCount: 2,
        complete: true,
        safetyCap: 500,
      },
      customization: {
        schemaVersion: 1,
        source: { asin: "B0MOCK0002", marketplaceId: "ATVPDKIKX0DER", merchantId: "", sku: "", sellerConfigVersion: "1" },
        product: { productImageUrl: "https://m.media-amazon.com/images/I/mock.jpg", previewSize: 400 },
        surfaces: [],
        optionGroups: [],
        textInputs: [{ id: "name", type: "TextInputComponent", label: "Name", required: true }],
        imageInputs: [],
        fontGroups: [],
        colorGroups: [],
        placements: [],
        conditionalRules: [],
        regexChoices: {},
        controlOrder: [{ type: "text", id: "name" }],
        componentParent: {},
        componentTypes: { name: "TextInputComponent", "gift-box": "OptionChooserComponent" },
        assets: [],
        pricing: {
          currencyCode: "USD",
          mode: "product_variants",
          paidOptionGroups: [{
            id: "gift-box",
            label: "Gift Box",
            required: false,
            defaultOptionId: "none",
            options: [
              { id: "none", label: "None", price: { raw: "$0.00", amount: 0, currency: "USD" }, isAvailable: true },
              { id: "premium", label: "Premium", price: { raw: "+$5.00", amount: 5, currency: "USD" }, isAvailable: true },
            ],
          }],
        },
        fingerprint: "mock-customization",
      },
      splitContext: {
        attribute: "Design",
        value: "Starry Night",
        groupKey: "mock-parent-design-starry-night",
        sourceAsins: ["B0MOCK0002"],
      },
      preset: null,
      warnings: [],
      diagnostics: {
        fetchMode: "http",
        attempts: 1,
        captchaEncountered: false,
        locationFallbackUsed: false,
        matrixSwept: false,
        cacheHit: false,
      },
    },
    matrixMockProduct,
    jeminiseMockProduct,
  ],
  errors: [],
  warnings: [],
  statistics: {
    requestedInputs: 1,
    acceptedInputs: 1,
    rejectedInputs: 0,
    products: 4,
    sourceVariants: 5,
    finalVariants: 52,
    durationMs: 1000,
  },
  exportFilename: "amazon-crawl-mock-amazon-job.json",
};
