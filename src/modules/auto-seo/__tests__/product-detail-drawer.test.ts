import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ProductDetailDrawer,
  type ProductDetailDrawerProps,
} from "../ui/components/ProductDetailDrawer";

import type { ShopifyProductForAutoSeoUi } from "../types";

const mockProductWithSeo: ShopifyProductForAutoSeoUi = {
  id: "gid://shopify/Product/101",
  title: "Premium Vintage Denim Jacket",
  handle: "premium-vintage-denim-jacket",
  status: "ACTIVE",
  vendor: "Denim Co",
  productType: "Apparel",
  tags: ["vintage", "denim"],
  seo: {
    title: "Vintage Denim Jacket - Authentic 90s Style",
    description: "Discover our authentic vintage denim jacket crafted from 100% heavy cotton.",
  },
  images: [
    {
      id: "gid://shopify/ProductImage/1",
      url: "https://cdn.shopify.com/products/jacket-front.jpg",
      altText: "Front view of vintage denim jacket",
      width: 2000,
      height: 2000,
    },
    {
      id: "gid://shopify/ProductImage/2",
      url: "https://cdn.shopify.com/products/jacket-back.jpg",
      altText: "Back view with embroidered collar detail",
      width: 1800,
      height: 1800,
    },
  ],
  variants: [
    {
      id: "gid://shopify/ProductVariant/1",
      title: "M / Blue",
      price: "120.00",
      sku: "JCK-BLU-M",
      inventoryQuantity: 15,
    },
  ],
};

interface RenderDrawerResult {
  captured: React.ReactElement | null;
  html: string;
}

function renderDrawer(
  props: Partial<ProductDetailDrawerProps> & { product: ShopifyProductForAutoSeoUi | null },
): RenderDrawerResult {
  let captured: React.ReactElement | null = null;

  function TestHarness(): React.JSX.Element | null {
    captured = ProductDetailDrawer({
      product: props.product,
      isOpen: props.isOpen ?? true,
      decision: props.decision ?? "pending",
      onClose: props.onClose ?? (() => {}),
      onApprove: props.onApprove ?? (() => {}),
      onMarkNeedsEdit: props.onMarkNeedsEdit ?? (() => {}),
      onMarkDraft: props.onMarkDraft ?? (() => {}),
      onSkip: props.onSkip ?? (() => {}),
      selectedImageIndex: props.selectedImageIndex,
      onSelectImageIndex: props.onSelectImageIndex,
    });
    return captured;
  }

  const html = renderToStaticMarkup(React.createElement(TestHarness));
  return { captured, html };
}

function findThumbnailButtons(
  node: unknown,
): React.ReactElement<{ onClick?(): void; title?: string }>[] {
  const results: React.ReactElement<{ onClick?(): void; title?: string }>[] = [];
  function walk(current: unknown): void {
    if (!React.isValidElement(current)) {
      return;
    }
    const props = current.props as Record<string, unknown>;
    if (
      current.type === "button" &&
      typeof props.title === "string" &&
      props.title.startsWith("Ảnh ")
    ) {
      results.push(current as React.ReactElement<{ onClick?(): void; title?: string }>);
    }
    if (props && props.children) {
      React.Children.forEach(props.children as React.ReactNode, walk);
    }
  }
  walk(node);
  return results;
}

// 1. renders SEO Title
test("ProductDetailDrawer: renders SEO Title", () => {
  const { html } = renderDrawer({ product: mockProductWithSeo });

  assert.ok(html.includes("SEO Title:"), "Must display 'SEO Title:' label");
  assert.ok(
    html.includes("Vintage Denim Jacket - Authentic 90s Style"),
    "Must display actual SEO Title value",
  );
});

// 2. renders SEO Description
test("ProductDetailDrawer: renders SEO Description", () => {
  const { html } = renderDrawer({ product: mockProductWithSeo });

  assert.ok(html.includes("SEO Description:"), "Must display 'SEO Description:' label");
  assert.ok(
    html.includes(
      "Discover our authentic vintage denim jacket crafted from 100% heavy cotton.",
    ),
    "Must display actual SEO Description value",
  );
});

// 3. renders fallback when SEO Title missing
test("ProductDetailDrawer: renders fallback when SEO Title missing", () => {
  // Case A: null
  const { html: htmlNull } = renderDrawer({
    product: { ...mockProductWithSeo, seo: { title: null, description: "Valid Description" } },
  });
  assert.ok(
    htmlNull.includes("Chưa có SEO Title"),
    "Must display fallback 'Chưa có SEO Title' when title is null",
  );

  // Case B: empty string
  const { html: htmlEmpty } = renderDrawer({
    product: { ...mockProductWithSeo, seo: { title: "", description: "Valid Description" } },
  });
  assert.ok(
    htmlEmpty.includes("Chưa có SEO Title"),
    "Must display fallback 'Chưa có SEO Title' when title is empty string",
  );

  // Case C: undefined seo object
  const { html: htmlUndefinedSeo } = renderDrawer({
    product: { ...mockProductWithSeo, seo: undefined },
  });
  assert.ok(
    htmlUndefinedSeo.includes("Chưa có SEO Title"),
    "Must display fallback 'Chưa có SEO Title' when seo object is undefined",
  );
});

// 4. renders fallback when SEO Description missing
test("ProductDetailDrawer: renders fallback when SEO Description missing", () => {
  // Case A: null
  const { html: htmlNull } = renderDrawer({
    product: { ...mockProductWithSeo, seo: { title: "Valid Title", description: null } },
  });
  assert.ok(
    htmlNull.includes("Chưa có SEO Description"),
    "Must display fallback 'Chưa có SEO Description' when description is null",
  );

  // Case B: empty string
  const { html: htmlEmpty } = renderDrawer({
    product: { ...mockProductWithSeo, seo: { title: "Valid Title", description: "" } },
  });
  assert.ok(
    htmlEmpty.includes("Chưa có SEO Description"),
    "Must display fallback 'Chưa có SEO Description' when description is empty string",
  );

  // Case C: undefined seo object
  const { html: htmlUndefinedSeo } = renderDrawer({
    product: { ...mockProductWithSeo, seo: undefined },
  });
  assert.ok(
    htmlUndefinedSeo.includes("Chưa có SEO Description"),
    "Must display fallback 'Chưa có SEO Description' when seo object is undefined",
  );
});

// 5. renders image altText as visible text
test("ProductDetailDrawer: renders image altText as visible text", () => {
  const { html } = renderDrawer({ product: mockProductWithSeo });

  assert.ok(html.includes("Alt Text:"), "Must display 'Alt Text:' label");
  assert.ok(
    html.includes("Front view of vintage denim jacket"),
    "Must display active image Alt Text as visible text",
  );
  assert.ok(html.includes("Ảnh 1 / 2"), "Must display image index position counter");
});

// 6. renders "Chưa có Alt Text" when altText missing
test("ProductDetailDrawer: renders 'Chưa có Alt Text' when altText missing", () => {
  // Case A: null altText
  const { html: htmlNull } = renderDrawer({
    product: {
      ...mockProductWithSeo,
      images: [{ url: "https://example.com/no-alt.jpg", altText: null }],
    },
  });
  assert.ok(
    htmlNull.includes("Chưa có Alt Text"),
    "Must display fallback 'Chưa có Alt Text' when altText is null",
  );

  // Case B: empty altText
  const { html: htmlEmpty } = renderDrawer({
    product: {
      ...mockProductWithSeo,
      images: [{ url: "https://example.com/empty-alt.jpg", altText: "   " }],
    },
  });
  assert.ok(
    htmlEmpty.includes("Chưa có Alt Text"),
    "Must display fallback 'Chưa có Alt Text' when altText is whitespace",
  );

  // Case C: undefined altText
  const { html: htmlUndefined } = renderDrawer({
    product: {
      ...mockProductWithSeo,
      images: [{ url: "https://example.com/undefined-alt.jpg" }],
    },
  });
  assert.ok(
    htmlUndefined.includes("Chưa có Alt Text"),
    "Must display fallback 'Chưa có Alt Text' when altText is undefined",
  );
});

// 7. renders image width/height when available
test("ProductDetailDrawer: renders image width/height when available", () => {
  // Available dimensions
  const { html: htmlWithDimensions } = renderDrawer({ product: mockProductWithSeo });
  assert.ok(
    htmlWithDimensions.includes("Kích thước: 2000 × 2000"),
    "Must display width × height when available",
  );

  // Missing dimensions
  const { html: htmlNoDimensions } = renderDrawer({
    product: {
      ...mockProductWithSeo,
      images: [{ url: "https://example.com/no-dim.jpg", altText: "Some image" }],
    },
  });
  assert.equal(
    htmlNoDimensions.includes("Kích thước:"),
    false,
    "Must not display dimension label when width/height are unavailable",
  );
});

// 8. image thumbnail selection updates displayed Alt Text
test("ProductDetailDrawer: image thumbnail selection updates displayed Alt Text", () => {
  const selectedIndices: number[] = [];

  const { captured, html: initialHtml } = renderDrawer({
    product: mockProductWithSeo,
    onSelectImageIndex: (idx) => selectedIndices.push(idx),
  });

  // Initially displays image 1
  assert.ok(
    initialHtml.includes("Front view of vintage denim jacket"),
    "Initial active image must display image 1 Alt Text",
  );
  assert.ok(initialHtml.includes("Ảnh 1 / 2"), "Initial position counter is Ảnh 1 / 2");

  // Verify thumbnails have titles/tooltips
  const thumbnails = findThumbnailButtons(captured);
  assert.equal(thumbnails.length, 2, "Must render 2 thumbnail buttons for 2 images");
  assert.equal(
    thumbnails[0].props.title,
    "Ảnh 1: Front view of vintage denim jacket",
    "Thumbnail 1 must have tooltip with its altText",
  );
  assert.equal(
    thumbnails[1].props.title,
    "Ảnh 2: Back view with embroidered collar detail",
    "Thumbnail 2 must have tooltip with its altText",
  );

  // Click second thumbnail
  thumbnails[1].props.onClick?.();
  assert.deepEqual(
    selectedIndices,
    [1],
    "Clicking thumbnail 2 must trigger onSelectImageIndex with index 1",
  );

  // Rendering with selectedImageIndex: 1 updates displayed Alt Text and position
  const { html: updatedHtml } = renderDrawer({
    product: mockProductWithSeo,
    selectedImageIndex: 1,
  });
  assert.ok(
    updatedHtml.includes("Back view with embroidered collar detail"),
    "Selected image 2 must display image 2 Alt Text",
  );
  assert.ok(updatedHtml.includes("Ảnh 2 / 2"), "Updated position counter is Ảnh 2 / 2");
});

// 9. switching product resets selected image safely
test("ProductDetailDrawer: switching product resets selected image safely", () => {
  const productA: ShopifyProductForAutoSeoUi = {
    ...mockProductWithSeo,
    id: "gid://shopify/Product/A",
    title: "Product A",
    images: [
      { url: "https://example.com/a1.jpg", altText: "Product A Image 1" },
      { url: "https://example.com/a2.jpg", altText: "Product A Image 2" },
      { url: "https://example.com/a3.jpg", altText: "Product A Image 3" },
    ],
  };

  const productB: ShopifyProductForAutoSeoUi = {
    ...mockProductWithSeo,
    id: "gid://shopify/Product/B",
    title: "Product B",
    images: [
      { url: "https://example.com/b1.jpg", altText: "Product B Only Image" },
    ],
  };

  // 1. Safe clamping: If previous index was 2 (out of bounds for Product B with 1 image)
  const { html: htmlBWithStaleIndex } = renderDrawer({
    product: productB,
    selectedImageIndex: 2,
  });
  assert.ok(
    htmlBWithStaleIndex.includes("Ảnh 1 / 1"),
    "Must safely clamp image index to valid bounds (Ảnh 1 / 1)",
  );
  assert.ok(
    htmlBWithStaleIndex.includes("Product B Only Image"),
    "Must safely display Product B's only image without error",
  );

  // 2. Safe reset when switching product:
  // Render Product A with image index 0
  const { html: htmlA } = renderDrawer({ product: productA });
  assert.ok(htmlA.includes("Product A Image 1"));
  assert.ok(htmlA.includes("Ảnh 1 / 3"));

  // Switch to Product B
  const { html: htmlB } = renderDrawer({ product: productB });
  assert.ok(htmlB.includes("Product B Only Image"));
  assert.ok(htmlB.includes("Ảnh 1 / 1"));

  // 3. Dynamic product switch within same component lifecycle
  function DynamicSwitchHarness(): React.JSX.Element | null {
    const [currentProduct, setCurrentProduct] = React.useState<ShopifyProductForAutoSeoUi>(productA);
    const [didSwitch, setDidSwitch] = React.useState(false);

    if (!didSwitch) {
      setDidSwitch(true);
      setCurrentProduct(productB);
    }

    return ProductDetailDrawer({
      product: currentProduct,
      isOpen: true,
      onClose: () => {},
      onApprove: () => {},
      onMarkNeedsEdit: () => {},
      onMarkDraft: () => {},
      onSkip: () => {},
    });
  }

  const htmlDynamicSwitch = renderToStaticMarkup(React.createElement(DynamicSwitchHarness));
  assert.ok(
    htmlDynamicSwitch.includes("Product B Only Image"),
    "Dynamic product switch must render newly switched product",
  );
  assert.ok(
    htmlDynamicSwitch.includes("Ảnh 1 / 1"),
    "Dynamic product switch must reset image index to 0 (Ảnh 1 / 1)",
  );

  // 4. Drawer reopen resets state
  function DrawerReopenHarness(): React.JSX.Element | null {
    const [isOpen, setIsOpen] = React.useState(false);
    const [didOpen, setDidOpen] = React.useState(false);

    if (!didOpen) {
      setDidOpen(true);
      setIsOpen(true);
    }

    return ProductDetailDrawer({
      product: productA,
      isOpen,
      onClose: () => {},
      onApprove: () => {},
      onMarkNeedsEdit: () => {},
      onMarkDraft: () => {},
      onSkip: () => {},
    });
  }

  const htmlReopened = renderToStaticMarkup(React.createElement(DrawerReopenHarness));
  assert.ok(
    htmlReopened.includes("Product A Image 1"),
    "Reopened drawer must render image 1",
  );
  assert.ok(
    htmlReopened.includes("Ảnh 1 / 3"),
    "Reopened drawer must reset image index to 0 (Ảnh 1 / 3)",
  );

  // 5. Safe empty images handling
  const productNoImages: ShopifyProductForAutoSeoUi = {
    ...mockProductWithSeo,
    id: "gid://shopify/Product/Empty",
    images: [],
  };
  const { html: htmlEmpty } = renderDrawer({ product: productNoImages });
  assert.ok(
    htmlEmpty.includes("Không có hình ảnh nào được lưu trữ cho sản phẩm này."),
    "Must render empty image placeholder safely",
  );
});

// Additional edge cases: drawer closed or product null
test("ProductDetailDrawer: returns null when isOpen is false or product is null", () => {
  const { html: htmlClosed } = renderDrawer({
    product: mockProductWithSeo,
    isOpen: false,
  });
  assert.equal(htmlClosed, "", "Must return null/empty when isOpen is false");

  const { html: htmlNoProduct } = renderDrawer({
    product: null,
    isOpen: true,
  });
  assert.equal(htmlNoProduct, "", "Must return null/empty when product is null");
});

test("ProductDetailDrawer: does NOT render decision badges or decision action buttons", () => {
  const { html } = renderDrawer({
    product: mockProductWithSeo,
    isOpen: true,
  });

  assert.equal(html.includes("✓ Duyệt"), false, "Drawer must NOT render Duyệt button");
  assert.equal(html.includes("✎ Cần sửa"), false, "Drawer must NOT render Cần sửa button");
  assert.equal(html.includes("Draft"), false, "Drawer must NOT render Draft button");
  assert.equal(html.includes("✕ Bỏ"), false, "Drawer must NOT render Bỏ button");
  assert.equal(html.includes("Chờ duyệt"), false, "Drawer must NOT render Chờ duyệt badge");
  assert.equal(html.includes("Đã duyệt"), false, "Drawer must NOT render Đã duyệt badge");
  assert.ok(html.includes("Đóng"), "Drawer must render Close button");
});
