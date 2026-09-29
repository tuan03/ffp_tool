import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";

test("Custom GPT schema uses a configurable HTTPS origin and exposes no administration", () => {
  const result = spawnSync(process.execPath, ["scripts/export-custom-gpt-schema.mjs", "https://seo.example.org"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const schema = JSON.parse(result.stdout);
  assert.equal(schema.servers[0].url, "https://seo.example.org");
  assert.equal(Object.keys(schema.paths).length, 17);
  assert.ok(Object.keys(schema.paths).every(route => !route.includes("admin")));
  const operationIds = Object.values(schema.paths).flatMap(path => Object.values(path).map(operation => operation.operationId));
  assert.equal(new Set(operationIds).size, operationIds.length);
});

test("Custom GPT schema exposes an authenticated public image URL lookup", () => {
  const result = spawnSync(process.execPath, ["scripts/export-custom-gpt-schema.mjs", "https://seo.example.org"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const schema = JSON.parse(result.stdout);
  const operation = schema.paths["/api/v1/gpt-seo/image-content"]?.get;

  assert.equal(operation?.operationId, "getSeoJobImageContent");
  assert.deepEqual(operation?.security, [{ actionKey: [] }]);
  const responseSchema = operation?.responses?.["200"]?.content?.["application/json"]?.schema;
  assert.deepEqual(responseSchema?.required, ["imageId", "imageUrl", "instructions"]);
  assert.equal(responseSchema?.properties?.imageUrl?.format, "uri");
  assert.equal(operation?.responses?.["200"]?.content?.["image/jpeg"], undefined);
  assert.deepEqual(operation?.parameters?.map(parameter => parameter.name), ["jobId", "imageId"]);
});

test("Custom GPT schema satisfies Builder object schema requirements", () => {
  const result = spawnSync(process.execPath, ["scripts/export-custom-gpt-schema.mjs", "https://seo.example.org"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const schema = JSON.parse(result.stdout);
  const objectSchemasWithoutProperties = [];

  const inspect = (value, path) => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => inspect(entry, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    if (value.type === "object" && (!value.properties || typeof value.properties !== "object" || Array.isArray(value.properties))) {
      objectSchemasWithoutProperties.push(path);
    }
    Object.entries(value).forEach(([key, entry]) => inspect(entry, `${path}.${key}`));
  };

  assert.ok(schema.components.schemas && typeof schema.components.schemas === "object" && !Array.isArray(schema.components.schemas));
  inspect(schema, "schema");
  assert.deepEqual(objectSchemasWithoutProperties, []);
});

test("Custom GPT schema rejects plaintext origins", () => {
  const result = spawnSync(process.execPath, ["scripts/export-custom-gpt-schema.mjs", "http://localhost:3001"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /HTTPS/);
});
