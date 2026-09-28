# Thêm Custom GPT SEO cho một store mới

Tài liệu này hướng dẫn tạo một Custom GPT SEO riêng cho store mới mà không làm mất kết nối của GPT đang dùng. Mỗi GPT dùng chung domain, OpenAPI schema, Instructions và Knowledge, nhưng phải có Bearer Action Key riêng.

## 1. Phân biệt hai loại kết nối

- **Kết nối Shopify Gateway** cho phép FFP Tool đọc và ghi dữ liệu Shopify. Việc một store xuất hiện trong danh sách mẫu trên giao diện không chứng minh store đã được đăng ký trên VPS.
- **Kết nối Custom GPT** cho phép GPT truy cập đúng SEO queue của store thông qua một Action Key riêng.

Muốn chạy toàn bộ quy trình đến bước đồng bộ Shopify, store cần cả hai kết nối. Nếu chỉ cấu hình Custom GPT, GPT có thể đọc queue nhưng bước đồng bộ Shopify vẫn thất bại khi Gateway chưa biết store.

## 2. Thông tin cần chuẩn bị

- Store ID ổn định, viết bằng chữ, số, `_` hoặc `-`, ví dụ `jeminise`.
- Shopify domain, ví dụ `b6-theme-test.myshopify.com`.
- Shopify Client ID và Client Secret, hoặc Admin API access token, nếu store chưa được đăng ký với Gateway.
- Quyền SSH vào VPS.
- Quyền chỉnh sửa Custom GPT trong ChatGPT.

Không gửi Action Key, Shopify credential, `GATEWAY_AUTH_TOKEN` hoặc file PEM qua chat, ảnh chụp màn hình hay Git.

## 3. Xác nhận store đã được đăng ký với Shopify Gateway

Dropdown của Amazon Crawler hiện có thể chứa store mẫu. Kiểm tra registry thật trên VPS:

```bash
ssh -i /duong-dan/toi/wrydeco-vps_key.pem azureuser@20.222.21.81
cd /opt/ffp-tool

ADMIN_KEY="$(docker exec ffp-tool-app printenv GATEWAY_AUTH_TOKEN)"
curl -sS \
  -H "Content-Type: application/json" \
  -H "X-Gateway-Key: $ADMIN_KEY" \
  -d '{"operation":"stores.list","payload":{}}' \
  http://127.0.0.1:3010/api/shopify
unset ADMIN_KEY
```

Store phải xuất hiện trong `data.stores`. Nếu chưa có, hãy hoàn tất quy trình đăng ký Shopify store trước khi chạy đồng bộ sản phẩm. Không dùng Action Key thay cho Shopify credential; hai loại key có mục đích khác nhau.

## 4. Sao lưu cấu hình VPS

```bash
cd /opt/ffp-tool
cp .env ".env.backup-gpt-store-$(date +%Y%m%d-%H%M%S)"
chmod 600 .env
```

Ghi lại tên file backup được tạo. Không sao chép nội dung `.env` vào tài liệu hoặc tin nhắn.

## 5. Tạo Action Key riêng cho store mới

Tạo một secret ngẫu nhiên:

```bash
openssl rand -hex 32
```

Sao chép kết quả vào password manager ngay. Secret chỉ dùng cho GPT của store mới và phải khác:

- key của mọi store khác;
- `GATEWAY_AUTH_TOKEN`;
- Shopify Client Secret hoặc Admin API token.

## 6. Chuyển cấu hình legacy sang multi-store

Mở file cấu hình:

```bash
nano /opt/ffp-tool/.env
```

Nếu VPS đang dùng cấu hình cũ:

```dotenv
GPT_SEO_ACTION_KEY=<key-capozen-hien-tai>
GPT_SEO_STORE_ID=capozen
```

thì thêm map mới, trong đó key Capozen phải được chép chính xác từ cấu hình hiện tại:

```dotenv
GPT_SEO_ACTION_KEYS_JSON={"capozen":"<key-capozen-hien-tai>","jeminise":"<key-jeminise-moi>"}
```

Thay `jeminise` bằng Store ID thực tế. JSON phải nằm trên một dòng, dùng dấu ngoặc kép, không có dấu phẩy thừa và không được dùng cùng một key cho hai store.

Khi `GPT_SEO_ACTION_KEYS_JSON` tồn tại, server ưu tiên hoàn toàn map này. `GPT_SEO_ACTION_KEY` cũ không còn là fallback đang hoạt động. Vì vậy một key Capozen bị chép sai sẽ làm GPT Capozen nhận `401`, dù dòng legacy vẫn còn trong file.

Tạm thời giữ hai dòng legacy để hỗ trợ rollback. Chỉ xóa chúng sau khi cả GPT cũ và GPT mới đều vượt qua kiểm thử.

## 7. Kiểm tra cấu hình và tạo lại container

Giữ cổng cố định để Nginx và Docker không lệch nhau:

```dotenv
APP_PORT=3010
GPT_SEO_PUBLIC_URL=https://ffp.b6-team.site
```

Sau đó chạy:

```bash
cd /opt/ffp-tool

CURRENT_IMAGE="$(docker inspect --format '{{.Config.Image}}' ffp-tool-app)"
export DOCKER_IMAGE="$CURRENT_IMAGE"
export APP_PORT=3010

docker compose -f compose.prod.yaml config -q
docker compose -f compose.prod.yaml up -d --force-recreate app
docker compose -f compose.prod.yaml ps
```

Đợi container hiện `healthy`, rồi kiểm tra domain:

```bash
curl -sS -o /dev/null -w 'root=%{http_code}\n' https://ffp.b6-team.site/
curl -sS -o /dev/null -w 'health=%{http_code}\n' https://ffp.b6-team.site/health
curl -sS -o /dev/null -w 'without_key=%{http_code}\n' https://ffp.b6-team.site/api/v1/gpt-seo/capabilities
```

Kết quả mong đợi:

- `root=200`;
- `health=200`;
- `without_key=401`.

## 8. Kiểm tra từng Action Key mà không ghi key vào history

Kiểm tra GPT cũ trước:

```bash
read -rsp 'Capozen Action Key: ' ACTION_KEY; echo
curl -sS \
  -H "Authorization: Bearer $ACTION_KEY" \
  https://ffp.b6-team.site/api/v1/gpt-seo/context
unset ACTION_KEY
```

Response phải có `"storeId":"capozen"`.

Sau đó kiểm tra store mới:

```bash
read -rsp 'New store Action Key: ' ACTION_KEY; echo
curl -sS \
  -H "Authorization: Bearer $ACTION_KEY" \
  https://ffp.b6-team.site/api/v1/gpt-seo/context
unset ACTION_KEY
```

Response phải trả đúng Store ID mới. Dừng lại và rollback nếu key Capozen cũ không còn hoạt động.

## 9. Tạo Custom GPT cho store mới

Trong ChatGPT, mở **My GPTs** rồi nhân bản GPT SEO hiện có hoặc tạo GPT mới:

1. Đặt tên theo store, ví dụ `Jeminise SEO Queue`.
2. Dùng lại nội dung [gpt-instructions.md](gpt-instructions.md) trong Instructions.
3. Tải lại [seo-knowledge.md](seo-knowledge.md) vào Knowledge.
4. Dùng lại OpenAPI schema đã export cho `https://ffp.b6-team.site`.
5. Trong Action authentication, chọn **API Key** và **Bearer**.
6. Nhập Action Key của store mới, không dùng key Capozen hoặc `GATEWAY_AUTH_TOKEN`.
7. Lưu GPT ở chế độ riêng tư phù hợp với đội vận hành.

Không cần đổi domain hoặc tạo OpenAPI schema khác cho từng store. Bearer key là thành phần quyết định GPT được phép truy cập store nào.

## 10. Kiểm thử trong GPT Builder

Chạy lần lượt:

1. `Kiểm tra capabilities của SEO queue.`
2. `Đọc store SEO context.`
3. `Cho tôi xem trạng thái queue hiện tại.`

Xác nhận:

- context trả đúng Store ID mới;
- batch size và ngôn ngữ đúng cấu hình store;
- GPT mới không thể yêu cầu dữ liệu của store khác;
- yêu cầu chéo store trả `403 STORE_FORBIDDEN`;
- không có thao tác publish Shopify trong danh sách Actions.

Sau đó gửi một sản phẩm thử nghiệm vào queue, xử lý một batch và dừng ở `REVIEW_READY`. Chỉ đồng bộ Shopify sau khi con người đã kiểm tra và phê duyệt.

## 11. Đổi hoặc thu hồi Action Key

Mỗi store hiện có một Action Key đang hoạt động. Để đổi key:

1. Tạo key mới bằng `openssl rand -hex 32`.
2. Chuẩn bị sẵn trang cấu hình Action của GPT.
3. Thay giá trị của store trong `GPT_SEO_ACTION_KEYS_JSON`.
4. Tạo lại container.
5. Cập nhật Bearer key trong GPT Builder.
6. Kiểm tra context và queue.

Key cũ mất hiệu lực ngay khi container mới chạy. Hệ thống hiện không có thời gian chuyển tiếp cho hai key cùng một store.

Để thu hồi hoàn toàn, xóa entry của store khỏi JSON rồi tạo lại container. Không để map rỗng `{}` vì cấu hình đó bị từ chối. Nếu muốn tắt toàn bộ Custom GPT Actions, xóa cả cấu hình multi-store và các biến legacy, sau đó restart dịch vụ.

## 12. Rollback

Nếu domain trả `502`, container không healthy hoặc GPT cũ nhận `401`, khôi phục file backup:

```bash
cd /opt/ffp-tool
cp .env.backup-gpt-store-YYYYMMDD-HHMMSS .env
chmod 600 .env

CURRENT_IMAGE="$(docker inspect --format '{{.Config.Image}}' ffp-tool-app)"
export DOCKER_IMAGE="$CURRENT_IMAGE"
export APP_PORT=3010
docker compose -f compose.prod.yaml up -d --force-recreate app
```

Thay tên backup bằng file thực tế đã tạo ở bước 4. Sau rollback, kiểm tra lại `/health` và GPT Capozen.

## 13. Lỗi thường gặp

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
| --- | --- | --- |
| `401 UNAUTHORIZED` | Sai Bearer key hoặc map JSON chưa được nạp | Kiểm tra đúng entry store và tạo lại container |
| `403 STORE_FORBIDDEN` | Key hợp lệ nhưng yêu cầu store khác | Dùng GPT/key thuộc đúng store |
| Domain trả `502` | Nginx và Docker dùng khác cổng | Xác nhận Docker publish `127.0.0.1:3010` và Nginx proxy tới `3010` |
| Container restart liên tục | JSON sai cú pháp, key trùng hoặc key trùng admin token | Khôi phục backup, sửa JSON rồi chạy `docker compose config -q` |
| Store có trong dropdown nhưng Shopify báo `Store not found` | Giao diện đang hiển thị store mẫu | Kiểm tra `stores.list` và đăng ký store trong Gateway |
| Queue hoạt động nhưng sync Shopify thất bại | Có GPT key nhưng chưa có Shopify credential | Hoàn tất đăng ký Shopify Gateway cho store |

Xem thêm [setup.md](setup.md) để cấu hình lần đầu và [validation.md](validation.md) để kiểm tra toàn bộ workflow.
