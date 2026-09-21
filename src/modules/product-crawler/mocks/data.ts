import {
  DEFAULT_CRAWLER_OPTIONS,
  type CrawlerError,
  type CrawlerProduct,
  type ProductCrawlerJobOutput,
  type ProductCrawlerOptions,
} from "../types";

export function createMockSvgThumbnail(
  title: string,
  subtitle: string,
  bgColor = "#0f172a",
  textColor = "#38bdf8",
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
    <rect width="400" height="400" fill="${bgColor}" rx="16"/>
    <circle cx="200" cy="150" r="70" fill="${textColor}" fill-opacity="0.15"/>
    <path d="M165 150 L235 150 M200 115 L200 185" stroke="${textColor}" stroke-width="6" stroke-linecap="round"/>
    <text x="200" y="270" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="bold" text-anchor="middle">${title}</text>
    <text x="200" y="300" fill="${textColor}" font-family="system-ui, -apple-system, sans-serif" font-size="13" font-weight="medium" text-anchor="middle">${subtitle}</text>
    <rect x="60" y="330" width="280" height="24" rx="6" fill="#1e293b"/>
    <text x="200" y="346" fill="#94a3b8" font-family="monospace" font-size="11" text-anchor="middle">AMAZON VERIFIED ASIN</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export const defaultMockCrawlerOptions: ProductCrawlerOptions = {
  ...DEFAULT_CRAWLER_OPTIONS,
};

export const mockProduct1Handbag: CrawlerProduct = {
  id: "prod_B0GQ33XWW7",
  parentAsin: "B0GQ33XWW7",
  canonicalUrl: "https://www.amazon.com/dp/B0GQ33XWW7",
  sourceTitle: "Custom Christian Leather Handbag Personalized Scripture Tote",
  title: "Custom Christian Leather Handbag Personalized Scripture Tote with Matching Wallet",
  description:
    "Elevate your daily routine with this handcrafted, premium leather handbag customized with your favorite Scripture and personalized family name. Built to last with reinforced stitching and timeless brass hardware.",
  bulletPoints: [
    "PERSONALIZED ENGRAVING: Laser-engraved Christian scripture verse and your custom name.",
    "PREMIUM LEATHER: Crafted from 100% full-grain genuine leather with water-resistant finish.",
    "SPACIOUS DESIGN: Fits 14-inch laptops, books, Bibles, and daily essentials with multi-compartment dividers.",
    "OPTIONAL MATCHING WALLET: Complementary RFID-blocking zip wallet available in matching leather tones.",
    "HANDMADE INTEGRITY: Each bag is inspected, conditioned, and packaged with care in the USA.",
  ],
  categories: ["Clothing, Shoes & Jewelry", "Women's Handbags", "Shoulder Bags & Totes"],
  productDetails: {
    ASIN: "B0GQ33XWW7",
    Brand: "Grace & Co Leatherworks",
    Material: "Full-Grain Leather",
    Dimensions: "15 x 11.5 x 5.2 inches",
    Weight: "1.85 lbs",
    Closure: "Brass Zipper",
    CountryOfOrigin: "USA",
  },
  media: [
    {
      url: createMockSvgThumbnail("Handbag Main Front", "Grace & Co - Cognac Brown", "#1e1b4b", "#818cf8"),
      kind: "image",
      sourceAsin: "B0GQ33XWW7",
    },
    {
      url: createMockSvgThumbnail("Handbag Interior Detail", "Multi-pocket Divider", "#0f172a", "#38bdf8"),
      kind: "image",
      sourceAsin: "B0GQ33XWW7",
    },
    {
      url: createMockSvgThumbnail("Matching Wallet Set", "RFID Blocking Zip Wallet", "#1e293b", "#a78bfa"),
      kind: "image",
      sourceAsin: "B0GQ33XWW7",
    },
    {
      url: createMockSvgThumbnail("Custom Engraving Sample", "Laser Etched Scripture", "#172554", "#60a5fa"),
      kind: "image",
      sourceAsin: "B0GQ33XWW7",
    },
  ],
  sourceVariants: [
    {
      asin: "B0GQ33XWW7",
      title: "Cognac Brown - Medium",
      price: 39.95,
      currency: "USD",
      dimensions: { Color: "Cognac Brown", Size: "Medium" },
      inStock: true,
    },
    {
      asin: "B0GQ3JQ144",
      title: "Cognac Brown - Large",
      price: 49.95,
      currency: "USD",
      dimensions: { Color: "Cognac Brown", Size: "Large" },
      inStock: true,
    },
  ],
  variants: [
    {
      id: "B0GQ33XWW7-C01-M-NOWALLET",
      sku: "HB-COG-MED-NOWLT",
      sourceAsin: "B0GQ33XWW7",
      title: "Medium Bag / No Wallet / Cognac Brown",
      options: {
        "Choose Leather Bag Size": "Medium",
        "Matching Wallet": "No",
        Color: "Cognac Brown",
      },
      price: { amount: 39.95, currency: "USD" },
      surcharge: { amount: 0, currency: "USD" },
    },
    {
      id: "B0GQ33XWW7-C01-M-WALLET",
      sku: "HB-COG-MED-WLT",
      sourceAsin: "B0GQ33XWW7",
      title: "Medium Bag / With Matching Wallet / Cognac Brown",
      options: {
        "Choose Leather Bag Size": "Medium",
        "Matching Wallet": "Yes",
        Color: "Cognac Brown",
      },
      price: { amount: 65.95, currency: "USD" },
      surcharge: { amount: 26.0, currency: "USD" },
    },
    {
      id: "B0GQ33XWW7-C01-L-NOWALLET",
      sku: "HB-COG-LRG-NOWLT",
      sourceAsin: "B0GQ3JQ144",
      title: "Large Bag / No Wallet / Cognac Brown",
      options: {
        "Choose Leather Bag Size": "Large",
        "Matching Wallet": "No",
        Color: "Cognac Brown",
      },
      price: { amount: 49.95, currency: "USD" },
      surcharge: { amount: 10.0, currency: "USD" },
    },
    {
      id: "B0GQ33XWW7-C01-L-WALLET",
      sku: "HB-COG-LRG-WLT",
      sourceAsin: "B0GQ3JQ144",
      title: "Large Bag / With Matching Wallet / Cognac Brown",
      options: {
        "Choose Leather Bag Size": "Large",
        "Matching Wallet": "Yes",
        Color: "Cognac Brown",
      },
      price: { amount: 75.95, currency: "USD" },
      surcharge: { amount: 36.0, currency: "USD" },
    },
    {
      id: "B0GQ33XWW7-C02-M-NOWALLET",
      sku: "HB-BLK-MED-NOWLT",
      sourceAsin: "B0GQ33XWW7",
      title: "Medium Bag / No Wallet / Midnight Black",
      options: {
        "Choose Leather Bag Size": "Medium",
        "Matching Wallet": "No",
        Color: "Midnight Black",
      },
      price: { amount: 39.95, currency: "USD" },
      surcharge: { amount: 0, currency: "USD" },
    },
    {
      id: "B0GQ33XWW7-C02-M-WALLET",
      sku: "HB-BLK-MED-WLT",
      sourceAsin: "B0GQ33XWW7",
      title: "Medium Bag / With Matching Wallet / Midnight Black",
      options: {
        "Choose Leather Bag Size": "Medium",
        "Matching Wallet": "Yes",
        Color: "Midnight Black",
      },
      price: { amount: 65.95, currency: "USD" },
      surcharge: { amount: 26.0, currency: "USD" },
    },
    {
      id: "B0GQ33XWW7-C02-L-NOWALLET",
      sku: "HB-BLK-LRG-NOWLT",
      sourceAsin: "B0GQ3JQ144",
      title: "Large Bag / No Wallet / Midnight Black",
      options: {
        "Choose Leather Bag Size": "Large",
        "Matching Wallet": "No",
        Color: "Midnight Black",
      },
      price: { amount: 49.95, currency: "USD" },
      surcharge: { amount: 10.0, currency: "USD" },
    },
    {
      id: "B0GQ33XWW7-C02-L-WALLET",
      sku: "HB-BLK-LRG-WLT",
      sourceAsin: "B0GQ3JQ144",
      title: "Large Bag / With Matching Wallet / Midnight Black",
      options: {
        "Choose Leather Bag Size": "Large",
        "Matching Wallet": "Yes",
        Color: "Midnight Black",
      },
      price: { amount: 75.95, currency: "USD" },
      surcharge: { amount: 36.0, currency: "USD" },
    },
  ],
  variantMatrix: {
    dimensions: {
      Size: ["Medium", "Large"],
      Wallet: ["No", "Yes"],
      Color: ["Cognac Brown", "Midnight Black"],
    },
    combinationsCount: 8,
  },
  customization: {
    source: "amazon_custom_widget_v2",
    productImage: createMockSvgThumbnail("Handbag Main Front", "Grace & Co - Cognac Brown", "#1e1b4b", "#818cf8"),
    surfaces: [
      {
        name: "Front Patch",
        previewUrl: createMockSvgThumbnail("Front Patch Surface", "Laser Surface", "#1e293b", "#38bdf8"),
      },
    ],
    optionGroups: [
      {
        id: "scripture_verse",
        name: "Select Scripture Verse",
        type: "select",
        required: true,
        options: [
          { label: "Philippians 4:13 - I can do all things...", value: "phil_4_13", priceDelta: 0 },
          { label: "Proverbs 31:25 - She is clothed with strength...", value: "prov_31_25", priceDelta: 0 },
          { label: "Jeremiah 29:11 - For I know the plans...", value: "jer_29_11", priceDelta: 0 },
          { label: "Custom Verse (+Laser setup fee)", value: "custom_verse", priceDelta: 5.0 },
        ],
      },
      {
        id: "wallet_option",
        name: "Matching Wallet Add-on",
        type: "radio",
        required: false,
        options: [
          { label: "No Wallet (+$0)", value: "none", priceDelta: 0 },
          { label: "Add Matching Wallet (+$26.00)", value: "yes", priceDelta: 26.0 },
        ],
      },
    ],
    textInputs: [
      {
        id: "recipient_name",
        label: "Personalized Name / Initials",
        required: true,
        placeholder: "e.g. Sophia Marie",
        maxLength: 30,
      },
      {
        id: "custom_note",
        label: "Gift Note on Interior Tag",
        required: false,
        placeholder: "With all my love, David",
        maxLength: 80,
      },
    ],
    fontGroups: [
      {
        id: "primary_font",
        name: "Script Typography Style",
        fonts: ["Elegant Script", "Bold Serif", "Modern Sans", "Handwritten Cursive"],
      },
    ],
  },
  warnings: [],
  diagnostics: {
    fetchDurationMs: 820,
    retries: 0,
    cached: false,
  },
};

export const mockProduct2Watch: CrawlerProduct = {
  id: "prod_B08XY12345",
  parentAsin: "B08XY12345",
  canonicalUrl: "https://www.amazon.com/dp/B08XY12345",
  sourceTitle: "Personalized Engraved Wooden Watch - Custom Message For Him",
  title: "Personalized Engraved Wooden Watch with Genuine Leather Band - Custom Husband / Groom Gift",
  description:
    "Handmade natural sandalwood and ebony wooden watch featuring high-precision Japanese quartz movement. Laser-etched back cover allows bespoke romantic or commemorative engravings.",
  bulletPoints: [
    "AUTHENTIC NATURAL WOOD: Made with eco-friendly natural wood; each timepiece has unique wood grain.",
    "JAPANESE QUARTZ MOVEMENT: Ultra-accurate battery-operated quartz movement with scratch-proof glass.",
    "PERFECT MEMORABLE GIFT: Highly customized back engraving for anniversaries, birthdays, weddings, or Father's day.",
    "PREMIUM PACKAGING: Delivered in an authentic bamboo gift watch box ready for presenting.",
  ],
  categories: ["Men's Watches", "Wrist Watches", "Handmade Products"],
  productDetails: {
    ASIN: "B08XY12345",
    Brand: "NordicTimber Co.",
    CaseDiameter: "44mm",
    BandWidth: "22mm",
    Movement: "Japanese Quartz",
    WaterResistance: "3 ATM (Splash resistant)",
  },
  media: [
    {
      url: createMockSvgThumbnail("Wooden Watch Front", "NordicTimber - Ebony", "#1c1917", "#f59e0b"),
      kind: "image",
      sourceAsin: "B08XY12345",
    },
    {
      url: createMockSvgThumbnail("Engraved Watch Backing", "Laser Engraved Back", "#292524", "#fbbf24"),
      kind: "image",
      sourceAsin: "B08XY12345",
    },
  ],
  sourceVariants: [
    {
      asin: "B08XY12345",
      title: "Ebony Wood / Brown Leather",
      price: 45.0,
      currency: "USD",
      inStock: true,
    },
    {
      asin: "B08XY67890",
      title: "Sandalwood / Black Leather",
      price: 49.0,
      currency: "USD",
      inStock: true,
    },
  ],
  variants: [
    {
      id: "B08XY12345-EBONY-BRN",
      sku: "WTCH-EBN-BRN",
      sourceAsin: "B08XY12345",
      title: "Ebony Wood / Brown Leather Band",
      options: { Wood: "Natural Ebony", Band: "Brown Leather" },
      price: { amount: 45.0, currency: "USD" },
      surcharge: { amount: 0, currency: "USD" },
    },
    {
      id: "B08XY12345-SNDL-BLK",
      sku: "WTCH-SND-BLK",
      sourceAsin: "B08XY67890",
      title: "Sandalwood / Black Leather Band",
      options: { Wood: "Sandalwood", Band: "Black Leather" },
      price: { amount: 49.0, currency: "USD" },
      surcharge: { amount: 4.0, currency: "USD" },
    },
  ],
  variantMatrix: {
    dimensions: {
      Wood: ["Natural Ebony", "Sandalwood"],
      Band: ["Brown Leather", "Black Leather"],
    },
    combinationsCount: 4,
  },
  customization: {
    source: "amazon_custom_widget_v2",
    textInputs: [
      {
        id: "engraving_line1",
        label: "Back Engraving Line 1 (Message)",
        required: true,
        placeholder: "To My Husband, Love Always",
        maxLength: 35,
      },
      {
        id: "engraving_line2",
        label: "Back Engraving Line 2 (Date / Names)",
        required: false,
        placeholder: "Est. 10.14.2023",
        maxLength: 25,
      },
    ],
    fontGroups: [
      {
        id: "engrave_font",
        name: "Font Style",
        fonts: ["Classic Serif", "Romantic Script", "Modern Block"],
      },
    ],
  },
  warnings: [],
  diagnostics: {
    fetchDurationMs: 640,
    retries: 0,
    cached: true,
  },
};

export const mockProduct3MugWarning: CrawlerProduct = {
  id: "prod_B09PQ56789",
  parentAsin: "B09PQ56789",
  canonicalUrl: "https://www.amazon.com/dp/B09PQ56789",
  sourceTitle: "Custom Name Ceramic Coffee Mug 15oz - Dishwasher Safe",
  title: "Personalized Ceramic Coffee Mug 15oz - Customizable Name & Monogram",
  description:
    "High-grade ceramic coffee mug with durable glossy glaze. High definition heat sublimation printing ensures vibrant artwork that won't fade.",
  bulletPoints: [
    "DURABLE CERAMIC: 100% thick white ceramic with comfortable C-handle.",
    "MICROWAVE & DISHWASHER SAFE: Safe for hot beverages and commercial dishwashers.",
    "PRINTED IN USA: Vibrant two-sided printing.",
  ],
  categories: ["Kitchen & Dining", "Dining & Entertaining", "Glassware & Drinkware", "Mugs"],
  productDetails: {
    ASIN: "B09PQ56789",
    Capacity: "15 Fluid Ounces",
    Material: "Ceramic",
    Color: "Pure White",
  },
  media: [
    {
      url: createMockSvgThumbnail("Ceramic Mug 15oz", "Glossy White Finish", "#0c4a6e", "#38bdf8"),
      kind: "image",
      sourceAsin: "B09PQ56789",
    },
  ],
  sourceVariants: [
    {
      asin: "B09PQ56789",
      title: "15 oz - White",
      price: 16.99,
      currency: "USD",
      inStock: true,
    },
  ],
  variants: [
    {
      id: "B09PQ56789-15OZ-WHT",
      sku: "MUG-15OZ-WHT",
      sourceAsin: "B09PQ56789",
      title: "15 oz Standard Mug / White",
      options: { Size: "15 oz", Color: "White" },
      price: { amount: 16.99, currency: "USD" },
      surcharge: { amount: 0, currency: "USD" },
    },
  ],
  variantMatrix: {
    dimensions: { Size: ["15 oz"] },
    combinationsCount: 1,
  },
  customization: null,
  warnings: [
    "Amazon indicates customization exists, but its widget payload could not be parsed. Fallback to basic product attributes.",
  ],
  diagnostics: {
    fetchDurationMs: 1420,
    retries: 1,
    cached: false,
  },
};

export const mockProduct4Backpack: CrawlerProduct = {
  id: "prod_B07ZZ99881",
  parentAsin: "B07ZZ99881",
  canonicalUrl: "https://www.amazon.com/dp/B07ZZ99881",
  sourceTitle: "Heavy Duty Tactical Backpack 45L Waterproof Outdoor Rucksack",
  title: "Heavy Duty Tactical Military Backpack 45L - Waterproof Bug Out Bag MOLLE Rucksack",
  description:
    "Constructed from 900D high-density waterproof oxford nylon fabric. Equipped with double-stitched heavy-duty zippers, utility-style cord pulls, side and front load compression system, and ventilated mesh padded back area.",
  bulletPoints: [
    "MILITARY GRADE MATERIAL: 900D oxford nylon fabric, tear-resistant, durable and water-resistant.",
    "LARGE CAPACITY: 45L multi-compartment storage with dedicated laptop sleeve and concealed back pouch.",
    "MOLLE MODULAR SYSTEM: Full-coverage tactical MOLLE webbing for attaching camping gear and pouches.",
  ],
  categories: ["Sports & Outdoors", "Outdoor Recreation", "Camping & Hiking", "Backpacks"],
  productDetails: {
    ASIN: "B07ZZ99881",
    Brand: "ApexTactical",
    Capacity: "45 Liters",
    Material: "900D Oxford Fabric",
    Weight: "2.8 lbs",
  },
  media: [
    {
      url: createMockSvgThumbnail("Tactical Backpack Front", "45L Bug Out Bag - Coyote", "#14532d", "#4ade80"),
      kind: "image",
      sourceAsin: "B07ZZ99881",
    },
    {
      url: createMockSvgThumbnail("Tactical Backpack Side", "MOLLE Attachment Points", "#064e3b", "#34d399"),
      kind: "image",
      sourceAsin: "B07ZZ99881",
    },
  ],
  sourceVariants: [
    {
      asin: "B07ZZ99881",
      title: "Coyote Tan - 45L",
      price: 49.99,
      currency: "USD",
      inStock: true,
    },
    {
      asin: "B07ZZ99882",
      title: "Tactical Black - 45L",
      price: 49.99,
      currency: "USD",
      inStock: true,
    },
    {
      asin: "B07ZZ99883",
      title: "Olive Drab Green - 45L",
      price: 49.99,
      currency: "USD",
      inStock: true,
    },
  ],
  variants: [
    {
      id: "B07ZZ99881-COYOTE",
      sku: "BP-45L-COY",
      sourceAsin: "B07ZZ99881",
      title: "45L Military Rucksack / Coyote Tan",
      options: { Color: "Coyote Tan", Size: "45 Liters" },
      price: { amount: 49.99, currency: "USD" },
    },
    {
      id: "B07ZZ99882-BLACK",
      sku: "BP-45L-BLK",
      sourceAsin: "B07ZZ99882",
      title: "45L Military Rucksack / Tactical Black",
      options: { Color: "Tactical Black", Size: "45 Liters" },
      price: { amount: 49.99, currency: "USD" },
    },
    {
      id: "B07ZZ99883-ODGREEN",
      sku: "BP-45L-ODG",
      sourceAsin: "B07ZZ99883",
      title: "45L Military Rucksack / Olive Drab Green",
      options: { Color: "Olive Drab Green", Size: "45 Liters" },
      price: { amount: 49.99, currency: "USD" },
    },
  ],
  variantMatrix: {
    dimensions: {
      Color: ["Coyote Tan", "Tactical Black", "Olive Drab Green"],
      Size: ["45 Liters"],
    },
    combinationsCount: 3,
  },
  customization: null,
  warnings: [],
  diagnostics: {
    fetchDurationMs: 710,
    retries: 0,
    cached: false,
  },
};

export const mockSampleProducts: readonly CrawlerProduct[] = [
  mockProduct1Handbag,
  mockProduct2Watch,
  mockProduct3MugWarning,
  mockProduct4Backpack,
];

export const mockCrawlerErrors: readonly CrawlerError[] = [
  {
    code: "AMAZON_PRODUCT_UNAVAILABLE",
    message: "Amazon product page returned 404 or inactive listing for ASIN B0FAKEXXX",
    input: "B0FAKEXXX",
    retryable: false,
  },
];

export function getFreshMockProducts(): CrawlerProduct[] {
  return JSON.parse(JSON.stringify(mockSampleProducts));
}

export function buildMockJobOutput(
  jobId: string,
  products = getFreshMockProducts(),
  requestedCount = 4,
  errors: CrawlerError[] = [],
): ProductCrawlerJobOutput {
  const hasWarnings = products.some((p) => (p.warnings?.length ?? 0) > 0);
  const totalVariants = products.reduce((acc, p) => acc + p.variants.length, 0);
  const totalSourceVariants = products.reduce((acc, p) => acc + p.sourceVariants.length, 0);

  return {
    version: "2.0.0",
    jobId,
    status: hasWarnings || errors.length > 0 ? "partial" : "completed",
    startedAt: new Date(Date.now() - 14500).toISOString(),
    completedAt: new Date().toISOString(),
    products,
    errors,
    warnings: hasWarnings
      ? ["Một số sản phẩm có cảnh báo khi bóc tách tùy biến widget; vui lòng kiểm tra chi tiết sản phẩm."]
      : [],
    statistics: {
      requestedInputs: requestedCount,
      acceptedInputs: requestedCount - errors.length,
      rejectedInputs: errors.length,
      products: products.length,
      sourceVariants: totalSourceVariants,
      finalVariants: totalVariants,
      durationMs: 14500,
    },
  };
}
