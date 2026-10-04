# FFP SEO Agent Pack — preview

This helper does not generate SEO or call a paid OpenAI API. It forwards MCP over
HTTPS and maintains a bounded heartbeat. Store cutover remains disabled until the
full worker/publish acceptance tests and an operator-selected pilot pass.

## Install

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

Use `status` to check the token and `logout` to remove its local vault entry.
Logout does not revoke other copies: use Agent Access → Revoke for that.

## Build and evidence

From the repository root run `python scripts/build-seo-agent-pack.py`. Output is
an allowlisted ZIP and SHA-256 file under ignored `dist/seo-agent-pack/`.
Do not redistribute a modified pack containing local config, backups or secrets.

Automated tests cover helper logic using temporary workspaces and mocked vaults.
They are not proof of actual Windows/macOS/Linux credential round trips or two
real Codex sessions. Those acceptance checks remain required before rollout.

Configuration references: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli),
[Codex skills](https://learn.chatgpt.com/docs/build-skills),
[keyring OS backends](https://keyring.readthedocs.io/en/latest/).
