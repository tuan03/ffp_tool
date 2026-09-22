# ĐẶC TẢ GÓI BÀN GIAO: PINTEREST POD ➔ SEO + CONTENT

> **Người gửi:** Phụ trách Module **Pinterest POD**  
> **Người nhận:** Phụ trách Module **SEO + CONTENT**  
> **Phiên bản:** v2.0 (Chỉ tập trung vào Hợp đồng Dữ liệu Bàn giao)  
> **Ngày cập nhật:** 21/09/2026  

---

## 1. Mục đích Tài liệu

Tài liệu này xác định **chính xác cấu trúc dữ liệu thành phẩm (Deliverables Payload)** mà Module Pinterest POD sẽ đóng gói và bàn giao sang cho Module SEO + CONTENT (thông qua Orchestrator / API). 

Module SEO chỉ cần tiếp nhận đúng gói JSON này để phục vụ việc viết bài và tối ưu nội dung sản phẩm.

---

## 2. Đặc tả Dữ liệu Bàn giao (TypeScript Interface)

```ts
export interface PodPrintMasterSpec {
  cmykUrl: string;         // Relative URL: /api/pinterest-pod/assets/:jobId/cmyk.jpg
  rgbUrl: string;          // Relative URL: /api/pinterest-pod/assets/:jobId/rgb.png
  localFilePath?: string;  // Đường dẫn tương đối trên đĩa: temp/pinterest_pod/:jobId/cmyk.jpg
  widthPx: number;         // Thảm Rug: 4000px | Chăn Blanket: 10000px
  heightPx: number;        // Thảm Rug: 6400px | Chăn Blanket: 11000px
  dpi: 300;                // Luôn đạt chuẩn in xưởng 300 DPI
}

export interface PodCutoutSpec {
  transparentUrl: string;  // Relative URL phôi trong suốt
  whiteBgUrl: string;      // Relative URL phôi nền trắng
  localFilePath?: string;  // Đường dẫn tương đối trên đĩa
}

export interface PodComposedMockupSpec {
  referenceImageId: string;        // ID của ảnh phòng gốc
  mockupUrl: string;               // Relative URL: /api/pinterest-pod/assets/:jobId/mockup.jpg
  localFilePath?: string;          // Đường dẫn tương đối trên đĩa
  detectedSceneType: string;       // AI Vision tự nhận diện loại phòng
  detectedSceneDescription: string;// AI Vision tự mô tả chi tiết không gian phòng
}

export interface PodDeliverableItem {
  designId: string;                    // Mã định danh sản phẩm do module sinh ra (VD: "design_rug_101")
  sourceCandidateId: string;           // Mã ứng viên cào từ Pinterest
  productType: "rug" | "blanket" | "custom"; // Loại sản phẩm
  originalPinTitle: string;            // Tiêu đề Pin gốc cào được từ Pinterest
  trendKeywords: readonly string[];    // Danh sách từ khóa hot trend Pinterest liên quan đến mẫu
  printMaster: PodPrintMasterSpec;     // File in xưởng 300 DPI
  cutoutProduct: PodCutoutSpec;        // Phôi nền trắng & nền trong suốt
  composedMockups: PodComposedMockupSpec[]; // Danh sách các ảnh phòng đã render bằng AI
}

/** Gói dữ liệu hoàn chỉnh bàn giao cho khối SEO */
export interface PinterestPodDeliverables {
  workflowId: string;
  success: true;
  productType: "rug" | "blanket" | "custom";
  totalProduced: number;               // Tổng số lượng sản phẩm được tạo ra
  items: readonly PodDeliverableItem[];
}
```

---

## 3. Ví dụ JSON Bàn giao Thực tế (Sample Deliverables Payload)

Dưới đây là mẫu JSON đầy đủ mà module SEO sẽ nhận được:

```json
{
  "workflowId": "wf_20260921_8f12a",
  "success": true,
  "productType": "rug",
  "totalProduced": 2,
  "items": [
    {
      "designId": "design_rug_101",
      "sourceCandidateId": "cand_pin_101",
      "productType": "rug",
      "originalPinTitle": "Washed Persian Medallion Rug in Earth Tones",
      "trendKeywords": [
        "vintage boho rug",
        "persian aesthetic",
        "distressed medallion rug",
        "earth tone living room",
        "moroccan washed runner"
      ],
      "printMaster": {
        "cmykUrl": "/api/pinterest-pod/assets/wf_001/design_101_cmyk_300dpi.jpg",
        "rgbUrl": "/api/pinterest-pod/assets/wf_001/design_101_rgb_4k.png",
        "widthPx": 4000,
        "heightPx": 6400,
        "dpi": 300
      },
      "cutoutProduct": {
        "transparentUrl": "/api/pinterest-pod/assets/wf_001/design_101_cutout.png",
        "whiteBgUrl": "/api/pinterest-pod/assets/wf_001/design_101_white.jpg"
      },
      "composedMockups": [
        {
          "referenceImageId": "ref_01",
          "mockupUrl": "/api/pinterest-pod/assets/wf_001/mockup_room_01_design_101.jpg",
          "detectedSceneType": "living_room",
          "detectedSceneDescription": "Modern spacious living room with brown leather couch, coffee table and natural sunlight"
        },
        {
          "referenceImageId": "ref_02",
          "mockupUrl": "/api/pinterest-pod/assets/wf_001/mockup_room_02_design_101.jpg",
          "detectedSceneType": "bedroom",
          "detectedSceneDescription": "Cozy minimalist bedroom with oak hardwood flooring and beige bedding"
        }
      ]
    },
    {
      "designId": "design_rug_102",
      "sourceCandidateId": "cand_pin_102",
      "productType": "rug",
      "originalPinTitle": "Minimalist Abstract Beige Line Runner",
      "trendKeywords": [
        "minimalist rug",
        "japandi home",
        "beige geometric runner"
      ],
      "printMaster": {
        "cmykUrl": "/api/pinterest-pod/assets/wf_001/design_102_cmyk_300dpi.jpg",
        "rgbUrl": "/api/pinterest-pod/assets/wf_001/design_102_rgb_4k.png",
        "widthPx": 4000,
        "heightPx": 6400,
        "dpi": 300
      },
      "cutoutProduct": {
        "transparentUrl": "/api/pinterest-pod/assets/wf_001/design_102_cutout.png",
        "whiteBgUrl": "/api/pinterest-pod/assets/wf_001/design_102_white.jpg"
      },
      "composedMockups": [
        {
          "referenceImageId": "ref_01",
          "mockupUrl": "/api/pinterest-pod/assets/wf_001/mockup_room_01_design_102.jpg",
          "detectedSceneType": "living_room",
          "detectedSceneDescription": "Modern spacious living room with brown leather couch, coffee table and natural sunlight"
        },
        {
          "referenceImageId": "ref_02",
          "mockupUrl": "/api/pinterest-pod/assets/wf_001/mockup_room_02_design_102.jpg",
          "detectedSceneType": "bedroom",
          "detectedSceneDescription": "Cozy minimalist bedroom with oak hardwood flooring and beige bedding"
        }
      ]
    }
  ]
}
```

---

## 4. Cam kết Chất lượng Dữ liệu từ Pinterest POD

1. **Về hình ảnh & File in**:
   - `printMaster.cmykUrl`: Luôn là file JPEG chất lượng cao hệ màu CMYK, 300 DPI đúng kích thước xưởng (Rug: `4000x6400px`, Blanket: `10000x11000px`).
   - `cutoutProduct.whiteBgUrl`: Luôn là ảnh tỷ lệ 1:1 nền trắng sạch (`#ffffff`) đúng chuẩn ảnh chính (Featured Image) của sàn thương mại điện tử.
   - `composedMockups`: Mỗi ảnh tham chiếu đều được thay thế phôi sản phẩm chuẩn phối cảnh và ánh sáng phòng.
2. **Về từ khóa & Ngữ nghĩa**:
   - `trendKeywords`: Luôn cung cấp từ 3 đến 8 từ khóa hot trend liên quan trực tiếp đến mẫu thiết kế được cào về từ Pinterest.
   - `detectedSceneDescription`: AI Vision luôn cung cấp mô tả ngắn gọn về không gian phòng (đồ nội thất, màu sắc, loại sàn) để hỗ trợ SEO.
