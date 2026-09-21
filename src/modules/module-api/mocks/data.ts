import type {
  ShopifyCollection,
  ShopifyConnectionTestData,
  ShopifyProduct,
} from "../types";

export const shopifyMockConnection: ShopifyConnectionTestData = {
  connected: true,
  shopDomain: "quickstart-demo.myshopify.com",
  shopName: "Quickstart Demo Store",
  currencyCode: "USD",
};

export const shopifyMockProducts: readonly ShopifyProduct[] = [
  {
    id: "gid://shopify/Product/1001",
    title: "Classic Cotton T-Shirt",
    handle: "classic-cotton-t-shirt",
    descriptionHtml: "<p>Comfortable everyday 100% cotton t-shirt.</p>",
    status: "ACTIVE",
    vendor: "Acme Apparel",
    productType: "Apparel",
    tags: ["t-shirt", "summer", "cotton"],
    variants: [
      {
        id: "gid://shopify/ProductVariant/2001",
        productId: "gid://shopify/Product/1001",
        title: "Small / Black",
        price: "24.99",
        sku: "TSHIRT-BLK-S",
        barcode: "123456789012",
        inventoryQuantity: 42,
      },
      {
        id: "gid://shopify/ProductVariant/2002",
        productId: "gid://shopify/Product/1001",
        title: "Medium / Black",
        price: "24.99",
        sku: "TSHIRT-BLK-M",
        barcode: "123456789013",
        inventoryQuantity: 28,
      },
    ],
    createdAt: "2025-01-10T08:00:00Z",
    updatedAt: "2025-01-15T12:30:00Z",
  },
  {
    id: "gid://shopify/Product/1002",
    title: "Ceramic Coffee Mug",
    handle: "ceramic-coffee-mug",
    descriptionHtml: "<p>Durable 12oz ceramic coffee mug.</p>",
    status: "ACTIVE",
    vendor: "Home Goods Co",
    productType: "Drinkware",
    tags: ["mug", "kitchen", "coffee"],
    variants: [
      {
        id: "gid://shopify/ProductVariant/2003",
        productId: "gid://shopify/Product/1002",
        title: "Default Title",
        price: "14.50",
        sku: "MUG-WHT-12OZ",
        barcode: "123456789014",
        inventoryQuantity: 100,
      },
    ],
    createdAt: "2025-01-12T09:15:00Z",
    updatedAt: "2025-01-14T16:45:00Z",
  },
  {
    id: "gid://shopify/Product/1003",
    title: "Vintage Denim Jacket",
    handle: "vintage-denim-jacket",
    descriptionHtml: "<p>Rugged vintage-washed denim jacket.</p>",
    status: "DRAFT",
    vendor: "Acme Apparel",
    productType: "Apparel",
    tags: ["jacket", "denim", "vintage"],
    variants: [
      {
        id: "gid://shopify/ProductVariant/2004",
        productId: "gid://shopify/Product/1003",
        title: "Large / Blue",
        price: "89.00",
        sku: "JKT-BLU-L",
        barcode: "123456789015",
        inventoryQuantity: 15,
      },
    ],
    createdAt: "2025-01-14T11:00:00Z",
    updatedAt: "2025-01-16T15:10:00Z",
  },
];

export const shopifyMockCollections: readonly ShopifyCollection[] = [
  {
    id: "gid://shopify/Collection/3001",
    title: "Summer Collection",
    handle: "summer-collection",
    description: "Curated summer essentials and warm-weather apparel.",
    productsCount: 12,
    updatedAt: "2025-01-15T10:00:00Z",
  },
  {
    id: "gid://shopify/Collection/3002",
    title: "Best Sellers",
    handle: "best-sellers",
    description: "Top performing and most popular products in store.",
    productsCount: 8,
    updatedAt: "2025-01-16T14:20:00Z",
  },
];

export const shopifyApiMockData = {
  connection: shopifyMockConnection,
  products: shopifyMockProducts,
  collections: shopifyMockCollections,
} as const;
