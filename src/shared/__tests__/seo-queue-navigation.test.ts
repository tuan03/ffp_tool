import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSeoQueueUrl, resolveSeoQueueStoreId } from "../seo-queue-navigation";

test("SEO queue URL carries the selected Auto SEO store", () => {
  assert.equal(buildSeoQueueUrl(" Wrydeco "), "/gpt-seo?storeId=wrydeco");
});

test("SEO queue resolves its initial store from the URL", () => {
  assert.equal(resolveSeoQueueStoreId(new URLSearchParams("storeId=Wrydeco")), "wrydeco");
  assert.equal(resolveSeoQueueStoreId(new URLSearchParams(), "Jeminise-Real"), "jeminise-real");
  assert.equal(resolveSeoQueueStoreId(new URLSearchParams()), "capozen");
});
