import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("GPT SEO restart script validates root Compose and waits for a healthy server", async () => {
  const script = await readFile("scripts/restart-gpt-seo.sh", "utf8");

  assert.match(script, /set -Eeuo pipefail/);
  assert.match(script, /docker compose config -q/);
  assert.match(script, /docker compose up -d --build --force-recreate --wait --wait-timeout 120 server/);
  assert.doesNotMatch(script, /compose\.prod\.yaml/);
  assert.doesNotMatch(script, /ffp-tool-app/);
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

test("production deployment writes CLIENT_PORT on a new line", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");

  assert.match(workflow, /printf '\\nCLIENT_PORT=%s\\n' "\$CLIENT_PORT" >> \.env/);
  assert.match(workflow, /grep -E "\^APP_PORT="/);
  assert.match(workflow, /sed -i '\/\^\[\[:space:\]\]\*APP_PORT=\/d' \.env/);
  assert.doesNotMatch(workflow, /docker compose -f compose\.prod\.yaml/);
  assert.match(workflow, /docker compose up -d --build --remove-orphans/);
});

test("production deployment keeps the VPS action-key map authoritative over environment secrets", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");

  assert.match(workflow, /EXISTING_GPT_SEO_ACTION_KEYS_JSON=/);
  assert.match(workflow, /INCOMING_GPT_SEO_ACTION_KEYS_JSON=/);
  assert.match(
    workflow,
    /if \[ -n "\$EXISTING_GPT_SEO_ACTION_KEYS_JSON" \]; then[\s\S]*?GPT_SEO_ACTION_KEYS_JSON=%s/,
  );
  assert.doesNotMatch(
    workflow,
    /\[ -z "\$INCOMING_GPT_SEO_ACTION_KEYS_JSON" \] && \[ -n "\$EXISTING_GPT_SEO_ACTION_KEYS_JSON" \]/,
  );
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
  assert.match(
    workflow,
    /if \[ -s "\$EXISTING_STORE_ENV_FILE" \]; then[\s\S]*?printf '\\n' >> \.env[\s\S]*?while IFS= read -r store_line/,
  );
  assert.match(workflow, /while IFS= read -r store_line/);
  assert.match(workflow, /store_key="\$\{store_line%%=\*\}"/);
});

test("new-store guide uses only the multi-store action-key map", async () => {
  const guide = await readFile("docs/custom-gpt-seo/add-store.md", "utf8");

  assert.match(guide, /GPT_SEO_ACTION_KEYS_JSON=/);
  assert.doesNotMatch(guide, /`GPT_SEO_ACTION_KEY`/);
});

test("Custom GPT instructions open original image URLs returned by getSeoJobImages", async () => {
  const [instructions, knowledge] = await Promise.all([
    readFile("docs/custom-gpt-seo/gpt-instructions.md", "utf8"),
    readFile("docs/custom-gpt-seo/seo-knowledge.md", "utf8"),
  ]);

  assert.match(instructions, /getSeoJobImages/);
  assert.match(instructions, /images\[\]\.url/);
  assert.match(instructions, /imageId/);
  assert.match(instructions, /original public image URL/);
  assert.match(instructions, /does not require a Bearer token/);
  assert.doesNotMatch(instructions, /getSeoJobImageContent/);
  assert.doesNotMatch(instructions, /returned image content visually/);
  assert.match(knowledge, /images\[\]\.url/);
  assert.match(knowledge, /original source URL/);
  assert.match(knowledge, /actually rendered and inspected/);
});

test("Custom GPT instructions and knowledge briefly explain every exposed Action", async () => {
  const [instructions, knowledge, schemaText] = await Promise.all([
    readFile("docs/custom-gpt-seo/gpt-instructions.md", "utf8"),
    readFile("docs/custom-gpt-seo/seo-knowledge.md", "utf8"),
    readFile("docs/custom-gpt-seo/openapi.json", "utf8"),
  ]);
  const schema = JSON.parse(schemaText);
  const operationIds = Object.values(schema.paths)
    .flatMap(path => Object.values(path).map(operation => operation.operationId));

  assert.equal(operationIds.length, 17);
  for (const operationId of operationIds) {
    assert.match(instructions, new RegExp(`\\b${operationId}\\b`));
    assert.match(knowledge, new RegExp(`\\b${operationId}\\b`));
  }
});

test("production deployment installs the GPT SEO restart script from the repository", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");

  assert.match(workflow, /chmod 755 scripts\/restart-gpt-seo\.sh/);
  assert.doesNotMatch(workflow, /docker cp/);
});

test("production deployment fails when the health endpoint stays unavailable", async () => {
  const workflow = await readFile(".github/workflows/deploy.yml", "utf8");

  assert.match(workflow, /if \[ "\$HEALTHY" = "false" \]; then[\s\S]*?docker compose logs --tail=50[\s\S]*?exit 1[\s\S]*?fi/);
});
