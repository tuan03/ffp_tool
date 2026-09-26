import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveLocalImageFile } from "../local-image-resolver";

test("resolveLocalImageFile: returns undefined for empty or missing inputs", () => {
  assert.equal(resolveLocalImageFile(undefined, undefined), undefined);
  assert.equal(resolveLocalImageFile("", ""), undefined);
  assert.equal(resolveLocalImageFile("   ", "   "), undefined);
});

test("resolveLocalImageFile: resolves direct existing file paths", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ffp_test_direct_"));
  try {
    const directFile = path.join(tempDir, "direct_test_image.jpg");
    fs.writeFileSync(directFile, Buffer.from("image_data"));

    const resolved = resolveLocalImageFile(directFile);
    assert.equal(resolved, path.resolve(directFile));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("resolveLocalImageFile: resolves specific runId and avoids collisions with older runs", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ffp_test_runs_"));
  try {
    const outputDir = path.join(tempRoot, "src/modules/pinterest-pod/server/data/pinterest_pod/output");
    const oldRunDir = path.join(outputDir, "run_20260901_000000", "lifestyle_mockups");
    const newRunDir = path.join(outputDir, "run_20260902_000000", "lifestyle_mockups");

    fs.mkdirSync(oldRunDir, { recursive: true });
    fs.mkdirSync(newRunDir, { recursive: true });

    const sharedFilename = "mockup_room_01_design_1.jpg";
    const oldFile = path.join(oldRunDir, sharedFilename);
    const newFile = path.join(newRunDir, sharedFilename);

    fs.writeFileSync(oldFile, Buffer.from("old_run_content"));
    fs.writeFileSync(newFile, Buffer.from("new_run_content"));

    // Set old file mtime in the past
    fs.utimesSync(oldFile, new Date("2026-09-01"), new Date("2026-09-01"));
    fs.utimesSync(newFile, new Date("2026-09-02"), new Date("2026-09-02"));

    // 1. When specifying newRunId in rawPath, it MUST resolve to newRunDir
    const rawPathNew = `temp/pinterest_pod/run_20260902_000000/${sharedFilename}`;
    const resolvedNew = resolveLocalImageFile(rawPathNew, undefined, tempRoot);
    assert.equal(resolvedNew, newFile);

    // 2. When specifying oldRunId in rawPath, it MUST resolve to oldRunDir
    const rawPathOld = `temp/pinterest_pod/run_20260901_000000/${sharedFilename}`;
    const resolvedOld = resolveLocalImageFile(rawPathOld, undefined, tempRoot);
    assert.equal(resolvedOld, oldFile);

    // 3. When specifying runId in URL, it MUST resolve to that exact run
    const urlNew = `/api/pinterest-pod/assets/run_20260902_000000/${sharedFilename}`;
    const resolvedFromUrl = resolveLocalImageFile(undefined, urlNew, tempRoot);
    assert.equal(resolvedFromUrl, newFile);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("resolveLocalImageFile: resolves across standard subdirectories (final_print, cutouts)", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ffp_test_subdirs_"));
  try {
    const outputDir = path.join(tempRoot, "src/modules/pinterest-pod/server/data/pinterest_pod/output");
    const runId = "job_prod_alpha";
    const finalPrintDir = path.join(outputDir, runId, "final_print");
    const cutoutsWhiteDir = path.join(outputDir, runId, "product_cutouts_white");

    fs.mkdirSync(finalPrintDir, { recursive: true });
    fs.mkdirSync(cutoutsWhiteDir, { recursive: true });

    const cmykFile = path.join(finalPrintDir, "design_rug_cmyk_300dpi.jpg");
    const cutoutWhiteFile = path.join(cutoutsWhiteDir, "design_rug_white.png");

    fs.writeFileSync(cmykFile, Buffer.from("cmyk_print"));
    fs.writeFileSync(cutoutWhiteFile, Buffer.from("cutout_white"));

    const resolvedCmyk = resolveLocalImageFile(
      `temp/pinterest_pod/${runId}/design_rug_cmyk_300dpi.jpg`,
      undefined,
      tempRoot,
    );
    assert.equal(resolvedCmyk, cmykFile);

    const resolvedCutout = resolveLocalImageFile(
      undefined,
      `/api/pinterest-pod/assets/${runId}/design_rug_white.png`,
      tempRoot,
    );
    assert.equal(resolvedCutout, cutoutWhiteFile);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
