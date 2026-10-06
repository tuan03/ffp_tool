## 1. Các điều cần nhắc cho AI Agent sau này trước khi bắt đầu code module SEO Content

1. Module SEO Content dùng Gemini API qua Google Cloud.
2. Project chạy trên Node.js runtime, vì vậy phần server của module có thể dùng trực tiếp thư viện `fs`.
3. Input contract V2 chỉ có `images`, `niche`, và `storeProfile`. Không thêm lại title, description, handle, variants, existing keywords, site domain, URL hoặc old alt text vào semantic input.
4. Pixel ảnh là nguồn sự thật duy nhất cho mọi dữ kiện riêng của sản phẩm. `niche` chỉ giúp phân biệt đối tượng được bán; `storeProfile` chỉ cung cấp cấu hình và policy đã version hóa.
5. Store profile phải được resolve trước khi enqueue. Domain và source snapshot chỉ thuộc execution envelope và không được đưa vào prompt/generation context.
6. Khi không đọc được ảnh hoặc danh tính sản phẩm mơ hồ, pipeline phải fail closed bằng lỗi ổn định thay vì sinh nội dung từ niche hoặc metadata cũ.
