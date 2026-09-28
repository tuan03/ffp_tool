# Thêm Custom GPT cho store mới

Mỗi store dùng chung domain, schema và hướng dẫn, nhưng phải có một Bearer Action Key riêng.

## 1. Chuẩn bị thông tin

Bước này xác định GPT mới sẽ làm việc cho store nào và bảo đảm bạn có quyền cấu hình cả server lẫn GPT Builder.

- **Store ID**, ví dụ `jeminise`: mã này dùng để tách queue và dữ liệu SEO giữa các store.
- **Quyền SSH vào VPS**: cần để thêm Action Key vào cấu hình server.
- **Quyền chỉnh sửa GPT**: cần để gắn key mới vào GPT của store.

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

Bước này kiểm tra cấu hình rồi tạo lại container để server nạp map Action Key mới. Dữ liệu queue vẫn nằm trong volume, không bị xóa.

```bash
cd /opt/ffp-tool

# Lấy đúng image mà container hiện tại đang sử dụng.
CURRENT_IMAGE="$(docker inspect --format '{{.Config.Image}}' ffp-tool-app)"
export DOCKER_IMAGE="$CURRENT_IMAGE"

# Giữ Docker cùng cổng 3010 mà Nginx đang chuyển tiếp tới.
export APP_PORT=3010

# Kiểm tra file Compose trước khi restart.
docker compose -f compose.prod.yaml config -q

# Tạo lại riêng dịch vụ app để nạp .env mới.
docker compose -f compose.prod.yaml up -d --force-recreate app

# Xem container đã chạy và chuyển sang healthy hay chưa.
docker compose -f compose.prod.yaml ps
```

Container phải chuyển sang `healthy`. Lệnh sau gọi health endpoint qua domain công khai:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://ffp.b6-team.site/health
```

Kết quả phải là `200`.

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
