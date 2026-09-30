# Thêm một máy Codex xử lý SEO

## Trên VPS

- Deploy phiên bản code mới nhất của nhánh `rua`.
- Tạo token riêng cho máy mới: `openssl rand -hex 32`.
- Sửa biến môi trường, giữ nguyên các máy đang có và thêm máy mới:
  `GPT_SEO_MCP_KEYS_JSON={"capozen":{"may-cua-toi":"TOKEN_CU","may-ban":"TOKEN_MOI"}}`
- Khởi động lại dịch vụ: `bash /opt/ffp-tool/scripts/restart-gpt-seo.sh`.
- Không gửi `TOKEN_MOI` cho máy nào khác ngoài máy bạn.

## Trên máy bạn

- Cài token: `setx FFP_SEO_MCP_TOKEN "TOKEN_MOI"`.
- Thêm vào `%USERPROFILE%\.codex\config.toml`:
  ```toml
  [mcp_servers.ffpSeo]
  url = "https://ffp.b6-team.site/mcp/gpt-seo"
  bearer_token_env_var = "FFP_SEO_MCP_TOKEN"
  ```
- Đóng và mở lại Codex/IDE.
- Yêu cầu Codex: `Dùng MCP ffpSeo xử lý toàn bộ batch đến REVIEW_READY, không publish Shopify.`
