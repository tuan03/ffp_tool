import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FileSeoConflictCorpus, SeoCorpusReservation } from "..";

test("failed image preparation releases keywords, while review-ready products retain them", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "seo-reservation-"));
  try {
    const corpus = new FileSeoConflictCorpus({ filePath: path.join(directory, "corpus.json") });
    const identity = { productId: "product-1", handle: "music-rug" };
    const prepare = async (imageSucceeds: boolean) => {
      await corpus.upsertProduct({ identity, approvedKeywords: ["music rug"] });
      const reservation = new SeoCorpusReservation(() => corpus.removeProduct(identity));
      try {
        if (!imageSucceeds) return; // Same handled-error return used by the worker.
        reservation.retain();
      } finally {
        await reservation.dispose();
      }
    };
    await prepare(false);
    assert.equal((await corpus.getSnapshot()).products.length, 0);
    await prepare(true);
    assert.equal((await corpus.getSnapshot()).products.length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
