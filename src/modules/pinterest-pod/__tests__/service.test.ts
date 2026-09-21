import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../../shared/errors";
import {
  buildSeoDeliverables,
  cancelJob,
  cancelMockJob,
  FACTORY_PRINT_STANDARDS,
  getAssetUrl,
  getDiscoveryRunner,
  getMockAuthStatus,
  getPinterestAuthRunner,
  getPinterestPodRunner,
  getProductionRunner,
  launchLogin,
  launchMockLogin,
  mock15Candidates,
  mockPinterestAuthStatus,
  mockSeoDeliverables,
  pollDiscoveryJob,
  pollProductionJob,
  runDiscovery,
  runMockDiscovery,
  runMockProduction,
  runProduction,
  startProductionJob,
  STOREFRONT_DISPLAY_STANDARD,
} from "..";
import type { PodJobStatusResponse } from "../types";

test("Pinterest POD: Factory and Storefront standards are correctly defined", () => {
  assert.equal(FACTORY_PRINT_STANDARDS.rug.widthPx, 4000);
  assert.equal(FACTORY_PRINT_STANDARDS.rug.heightPx, 6400);
  assert.equal(FACTORY_PRINT_STANDARDS.rug.dpi, 300);
  assert.equal(FACTORY_PRINT_STANDARDS.rug.colorMode, "CMYK");

  assert.equal(FACTORY_PRINT_STANDARDS.blanket.widthPx, 10000);
  assert.equal(FACTORY_PRINT_STANDARDS.blanket.heightPx, 11000);
  assert.equal(FACTORY_PRINT_STANDARDS.blanket.dpi, 300);
  assert.equal(FACTORY_PRINT_STANDARDS.blanket.colorMode, "CMYK");

  assert.equal(STOREFRONT_DISPLAY_STANDARD.width, 1500);
  assert.equal(STOREFRONT_DISPLAY_STANDARD.height, 1500);
  assert.equal(STOREFRONT_DISPLAY_STANDARD.fit, "contain");
  assert.equal(STOREFRONT_DISPLAY_STANDARD.background, "#ffffff");
});

test("Stage 1 Mock Discovery returns 15 scored candidates with ready_for_review status", async () => {
  let progressCalled = false;
  const result = await runMockDiscovery(
    {
      niche: "vintage distressed rug",
      product: "rug",
      candidatePoolSize: 15,
    },
    {
      onProgress: (status) => {
        progressCalled = true;
        assert.equal(status.status, "running");
      },
    },
  );

  assert.equal(progressCalled, true);
  assert.equal(result.ok, true);
  assert.equal(result.status, "ready_for_review");
  assert.equal(result.candidates.length, 15);
  assert.equal(result.stepper.current_step, 2);
  assert.equal(result.stepper.percent, 40);

  const firstCand = result.candidates[0];
  assert.equal(firstCand.id, "cand_pin_101");
  assert.equal(typeof firstCand.image_score, "number");
  assert.equal(typeof firstCand.printability_score, "number");
  assert.equal(typeof firstCand.flat_artwork_score, "number");
  assert.equal(firstCand.is_direct_printable, true);
  assert.equal(firstCand.recommended, true);
});

test("Stage 1 Mock Discovery provides independent candidate copies", async () => {
  const result1 = await runMockDiscovery({ niche: "rug", product: "rug", candidatePoolSize: 5 });
  const result2 = await runMockDiscovery({ niche: "rug", product: "rug", candidatePoolSize: 5 });

  assert.equal(result1.candidates.length, 5);
  assert.equal(result2.candidates.length, 5);
  assert.notEqual(result1.candidates, mock15Candidates);
  assert.notEqual(result1.candidates[0], result2.candidates[0]);
});

test("Stage 2 Mock Production generates completed deliverables with CMYK 300 DPI and SEO package", async () => {
  let progressCalled = false;
  const result = await runMockProduction(
    {
      jobId: "job_custom_stage2",
      selected_candidates: ["cand_pin_101", "cand_pin_102"],
      product: "rug",
    },
    {
      onProgress: (status) => {
        progressCalled = true;
        assert.equal(status.status, "running");
      },
    },
  );

  assert.equal(progressCalled, true);
  assert.equal(result.ok, true);
  assert.equal(result.status, "completed");
  assert.equal(result.stepper.percent, 100);
  assert.equal(result.summaryMetrics.cmyk_count, 2);

  const seo = result.seoDeliverables;
  assert.equal(seo.success, true);
  assert.equal(seo.productType, "rug");
  assert.equal(seo.totalProduced, 2);
  assert.equal(seo.items.length, 2);

  const item1 = seo.items[0];
  assert.equal(item1.sourceCandidateId, "cand_pin_101");
  assert.equal(item1.printMaster.dpi, 300);
  assert.equal(item1.printMaster.widthPx, 4000);
  assert.equal(item1.printMaster.heightPx, 6400);
  assert.equal(item1.printMaster.colorMode, "CMYK");
  assert.ok(item1.composedMockups.length >= 2);
  assert.ok(item1.composedMockups[0].detectedSceneType.length > 0);
  assert.ok(item1.composedMockups[0].detectedSceneDescription.length > 0);
});

test("Stage 2 Mock Production adapts dimensions for blanket product type", async () => {
  const result = await runMockProduction({
    jobId: "job_blanket_stage2",
    selected_candidates: ["cand_pin_101"],
    product: "blanket",
  });

  assert.equal(result.seoDeliverables.productType, "blanket");
  const item = result.seoDeliverables.items[0];
  assert.equal(item.printMaster.widthPx, 10000);
  assert.equal(item.printMaster.heightPx, 11000);
  assert.equal(item.printMaster.dpi, 300);
});

test("Mock auth, login, and cancel functions return expected responses", async () => {
  const auth = await getMockAuthStatus();
  assert.equal(auth.ok, true);
  assert.equal(auth.logged_in, true);
  assert.notEqual(auth, mockPinterestAuthStatus);

  const login = await launchMockLogin({ timeout: 120 });
  assert.equal(login.ok, true);
  assert.equal(login.logged_in, true);

  const cancel = await cancelMockJob("job_to_cancel");
  assert.equal(cancel.ok, true);
  assert.ok(cancel.message?.includes("job_to_cancel"));
});

test("Runtime environment selector correctly switches runners", () => {
  assert.equal(getDiscoveryRunner("mock"), runMockDiscovery);
  assert.equal(getDiscoveryRunner("development"), runDiscovery);
  assert.equal(getDiscoveryRunner("production"), runDiscovery);

  assert.equal(getProductionRunner("mock"), runMockProduction);
  assert.equal(getProductionRunner("development"), runProduction);
  assert.equal(getProductionRunner("production"), runProduction);

  assert.equal(getPinterestAuthRunner("mock"), getMockAuthStatus);

  const mockRunner = getPinterestPodRunner("mock");
  assert.equal(mockRunner.runDiscovery, runMockDiscovery);
  assert.equal(mockRunner.runProduction, runMockProduction);

  const devRunner = getPinterestPodRunner("development");
  assert.equal(devRunner.runDiscovery, runDiscovery);
  assert.equal(devRunner.runProduction, runProduction);
});

test("buildSeoDeliverables builds accurate SEO package from comparison rows", () => {
  const sampleStatus: PodJobStatusResponse = {
    ok: true,
    jobId: "job_wf_99",
    status: "completed",
    candidates: mock15Candidates,
    deliverables: {
      comparison_rows: [
        {
          index: 1,
          product_label: "Design #1",
          source_url: mock15Candidates[0].image_url,
          cutout_url: "/api/pinterest-pod/assets/job_wf_99/design_101_cutout.png",
          cutout_white_url: "/api/pinterest-pod/assets/job_wf_99/design_101_white.jpg",
          final_print_url: "/api/pinterest-pod/assets/job_wf_99/design_101_cmyk_300dpi.jpg",
          ai_background_urls: [
            "/api/pinterest-pod/assets/job_wf_99/mockup_room_01_design_101.jpg",
            "/api/pinterest-pod/assets/job_wf_99/mockup_room_02_design_101.jpg",
          ],
        },
      ],
      lifestyle_mockups: [
        {
          filename: "mockup_room_01_design_101.jpg",
          url: "/api/pinterest-pod/assets/job_wf_99/mockup_room_01_design_101.jpg",
          scene_type: "living_room",
          scene_description: "Spacious modern living room",
        },
      ],
    },
  };

  const seo = buildSeoDeliverables(sampleStatus, "rug");
  assert.equal(seo.workflowId, "job_wf_99");
  assert.equal(seo.totalProduced, 1);
  assert.equal(seo.items[0].sourceCandidateId, "cand_pin_101");
  assert.equal(seo.items[0].originalPinTitle, mock15Candidates[0].title);
  assert.equal(seo.items[0].printMaster.dpi, 300);
  assert.equal(seo.items[0].composedMockups[0].detectedSceneType, "living_room");
  assert.equal(seo.items[0].composedMockups[0].detectedSceneDescription, "Spacious modern living room");
});

test("buildSeoDeliverables works gracefully when comparison rows are missing", () => {
  const sampleStatus: PodJobStatusResponse = {
    ok: true,
    jobId: "job_wf_100",
    status: "completed",
    deliverables: {
      print_cmyk_images: [
        {
          filename: "design_01_cmyk.jpg",
          url: "/api/pinterest-pod/assets/job_wf_100/design_01_cmyk.jpg",
        },
      ],
      product_cutouts_white: [
        {
          filename: "design_01_white.jpg",
          url: "/api/pinterest-pod/assets/job_wf_100/design_01_white.jpg",
        },
      ],
      lifestyle_mockups: [
        {
          filename: "mockup_01.jpg",
          url: "/api/pinterest-pod/assets/job_wf_100/mockup_01.jpg",
          scene_type: "bedroom",
          scene_description: "Oak wood bedroom",
        },
      ],
    },
  };

  const seo = buildSeoDeliverables(sampleStatus, "blanket");
  assert.equal(seo.items.length, 1);
  assert.equal(seo.items[0].productType, "blanket");
  assert.equal(seo.items[0].printMaster.widthPx, 10000);
  assert.equal(seo.items[0].printMaster.heightPx, 11000);
  assert.equal(seo.items[0].composedMockups[0].detectedSceneType, "bedroom");
});

test("Service handles job failure by throwing AppError with PINTEREST_POD_JOB_FAILED", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        jobId: "job_failed_test",
        status: "failed",
        error: "Pinterest crawler encountered captcha block",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    await assert.rejects(
      async () => {
        await pollDiscoveryJob("job_failed_test", { intervalMs: 10, timeoutMs: 100 });
      },
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "PINTEREST_POD_JOB_FAILED");
        assert.ok(error.message.includes("captcha"));
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Service handles job cancellation by throwing AppError with PINTEREST_POD_JOB_CANCELLED", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        jobId: "job_cancelled_test",
        status: "cancelled",
        message: "Job was terminated by user request",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    await assert.rejects(
      async () => {
        await pollProductionJob("job_cancelled_test", "rug", { intervalMs: 10, timeoutMs: 100 });
      },
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "PINTEREST_POD_JOB_CANCELLED");
        assert.ok(error.message.includes("terminated by user"));
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Service polling handles timeout by throwing AppError with PINTEREST_POD_POLL_TIMEOUT", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: true,
        jobId: "job_timeout_test",
        status: "running",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    await assert.rejects(
      async () => {
        await pollDiscoveryJob("job_timeout_test", { intervalMs: 20, timeoutMs: 50 });
      },
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "PINTEREST_POD_POLL_TIMEOUT");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("getAssetUrl constructs relative asset URLs conforming to contract", () => {
  assert.equal(getAssetUrl("job_123", "cmyk.jpg"), "/api/pinterest-pod/assets/job_123/cmyk.jpg");
  assert.equal(getAssetUrl("job 456", "room 01.jpg"), "/api/pinterest-pod/assets/job%20456/room%2001.jpg");
});

test("buildSeoDeliverables matches selected candidates accurately rather than relying on global candidate index", () => {
  const status: PodJobStatusResponse = {
    ok: true,
    jobId: "job_wf_select",
    status: "completed",
    candidates: mock15Candidates,
    deliverables: {
      comparison_rows: [
        {
          index: 1,
          product_label: "Design #1",
          source_url: "/api/pinterest-pod/assets/job_wf_select/source_105.jpg",
          cutout_url: "/api/pinterest-pod/assets/job_wf_select/design_105_cutout.png",
          cutout_white_url: "/api/pinterest-pod/assets/job_wf_select/design_105_white.jpg",
          final_print_url: "/api/pinterest-pod/assets/job_wf_select/design_105_cmyk_300dpi.jpg",
          ai_background_urls: ["/api/pinterest-pod/assets/job_wf_select/mockup_room_01_design_105.jpg"],
        },
      ],
    },
  };

  // User selected cand_pin_105 (index 4 in mock15Candidates)
  const seo = buildSeoDeliverables(status, "rug", ["cand_pin_105"]);
  assert.equal(seo.items.length, 1);
  assert.equal(seo.items[0].sourceCandidateId, "cand_pin_105");
  assert.equal(seo.items[0].originalPinTitle, mock15Candidates[4].title);
  assert.ok(seo.items[0].printMaster.localFilePath?.includes("design_105_cmyk_300dpi.jpg"));
  assert.ok(seo.items[0].cutoutProduct.localFilePath?.includes("design_105_white.jpg"));
  assert.ok(seo.items[0].composedMockups[0].localFilePath?.includes("mockup_room_01_design_105.jpg"));
});

test("Stage 2 Mock Production supports arbitrary candidate selection from candidate pool", async () => {
  const result = await runMockProduction({
    jobId: "job_custom_cand34",
    selected_candidates: ["cand_pin_103", "cand_pin_104"],
    product: "rug",
  });

  assert.equal(result.seoDeliverables.items.length, 2);
  assert.equal(result.seoDeliverables.items[0].sourceCandidateId, "cand_pin_103");
  assert.equal(result.seoDeliverables.items[1].sourceCandidateId, "cand_pin_104");
  assert.equal(result.seoDeliverables.items[0].originalPinTitle, mock15Candidates[2].title);
  assert.equal(result.seoDeliverables.items[1].originalPinTitle, mock15Candidates[3].title);
});

test("Service polling aborts immediately when signal is triggered", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ ok: true, jobId: "job_abort_test", status: "running" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);

  try {
    await assert.rejects(
      async () => {
        await pollDiscoveryJob("job_abort_test", {
          intervalMs: 100,
          timeoutMs: 5000,
          signal: controller.signal,
        });
      },
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.equal(error.code, "PINTEREST_POD_JOB_ABORTED");
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("startProductionJob sends product and returns production jobId", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody = "";
  globalThis.fetch = async (_url, init) => {
    capturedBody = (init?.body as string) || "";
    return new Response(
      JSON.stringify({ ok: true, jobId: "job_prod_new_99", status: "running" }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const res = await startProductionJob({
      jobId: "job_stage1_12",
      selected_candidates: ["cand_pin_101"],
      product: "blanket",
    });

    assert.equal(res.ok, true);
    assert.equal(res.jobId, "job_prod_new_99");
    assert.equal(res.status, "running");
    assert.ok(capturedBody.includes('"product":"blanket"'));
    assert.ok(capturedBody.includes('"jobId":"job_stage1_12"'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("launchLogin normalizes response with fallback status_text and message", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({ ok: true, status: "launched", pid: 1234, message: "Trình duyệt đã mở" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  try {
    const res = await launchLogin({ timeout: 300 });
    assert.equal(res.ok, true);
    assert.equal(res.status_text, "Trình duyệt đã mở");
    assert.equal(res.pid, 1234);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("cancelJob calls cancel endpoint and parses response", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(
      JSON.stringify({ ok: true, jobId: "job_to_cancel", status: "cancelled" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const res = await cancelJob("job_to_cancel");
    assert.equal(res.ok, true);
    assert.equal(res.status, "cancelled");
    assert.ok(requestedUrl.includes("/api/pinterest-pod/jobs/job_to_cancel/cancel"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
