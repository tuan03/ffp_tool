import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVE_STORE_STORAGE_KEY,
  LEGACY_REVIEW_STORE_STORAGE_KEY,
  buildStoreAwarePath,
  persistActiveStoreId,
  readActiveStoreId,
} from "../active-store";

test("active store is normalized, persisted and added to cross-tab routes", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };

  assert.equal(persistActiveStoreId(" Jeminise-Real ", storage), "jeminise-real");
  assert.equal(values.get(ACTIVE_STORE_STORAGE_KEY), "jeminise-real");
  assert.equal(values.get(LEGACY_REVIEW_STORE_STORAGE_KEY), "jeminise-real");
  assert.equal(readActiveStoreId(storage), "jeminise-real");
  assert.equal(buildStoreAwarePath("/seo-review", " Jeminise-Real "), "/seo-review?storeId=jeminise-real");
});

test("active store reads the existing SEO Review key during migration", () => {
  const storage = {
    getItem: (key: string) => key === LEGACY_REVIEW_STORE_STORAGE_KEY ? "JEMINISE" : null,
  };
  assert.equal(readActiveStoreId(storage), "jeminise");
});
