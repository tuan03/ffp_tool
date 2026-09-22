import type { SeoContentInput, SeoContentOutput } from "../types";

export const seoContentMockInput: SeoContentInput = {
  images: [
    {
      id: "img-mock-1",
      url: "https://example.com/assets/halloween-cat-rug-main.jpg",
      alt: "Vintage distressed black cat Halloween rug styled in living room",
      localFilePath: "/temp/assets/halloween-cat-rug-main.jpg",
    },
    {
      id: "img-mock-2",
      url: "https://example.com/assets/halloween-cat-rug-detail.jpg",
      alt: "Close-up detail of textured fabric and stitching on black cat rug",
      localFilePath: "/temp/assets/halloween-cat-rug-detail.jpg",
    },
  ],
  niche: "vintage distressed rug",
  title: "Black Cat Halloween Rug - Spooky Vintage Living Room Area Mat",
  description:
    "<p>Elevate your seasonal decor with this vintage distressed Halloween rug featuring an eerie black cat and autumn botanicals. Crafted with low-pile washable fabric, it brings cozy gothic charm to living rooms, entryways, or covered porches.</p>",
  handle: "vintage-black-cat-halloween-rug",
};

export const seoContentMockData: SeoContentOutput = {
  productTitle: "Vintage Black Cat Halloween Rug, Distressed Gothic Area Rug for Living Room",
  productDescription: [
    '<div class="product-description">',
    "  <p>Bring mysterious gothic warmth into your living space with this vintage distressed black cat Halloween rug. Designed with intricate autumn foliage and moody vintage tones, this statement piece blends seasonal festivity with year-round vintage appeal.</p>",
    "  <h3>Key Features</h3>",
    "  <ul>",
    "    <li>Durable low-pile polyester fabric resistant to shedding and daily foot traffic.</li>",
    "    <li>Non-slip TPR backing keeps the rug firmly in place on hardwood and tile floors.</li>",
    "    <li>Easy machine-washable maintenance for busy households with pets or kids.</li>",
    "  </ul>",
    "  <h3>Specifications & Care</h3>",
    "  <p>Machine wash cold on gentle cycle. Lay flat or hang dry. Do not bleach.</p>",
    "</div>",
  ].join("\n"),
  productSeoTitle: "Vintage Black Cat Halloween Rug | Gothic Distressed Living Room Mat",
  productSeoDescription:
    "Shop our vintage black cat Halloween rug featuring distressed gothic styling, low-pile washable fabric, and non-slip backing. Perfect cozy seasonal decor.",
  images: [
    {
      sourceUrl: "https://example.com/assets/halloween-cat-rug-main.jpg",
      alt: "Vintage distressed black cat Halloween rug styled in cozy living room setting",
      webp: {
        filename: "vintage-black-cat-halloween-rug-main.webp",
        localFilePath: "/temp/assets/vintage-black-cat-halloween-rug-main.webp",
        url: "/api/assets/vintage-black-cat-halloween-rug-main.webp",
      },
    },
    {
      sourceUrl: "https://example.com/assets/halloween-cat-rug-detail.jpg",
      alt: "Close-up texture and non-slip backing of vintage black cat Halloween area rug",
      webp: {
        filename: "vintage-black-cat-halloween-rug-detail.webp",
        localFilePath: "/temp/assets/vintage-black-cat-halloween-rug-detail.webp",
        url: "/api/assets/vintage-black-cat-halloween-rug-detail.webp",
      },
    },
  ],
  productHandle: "vintage-black-cat-halloween-rug",
};
