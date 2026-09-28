# Thêm Custom GPT cho store mới

Mỗi store dùng chung domain, schema và hướng dẫn, nhưng phải có một Bearer Action Key riêng.

## 1. Chuẩn bị

- Store ID, ví dụ `jeminise`.
- Quyền SSH vào VPS.
- Quyền tạo hoặc chỉnh sửa GPT.

Lưu ý: store xuất hiện trong dropdown FFP Tool có thể chỉ là dữ liệu mẫu. Muốn đồng bộ Shopify, store còn phải được đăng ký trong Shopify Gateway.

## 2. Sao lưu và tạo key

Đăng nhập VPS rồi chạy:

```bash
cd /opt/ffp-tool
cp .env ".env.backup-gpt-$(date +%Y%m%d-%H%M%S)"
openssl rand -hex 32
```

Lưu key vừa tạo vào password manager. Không gửi key qua chat, ảnh chụp hoặc Git.

## 3. Thêm store vào `.env`

```bash
nano /opt/ffp-tool/.env
```

Lấy chính xác key Capozen hiện tại từ `GPT_SEO_ACTION_KEY`, rồi thêm một dòng:

```dotenv
GPT_SEO_ACTION_KEYS_JSON={"capozen":"<key-capozen-hien-tai>","jeminise":"<key-moi>"}
```

Thay `jeminise` bằng Store ID thực tế. JSON phải nằm trên một dòng, không có dấu phẩy thừa và mỗi store phải dùng key khác nhau.

Khi biến JSON tồn tại, nó được ưu tiên hoàn toàn. Nếu chép sai key Capozen, GPT Capozen cũ sẽ nhận `401`.

## 4. Khởi động lại

```bash
cd /opt/ffp-tool
CURRENT_IMAGE="$(docker inspect --format '{{.Config.Image}}' ffp-tool-app)"
export DOCKER_IMAGE="$CURRENT_IMAGE"
export APP_PORT=3010

docker compose -f compose.prod.yaml config -q
docker compose -f compose.prod.yaml up -d --force-recreate app
docker compose -f compose.prod.yaml ps
```

Container phải chuyển sang `healthy`. Kiểm tra domain:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://ffp.b6-team.site/health
```

Kết quả phải là `200`.

## 5. Tạo GPT cho store mới

Trong **My GPTs**, nhân bản GPT Capozen rồi:

1. Đổi tên, ví dụ `Jeminise SEO Queue`.
2. Giữ nguyên Instructions và file Knowledge.
3. Giữ nguyên OpenAPI schema và domain `https://ffp.b6-team.site`.
4. Trong Action authentication, chọn **API Key → Bearer**.
5. Nhập key của store mới và lưu GPT.

## 6. Kiểm tra

Trong GPT mới, gửi:

```text
Đọc store SEO context và trạng thái queue hiện tại.
```

Kết quả phải trả đúng Store ID mới. Kiểm tra lại GPT Capozen để chắc chắn GPT cũ vẫn hoạt động.

- `401`: sai key hoặc container chưa nạp cấu hình mới.
- `403 STORE_FORBIDDEN`: GPT đang dùng key của store khác.
- `502`: kiểm tra Docker và Nginx đều dùng cổng `3010`.

Nếu có lỗi, khôi phục file `.env.backup-gpt-*` rồi tạo lại container bằng lệnh ở bước 4.

Xem hướng dẫn đầy đủ ban đầu tại [setup.md](setup.md).
