import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { readThemePreference, saveThemePreference, THEME_STORAGE_KEY } from "../../../app/theme/theme-preference";

test("theme defaults to light and accepts only the two explicit modes", () => {
  for (const stored of [null, "", "system", "invalid"]) {
    assert.equal(readThemePreference({ getItem: () => stored }), "light");
  }
  assert.equal(readThemePreference({ getItem: () => "dark" }), "dark");
  assert.equal(readThemePreference({ getItem: () => "light" }), "light");
  assert.equal(readThemePreference(), "light");
});

test("theme preference saves separately from other workspace settings and tolerates blocked storage", () => {
  const values = new Map<string, string>([["crawler-draft", "B0MOCK1001"]]);
  const storage = { setItem: (key: string, value: string) => { values.set(key, value); } };
  saveThemePreference("dark", storage);
  assert.equal(values.get(THEME_STORAGE_KEY), "dark");
  assert.equal(values.get("crawler-draft"), "B0MOCK1001");
  const unavailable = { getItem: (): never => { throw new Error("Unavailable"); }, setItem: (): never => { throw new Error("Unavailable"); } };
  assert.equal(readThemePreference(unavailable), "light");
  assert.doesNotThrow(() => saveThemePreference("dark", unavailable));
  assert.doesNotThrow(() => saveThemePreference("light"));
});

test("pre-render bootstrap applies the saved mode before the app, including blocked storage", () => {
  const bootstrap = readFileSync(new URL("../../../../public/theme-init.js", import.meta.url), "utf8");
  for (const saved of ["dark", "light", "invalid", null]) {
    const attributes = new Map<string, string>();
    const root = { setAttribute: (key: string, value: string) => { attributes.set(key, value); }, style: { colorScheme: "" } };
    runInNewContext(bootstrap, { document: { documentElement: root }, localStorage: { getItem: (key: string) => { assert.equal(key, THEME_STORAGE_KEY); return saved; } } });
    assert.equal(attributes.get("data-theme"), saved === "dark" ? "dark" : "light");
    assert.equal(root.style.colorScheme, saved === "dark" ? "dark" : "light");
  }
  const attributes = new Map<string, string>();
  runInNewContext(bootstrap, { document: { documentElement: { setAttribute: (key: string, value: string) => { attributes.set(key, value); }, style: {} } }, localStorage: { getItem: () => { throw new Error("Blocked"); } } });
  assert.equal(attributes.get("data-theme"), "light");
  const html = readFileSync(new URL("../../../../index.html", import.meta.url), "utf8");
  const bootstrapPosition = html.indexOf('src="/theme-init.js"');
  assert.ok(bootstrapPosition > 0);
  assert.ok(bootstrapPosition < html.indexOf('src="/src/main.tsx"'));
});
