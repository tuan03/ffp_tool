import { readFileSync } from "node:fs";

const domain = process.argv[2];
if (!domain) {
  console.error("Usage: node scripts/export-custom-gpt-schema.mjs https://your-domain.example");
  process.exitCode = 1;
} else {
  try {
    const url = new URL(domain);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || (url.port && url.port !== "443")) throw new Error("Use an HTTPS origin on port 443 without credentials, path or query");
    const schema = JSON.parse(readFileSync(new URL("../docs/custom-gpt-seo/openapi.json", import.meta.url), "utf8"));
    schema.servers = [{ url: url.origin }];
    process.stdout.write(`${JSON.stringify(schema, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid domain");
    process.exitCode = 1;
  }
}
