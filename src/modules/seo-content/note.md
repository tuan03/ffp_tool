## 1. các điều cần nhắc cho AI Agent sau này trước khi bắt đầu code module SEO Content

1. module SEO Content sẽ dùng Gemini API qua Google Cloud
2. project này sẽ chạy trên nodejs runtime, tức là module SEO Content có thể dùng trực tiếp lib fs của nodejs
3. `SeoContentInput.niche` luôn bắt buộc và là fallback; `siteDomain` chỉ là optional. Khi có domain, server render homepage, gửi evidence đã giới hạn cho Gemini để suy luận `effectiveNiche`. Khi không có domain hoặc inference lỗi, pipeline dùng ngay `niche` nhập tay.
4. Niche inference cache theo normalized storefront domain trong `.local-data/seo-content-niche.sqlite3` trong 24 giờ. Cache không được lưu HTML hoặc evidence thô.
