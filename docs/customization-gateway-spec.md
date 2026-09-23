# Tài Liệu Kỹ Thuật: Hướng Dẫn Tích Hợp Gateway Cho Module Customization Manager

> **Dành cho:** Hiệp (phụ trách hạ tầng Shopify Gateway & `module-api`)  
> **Mục tiêu:** Hướng dẫn bổ sung 2 API còn thiếu trên Gateway để kết nối hoàn chỉnh với module `src/modules/customization-manager`.  
> **Cơ chế:** Module `customization-manager` đã được xây dựng theo chuẩn **Dependency Inversion** thông qua interface `CustomizationGateway`. Khi Gateway bổ sung xong, chỉ cần inject adapter vào là chạy được ngay.

---

## 1. Tổng Quan 2 Thao Tác Cần Bổ Sung Trên Gateway

Hiện tại Gateway đã hỗ trợ rất tốt các operation:
- `products.create`, `products.get`, `products.update`, `products.delete`, `products.list`
- `variants.bulkCreate`, `variants.bulkUpdate`
- `files.create`, `files.bulkCreate`
- `metafields.set`

Để phục vụ bài toán CRUD Customizer và **tự động xóa dọn rác các file CDN khi sản phẩm bị xóa hoặc cập nhật**, Gateway cần bổ sung 2 operations:

| Thao tác Gateway | GraphQL Mutation / Query trên Shopify | Trách nhiệm |
| :--- | :--- | :--- |
| **`files.delete`** | `mutation fileDelete($fileIds: [ID!]!)` | Xóa hàng loạt file trên Shopify CDN khi xóa sản phẩm hoặc xóa asset |
| **`metafields.get`** | `query ProductMetafield($id: ID!, $namespace: String!, $key: String!)` | Đọc giá trị metafield `custom.amazon_customizer` của sản phẩm |

---

## 2. Chi Tiết Kỹ Thuật Từng Operation

### 🟢 API 1: `files.delete` — Xóa File Hàng Loạt Trên Shopify Files CDN

* **Tên Operation trên Gateway:** `"files.delete"`
* **File đề xuất đặt tại Gateway:** `gateway/operations/files-write.ts`
* **Tham số đầu vào (`ShopifyFilesDeleteInput`):**
  ```typescript
  export interface ShopifyFilesDeleteInput {
    readonly fileIds: readonly string[]; // Danh sách GID Shopify, ví dụ: ["gid://shopify/MediaImage/123", "gid://shopify/GenericFile/456"]
  }
  ```

* **GraphQL Mutation gửi lên Shopify:**
  ```graphql
  mutation FileDelete($fileIds: [ID!]!) {
    fileDelete(fileIds: $fileIds) {
      deletedFileIds
      userErrors {
        field
        message
      }
    }
  }
  ```

* **Quy tắc xử lý:**
  - Shopify cho phép xóa tối đa **250 file IDs** trong 1 request. Nếu mảng `fileIds` lớn hơn 250, Gateway chia nhỏ thành các batch 250 phần tử.
  - Hỗ trợ chế độ `preview`: Nếu `executionMode === "preview"`, trả về mảng `deletedFileIds` giả định mà không gọi Shopify.
  - Kết quả trả về trên Gateway:
    ```typescript
    export interface ShopifyFilesDeleteResponse {
      readonly deletedFileIds: readonly string[];
      readonly userErrors?: readonly { field: string[]; message: string }[];
    }
    ```

---

### 🟢 API 2: `metafields.get` — Đọc Metafield Của Sản Phẩm

* **Tên Operation trên Gateway:** `"metafields.get"` (hoặc tích hợp vào `products.get`)
* **Tham số đầu vào:**
  ```typescript
  export interface ShopifyMetafieldsGetInput {
    readonly ownerId: string;    // Ví dụ: "gid://shopify/Product/8481215709269"
    readonly namespace?: string; // Mặc định: "custom"
    readonly key?: string;       // Mặc định: "amazon_customizer"
  }
  ```

* **GraphQL Query gửi lên Shopify:**
  ```graphql
  query ProductMetafield($id: ID!, $namespace: String!, $key: String!) {
    product(id: $id) {
      id
      metafield(namespace: $namespace, key: $key) {
        id
        namespace
        key
        value
        type
      }
    }
  }
  ```

* **Kết quả trả về trên Gateway:**
  ```typescript
  export interface ShopifyMetafieldsGetResponse {
    readonly id?: string;
    readonly value: string | null; // Chuỗi JSON của customizer_data
    readonly namespace?: string;
    readonly key?: string;
    readonly type?: string;
  }
  ```

---

## 3. Mẫu Adapter Kết Nối Với `customization-manager`

Sau khi Hiệp bổ sung 2 operation trên vào `gateway/` và `src/modules/module-api/`, Hiệp có thể export một Adapter đơn giản trong `module-api`:

```typescript
import type { CustomizationGateway } from "../customization-manager";
import { runModuleApi } from "./service";

export function createCustomizationGatewayAdapter(config: { storeId?: string } = {}): CustomizationGateway {
  return {
    async getMetafield({ ownerId, namespace = "custom", key = "amazon_customizer" }) {
      const res = await runModuleApi({
        operation: "metafields.get",
        storeId: config.storeId,
        input: { ownerId, namespace, key },
      });
      return {
        id: res.data.id,
        value: res.data.value,
        namespace,
        key,
      };
    },

    async setMetafield({ ownerId, namespace = "custom", key = "amazon_customizer", value, type = "json" }) {
      const res = await runModuleApi({
        operation: "metafields.set",
        storeId: config.storeId,
        input: {
          metafields: [{ ownerId, namespace, key, value, type }],
        },
      });
      return {
        success: res.data.success,
        metafieldId: res.data.metafields?.[0]?.id,
      };
    },

    async deleteMetafield({ ownerId, namespace = "custom", key = "amazon_customizer" }) {
      // Có thể set value rỗng hoặc gọi metafieldDelete mutation
      const res = await runModuleApi({
        operation: "metafields.set",
        storeId: config.storeId,
        input: {
          metafields: [{ ownerId, namespace, key, value: "", type: "json" }],
        },
      });
      return { success: res.data.success };
    },

    async deleteFiles({ fileIds }) {
      const res = await runModuleApi({
        operation: "files.delete",
        storeId: config.storeId,
        input: { fileIds },
      });
      return {
        deletedFileIds: res.data.deletedFileIds ?? [],
      };
    },

    async queryFiles({ query, first = 250 }) {
      // Tìm file theo query tag
      return { files: [] };
    },
  };
}
```

---

## 4. Kiểm Thử Độc Lập

Hiệp có thể test độc lập 2 operation mới bằng file test chuyên biệt:
```bash
npx tsx --test gateway/__tests__/gateway.test.ts
```
Module `customization-manager` đã có sẵn bộ 13 test case độc lập (`src/modules/customization-manager/__tests__/service.test.ts`) giả lập hoàn chỉnh gateway. Khi Hiệp cắm adapter thực tế vào sẽ hoàn toàn tương thích 100%.
