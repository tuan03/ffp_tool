# Thêm Custom GPT cho store mới

Mỗi store dùng chung domain, schema và hướng dẫn, nhưng phải có một Bearer Action Key riêng.

## 1. Chuẩn bị thông tin

Bước này xác định GPT mới sẽ làm việc cho store nào và bảo đảm bạn có quyền cấu hình cả server lẫn GPT Builder.

- **Store ID**, ví dụ `jeminise`: mã này dùng để tách queue và dữ liệu SEO giữa các store.
- **Quyền SSH vào VPS**: cần để thêm Action Key vào cấu hình server.
- **Quyền chỉnh sửa GPT**: cần để gắn key mới vào GPT của store.

Mở PowerShell trên Windows và đăng nhập VPS bằng lệnh:

```powershell
ssh -i "D:\all_about_shopify\tools\ffp_tool\wrydeco-vps_key.pem" azureuser@20.222.21.81
```

Nếu được hỏi xác nhận máy chủ trong lần đầu kết nối, nhập `yes`. Đăng nhập thành công khi dòng lệnh bắt đầu bằng `azureuser@wrydeco-vps`.

Lưu ý: store xuất hiện trong dropdown FFP Tool có thể chỉ là dữ liệu mẫu. Muốn đồng bộ Shopify, store còn phải được đăng ký trong Shopify Gateway.

## 2. Sao lưu và tạo key

Bước này tạo bản phục hồi trước khi sửa cấu hình và tạo mật khẩu riêng cho GPT mới. Sau khi đăng nhập VPS, chạy:

```bash
# Đi tới thư mục đang chạy FFP Tool.
cd /opt/ffp-tool

# Sao lưu .env để có thể khôi phục nếu cấu hình mới bị lỗi.
cp .env ".env.backup-gpt-$(date +%Y%m%d-%H%M%S)"

# Tạo một Action Key ngẫu nhiên dài 64 ký tự.
openssl rand -hex 32
```

Lưu key vừa tạo vào password manager. Không gửi key qua chat, ảnh chụp hoặc Git.

## 3. Thêm store vào `.env`

Bước này khai báo key nào được phép truy cập queue của store nào.

```bash
# Mở file cấu hình bằng trình soạn thảo nano.
nano /opt/ffp-tool/.env
```

Lấy chính xác key Capozen hiện tại từ `GPT_SEO_ACTION_KEY`, rồi thêm một dòng:

```dotenv
GPT_SEO_ACTION_KEYS_JSON={"capozen":"<key-capozen-hien-tai>","jeminise":"<key-moi>"}
```

Thay `jeminise` bằng Store ID thực tế. JSON phải nằm trên một dòng, không có dấu phẩy thừa và mỗi store phải dùng key khác nhau.

Khi biến JSON tồn tại, nó được ưu tiên hoàn toàn. Nếu chép sai key Capozen, GPT Capozen cũ sẽ nhận `401`.

## 4. Khởi động lại

Bước này chạy script có sẵn để kiểm tra cấu hình, tạo lại container, chờ server hoạt động và kiểm tra website. Dữ liệu queue vẫn nằm trong volume, không bị xóa.

```bash
bash /opt/ffp-tool/scripts/restart-gpt-seo.sh
```

Script tự lấy Docker image hiện tại, dùng cổng `3010`, kiểm tra Compose và chỉ báo thành công khi website trả `HTTP 200`. Nếu có lỗi, script dừng ngay và hiển thị bước bị lỗi.

## 5. Tạo GPT cho store mới

Bước này tạo một GPT riêng nhưng tái sử dụng toàn bộ quy trình SEO đã cấu hình cho Capozen.

Trong **My GPTs**, nhân bản GPT Capozen rồi:

1. Đổi tên, ví dụ `Jeminise SEO Queue`, để người vận hành không chọn nhầm store.
2. Giữ nguyên Instructions và Knowledge vì các store dùng cùng quy trình SEO.
3. Giữ nguyên OpenAPI schema và domain `https://ffp.b6-team.site` vì tất cả GPT gọi cùng server.
4. Chọn **API Key → Bearer**, nhập key mới và lưu GPT. Bearer key sẽ xác định store mà GPT được phép đọc.

## 6. Kiểm tra

Bước này xác nhận GPT đang dùng đúng key và không đọc nhầm queue của store khác.

Trong GPT mới, gửi:

```text
Đọc store SEO context và trạng thái queue hiện tại.
```

Kết quả phải trả đúng Store ID mới. Sau đó gửi cùng yêu cầu trong GPT Capozen; nó phải tiếp tục trả `capozen`.

- `401`: sai key hoặc container chưa nạp cấu hình mới.
- `403 STORE_FORBIDDEN`: GPT đang dùng key của store khác.
- `502`: kiểm tra Docker và Nginx đều dùng cổng `3010`.

Nếu có lỗi, khôi phục file `.env.backup-gpt-*` rồi tạo lại container bằng lệnh ở bước 4.

Xem hướng dẫn đầy đủ ban đầu tại [setup.md](setup.md).
