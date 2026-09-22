# Tài Liệu Kỹ Thuật: Hướng Dẫn Xây Dựng Module Giao Tiếp Shopify (Shopify Gateway)

> **Dành cho:** Hiệp (hoặc thành viên phụ trách hạ tầng Shopify API)  
> **Mục tiêu:** Xây dựng module độc lập (ví dụ `src/modules/shopify-gateway/` hoặc `shopify-client/`) đảm nhận toàn bộ việc kết nối mạng và gửi lệnh GraphQL Admin API lên Shopify.  
> **Cơ chế hoạt động:** Module của Rùa (`shopify-sync`) sẽ nhập và gọi các hàm từ module của Hiệp thông qua hợp đồng chuẩn `ShopifyGateway`.

---

## 1. Phân chia trách nhiệm trong hệ thống

```text
┌─────────────────────────┐      ┌─────────────────────────┐      ┌─────────────────────────┐
│     MODULE CỦA SANG     │      │     MODULE CỦA RÙA      │      │     MODULE CỦA HIỆP     │
│   (Crawler / Cào data)  │ ───► │  (shopify-sync logic)   │ ───► │    (Shopify Gateway)    │
│                         │      │                         │      │                         │
│ • Cào Amazon/Etsy       │      │ • Chuẩn hóa URL, Alt    │      │ • Quản lý .env.shopify  │
│ • Tách sản phẩm C01-C10 │      │ • Dựng HTML mô tả       │      │ • Gửi GraphQL mutations │
│ • Xuất cấu trúc thô     │      │ • Đổi link sang CDN     │      │ • Xử lý rate-limit 429  │
│                         │      │ • Điều phối 4 bước      │      │ • Trả kết quả sạch      │
└─────────────────────────┘      └─────────────────────────┘      └─────────────────────────┘
```

---

## 2. Hợp Đồng Giao Tiếp (ShopifyGateway Contract)

Hiệp có thể import trực tiếp các kiểu dữ liệu này từ module của Rùa:

```typescript
import type {
  ShopifyGateway,
  CreateProductInput,
  CreateProductOutput,
  CreateVariantItem,
  CreateVariantsOutput,
  UploadFileInput,
  UploadFileOutput,
  SetMetafieldInput,
  SetMetafieldOutput,
} from "../shopify-sync";
```

Module của Hiệp cần export một đối tượng (hoặc class/factory) thỏa mãn interface `ShopifyGateway`:

```typescript
export interface ShopifyGateway {
  createProduct: (input: CreateProductInput) => Promise<CreateProductOutput>;
  createVariants: (productId: string, variants: readonly CreateVariantItem[]) => Promise<CreateVariantsOutput>;
  uploadFile: (input: UploadFileInput) => Promise<UploadFileOutput>;
  setProductMetafield: (input: SetMetafieldInput) => Promise<SetMetafieldOutput>;
}
```

---

## 3. Chi tiết 4 API cần chuẩn bị

### 🟢 API 1: `createProduct(input)` — Tạo Sản phẩm & Media Gallery

* **Mục đích:** Tạo sản phẩm chính trên Shopify và tải lên danh sách ảnh media gallery (đã có sẵn Alt text chuẩn SEO do Rùa sinh ra).
* **Tham số đầu vào (`CreateProductInput`):**
  ```typescript
  {
    title: string;              // Tiêu đề sản phẩm
    descriptionHtml: string;    // Mô tả HTML hoàn chỉnh (đã có bảng specs + highlights)
    vendor?: string;            // Ví dụ: "FFP Store"
    productType?: string;       // Ví dụ: "Custom Handbag"
    tags?: readonly string[];   // Mảng tags (ví dụ: ["has-customizer", "leather-bag"])
    media?: Array<{
      originalSource: string;   // URL ảnh gốc
      alt: string;              // Alt text chuẩn SEO
      mediaContentType?: "IMAGE" | "VIDEO";
    }>;
  }
  ```
* **Kết quả trả về (`CreateProductOutput`):**
  ```typescript
  {
    productId: string;          // GID Shopify, ví dụ: "gid://shopify/Product/123456789"
    productHandle: string;      // Slug URL, ví dụ: "custom-christian-leather-handbag"
  }
  ```
* **GraphQL Mutation gợi ý:**
  ```graphql
  mutation CreateProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
    productCreate(product: $product, media: $media) {
      product {
        id
        handle
        title
      }
      userErrors {
        field
        message
      }
    }
  }
  ```

---

### 🟢 API 2: `createVariants(productId, variants)` — Tạo Biến Thể Tính Tiền

* **Mục đích:** Tạo các biến thể tính tiền (Size túi, Ví kèm theo) cho sản phẩm vừa tạo.
* **Tham số đầu vào:**
  * `productId`: ID sản phẩm thu được từ API 1.
  * `variants` (`readonly CreateVariantItem[]`):
    ```typescript
    Array<{
      price: string;            // Ví dụ: "49.99"
      compareAtPrice?: string;  // Ví dụ: "59.99"
      sku?: string;             // Ví dụ: "C01-MED-WALLET"
      barcode?: string;
      optionValues?: Array<{
        optionName: string;     // Ví dụ: "Size"
        name: string;           // Ví dụ: "Medium"
      }>;
    }>
    ```
* **Kết quả trả về (`CreateVariantsOutput`):**
  ```typescript
  {
    createdCount: number;       // Số lượng biến thể đã tạo thành công
  }
  ```
* **GraphQL Mutation gợi ý:**
  ```graphql
  mutation CreateProductVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants) {
      productVariants {
        id
        title
        price
        sku
      }
      userErrors {
        field
        message
      }
    }
  }
  ```

---

### 🟢 API 3: `uploadFile(input)` — Tải Ảnh Customize Lên Kho Shopify Files

> [!IMPORTANT]
> **Điểm mấu chốt:** Rùa gửi URL ảnh Amazon sang, Hiệp cần nạp vào kho Shopify Files và **đợi file xử lý xong (`READY`)** để lấy về link CDN chính thức của Shopify (`https://cdn.shopify.com/s/files/...`). Nhờ link này, Rùa mới thay thế được link Amazon trong cấu hình JSON.

* **Tham số đầu vào (`UploadFileInput`):**
  ```typescript
  {
    originalSource: string;     // Link ảnh gốc trên Amazon CDN
    filename: string;           // Tên file chuẩn SEO (ví dụ: "thumbnail-bag-size-medium-a1b2c3.jpg")
    alt: string;                // Alt text cụ thể (ví dụ: "Choose Leather Bag Size - Medium (Thumbnail)")
  }
  ```
* **Kết quả trả về (`UploadFileOutput`):**
  ```typescript
  {
    fileId: string;             // GID của file trên Shopify
    shopifyCdnUrl: string;      // Link CDN thực tế: "https://cdn.shopify.com/s/files/..."
  }
  ```
* **GraphQL Mutation & Polling gợi ý:**
  ```graphql
  mutation CreateFile($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        fileStatus
        alt
        ... on MediaImage { image { url } }
        ... on GenericFile { url }
      }
      userErrors { field message }
    }
  }
  ```
  *(Nếu `fileStatus` chưa phải là `READY`, Hiệp poll nhẹ query `query { node(id: $id) { ... } }` sau mỗi 500ms để lấy `image.url`).*

---

### 🟢 API 4: `setProductMetafield(input)` — Ghi Cấu Hình Customize Vào Metafield

* **Mục đích:** Ghi chuỗi JSON cấu hình customize (đã được Rùa thay thế toàn bộ bằng link CDN Shopify từ API 3) vào đúng Metafield mà theme của shop đang lắng nghe.
* **Tham số đầu vào (`SetMetafieldInput`):**
  ```typescript
  {
    productId: string;          // GID sản phẩm từ API 1
    namespace: "custom";        // Cố định là "custom"
    key: "amazon_customizer";   // Cố định là "amazon_customizer"
    type: "json";               // Cố định là "json"
    value: string;              // Chuỗi JSON stringify cấu hình tùy biến
  }
  ```
* **Kết quả trả về (`SetMetafieldOutput`):**
  ```typescript
  {
    success: boolean;           // true nếu gắn thành công
    metafieldId?: string;       // GID của metafield tạo/cập nhật
  }
  ```
* **GraphQL Mutation gợi ý:**
  ```graphql
  mutation SetCustomizerMetafield($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
        namespace
        key
        type
      }
      userErrors { field message }
    }
  }
  ```

---

## 4. Yêu Cầu Kỹ Thuật Bắt Buộc Đối Với Hiệp

1. **Quản lý Thông tin Cửa Hàng:**
   * Tự động đọc file `.env.shopify` tại root dự án gồm:
     - `SHOPIFY_SHOP`: Domain cửa hàng (ví dụ: `your-shop.myshopify.com`).
     - `SHOPIFY_ACCESS_TOKEN`: Token Admin API bí mật (`shpat_...`).
     - `SHOPIFY_API_VERSION`: Mặc định `2026-04`.
2. **Xử lý Rate-Limit & Chống sập (Anti-Throttling):**
   * Bắt mã HTTP `429 Too Many Requests` hoặc lỗi GraphQL `extensions.code == "THROTTLED"`.
   * Đọc header `Retry-After` (nếu có), hoặc áp dụng công thức Exponential Backoff + Jitter để tự động thử lại (retry) tối đa 4–6 lần trước khi báo lỗi.
3. **Xử lý lỗi người dùng (`userErrors`):**
   * Nếu mutation trả về `userErrors` không rỗng, trích xuất và ném lỗi rõ ràng (`userErrors.map(e => e.message).join("; ")`).

---

## 5. Ví Dụ Khi Rùa Gọi Module Của Hiệp

Khi Hiệp hoàn thành module và export `shopifyGateway`:

```typescript
import { runCustomizationNormalizer } from "../customization-normalizer";
import { fromCustomizationNormalizerBatch, runShopifySync } from "../shopify-sync";
import { shopifyGateway } from "../shopify-gateway"; // Module của Hiệp

async function main(crawlOutputFromSang) {
  // 1. Rùa chuẩn hóa dữ liệu cào
  const normalized = await runCustomizationNormalizer(crawlOutputFromSang);
  const syncBatch = fromCustomizationNormalizerBatch(normalized);

  // 2. Rùa chuyển giao cho Gateway của Hiệp đẩy lên Shopify
  const syncResult = await runShopifySync(syncBatch, {
    gateway: shopifyGateway, // Cắm thẳng gateway của Hiệp vào đây!
  });

  console.log(`Hoàn thành: ${syncResult.successfulProducts}/${syncResult.totalProducts} sản phẩm đã lên store!`);
}
```
