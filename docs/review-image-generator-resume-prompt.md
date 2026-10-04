# Prompt to resume this task in a new session

First change the workspace/terminal directory to:

```text
D:\Shopify_Workspace\Tool\ffp_tool-review-image-worktree
```

Then paste this prompt into the new session:

```text
Tiếp tục task tích hợp tính năng Tạo ảnh review vào repo FFP Tool gốc. Tôi đang làm việc trong linked worktree D:\Shopify_Workspace\Tool\ffp_tool-review-image-worktree, thuộc cùng repo với D:\Shopify_Workspace\Tool\ffp_tool, trên nhánh feature/main-add-review-image-generator. Đây không phải thư mục Tool_crawer_New_update.

Trước khi làm gì, hãy đọc AGENTS.md, docs/review-image-generator-handoff.md, docs/superpowers/specs/2026-09-29-review-image-generator-design.md, docs/superpowers/plans/2026-09-29-review-image-generator.md và phần Review image generator trong README.md. Sau đó kiểm tra git branch --show-current, git status --short, git log -5 --oneline và các port 5175/8770. Hãy báo ngắn gọn trạng thái thực tế, đừng giả định service vẫn chạy.

Tính năng và kiểm thử đã được commit tới 0f763a5. Đừng áp lại hai stash "review-image WIP" vì nội dung đã ở trên nhánh này. Đừng checkout/reset/merge vào thư mục ffp_tool gốc đang phục vụ nhánh Amazon Reviews, và đừng push hay tạo PR khi tôi chưa chọn cách tích hợp.

Ưu tiên tiếp theo là giúp tôi test một lần tạo ảnh THẬT bằng extension Chrome và tab ChatGPT đã đăng nhập: hướng dẫn import extension ở browser-extension/review-image, kiểm tra kết nối Bridge, upload ảnh sản phẩm, xem ảnh kết quả, xác nhận nền/template đúng và sản phẩm cũ đã bị xóa. Phân biệt rõ kết quả test thật với các smoke test dùng ảnh giả đã làm trước đó. Nếu gặp lỗi, chẩn đoán bằng bằng chứng rồi mới sửa; chạy lại test liên quan và ghi rõ thay đổi. Cuối cùng hỏi tôi chọn merge vào main, tạo PR, hay giữ nhánh.
```

If the new session starts outside the repository, run this in PowerShell first:

```powershell
Set-Location 'D:\Shopify_Workspace\Tool\ffp_tool-review-image-worktree'
git branch --show-current
```
