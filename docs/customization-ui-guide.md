# Hướng Dẫn Tích Hợp UI Cho Module Customization Manager

> **Dành cho:** Frontend / UI Team
> **Mục tiêu:** Hướng dẫn xây dựng giao diện quản trị (Visual Editor & CDN Asset Cleaner) kết nối với module `src/modules/customization-manager`.
> **Vị trí đề xuất đặt UI:** `src/modules/customization-manager/ui/` và đăng ký route tại `src/app/routes/`.

---

## 1. Cách Import & Gọi Service Từ React

Tuân thủ quy chuẩn [AGENTS.md](file:///d:/all_about_shopify/tools/ffp_tool/AGENTS.md):
- Chỉ import các hàm và types từ **entry point duy nhất** `src/modules/customization-manager`.
- Tuyệt đối không import file nội bộ `service.ts` hay `mocks/`.

```typescript
import { useState, useEffect } from "react";
import {
  readCustomization,
  updateCustomization,
  deleteCustomization,
  cleanOrphanAssets,
  validateCustomizationPayloadSize,
} from "../../modules/customization-manager";
import type {
  ProductCustomization,
  ReadCustomizationOutput,
  UpdateCustomizationOutput,
} from "../../modules/customization-manager";
```

---

## 2. Kiến Trúc Màn Hình Đề Xuất (Component Hierarchy)

```text
CustomizationManagerPage (Trang chủ quản trị /customization-manager)
├── Header & ProductLookupBar (Tìm kiếm sản phẩm theo Shopify GID hoặc Slug Handle)
├── PayloadSizeIndicator (Thanh đo dung lượng thời gian thực so với trần 128 KB)
├── CustomizerWorkspace (Khu vực làm việc chính dạng Tabs)
│   ├── Tab 1: SurfaceManager (Quản lý mặt in: Front, Back, ảnh phôi Mockup, vùng Placement)
│   ├── Tab 2: OptionGroupEditor (Quản lý các nhóm tùy chọn: Màu sắc, Font chữ, Nhập chữ, Icon)
│   ├── Tab 3: AssetInspector (Xem danh sách ảnh CDN, dung lượng, thay thế ảnh có dọn file cũ)
│   └── Tab 4: CloneAndDangerZone (Nhân bản sang SP khác, Xóa Customizer, Cascade Delete)
└── OrphanAssetCleanerModal (Cửa sổ quét và dọn dẹp file CDN mồ côi 1-Click)
```

---

## 3. Các Luồng Nghiệp Vụ Chính Cần Xử Lý Trên UI

### 🔹 Luồng 1: Tải Cấu Hình Sản Phẩm (Read)
```typescript
async function handleLoadProduct(productId: string) {
  setIsLoading(true);
  try {
    const result: ReadCustomizationOutput = await readCustomization(gateway, { productId });
    if (result.exists && result.customization) {
      setCustomization(result.customization);
      setTrackedFileIds(result.trackedFileIds);
      setByteSize(result.byteSize);
    } else {
      // Sản phẩm chưa có cấu hình customizer -> Hiển thị nút "Tạo cấu hình mới" hoặc "Áp dụng Template mẫu"
    }
  } finally {
    setIsLoading(false);
  }
}
```

### 🔹 Luồng 2: Cập Nhật Cấu Hình & Tự Động Xóa File Cũ Bị Thay Thế (Delta Cleanup)
Khi người dùng thay đổi 1 ảnh mockup hoặc gỡ bỏ 1 clipart:
```typescript
async function handleSaveCustomization(updatedConfig: ProductCustomization) {
  // 1. Kiểm tra kích thước trước khi lưu
  const validation = validateCustomizationPayloadSize(updatedConfig);
  if (!validation.isSafe) {
    alert(`Cảnh báo: Dữ liệu đã vượt quá 128KB (${validation.byteSize} bytes)! Vui lòng gỡ bớt layer.`);
    return;
  }

  // 2. Gọi hàm Update có bật cờ tự động xóa file cũ đã bị gỡ bỏ
  const result: UpdateCustomizationOutput = await updateCustomization(gateway, {
    productId,
    customization: updatedConfig,
    autoCleanReplacedAssets: true, // Tự động xóa các file CDN cũ không còn dùng
  });

  if (result.deletedFileIds.length > 0) {
    console.log(`Đã tự động dọn dẹp ${result.deletedFileIds.length} file cũ trên CDN.`);
  }
}
```

### 🔹 Luồng 3: Xóa Customizer Kèm Xóa Sạch File CDN (Cascade Delete)
```typescript
async function handleDeleteCustomizer(cascadeFiles: boolean) {
  const confirmed = confirm(
    cascadeFiles
      ? "Bạn có chắc muốn xóa cấu hình Customizer VÀ XÓA TOÀN BỘ file ảnh mockup trên CDN không?"
      : "Bạn có chắc muốn xóa cấu hình Customizer (giữ lại file trên CDN) không?"
  );
  if (!confirmed) return;

  const result = await deleteCustomization(gateway, {
    productId,
    cascadeDeleteFiles: cascadeFiles,
  });

  alert(`Đã xóa thành công! Đã dọn dẹp ${result.deletedFileIds.length} file trên CDN.`);
}
```

### 🔹 Luồng 4: Dọn Rác File Mồ Côi Định Kỳ (Orphan Assets Cleaner)
```typescript
async function handleScanOrphans() {
  setIsScanning(true);
  // Quét ở chế độ dry-run trước để xem trước số lượng
  const preview = await cleanOrphanAssets(gateway, { dryRun: true });
  setOrphanCount(preview.orphanCount);
  setOrphanFileIds(preview.orphanFileIds);
  setIsScanning(false);
}

async function handleExecuteCleanOrphans() {
  setIsCleaning(true);
  const result = await cleanOrphanAssets(gateway, { dryRun: false });
  alert(`Đã xóa vĩnh viễn ${result.deletedFileIds.length} file rác mồ côi trên CDN!`);
  setIsCleaning(false);
}
```

---

## 4. Trải Nghiệm Người Dùng (UX Guidelines)

1. **Thanh đo trần 128 KB (Payload Size Indicator):**
   - Xanh (< 80 KB): An toàn.
   - Vàng (80 KB - 110 KB): Cảnh báo sắp đầy.
   - Đỏ (> 110 KB): Nguy hiểm, cần kích hoạt deduplication hoặc gỡ bớt option rườm rà.
2. **Xác nhận 2 lớp khi xóa CDN:**
   - Việc xóa file trên CDN bằng `fileDelete` của Shopify là không thể hoàn tác (permanent). Luôn có modal xác nhận rõ ràng trước khi gọi `cascadeDeleteFiles: true`.
