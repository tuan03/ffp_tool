# SEO + Content Module — Kế hoạch tổng quát

## 1. Mục tiêu

Module **SEO + Content** nhận dữ liệu sản phẩm từ flow chung, phân tích nội dung và hình ảnh, sau đó tạo lại bộ dữ liệu sản phẩm đã được tối ưu để chuyển cho module tiếp theo.

Module này tập trung vào:
- hiểu sản phẩm từ ảnh và nội dung gốc;
- mở rộng dữ liệu tìm kiếm liên quan;
- hạn chế trùng lặp/xung đột SEO;
- tạo lại nội dung SEO cho sản phẩm;
- xử lý ảnh trước khi trả kết quả.

---

## 2. Input của module

Module dự kiến nhận 4 nhóm dữ liệu:

1. **Ảnh sản phẩm**
   - Một hoặc nhiều ảnh/mockup của sản phẩm.

2. **Niche sản phẩm**
   - Chủ đề hoặc nhóm sản phẩm mà sản phẩm đang thuộc về.

3. **Mô tả sản phẩm hiện tại**
   - Product title.
   - Product description.

4. **Product handle**
   - Handle hiện tại của sản phẩm nếu đã có.

### Input tổng quát

```text
Product Images
Product Niche
Current Product Title
Current Product Description
Current Product Handle
```

---

## 3. Các bước xử lý trong module

### B1 — Phân tích sản phẩm từ hình ảnh

Phân tích ảnh để lấy thêm thông tin mà title/description hiện tại có thể chưa thể hiện đầy đủ.

Có thể bao gồm:
- nhận diện chữ trên thiết kế;
- nhận diện các thành phần hình ảnh chính;
- xác định màu sắc, phong cách và chủ đề;
- ghi nhận các đặc điểm có ích cho việc hiểu sản phẩm.

**Kết quả của bước này:** dữ liệu mô tả sản phẩm ở dạng có cấu trúc để dùng cho các bước tiếp theo.

---

### B2 — Xác định bối cảnh sản phẩm và người mua

Từ dữ liệu sản phẩm đã phân tích, xác định các nhóm thông tin liên quan đến hành vi mua hàng, ví dụ:
- sản phẩm phù hợp với nhóm đối tượng nào;
- ai có thể là người mua hoặc người nhận;
- các dịp hoặc hoàn cảnh sử dụng phù hợp;
- các ngữ cảnh mua hàng có liên quan.

**Kết quả của bước này:** bổ sung context để tạo seed keyword/search query phù hợp hơn.

---

### B3 — Thu thập suggestion và dữ liệu tìm kiếm liên quan

Từ các keyword ban đầu đã có, tiếp tục lấy thêm các suggestion/query thực tế để mở rộng tập dữ liệu tìm kiếm cho sản phẩm.

Các nguồn dự kiến:
- **Google Autocomplete API**;
- **Etsy Suggest Scraper**;
- **People Also Ask (PAA)** để lấy các câu hỏi liên quan.

Trong giai đoạn hiện tại, phần triển khai **chỉ tập trung vào Google Autocomplete API**. Etsy Suggest Scraper và PAA được giữ trong phạm vi kế hoạch tổng quát để có thể bổ sung ở các bước phát triển sau.

**Kết quả của bước này:** danh sách suggestion/query mở rộng từ các keyword đầu vào, kèm nguồn dữ liệu tương ứng khi cần.

---

### B4 — Kiểm tra trùng lặp và xung đột SEO

Kiểm tra các keyword/query thu được để hạn chế việc nhiều sản phẩm cùng nhắm vào một nhóm từ khóa quá giống nhau.

Có thể kiểm tra:
- từ khóa giống nhau;
- nội dung có ý nghĩa gần nhau;
- keyword đã được dùng cho sản phẩm hoặc URL khác.

**Kết quả của bước này:** nhóm keyword/query có thể tiếp tục sử dụng và các trường hợp cần tránh hoặc điều chỉnh.

---

### B5 — Phân loại và tạo nội dung SEO

Dùng dữ liệu sau khi đã lọc để xác định cách sử dụng keyword/query trong nội dung sản phẩm.

Bước này chịu trách nhiệm tạo hoặc tối ưu:
- product title;
- product description;
- SEO title;
- SEO description;
- product handle.

Việc phân bổ keyword cần dựa trên mục đích tìm kiếm và mức độ phù hợp với từng field, thay vì đưa cùng một keyword vào tất cả vị trí.

**Kết quả của bước này:** bộ nội dung text hoàn chỉnh cho sản phẩm.

---

### B6 — Xử lý ảnh sản phẩm

Xử lý ảnh trước khi trả kết quả cuối cùng.

Bao gồm:
- chuyển ảnh sang định dạng WebP;
- tạo tên file phù hợp với nội dung/target của sản phẩm;
- tạo alt text cho từng ảnh dựa trên nội dung thực tế của ảnh và sản phẩm.

**Kết quả của bước này:** ảnh WebP và alt text tương ứng.

---

## 4. Output của module

Module trả về bộ dữ liệu sản phẩm đã được xử lý gồm:

1. **Product title**
2. **Product description**
3. **Product SEO title**
4. **Product SEO description**
5. **Product image**
   - image alt;
   - image WebP.
6. **Product handle**

### Output tổng quát

```text
Optimized Product Title
Optimized Product Description
SEO Title
SEO Description
Product Images as WebP
Product Image Alt Text
Optimized Product Handle
```

---

## 5. Luồng tổng quát

```text
INPUT
│
├── Product Images
├── Niche
├── Current Title
├── Current Description
└── Current Handle
        │
        ▼
B1 — Phân tích hình ảnh/sản phẩm
        │
        ▼
B2 — Xác định audience / buying context
        │
        ▼
B3 — Mở rộng search suggestion/query
        │
        ▼
B4 — Kiểm tra conflict / duplication
        │
        ▼
B5 — Tạo và tối ưu content SEO
        │
        ▼
B6 — Xử lý ảnh WebP + alt
        │
        ▼
OUTPUT
│
├── Product Title
├── Product Description
├── SEO Title
├── SEO Description
├── Image Alt + WebP
└── Product Handle
```

---

## 6. Phạm vi của module

Module **SEO + Content** chỉ chịu trách nhiệm nhận dữ liệu đầu vào, xử lý và trả về bộ dữ liệu sản phẩm đã tối ưu.

Việc duyệt kết quả, đồng bộ dữ liệu hoặc cập nhật trực tiếp lên Shopify nên được thực hiện bởi module điều phối/API ở bước sau nếu flow tổng của project đã tách riêng phần này.

---

## 7. Contract mức module

### Input

```text
SeoContentInput
- images
- niche
- title
- description
- handle
```

### Output

```text
SeoContentOutput
- productTitle
- productDescription
- seoTitle
- seoDescription
- images[]
  - webp
  - alt
- handle
```

Mục tiêu là giữ contract này ổn định để các module khác chỉ cần biết dữ liệu nào phải gửi vào và dữ liệu nào sẽ nhận lại, không cần phụ thuộc vào cách B1–B6 được triển khai bên trong.
