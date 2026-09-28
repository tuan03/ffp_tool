# Báo cáo audit 4: partial family có cấu trúc

Audit này tiếp nối [negative cache](amazon-crawler-negative-cache-audit.md) và [checkpoint theo giai đoạn](amazon-crawler-stage-checkpoint-audit.md) trên nhánh `fix-bug-audit`.

## Trước và sau khi sửa

| Vấn đề | Trước khi sửa | Sau khi sửa | Tác dụng |
| --- | --- | --- | --- |
| Một child lỗi, các child khác thành công | Family dở đã giữ các variant thành công và retry có thể ghép kết quả mới, nhưng bản partial không liệt kê rõ ASIN theo trạng thái. | Partial cache lưu `completedAsins`, `failedAsins`, `retryableAsins`, `nonRetryableAsins` cùng parent và family. Các danh sách được cập nhật sau mỗi lượt retry. | Có thể biết chính xác child nào đã đủ dữ liệu, child nào còn thiếu và loại retry của từng child. |
| Kết quả trả về | Output có `status: partial` và một lỗi chung cho family; muốn biết child nào lỗi phải đọc variant và warning. | Kết quả crawler và coordinator trả bốn danh sách ASIN; lỗi partial của từng family cũng chứa các danh sách đó. | UI hoặc hệ thống giám sát đọc được trạng thái child mà không phải suy đoán từ warning. |
| Family có cả lỗi phục hồi được và lỗi không phục hồi được | Một child `not_found` hoặc `parser_error` đặt `retryable: false` cho cả family, khiến child lỗi mạng trong cùng family không được tự retry. | Family tiếp tục retry khi còn child phục hồi được. `retryAfter` lấy từ lỗi có thể retry; child thành công được dùng lại, child không retry được không được gọi lại trong thời gian negative cache. Khi chỉ còn lỗi không retry được, family dừng retry. | Không bỏ lỡ cơ hội hoàn tất các child còn phục hồi được và không tải lại những child đã thành công. |

Ví dụ một kết quả partial:

```json
{
  "status": "partial",
  "completedAsins": ["B012345678"],
  "failedAsins": ["B012345679", "B012345680"],
  "retryableAsins": ["B012345680"],
  "nonRetryableAsins": ["B012345679"]
}
```

Danh sách được sắp theo ASIN để partial cache, lỗi family và output tổng hợp có thứ tự ổn định. ASIN nằm trong `failedAsins` thuộc đúng một trong hai nhóm retry. Các trường mới trong contract TypeScript là tùy chọn để đọc được kết quả job cũ chưa có danh sách.

## Kiểm tra

- Test engine mô phỏng một child lỗi parser và một child lỗi mạng: lượt đầu báo đúng bốn danh sách và còn retry; lượt sau chỉ lấy lại child lỗi mạng, cập nhật partial cache rồi dừng khi chỉ còn lỗi parser.
- Test coordinator xác nhận một lỗi partial hỗn hợp được đưa lại vào hàng đợi và bốn danh sách cuối cùng xuất hiện trong kết quả job.
- Test mock xác nhận output có danh sách và mỗi lượt chạy nhận bản sao riêng.
- `npm run test:engine`: 218 test qua; 1 test PostgreSQL bỏ qua do chưa cấu hình test database.
- `npm run typecheck`, `npm run build`, `npm run build:mock`: qua.
- `npm test`: tooling 6/6 và web 666/666 qua; gateway 250/251. Test gateway về symlink `/etc/hosts` trên Windows vẫn trả `SHOPIFY_USER_ERROR` thay vì `SHOPIFY_SECURITY_ERROR`, nên lệnh tổng dừng trước khi chạy engine; engine đã được chạy riêng ở trên.

### Chạy thử Amazon thật: `B0FY3HS8JT` (28/09/2026)

Chạy headless với ZIP `90001`, cache tách biệt, không tạo export hoặc đồng bộ Shopify. Nội dung của các child được lấy từ Amazon thật; để kiểm tra nhánh partial một cách lặp lại được, test **giả lập** lỗi parser cho `B0FY3LSRGK` và lỗi mạng cho `B0FY3FX3SN` trước khi gửi request của hai child đó.

| Lượt | Kết quả | Request trang sản phẩm | Cache |
| --- | --- | --- | --- |
| Đầu | `partial`: 10 hoàn chỉnh, 2 lỗi; 1 retry được, 1 không retry được | Parent và các child còn lại | Partial cache khớp cả bốn danh sách của output. |
| Retry lỗi mạng | `partial`: 11 hoàn chỉnh, chỉ còn child parser không retry được | Chỉ `B0FY3FX3SN` | Partial cache được ghép và cập nhật; child thành công không bị tải lại. |
| Retry lỗi parser có chủ đích | `completed`: 12 hoàn chỉnh, không còn lỗi | Chỉ `B0FY3LSRGK` | Family cache hoàn chỉnh được ghi; partial cache được xóa. |

Để chạy ba lượt liên tiếp mà không đợi cooldown, test chủ động xóa negative cache **riêng child sắp retry** trước lượt hai và ba. Trong vận hành bình thường, lỗi mạng phải chờ `retryAfter`; lỗi parser không tự retry và cần được kiểm tra hoặc vô hiệu hóa cache có chủ đích.

## Giới hạn vận hành

- Bốn danh sách chỉ bao gồm ASIN đã được phát hiện trong variant matrix. Nếu matrix còn thiếu, các ASIN chưa tìm thấy chưa thể xuất hiện trong danh sách; family vẫn có thể ở trạng thái partial.
- Partial/checkpoint cache nằm trên agent. Nếu coordinator chuyển task sang agent khác, agent mới không có dữ liệu cục bộ để ghép và có thể phải crawl lại.
- Bài thử Amazon thật đã giả lập lỗi để kiểm tra luồng xử lý; nó không chứng minh Amazon đã trả lỗi parser hoặc mạng cho hai child đó trong thực tế.
