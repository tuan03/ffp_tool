# AUTO SEO UI IMPLEMENTATION CONTRACT

> **Dành cho:** Người phụ trách UI / MAIN  
> **Module liên quan:** `src/modules/auto-seo`  
> **Mục tiêu:** Xây dựng UI để load sản phẩm Shopify, cho phép chọn 1 hoặc nhiều sản phẩm, xem chi tiết sản phẩm dạng PDP, đánh dấu trạng thái xử lý, rồi tạo payload đầu vào cho module SEO Content.

---

## 1. Mục tiêu UI

UI Auto SEO không tạo SEO content trực tiếp. UI chỉ làm nhiệm vụ:

```text
Shopify products.list
→ hiển thị danh sách sản phẩm
→ user chọn / duyệt / draft / bỏ
→ map Shopify product sang AutoSeoProductCandidate
→ gọi runAutoSeo
→ nhận seoContentInputs
→ preview / gửi sang SEO Content sau này
```

Kết quả cuối của màn này là `AutoSeoOutput`, trong đó quan trọng nhất là `seoContentInputs`.

---

## 2. Những gì UI được làm

UI được làm:

```text
- Load danh sách sản phẩm từ Shopify API hiện có.
- Hiển thị bảng sản phẩm.
- Hiển thị thumbnail chính, title, STT, product ID, handle, status.
- Cho phép chọn 1 hoặc nhiều sản phẩm bằng checkbox.
- Cho phép click vào sản phẩm để mở detail drawer dạng PDP.
- Có nút Duyệt, Sửa, Draft, Bỏ trên từng hàng sản phẩm.
- Gọi runAutoSeo để tạo payload cho SEO Content.
- Hiển thị selectedCount, warnings, seoContentInputs.
- Copy / download JSON output.
```

UI không được làm ở phase này:

```text
- Không update Shopify.
- Không gọi productUpdate.
- Không gọi SEO Content thật nếu module SEO Content chưa nối.
- Không tạo SEO title, SEO description, image alt, WebP.
- Không sync sản phẩm.
- Không render descriptionHtml bằng dangerouslySetInnerHTML.
```

---

## 3. Mapping function

Tạo hoặc dùng function sau để map Shopify product sang `AutoSeoProductCandidate`.

Khuyến nghị đặt tại:

```text
src/modules/auto-seo/shopify-adapter.ts
```

và export qua:

```text
src/modules/auto-seo/index.ts
```

Code đề xuất:

```ts
import type { AutoSeoProductCandidate } from "./types";

export function mapShopifyProductToAutoSeoCandidate(product: {
  id: string;
  handle: string;
  title: string;
  descriptionHtml?: string;
  images?: readonly {
    url: string;
    altText?: string;
  }[];
}): AutoSeoProductCandidate {
  return {
    productId: product.id,
    handle: product.handle,
    title: product.title,
    descriptionHtml: product.descriptionHtml ?? "",
    images: (product.images ?? []).map((image, index) => ({
      url: image.url,
      altText: image.altText,
      position: index + 1,
    })),
  };
}
```

UI chỉ được import qua public API:

```ts
import {
  runAutoSeo,
  mapShopifyProductToAutoSeoCandidate,
} from "../../modules/auto-seo";
```

Không import trực tiếp:

```ts
import { runAutoSeo } from "../../modules/auto-seo/service";
```

---

## 4. Data type UI nên dùng

```ts
interface ShopifyProductForAutoSeoUi {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly descriptionHtml?: string;
  readonly status?: string;
  readonly vendor?: string;
  readonly productType?: string;
  readonly tags?: readonly string[];
  readonly images?: readonly {
    readonly id?: string;
    readonly url: string;
    readonly altText?: string;
    readonly width?: number;
    readonly height?: number;
  }[];
  readonly variants?: readonly {
    readonly id: string;
    readonly title: string;
    readonly price?: string;
    readonly sku?: string;
    readonly inventoryQuantity?: number;
  }[];
}
```

---

## 5. UI layout đề xuất

### 5.1 Header / controls

```text
Auto SEO Product Selection

Niche:
[ custom rug ]

[Load Products] [Select All] [Clear] [Run Auto SEO]
```

Niche là batch-level input. Khi gọi `runAutoSeo`, niche lấy từ ô này.

---

### 5.2 Product table

Bảng sản phẩm gồm các cột:

```text
[checkbox] STT | Thumbnail | Title | Product ID | Handle | Status | Actions
```

Ví dụ:

```text
☑  1  [img]  Custom Music Album Area Rug     gid://shopify/Product/...   personalized-music...   ACTIVE   [Duyệt] [Sửa] [Draft] [Bỏ]
☐  2  [img]  Custom Family Rug               gid://shopify/Product/...   custom-family-rug...    ACTIVE   [Duyệt] [Sửa] [Draft] [Bỏ]
```

Thumbnail lấy từ ảnh đầu tiên:

```ts
const thumbnailUrl = product.images?.[0]?.url;
```

Nếu không có ảnh, hiển thị placeholder:

```text
No image
```

---

## 6. Logic chọn 1 hoặc nhiều sản phẩm

UI cần có state:

```ts
const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
```

Checkbox từng hàng:

```text
Tick   → thêm product.id vào selectedProductIds
Untick → xóa product.id khỏi selectedProductIds
```

Select all:

```ts
setSelectedProductIds(products.map((product) => product.id));
```

Clear:

```ts
setSelectedProductIds([]);
```

---

## 7. Click sản phẩm mở detail drawer dạng PDP

Không nên dùng click row để chọn sản phẩm. Click row nên mở drawer/modal xem chi tiết sản phẩm.

Detail drawer cần hiển thị:

```text
- Main image / gallery
- Title
- Product ID
- Handle
- Status
- Vendor
- Product type
- Tags
- Variants
- Description HTML
- Raw JSON nếu cần debug
```

Wireframe:

```text
┌─────────────────────────────────────────────┐
│ Product Detail                              │
├─────────────────────────────────────────────┤
│ [Main Image]                                │
│ Custom Music Album Area Rug                 │
│ ID: gid://shopify/Product/...               │
│ Handle: personalized-music...               │
│ Status: ACTIVE                              │
│ Vendor: CHILLGEN                            │
│ Product type: Rug                           │
│ Tags: home-decor, rug                       │
│                                             │
│ Variants                                    │
│ - 24"x36" | $31.85 | SKU ...               │
│ - 36"x60" | $64.85 | SKU ...               │
│                                             │
│ Description HTML                            │
│ <textarea readonly>...</textarea>           │
└─────────────────────────────────────────────┘
```

Không render HTML trực tiếp bằng `dangerouslySetInnerHTML`.

Hiển thị `descriptionHtml` bằng:

```tsx
<textarea readOnly value={product.descriptionHtml ?? ""} />
```

hoặc:

```tsx
<pre>{product.descriptionHtml}</pre>
```

---

## 8. Các nút trên từng hàng sản phẩm

Các button hiện tại chỉ là trạng thái UI local, chưa update Shopify thật.

Tạo type:

```ts
type ProductReviewDecision =
  | "pending"
  | "approved"
  | "needs_edit"
  | "mark_draft"
  | "skipped";
```

State:

```ts
const [decisions, setDecisions] = useState<Record<string, ProductReviewDecision>>({});
```

---

### 8.1 Button Duyệt

Ý nghĩa: sản phẩm này được chọn để đưa vào batch Auto SEO.

```ts
function handleApprove(productId: string): void {
  setDecisions((current) => ({
    ...current,
    [productId]: "approved",
  }));

  setSelectedProductIds((current) =>
    current.includes(productId) ? current : [...current, productId],
  );
}
```

---

### 8.2 Button Sửa

Ý nghĩa: mở PDP detail / edit panel để user xem và chỉnh trước.

```ts
function handleEdit(product: ShopifyProductForAutoSeoUi): void {
  setActiveProduct(product);
  setIsDetailOpen(true);
  setDecisions((current) => ({
    ...current,
    [product.id]: "needs_edit",
  }));
}
```

Ở phase này, `Sửa` có thể chỉ sửa local draft, chưa update Shopify.

---

### 8.3 Button Draft

Ý nghĩa: đánh dấu sản phẩm muốn chuyển draft sau này.

```ts
function handleMarkDraft(productId: string): void {
  setDecisions((current) => ({
    ...current,
    [productId]: "mark_draft",
  }));

  setSelectedProductIds((current) =>
    current.filter((id) => id !== productId),
  );
}
```

Không gọi Shopify update status ở phase này.

---

### 8.4 Button Bỏ

Ý nghĩa: bỏ sản phẩm khỏi batch Auto SEO.

```ts
function handleSkip(productId: string): void {
  setDecisions((current) => ({
    ...current,
    [productId]: "skipped",
  }));

  setSelectedProductIds((current) =>
    current.filter((id) => id !== productId),
  );
}
```

---

## 9. Khi bấm Run Auto SEO

Lấy sản phẩm đã được duyệt/chọn:

```ts
const approvedProductIds = selectedProductIds;
```

Map Shopify product sang Auto SEO candidate:

```ts
const autoSeoProducts = products.map(mapShopifyProductToAutoSeoCandidate);
```

Gọi `runAutoSeo`:

```ts
const output = await runAutoSeo({
  workflowId: `auto_seo_${Date.now()}`,
  niche,
  products: autoSeoProducts,
  selectedProductIds: approvedProductIds,
});
```

Kết quả trả về:

```json
{
  "workflowId": "auto_seo_1726900000000",
  "selectedCount": 2,
  "seoContentInputs": [
    {
      "productId": "gid://shopify/Product/...",
      "handle": "custom-rug",
      "niche": "custom rug",
      "sourceTitle": "Custom Rug",
      "sourceDescriptionHtml": "<p>...</p>",
      "images": [
        {
          "url": "https://cdn.shopify.com/...jpg",
          "altText": "Custom Rug",
          "position": 1
        }
      ]
    }
  ],
  "warnings": []
}
```

---

## 10. Hiển thị Auto SEO output

Sau khi chạy Auto SEO, UI hiển thị section:

```text
Prepared SEO Content Inputs
```

Hiển thị:

```text
- workflowId
- selectedCount
- warnings
- bảng seoContentInputs
- nút Copy JSON
- nút Download JSON
- nút Send to SEO Content
```

Nếu SEO Content chưa nối, nút `Send to SEO Content` để disabled:

```text
Send to SEO Content — disabled
Tooltip: SEO Content module is not connected yet.
```

---

## 11. Component structure đề xuất

Nếu tạo page riêng:

```text
src/pages/auto-seo/
├── AutoSeoPage.tsx
├── components/
│   ├── AutoSeoToolbar.tsx
│   ├── ProductSelectionTable.tsx
│   ├── ProductDetailDrawer.tsx
│   ├── AutoSeoOutputPanel.tsx
│   └── ProductDecisionBadge.tsx
```

Nếu project không muốn thêm route/page mới thì đặt vào page hiện tại, nhưng vẫn nên tách component rõ trách nhiệm.

---

## 12. API/UI integration

UI load sản phẩm bằng Shopify API hiện có:

```text
POST /api/shopify
operation: products.list
```

Hoặc qua module-api public runner nếu đã được nối trong app runtime.

Yêu cầu sản phẩm trả về cần có ít nhất:

```text
id
handle
title
descriptionHtml
images[]
status
vendor
productType
tags
variants[]
```

Nếu `products.list` chưa trả `images`, cần bổ sung images vào query trước khi UI hoàn thiện thumbnail.

---

## 13. Validation UI

Trước khi `Run Auto SEO`, UI cần kiểm tra:

```text
- niche không rỗng.
- products đã load.
- user đã chọn ít nhất 1 sản phẩm.
```

Nếu user chưa chọn sản phẩm nào, hiển thị confirm:

```text
Bạn chưa chọn sản phẩm nào. Bạn muốn chạy Auto SEO cho tất cả sản phẩm không?
```

Tuy service hiện tại có thể hiểu “không chọn gì = chọn tất cả”, UI nên tránh nhầm thao tác.

---

## 14. Warnings UI

Nếu output có warnings:

```json
{
  "warnings": [
    "Product gid://shopify/Product/... has no images."
  ]
}
```

UI hiển thị box vàng:

```text
⚠ Auto SEO Warnings
- Product gid://shopify/Product/... has no images.
```

Warnings không nhất thiết là lỗi chết, nhưng user cần biết trước khi gửi sang SEO Content.

---

## 15. Checklist cho UI

```text
[ ] Có ô nhập niche.
[ ] Có nút Load Products.
[ ] Có bảng product list.
[ ] Có checkbox chọn từng sản phẩm.
[ ] Có Select All / Clear Selection.
[ ] Có STT.
[ ] Có thumbnail chính.
[ ] Có title sản phẩm.
[ ] Có product ID.
[ ] Có handle/status.
[ ] Có action buttons: Duyệt, Sửa, Draft, Bỏ.
[ ] Click sản phẩm mở PDP detail drawer.
[ ] Detail drawer hiển thị ảnh, title, id, handle, status, vendor, tags, variants.
[ ] Description HTML hiển thị dạng text/pre/textarea, không render HTML trực tiếp.
[ ] Có nút Run Auto SEO.
[ ] Gọi mapShopifyProductToAutoSeoCandidate.
[ ] Gọi runAutoSeo qua public API.
[ ] Hiển thị selectedCount.
[ ] Hiển thị warnings.
[ ] Hiển thị seoContentInputs.
[ ] Có Copy JSON / Download JSON.
[ ] Send to SEO Content disabled nếu chưa nối.
```

---

## 16. Prompt giao cho AGY/UI

```text
Implement Auto SEO UI for product selection and payload preparation.

Scope:
- UI only.
- Do not update Shopify.
- Do not call productUpdate.
- Do not call SEO Content.
- Do not implement sync.
- Do not implement real draft update.
- Do not use dangerouslySetInnerHTML.

User flow:
1. Load Shopify products from existing module-api products.list.
2. Show table with:
   - checkbox
   - STT
   - main thumbnail
   - product title
   - product ID
   - handle
   - status
   - action buttons: Duyệt, Sửa, Draft, Bỏ
3. Allow selecting one or many products.
4. Clicking a product row opens PDP-like detail drawer.
5. Detail drawer shows:
   - image gallery
   - title
   - id
   - handle
   - status
   - vendor
   - productType
   - tags
   - variants
   - descriptionHtml as readonly text/pre, not rendered HTML
   - raw JSON if useful
6. Buttons:
   - Duyệt: mark product as approved and selected
   - Sửa: open detail drawer and mark needs_edit
   - Draft: mark mark_draft and remove from selected
   - Bỏ: mark skipped and remove from selected
7. Run Auto SEO:
   - map Shopify products to AutoSeoProductCandidate
   - call runAutoSeo
   - pass selectedProductIds
   - pass niche from input
8. Show Auto SEO output:
   - workflowId
   - selectedCount
   - warnings
   - seoContentInputs table
   - Copy JSON
   - Download JSON
   - Send to SEO Content disabled for now

Mapping function:
Create or use:

export function mapShopifyProductToAutoSeoCandidate(product: {
  id: string;
  handle: string;
  title: string;
  descriptionHtml?: string;
  images?: readonly {
    url: string;
    altText?: string;
  }[];
}): AutoSeoProductCandidate {
  return {
    productId: product.id,
    handle: product.handle,
    title: product.title,
    descriptionHtml: product.descriptionHtml ?? "",
    images: (product.images ?? []).map((image, index) => ({
      url: image.url,
      altText: image.altText,
      position: index + 1,
    })),
  };
}

Rules:
- Import auto-seo only through public index.ts.
- Do not import service.ts directly.
- Do not modify gateway.
- Do not modify Shopify sync.
- Do not create productUpdate calls.
- Do not render descriptionHtml as HTML.
- Keep decisions local UI state for now.
```
