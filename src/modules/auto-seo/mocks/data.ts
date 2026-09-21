import type { ShopifyProductForAutoSeoUi } from "../types";

export const mockShopifyProducts: readonly ShopifyProductForAutoSeoUi[] = [
  {
    id: "gid://shopify/Product/8123456789001",
    title: "Custom Music Album Area Rug",
    handle: "personalized-music-album-area-rug",
    status: "ACTIVE",
    vendor: "CHILLGEN",
    productType: "Rug",
    tags: ["home-decor", "rug", "music-lover", "custom-rug"],
    descriptionHtml:
      "<p>Bring your favorite musical masterpiece right onto your floor with our high-grade <strong>Custom Music Album Area Rug</strong>.</p><ul><li>Anti-slip latex backing</li><li>Plush microfiber velvet surface</li><li>Vibrant dye sublimation print</li></ul>",
    images: [
      {
        id: "gid://shopify/ProductImage/901",
        url: "https://images.unsplash.com/photo-1600121848594-d8644e57abab?w=800&auto=format&fit=crop&q=80",
        altText: "Custom Music Album Area Rug in Living Room",
        width: 1000,
        height: 1000,
      },
      {
        id: "gid://shopify/ProductImage/902",
        url: "https://images.unsplash.com/photo-1579656381226-5fc0f0100c3b?w=800&auto=format&fit=crop&q=80",
        altText: "Detail view of plush velvet texture",
        width: 1000,
        height: 1000,
      },
    ],
    variants: [
      {
        id: "gid://shopify/ProductVariant/701",
        title: "24\" x 36\"",
        price: "31.85",
        sku: "RUG-ALBUM-2436",
        inventoryQuantity: 45,
      },
      {
        id: "gid://shopify/ProductVariant/702",
        title: "36\" x 60\"",
        price: "64.85",
        sku: "RUG-ALBUM-3660",
        inventoryQuantity: 30,
      },
      {
        id: "gid://shopify/ProductVariant/703",
        title: "48\" x 72\"",
        price: "112.50",
        sku: "RUG-ALBUM-4872",
        inventoryQuantity: 18,
      },
    ],
  },
  {
    id: "gid://shopify/Product/8123456789002",
    title: "Personalized Family Name Flannel Blanket",
    handle: "personalized-family-name-flannel-blanket",
    status: "ACTIVE",
    vendor: "CHILLGEN",
    productType: "Blanket",
    tags: ["cozy", "gift", "custom-blanket", "family"],
    descriptionHtml:
      "<p>Wrap yourself and your loved ones in warmth with the ultra-soft <em>Personalized Family Blanket</em>.</p><p>Crafted from 100% premium anti-pilling flannel fleece.</p>",
    images: [
      {
        id: "gid://shopify/ProductImage/903",
        url: "https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=800&auto=format&fit=crop&q=80",
        altText: "Personalized Family Blanket draped on sofa",
        width: 1000,
        height: 1000,
      },
    ],
    variants: [
      {
        id: "gid://shopify/ProductVariant/704",
        title: "Throw 50\" x 60\"",
        price: "38.99",
        sku: "BLANKET-FAM-5060",
        inventoryQuantity: 60,
      },
      {
        id: "gid://shopify/ProductVariant/705",
        title: "Queen 60\" x 80\"",
        price: "54.99",
        sku: "BLANKET-FAM-6080",
        inventoryQuantity: 25,
      },
    ],
  },
  {
    id: "gid://shopify/Product/8123456789003",
    title: "Boho Medallion Floral Woven Runner",
    handle: "boho-medallion-floral-woven-runner",
    status: "ACTIVE",
    vendor: "CHILLGEN",
    productType: "Rug",
    tags: ["vintage", "boho", "runner", "living-room"],
    descriptionHtml:
      "<p>Intricate bohemian medallion motif printed with archival fade-resistant pigment on textured woven chenille.</p>",
    images: [
      {
        id: "gid://shopify/ProductImage/904",
        url: "https://images.unsplash.com/photo-1513519245088-0e12902e5a38?w=800&auto=format&fit=crop&q=80",
        altText: "Boho Medallion Floral Runner on hallway wood floor",
        width: 1000,
        height: 1000,
      },
    ],
    variants: [
      {
        id: "gid://shopify/ProductVariant/706",
        title: "2.5' x 7' Runner",
        price: "49.50",
        sku: "RUNNER-BOHO-257",
        inventoryQuantity: 20,
      },
      {
        id: "gid://shopify/ProductVariant/707",
        title: "2.5' x 10' Runner",
        price: "68.00",
        sku: "RUNNER-BOHO-2510",
        inventoryQuantity: 12,
      },
    ],
  },
  {
    id: "gid://shopify/Product/8123456789004",
    title: "Retro Vinyl Record Round Area Rug",
    handle: "retro-vinyl-record-round-area-rug",
    status: "DRAFT",
    vendor: "CHILLGEN",
    productType: "Rug",
    tags: ["retro", "vinyl", "round-rug", "music"],
    descriptionHtml:
      "<p>Circular music lover's statement rug designed as an authentic classic LP vinyl record with custom song label text.</p>",
    images: [
      {
        id: "gid://shopify/ProductImage/905",
        url: "https://images.unsplash.com/photo-1539185441755-769473a23570?w=800&auto=format&fit=crop&q=80",
        altText: "Retro Vinyl Record Round Area Rug in studio",
        width: 1000,
        height: 1000,
      },
    ],
    variants: [
      {
        id: "gid://shopify/ProductVariant/708",
        title: "Diameter 36\"",
        price: "42.00",
        sku: "RUG-VINYL-36",
        inventoryQuantity: 15,
      },
      {
        id: "gid://shopify/ProductVariant/709",
        title: "Diameter 60\"",
        price: "85.00",
        sku: "RUG-VINYL-60",
        inventoryQuantity: 8,
      },
    ],
  },
  {
    id: "gid://shopify/Product/8123456789005",
    title: "Minimalist Linen Table Runner Sample",
    handle: "minimalist-linen-table-runner-sample",
    status: "ARCHIVED",
    vendor: "CHILLGEN",
    productType: "Table Runner",
    tags: ["dining", "minimalist"],
    descriptionHtml: "",
    images: [],
    variants: [
      {
        id: "gid://shopify/ProductVariant/710",
        title: "Standard 14\" x 72\"",
        price: "19.99",
        sku: "TABLE-LINEN-1472",
        inventoryQuantity: 0,
      },
    ],
  },
];
