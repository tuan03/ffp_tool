# Báo cáo Triển khai Stage B6: Image Processing & Alt Text (Xử lý ảnh & Tối ưu Alt Text)

## 1. Giới thiệu tổng quan

Stage B6 là chặng cuối cùng trong pipeline SEO Content, chịu trách nhiệm nhận tập ảnh sản phẩm gốc (`context.source.images`) cùng các thông tin đã được phân tích và sinh ra từ các stage trước:
- Tiêu đề và handle sản phẩm (`context.contentResult.productTitle`, `context.contentResult.productHandle`);
- Từ khóa chính và danh sách từ khóa mục tiêu (`context.contentGenerationMetadata.primaryKeyword`, `targetedKeywords`);
- Hiểu biết thị giác và thực thể sản phẩm (`context.productUnderstanding.detectedEntities`, `visualStyle`, `productCategory`);
- Tiêu đề gốc và alt text ban đầu (`context.source.title`, `image.alt`).

Từ các dữ liệu trên, Stage B6 thực hiện:
1. **Tạo tên file WebP chuẩn SEO**: Tên file định dạng `${stem}-${index + 1}.webp`, bảo vệ tuyệt đối chống path traversal, chuẩn hóa ký tự sang kebab-case sạch, ưu tiên theo thứ tự `productHandle` -> `primaryKeyword` -> `productTitle` -> `product-image`.
2. **Tạo Alt Text tự nhiên, tối ưu ngữ cảnh & trợ năng (Accessibility)**:
   - Ưu tiên bảo tồn và làm sạch `sourceAlt` nếu đã có nội dung mô tả thực chất;
   - Tự động bỏ qua các alt dạng placeholder, tên file (như `IMG_1234.jpg`, `photo`, `image 1`);
   - Ghép nối tự nhiên từ khóa chính `primaryKeyword` (tối đa 1 lần, chống nhồi từ khóa) với tối đa 1–2 thực thể thị giác nổi bật (`detectedEntities`) và phong cách (`visualStyle`);
   - Lọc bỏ triệt để các stop words/generic terms (`general`, `unspecified`, `none`, `unknown`);
   - Đảm bảo độ dài trần cứng <= 125 ký tự Unicode;
   - Đảm bảo tính độc nhất trong gallery: nếu ảnh trùng alt, tự động gán hậu tố `, view ${index + 1}` mà không bịa đặt góc chụp (do B1 là aggregate understanding);
   - Làm sạch 100% mã HTML, ký tự điều khiển và đường dẫn URL.
3. **Xử lý và Chuyển đổi WebP an toàn (Safe WebP Pipeline)**:
   - Hỗ trợ kiến trúc bộ nạp nguồn đa năng (`ImageSourceLoader`): local file path, data URI (base64) và remote HTTP(S) URL (có timeout 15s, giới hạn 10MB và chống SSRF mạng nội bộ);
   - Xác thực chữ ký số WebP (magic bytes `RIFF` và `WEBP`);
   - Hỗ trợ lưu trữ artifact (`ImageArtifactSink`): `MemoryImageSink` cho kiểm thử in-memory và `FileSystemImageSink` cho ghi đĩa nguyên tử (atomic write qua temp file + rename) kèm kiểm soát path traversal;
   - Đảm bảo tính nhất quán: **Tuyệt đối không fake WebP bytes**. Nếu không có bộ chuyển đổi hoặc ảnh lỗi trong chế độ lenient, trả về metadata lỗi và không gán trường `data`/`localFilePath` giả mạo.

---

## 2. Kiến trúc Module Stage B6

Stage B6 được tổ chức mô-đun hóa cao độ tại `src/modules/module-seo-content/internal/image-processing/`:

```text
internal/image-processing/
├── image-processing-types.ts    # Input, Output, Issue, Metadata interfaces
├── webp-filename-generator.ts   # Động cơ tạo tên file WebP chuẩn SEO
├── alt-text-sanitizer.ts        # Xóa HTML, control chars, URL, phát hiện placeholder
├── alt-text-fitter.ts           # Cắt gọt an toàn theo ranh giới từ (<= 125 ký tự)
├── alt-text-generator.ts        # Thuật toán tạo Alt Text tự nhiên & độc nhất
├── webp-validator.ts            # Kiểm tra magic bytes RIFF/WEBP, 1x1 WebP fixture
├── webp-converter.ts            # Interfaces, TestConverter, UnavailableConverter, SharpConverter
├── image-source-loader.ts       # InMemoryLoader (offline) & DefaultImageSourceLoader (SSRF safe)
├── image-artifact-sink.ts       # MemoryImageSink & FileSystemImageSink (atomic write)
├── image-processor.ts           # Orchestrator điều phối tuần tự từng ảnh
└── index.ts                     # Public internal barrel exports
```

---

## 3. Danh sách Tệp triển khai & Vai trò

| Tệp | Vị trí | Vai trò |
| --- | --- | --- |
| `image-processing-types.ts` | `internal/image-processing/` | Định nghĩa `ImageProcessingInput`, `ImageProcessingMetadata`, `ImageProcessingIssue` |
| `webp-filename-generator.ts` | `internal/image-processing/` | Sinh tên file `${stem}-${index + 1}.webp`, loại bỏ directory traversal |
| `alt-text-sanitizer.ts` | `internal/image-processing/` | Làm sạch HTML, URL, control chars, đếm ký tự Unicode, phát hiện placeholder |
| `alt-text-fitter.ts` | `internal/image-processing/` | Cắt gọt text theo từ ngữ mà không cắt vụn từ |
| `alt-text-generator.ts` | `internal/image-processing/` | Sinh alt text có căn cứ, không spam từ khóa, đảm bảo độ dài và tính duy nhất |
| `webp-validator.ts` | `internal/image-processing/` | Kiểm tra chữ ký magic bytes `RIFF` / `WEBP`, cung cấp fixture WebP 1x1 42 bytes |
| `webp-converter.ts` | `internal/image-processing/` | Chuyển đổi WebP với các adapter: DeterministicTest, Unavailable, Sharp |
| `image-source-loader.ts` | `internal/image-processing/` | Nạp dữ liệu ảnh từ buffer, file cục bộ, data URI hoặc remote URL an toàn |
| `image-artifact-sink.ts` | `internal/image-processing/` | Lưu trữ WebP vào bộ nhớ hoặc ghi file hệ thống nguyên tử |
| `image-processor.ts` | `internal/image-processing/` | Trình điều phối chính của B6, hỗ trợ chế độ lenient và strict |
| `b6-image-processing.ts` | `internal/stages/` | Kết nối Stage B6 vào luồng SEO Pipeline, đóng gói lỗi an toàn |
| `domain-types.ts` | `internal/` | Cập nhật `SeoPipelineContext` thêm trường `imageProcessingMetadata` |
| `b6-image-processing.test.ts` | `__tests__/` | 26 unit tests toàn diện cho toàn bộ các thành phần của Stage B6 |

---

## 4. Kết quả Kiểm thử & Nghiệm thu

Toàn bộ **256/256 tests** trong repository đều vượt qua (100% PASS):
- Nhóm B6 Unit Tests (`b6-image-processing.test.ts`): 26/26 tests PASS
  + Nhóm 1 (Filename Generator): Định dạng tên file, fallback stem, chuẩn hóa ký tự tiếng Việt, chống path traversal.
  + Nhóm 2 (Alt Sanitizer & Fitter): Xóa tag HTML, xóa control chars, phát hiện placeholder, cắt an toàn ranh giới từ.
  + Nhóm 3 (Alt Text Generator): Giữ alt có nghĩa, kết hợp primary keyword + entities, loại bỏ generic stop words, đảm bảo tính duy nhất trong gallery, fallback khi thiếu context, trần cứng <= 125 ký tự.
  + Nhóm 4 (WebP Validator & Converters): Kiểm tra magic bytes RIFF/WEBP, test converter trả về buffer hợp lệ, unavailable converter ném lỗi đặc thù.
  + Nhóm 5 (Source Loader & Sink): Load buffer in-memory offline 100%, parse data URI, chặn IP cục bộ/SSRF, ghi đĩa nguyên tử và chặn thoát thư mục.
  + Nhóm 6 (Processor & Edge Cases): Xử lý danh sách ảnh rỗng, bảo toàn thứ tự ảnh đầu vào, chế độ lenient không tạo fake WebP data, chế độ strict ném lỗi khi convert hỏng.
  + Nhóm 7 (Stage Execution & Context Invariants): Context bất biến, giữ nguyên tham chiếu `source`, bảo toàn `contentResult` và `corpusRevision` của B4/B5.
- Toàn bộ các bài kiểm thử hồi quy cũ (B1, B2, B3, B4, B5, Pipeline, Service, Mock, Orchestrator) đều PASS 100%.
- TypeScript Typecheck: 0 lỗi (`npm run typecheck` pass).
- Production Build: Thành công (`npm run build` pass).
- Mock Build: Thành công (`npm run build:mock` pass).
