import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createCustomizationManagerRoutes,
  CustomizationManagerPage,
} from "../index";
import {
  extractProductAsin,
  filterCatalogProducts,
  buildShopifyAdminUrl,
} from "../ui/components/ProductCatalogTable";
import type { ShopifyProduct, ShopifyCollection } from "../../module-api";

describe("Customization Manager: UI & Routes", () => {
  it("createCustomizationManagerRoutes defines /customization path", () => {
    const routes = createCustomizationManagerRoutes();
    assert.equal(routes.length, 1);
    assert.equal(routes[0].path, "customization");
    assert.ok(routes[0].element);
  });

  it("CustomizationManagerPage component is properly exported", () => {
    assert.equal(typeof CustomizationManagerPage, "function");
  });

  describe("Product Catalog Filtering & Scoped Navigation", () => {
    const sampleProducts = [
      {
        id: "gid://shopify/Product/1",
        title: "Funny Personalized Couple Doormat",
        handle: "personalized-family-couple-doormat-custom-couple-husband-design-05",
        tags: ["Doormats", "ASIN:B0GQGGXN47", "Family Name Rugs"],
        productType: "Rugs",
        variants: [{ id: "v1", sku: "IZ-B0GQGGXN47-01", price: "29.99" }],
      },
      {
        id: "gid://shopify/Product/2",
        title: "Home Sweet Home Couple Doormat",
        handle: "personalized-family-couple-doormat-custom-couple-husband-design-03",
        tags: ["Doormats", "Family Name Rugs"],
        productType: "Rugs",
        variants: [{ id: "v2", sku: "IZ-0WPM-WSOI", price: "29.99" }],
      },
      {
        id: "gid://shopify/Product/3",
        title: "Vintage Coffee Mug",
        handle: "vintage-coffee-mug",
        tags: ["Mugs"],
        productType: "Drinkware",
        variants: [{ id: "v3", sku: "MUG-001", price: "15.00" }],
      },
    ] as unknown as readonly ShopifyProduct[];

    const sampleCollections = [
      {
        id: "col-1",
        title: "Family Name Rugs",
        handle: "family-name-rugs",
        productsCount: 2,
      },
      {
        id: "col-2",
        title: "Coffee Mugs",
        handle: "coffee-mugs",
        productsCount: 1,
      },
    ] as unknown as readonly ShopifyCollection[];

    it("extractProductAsin extracts ASIN from tags, sku, handle, and title", () => {
      assert.equal(extractProductAsin(sampleProducts[0]), "B0GQGGXN47");
      assert.equal(extractProductAsin(sampleProducts[1]), null);

      const productWithHandleAsin = {
        id: "4",
        title: "Item",
        handle: "product-b0gqggxn47-test",
      } as unknown as ShopifyProduct;
      assert.equal(extractProductAsin(productWithHandleAsin), "B0GQGGXN47");
    });

    it("filterCatalogProducts filters products by collection", () => {
      const filtered = filterCatalogProducts(
        sampleProducts,
        sampleCollections,
        "collection",
        "col-1",
        "",
      );
      assert.equal(filtered.length, 2);
      assert.equal(filtered[0].id, "gid://shopify/Product/1");
      assert.equal(filtered[1].id, "gid://shopify/Product/2");
    });

    it("filterCatalogProducts filters products by ASIN search", () => {
      const filtered = filterCatalogProducts(
        sampleProducts,
        sampleCollections,
        "asin",
        "",
        "B0GQGGXN47",
      );
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].id, "gid://shopify/Product/1");
    });

    it("filterCatalogProducts filters products by text query", () => {
      const filtered = filterCatalogProducts(
        sampleProducts,
        sampleCollections,
        "all",
        "",
        "Sweet Home",
      );
      assert.equal(filtered.length, 1);
      assert.equal(filtered[0].id, "gid://shopify/Product/2");
    });

    it("scopes navigation index strictly within the filtered subset", () => {
      const filtered = filterCatalogProducts(
        sampleProducts,
        sampleCollections,
        "collection",
        "col-1",
        "",
      );
      // Both products belong to col-1 (size = 2)
      assert.equal(filtered.length, 2);

      const activeProduct = filtered[0];
      const indexInFiltered = filtered.findIndex((p) => p.id === activeProduct.id);
      assert.equal(indexInFiltered, 0);

      // Next product in filtered list
      const nextProduct = filtered[indexInFiltered + 1];
      assert.equal(nextProduct.id, "gid://shopify/Product/2");

      // Verify the count displayed is 1/2, not 1/3 (total catalog size)
      const counterLabel = `${indexInFiltered + 1}/${filtered.length}`;
      assert.equal(counterLabel, "1/2");
    });

    it("buildShopifyAdminUrl generates correct admin link for products", () => {
      assert.equal(
        buildShopifyAdminUrl("capozen", "gid://shopify/Product/12345678"),
        "https://admin.shopify.com/store/capozen/products/12345678",
      );
      assert.equal(
        buildShopifyAdminUrl("chillgen.myshopify.com", "888"),
        "https://admin.shopify.com/store/chillgen/products/888",
      );
      assert.equal(
        buildShopifyAdminUrl("https://jeminise.myshopify.com/", "gid://shopify/Product/999"),
        "https://admin.shopify.com/store/jeminise/products/999",
      );
      assert.equal(buildShopifyAdminUrl("capozen", ""), undefined);
      assert.equal(buildShopifyAdminUrl("capozen", undefined), undefined);
      assert.equal(buildShopifyAdminUrl("", "12345"), undefined);
    });
  });
});


