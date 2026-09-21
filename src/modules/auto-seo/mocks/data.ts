import type { AutoSeoProductCandidate } from "../types";

export const autoSeoMockProducts: readonly AutoSeoProductCandidate[] = [
  {
    productId: "gid://shopify/Product/100001",
    handle: "mock-ceramic-mug",
    title: "Mock Ceramic Coffee Mug",
    descriptionHtml:
      "<p>Premium 11oz ceramic mug with <strong>glossy</strong> finish.</p>\n<div>Microwave and dishwasher safe.</div>",
    seoTitle: "Shopify Ceramic Mug | Best Drinkware",
    seoDescription: "High quality ceramic mug with durable print.",
    images: [
      {
        url: "https://cdn.example.com/mock-mug-front.jpg",
        altText: "White ceramic mug front view",
        position: 1,
      },
      {
        url: "https://cdn.example.com/mock-mug-angle.jpg",
        altText: "White ceramic mug perspective view",
        position: 2,
      },
    ],
  },
  {
    productId: "gid://shopify/Product/100002",
    handle: "mock-digital-planner",
    title: "Mock Digital Daily Planner",
    descriptionHtml:
      "<div>Instant download printable &amp; tablet PDF planner.</div>",
    seoTitle: null,
    seoDescription: null,
    images: [],
  },
  {
    productId: "gid://shopify/Product/100003",
    handle: "mock-draft-hoodie",
    title: "Mock Heavy Blend Fleece Hoodie (Draft)",
    descriptionHtml:
      "<span>Cozy 50/50 cotton-poly fleece with matching drawstrings.</span>",
    images: [
      {
        url: "https://cdn.example.com/mock-hoodie.jpg",
        altText: "Black fleece hoodie mockup",
        position: 1,
      },
    ],
  },
];
