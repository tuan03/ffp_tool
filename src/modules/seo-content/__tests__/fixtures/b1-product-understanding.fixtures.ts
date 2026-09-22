import type { SeoContentInput } from "../../types";
import type { ProductImageAnalysis } from "../../internal/product-understanding/product-image-analyzer";

export const catShirtFixture: {
  readonly input: SeoContentInput;
  readonly mockAnalysis: ProductImageAnalysis;
} = {
  input: {
    title: "Cats Before People T-Shirt - Funny Cat Lover Graphic Tee",
    niche: "cat lover",
    description: "Super soft cotton tee featuring a cute black cat and paw prints graphic. Design says Cats Before People.",
    handle: "cats-before-people-t-shirt",
    images: [
      {
        url: "https://cdn.shopify.com/products/cat-tshirt-front.jpg",
        alt: "Black cat and paw prints graphic t-shirt with text 'Cats Before People'",
      },
      {
        url: "https://cdn.shopify.com/products/cat-tshirt-detail.jpg",
        alt: "Close-up detail of black cat typography on white cotton tee",
      },
    ],
  },
  mockAnalysis: {
    ocrTexts: ["Cats Before People"],
    detectedEntities: ["black cat", "paw prints"],
    dominantColors: ["black", "white"],
    visualStyle: "minimalist typography",
    productCategory: "t-shirt",
  },
};

export const motorcycleMugFixture: {
  readonly input: SeoContentInput;
  readonly mockAnalysis: ProductImageAnalysis;
} = {
  input: {
    title: "Vintage Motorcycle Ceramic Mug - Ride Free",
    niche: "vintage motorcycle",
    description: "Retro cream coffee mug featuring a classic motorcycle and retro sun. High quality ceramic mug.",
    handle: "vintage-motorcycle-ceramic-mug",
    images: [
      {
        url: "https://cdn.shopify.com/products/motorcycle-mug-main.jpg",
        alt: "Vintage motorcycle and retro sun on cream ceramic mug with quote 'Ride Free'",
      },
    ],
  },
  mockAnalysis: {
    ocrTexts: ["Ride Free"],
    detectedEntities: ["motorcycle", "retro sun"],
    dominantColors: ["cream", "orange", "black"],
    visualStyle: "vintage retro",
    productCategory: "ceramic mug",
  },
};

export const sportsHoodieFixture: {
  readonly input: SeoContentInput;
  readonly mockAnalysis: ProductImageAnalysis;
} = {
  input: {
    title: "Varsity Sports Pullover Hoodie - EST. 1987",
    niche: "basketball",
    description: "Comfortable navy blue sweatshirt with basketball and varsity emblem. Warm fleece pullover hoodie.",
    handle: "varsity-sports-pullover-hoodie",
    images: [
      {
        url: "https://cdn.shopify.com/products/sports-hoodie-front.jpg",
        alt: "Navy blue pullover hoodie with basketball and varsity emblem with lettering 'EST. 1987'",
      },
    ],
  },
  mockAnalysis: {
    ocrTexts: ["EST. 1987"],
    detectedEntities: ["basketball", "varsity emblem"],
    dominantColors: ["navy", "white"],
    visualStyle: "sporty varsity",
    productCategory: "hoodie",
  },
};
