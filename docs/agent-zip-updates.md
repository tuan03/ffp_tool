# Windows Agent signed ZIP updates

## Scope and trust

Agent 5.3.0 introduces portable ZIP updates. Authenticode is not required for
this channel: an embedded Ed25519 public key verifies the signed manifest, which
binds version, protocol, minimum Coordinator version, ZIP URL, SHA-256 and size.
Windows can still warn about an unknown publisher. This is not an Authenticode
installer and does not remove Windows warnings.

The initial transition from older Agents requires installing/extracting the new
ZIP once, keeping the existing configuration and data directory. Thereafter the
tray's **Update and restart** action downloads and installs the new ZIP; users do
not need to extract every release manually. Legacy installer scripts retain their
existing Authenticode policy; they are not bypassed by this change.

Implementation is on `cua_pro` at the user's explicit request (branch-name
exception to the handbook). No production deployment or release publication is
part of this change.

## Release setup (required before real updates work)

1. Store the Ed25519 seed as GitHub Actions secret
   `FFP_AGENT_RELEASE_PRIVATE_KEY` (base64, 32 raw bytes). Set repository variable
   `FFP_AGENT_RELEASE_KEY_ID` to the matching entry in `release_trust.py`.
   Never place a private key in Git, a manifest, browser environment or Agent ZIP.
2. Keep the public key embedded in both Coordinator and Agent. A local signing
   key can be created using `scripts/publish-agent-zip.py --generate-key <path>
   --key-id <id>`. The file is encrypted with Windows user-scoped DPAPI: copying
   the file alone to another user/computer is not a usable backup. Arrange a
   secure recoverable backup before production publication. Do not regenerate
   the key for every release; key rotation needs an overlap release trusted by
   the previous key before retiring it.
3. Configure `FFP_AGENT_RELEASE_MANIFEST_URL` on the server with the public HTTPS
   URL of `latest-zip.json`. The root Compose passes `.env` to the server.
   Remove any old `VITE_AMAZON_CRAWLER_RELEASE_API_URL` GitHub API override to
   use the default `/api/v1/agent-release` for web and Agent alike.
4. The default publishing workflow uses this repository's GitHub Releases.
   **Private-repository release URLs will not work for anonymous clients.** Use
   an approved public release repository or HTTPS artifact host if the source
   repository is private. Do not embed a GitHub PAT in Agent downloads.
   `--release-base-url` can select an HTTPS host whose path layout is
   `<base>/agent-v<version>/<zip-name>`; publish the ZIP, checksum and signed
   manifest to those exact paths. This alternate publication needs configuration,
   not a change to the embedded trust key.
5. Deploy a compatible Coordinator before advertising a new Agent. After QA,
   bump `AGENT_VERSION` and explicitly publish tag `agent-vX.Y.Z`. The workflow
   builds, signs, verifies, uploads a draft, then promotes it. A normal push to
   main does not publish an Agent release.

Local build/sign (no publication):

```powershell
npm run build:agent
python scripts/publish-agent-zip.py --key-id <id> --key-file <DPAPI-file>
```

Artifacts: `installer-output/FFP-Amazon-Crawler-X.Y.Z-windows-x64.zip`,
matching `.sha256`, and `latest-zip.json`. The ZIP includes a safe example
`agent.json` for new installs; the updater never overwrites existing `agent.json`.

## Runtime behavior

- Coordinator fetches and verifies the signed catalog, caches success for five
  minutes and failures for 30 seconds. Missing/invalid/unreachable releases give
  HTTP 503. Neither web nor Agent treats source-code version as a published release.
- Agent checks on startup and every 30 minutes. Updates require a user action;
  incompatible/downgrade releases are rejected before downloading/installing.
- Download completes and passes signature/checksum/ZIP path validation before
  admission is closed. Existing tasks finish; assignments and outbox must be
  empty and the server connected. No timeout discards unsent results.
- The current Agent is persisted paused. A separate copied helper verifies and
  stages the release before telling the Agent to exit. If helper preparation
  fails, the existing Agent is not terminated.
- Only `FFPAmazonCrawlerAgent.exe` and `_internal` are swapped. Config, client
  identity, server-scoped data, command ledger and profiles remain in place.
  SQLite is backed up under the data-directory instance lock.
- An offline startup probe checks version, identity, paused state and database
  integrity. Ordinary swap/probe failure restores the old runtime and database.
  A passing installation starts paused and waits for connectivity. Network outage
  alone does not roll back a valid runtime. Resume explicitly after verification.
- Server-triggered authenticated UPDATE_AGENT retains its existing DRAIN and ACK
  command workflow and uses the same ZIP verifier when ZIP trust is installed.

## Recovery and acceptance limits

The helper writes `status.json`, `updater.log`, `plan.json` and a database backup
in `%TEMP%/ffp-zip-update-*`. Previous managed files and move journal are retained
under `.ffp-recovery-*` in the installation. A result receipt is written to
`<dataDirectory>/last-zip-update.json`. Do not delete these during diagnosis.

If the computer loses power or the helper is forcibly killed between file moves,
automatic recovery is not guaranteed. Stop all instances and use the retained
journal/files to restore a consistent runtime before resuming. Locked files,
antivirus intervention or insufficient permissions can also require operator
assistance; never erase the outbox to force an update.

Code tests and a local build do not establish real-channel acceptance. Final
release acceptance requires an accessible manifest/ZIP, configured signing
secret, and two actual released versions tested through download → drain → ACK →
replace → restart → reconnect, plus a rollback case. An unsigned clean-Windows
warning is expected; Authenticode installer acceptance remains out of scope.
