# FFP SEO Agent Pack — preview

This helper does not generate SEO or call a paid OpenAI API. It forwards MCP over
HTTPS and maintains a bounded heartbeat. Store cutover remains disabled until the
full worker/publish acceptance tests and an operator-selected pilot pass.

## Install

One login and one `ffp_seo_worker` connection provide Queue drafts and SEO
Performance reports, evidence, URL inspection and saved recommendations for the
selected authorized store. New Agent Access tokens include all currently registered
stores; older tokens keep their previous grants. Ask Codex for a named store and it
uses `worker_status` / `worker_select_store` without another login or installation.
Stores are processed sequentially; switching is blocked during an active run/job.
Do not share one token between concurrent Codex sessions. Adding a store after token
issuance requires a new token/login, not another install. No second MCP connection or worker-side Google credentials are
required. Google must still be connected and mapped by an operator in FFP.
Existing unexpired worker tokens gain these tools after the server upgrade;
restart Codex to refresh tool discovery. No approval, publishing or admin access
is granted. Existing legacy MCP connections remain compatible and are not removed.

For updated guidance, replace the installed `.agents/skills/ffp-seo/SKILL.md` with
the ZIP's `skill/SKILL.md` after reviewing any local customizations. Do not rerun
setup over an existing configuration or overwrite other MCP entries.

### Quickstart (Tự động 1-click)

1. **Windows**: Click đúp vào file `cai-dat.bat` (hoặc `setup.bat`).
2. **macOS / Linux**: Mở terminal, chạy `bash cai-dat.sh` (hoặc `bash setup.sh`).

Script sẽ tự động:
- Kiểm tra Python 3.11+.
- Khởi tạo môi trường ảo `.venv` và cài đặt `requirements.txt`.
- Đăng nhập lưu token vào kho mật khẩu bảo mật của hệ điều hành (Windows Credential Manager / macOS Keychain / Linux Secret Service).
- Tự động thêm MCP server và Skill vào Codex Workspace.

---

### Manual Install (Thủ công từng bước)

Dành cho người muốn kiểm soát từng bước bằng lệnh terminal:

Use Python 3.11+ in a dedicated virtual environment. Keep this extracted folder
at a stable absolute path; Codex configuration references it.

```text
python -m venv .venv
```

On Windows use `.venv\Scripts\python.exe` for the following commands. On macOS
and Linux use `.venv/bin/python` (or activate the environment first).

```text
python -m pip install -r requirements.txt
python ffp_worker.py doctor --endpoint https://ffp.b6-team.site/mcp/seo-worker
python ffp_worker.py login --endpoint https://ffp.b6-team.site/mcp/seo-worker --profile my-machine
python ffp_worker.py setup --endpoint https://ffp.b6-team.site/mcp/seo-worker --profile my-machine --workspace /absolute/workspace
```

Create a token in SEO Queue → Agent Access first. Paste it only at the hidden
terminal prompt, never in CLI arguments or chat. Supported vaults are Windows
Credential Manager, macOS Keychain and Linux Secret Service. Linux needs an unlocked
Secret Service in its D-Bus session. No plaintext or environment-variable fallback
is accepted. `doctor` checks local prerequisites, not end-to-end acceptance.

Setup adds `.codex/config.toml` and `.agents/skills/ffp-seo` to the chosen workspace,
preserves other MCP servers, backs up an existing config, and refuses an existing
FFP entry. It does not modify `AGENTS.md`. Restart Codex in the trusted workspace.

```text
Use $ffp-seo. Verify the credential's store is jeminise-real, then process 5
successful Review drafts. Never approve or sync Shopify. If interrupted, report
the run ID and completed/target count so I can resume that run.
```

For resume, provide the previous run ID, not a fresh target. The helper cannot
bypass Codex quota, approvals or application shutdown. After 30 minutes without
checkpoint progress it stops heartbeats; network/auth failures also stop them.
Retry a mutation with the exact same requestId and payload, not a new requestId.
Transport retries are limited to three attempts for replayable requests. HTTP 401
is not retried. Retry-After above 120 seconds stops safely for a later resume.
Read `ffp://seo-worker/contracts` for current schemas/rules; `resources/` contains
the matching build-time copies. Current job context supplies store-specific rules.

Use `status` to check the token and `logout` to remove its local vault entry.
Logout does not revoke other copies: use Agent Access → Revoke for that.

### Login transport diagnostics

The helper identifies itself as `FFP-SEO-Worker/1.0` on HTTPS requests. Some
Cloudflare policies reject Python's default urllib signature before the request
reaches FFP. HTTP 403 indicates an access-policy rejection (inspect WAF/server
rules); HTTP 401 indicates rejected authentication. Neither requires reinstalling
Python. Network/TLS failures are reported separately. Diagnostics never print
tokens, HTTP response bodies, or third-party exception text. `doctor` checks local
prerequisites only; successful login is still required to verify a real token.

## Build and evidence

Web production/mock builds package this automatically. To package independently,
run `node scripts/build-seo-agent-pack.mjs` (Node 22.15+); the previous Python
entry point remains a wrapper. Output is
an allowlisted ZIP and SHA-256 file under ignored `dist/seo-agent-pack/`.
Do not redistribute a modified pack containing local config, backups or secrets.

Automated tests cover helper logic using temporary workspaces and mocked vaults.
They are not proof of actual Windows/macOS/Linux credential round trips or two
real Codex sessions. Those acceptance checks remain required before rollout.

### Real vault probe and two-machine acceptance

Run `python test_vault_live.py` with the virtual-environment interpreter on each OS.
This opt-in probe writes a random temporary credential, reads it back and deletes
only that entry. It never reads an FFP token and never prints the test secret.
A missing/locked/unsupported vault is a failed prerequisite, not a plaintext fallback.
The Windows Credential Manager probe passed on 2026-10-04. macOS Keychain and Linux
Secret Service still need an interactive OS session; container helper tests do not
prove vault integration.

For two-machine acceptance, after a reviewed staging/cutover deployment:

1. Record pack checksum, OS, Python and Codex versions on each machine. Use distinct
   machine names and separate store-scoped tokens. Do not include tokens in evidence.
2. Run doctor, the vault probe, login, setup and status. Open Codex in the configured
   trusted workspace and verify the FFP MCP connection before starting a run.
3. Enqueue two or more synthetic/test products explicitly. Start one run per machine
   with target 1; record run/job IDs. Verify different jobs, at most one lease per
   worker, two validated Review drafts, and no Shopify writes.
4. Interrupt one session after a checkpoint; verify expiry/recovery and stale-lease
   refusal. Resume its run, not a new target. Record the final successful/target counts.
5. Revoke a token while its worker is active; verify the next mutation fails. Logout
   on each machine and verify status no longer finds the local credential.
6. A human reviews the draft before the separate pilot Sync. Compare the intended
   fields and `custom.seo_version` before/after; vendor, handle, prices and variants
   must remain unchanged. Do not simulate a production failure by blind repeat writes.

Attach actual run/job IDs and redacted observations to the acceptance report. Two
test processes or two mocked sessions are not two physical Codex machines.

Configuration references: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
[Codex skills](https://learn.chatgpt.com/docs/build-skills),
[keyring OS backends](https://keyring.readthedocs.io/en/latest/).
