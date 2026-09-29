import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("GPT SEO restart script validates Compose and waits for a healthy app", async () => {
  const script = await readFile("scripts/restart-gpt-seo.sh", "utf8");

  assert.match(script, /set -Eeuo pipefail/);
  assert.match(script, /docker inspect --format '\{\{\.Config\.Image\}\}' ffp-tool-app/);
  assert.match(script, /APP_PORT="\$\{APP_PORT:-3010\}"/);
  assert.match(script, /docker compose -f compose\.prod\.yaml config -q/);
  assert.match(script, /docker compose -f compose\.prod\.yaml up -d --force-recreate --wait --wait-timeout 120 app/);
  assert.match(script, /https:\/\/ffp\.b6-team\.site\/health/);
});

test("new-store guide restarts GPT SEO with one command", async () => {
  const guide = await readFile("docs/custom-gpt-seo/add-store.md", "utf8");

  assert.match(guide, /bash \/opt\/ffp-tool\/scripts\/restart-gpt-seo\.sh/);
  assert.doesNotMatch(guide, /CURRENT_IMAGE=/);
});

test("new-store guide documents VPS login and the private key is ignored", async () => {
  const [guide, gitignore] = await Promise.all([
    readFile("docs/custom-gpt-seo/add-store.md", "utf8"),
    readFile(".gitignore", "utf8"),
  ]);

  assert.match(
    guide,
    /ssh -i "D:\\all_about_shopify\\tools\\ffp_tool\\wrydeco-vps_key\.pem" azureuser@20\.222\.21\.81/,
  );
  assert.match(gitignore, /^\/wrydeco-vps_key\.pem$/m);
});

test("production deployment writes APP_PORT on a new line", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");

  assert.match(workflow, /printf '\\nAPP_PORT=%s\\n' "\$APP_PORT" >> \.env/);
  assert.doesNotMatch(workflow, /echo "APP_PORT=\$APP_PORT" >> \.env/);
});

test("production deployment preserves a VPS action-key map when the environment secret omits it", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");

  assert.match(workflow, /EXISTING_GPT_SEO_ACTION_KEYS_JSON=/);
  assert.match(workflow, /INCOMING_GPT_SEO_ACTION_KEYS_JSON=/);
  assert.match(workflow, /GPT_SEO_ACTION_KEYS_JSON=%s/);
});

test("production deployment removes the legacy single-store action key when a key map exists", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");

  assert.match(
    workflow,
    /if \[ -n "\$INCOMING_GPT_SEO_ACTION_KEYS_JSON" \]; then[\s\S]*?sed -i '\/\^\[\[:space:\]\]\*GPT_SEO_ACTION_KEY=\/d' \.env[\s\S]*?fi/,
  );
});

test("production deployment preserves operator login credentials from the VPS", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");

  assert.match(workflow, /EXISTING_FFP_OPERATOR_USERNAME=/);
  assert.match(workflow, /EXISTING_FFP_OPERATOR_PASSWORD=/);
  assert.match(workflow, /FFP_OPERATOR_USERNAME=%s/);
  assert.match(workflow, /FFP_OPERATOR_PASSWORD=%s/);
});

test("production deployment preserves store credentials from the VPS", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");

  assert.match(workflow, /EXISTING_STORE_ENV_FILE=/);
  assert.match(workflow, /grep -E '\^STORE_\[A-Z0-9_\]\+=' \.env/);
  assert.match(workflow, /while IFS= read -r store_line/);
  assert.match(workflow, /store_key="\$\{store_line%%=\*\}"/);
});

test("new-store guide uses only the multi-store action-key map", async () => {
  const guide = await readFile("docs/custom-gpt-seo/add-store.md", "utf8");

  assert.match(guide, /GPT_SEO_ACTION_KEYS_JSON=/);
  assert.doesNotMatch(guide, /`GPT_SEO_ACTION_KEY`/);
});

test("production deployment exports the GPT SEO restart script from the container", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");

  assert.match(workflow, /docker cp ffp-tool-app:\/app\/scripts\/restart-gpt-seo\.sh scripts\/restart-gpt-seo\.sh/);
  assert.match(workflow, /chmod 755 scripts\/restart-gpt-seo\.sh/);
});

test("production deployment fails when the health endpoint stays unavailable", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");

  assert.match(workflow, /if \[ "\$HEALTHY" = "false" \]; then[\s\S]*?docker compose -f compose\.prod\.yaml logs --tail=50[\s\S]*?exit 1[\s\S]*?fi/);
});
