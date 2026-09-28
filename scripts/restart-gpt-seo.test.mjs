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
