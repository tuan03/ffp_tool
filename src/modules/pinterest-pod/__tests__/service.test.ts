import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../../shared/errors";
import {
  buildSeoDeliverables,
  cancelJob,
  cancelMockJob,
  FACTORY_PRINT_STANDARDS,
  getAssetUrl,
  getAuthStatus,
  getDiscoveryRunner,
  getMockAuthStatus,
  getPinterestAuthRunner,
  getPinterestPodClient,
  getPinterestPodRunner,
  getProductionRunner,
  handoverToSeo,
  launchLogin,
  launchMockLogin,
  mock15Candidates,
  mockCandidates,
  mockDeliverables,
  mockPinterestAuthStatus,
  mockPinterestPodClient,
  mockSeoDeliverables,
  packageDeliverablesForSeo,
  pollDiscoveryJob,
  pollProductionJob,
  realPinterestPodClient,
  RealPinterestPodClient,
  runDiscovery,
  runMockDiscovery,
  runMockProduction,
  runProduction,
  startProductionJob,
  STOREFRONT_DISPLAY_STANDARD,
} from "..";
import type { JobDetailResponse, PodJobStatusResponse } from "../types";

// ==========================================
// Tests for MockPinterestPodClient & UI Flow
// ==========================================

test("Mock client returns expected initial auth status and handles launchLogin", async () => {
  const status = await mockPinterestPodClient.getAuthStatus();
  assert.equal(status.ok, true);
  assert.equal(typeof status.logged_in, "boolean");

  const loginRes = await mockPinterestPodClient.launchLogin(600);
  assert.equal(loginRes.ok, true);

  const updatedStatus = await mockPinterestPodClient.getAuthStatus();
  assert.equal(updatedStatus.logged_in, true);
});

test("Mock client workflow: createJob -> poll ready_for_review -> produce -> completed", async () => {
  const created = await mockPinterestPodClient.createJob({
    niche: "vintage distressed rug",
    product: "rug",
    workflow_stage: "crawl_and_review",
    candidatePoolSize: 15,
  });

  assert.equal(created.ok, true);
  assert.ok(created.jobId.startsWith("job_"));
  assert.equal(created.status, "running");

  // First poll: still running
  const poll1 = await mockPinterestPodClient.getJobDetail(created.jobId);
  assert.equal(poll1.status, "running");
  assert.equal(poll1.stepper?.current_step, 1);

  // Second poll: transitions to ready_for_review with candidates
  const poll2 = await mockPinterestPodClient.getJobDetail(created.jobId);
  assert.equal(poll2.status, "ready_for_review");
  assert.equal(poll2.stepper?.current_step, 2);
  assert.equal(poll2.stepper?.percent, 40);
  assert.ok((poll2.candidates?.length ?? 0) > 0);

  // Send produce command
  const produceRes = await mockPinterestPodClient.produce({
    jobId: created.jobId,
    selected_candidates: ["cand_pin_101", "cand_pin_102"],
  });
  assert.equal(produceRes.ok, true);
  assert.equal(produceRes.status, "producing");

  // Third poll: producing
  const poll3 = await mockPinterestPodClient.getJobDetail(created.jobId);
  assert.equal(poll3.status, "producing");
  assert.equal(poll3.stepper?.current_step, 3);

  // Fourth poll: completed with deliverables
  const poll4 = await mockPinterestPodClient.getJobDetail(created.jobId);
  assert.equal(poll4.status, "completed");
  assert.equal(poll4.stepper?.current_step, 4);
  assert.equal(poll4.stepper?.percent, 100);
  assert.ok(poll4.deliverables !== undefined);
  assert.equal(poll4.deliverables?.print_cmyk_images?.length, 2);
  assert.equal(poll4.deliverables?.lifestyle_mockups?.length, 4);
  assert.equal(poll4.deliverables?.comparison_rows?.length, 2);
});

test("Mock client handles cancelJob", async () => {
  const created = await mockPinterestPodClient.createJob({
    niche: "cancel test rug",
    product: "rug",
  });

  const cancelRes = await mockPinterestPodClient.cancelJob(created.jobId);
  assert.equal(cancelRes.ok, true);
  assert.equal(cancelRes.status, "cancelled");

  const detail = await mockPinterestPodClient.getJobDetail(created.jobId);
  assert.equal(detail.status, "cancelled");
});

test("packageDeliverablesForSeo formats deliverables conforming to CONTRACT_PINTEREST_POD_TO_SEO.md", () => {
  const fakeJobDetail: JobDetailResponse = {
    ok: true,
    jobId: "wf_20260921_test",
    status: "completed",
    candidates: mockCandidates,
    deliverables: mockDeliverables,
  };

  const seoPayloadRug = packageDeliverablesForSeo(fakeJobDetail, "rug");
  assert.equal(seoPayloadRug.workflowId, "wf_20260921_test");
  assert.equal(seoPayloadRug.success, true);
  assert.equal(seoPayloadRug.productType, "rug");
  assert.equal(seoPayloadRug.totalProduced, 3);
  assert.equal(seoPayloadRug.items.length, 3);

  const item1 = seoPayloadRug.items[0];
  assert.ok(item1.designId.startsWith("design_rug_"));
  assert.equal(item1.printMaster.dpi, 300);
  assert.equal(item1.printMaster.widthPx, 4000);
  assert.equal(item1.printMaster.heightPx, 6400);
  assert.ok(item1.composedMockups.length > 0);
  assert.ok(item1.cutoutProduct.whiteBgUrl.length > 0);

  // Test Blanket dimension specs
  const seoPayloadBlanket = packageDeliverablesForSeo(fakeJobDetail, "blanket");
  assert.equal(seoPayloadBlanket.productType, "blanket");
  assert.equal(seoPayloadBlanket.items[0].printMaster.widthPx, 10000);
  assert.equal(seoPayloadBlanket.items[0].printMaster.heightPx, 11000);

  // Test RGB URL derivation conforming to CONTRACT_PINTEREST_POD_TO_SEO.md
  assert.notEqual(item1.printMaster.rgbUrl, item1.printMaster.cmykUrl);
  assert.ok(item1.printMaster.rgbUrl.includes("RGB"));

  // Edge case: Non-contiguous candidate selection mapping (e.g. candidate 105 only selected)
  const cand105 = mockCandidates.find((c) => c.id === "cand_pin_105");
  assert.ok(cand105 !== undefined);

  const selectiveJobDetail: JobDetailResponse = {
    ok: true,
    jobId: "wf_selective",
    status: "completed",
    candidates: mockCandidates,
    deliverables: {
      print_cmyk_images: [
        { filename: "design_01_cmyk_300dpi.jpg", url: "/api/assets/wf_selective/design_01_cmyk_300dpi.jpg" },
      ],
      lifestyle_mockups: [
        {
          filename: "mock_01.jpg",
          url: "/api/assets/wf_selective/mock_01.jpg",
          scene_type: "living_room",
          scene_description: "Retro living room",
        },
      ],
      product_cutouts_white: [
        { filename: "design_01_white.jpg", url: "/api/assets/wf_selective/design_01_white.jpg" },
      ],
      comparison_rows: [
        {
          index: 1,
          product_label: `Mẫu #1: ${cand105.title}`,
          source_url: cand105.image_url,
          final_print_url: "/api/assets/wf_selective/design_01_cmyk_300dpi.jpg",
          ai_background_urls: ["/api/assets/wf_selective/mock_01.jpg"],
        },
      ],
    },
  };

  const selectivePayload = packageDeliverablesForSeo(selectiveJobDetail, "rug");
  assert.equal(selectivePayload.totalProduced, 1);
  assert.equal(selectivePayload.items.length, 1);
  assert.equal(selectivePayload.items[0].sourceCandidateId, "cand_pin_105");
  assert.equal(selectivePayload.items[0].originalPinTitle, cand105.title);
  assert.equal(selectivePayload.items[0].composedMockups.length, 1);
  assert.equal(selectivePayload.items[0].composedMockups[0].mockupUrl, "/api/assets/wf_selective/mock_01.jpg");

  // Edge case: Empty deliverables
  const emptyJobDetail: JobDetailResponse = {
    ok: true,
    jobId: "wf_empty",
    status: "completed",
  };
  const emptyPayload = packageDeliverablesForSeo(emptyJobDetail, "custom");
  assert.equal(emptyPayload.totalProduced, 0);
  assert.equal(emptyPayload.items.length, 0);
  assert.equal(emptyPayload.productType, "custom");
});

test("Mock client dynamically adapts deliverables to selected candidate IDs and blanket product type", async () => {
  const blanketJob = await mockPinterestPodClient.createJob({
    niche: "retro 70s blanket",
    product: "blanket",
  });

  await mockPinterestPodClient.getJobDetail(blanketJob.jobId);
  const ready = await mockPinterestPodClient.getJobDetail(blanketJob.jobId);
  assert.equal(ready.status, "ready_for_review");

  const produceRes = await mockPinterestPodClient.produce({
    jobId: blanketJob.jobId,
    selected_candidates: ["cand_pin_105"],
  });
  assert.equal(produceRes.ok, true);

  await mockPinterestPodClient.getJobDetail(blanketJob.jobId);
  const completed = await mockPinterestPodClient.getJobDetail(blanketJob.jobId);
  assert.equal(completed.status, "completed");

  assert.equal(completed.summaryMetrics?.cmyk_count, 1);
  assert.equal(completed.summaryMetrics?.rgb_4k_count, 1);
  assert.equal(completed.summaryMetrics?.lifestyle_mockup_count, 2);
  assert.equal(completed.deliverables?.print_cmyk_images?.length, 1);
  assert.equal(completed.deliverables?.comparison_rows?.length, 1);

  const cmykSvgUrl = decodeURIComponent(completed.deliverables?.print_cmyk_images?.[0]?.url ?? "");
  assert.match(cmykSvgUrl, /10000x11000px/);

  const seoPayload = packageDeliverablesForSeo(completed, "blanket");
  assert.equal(seoPayload.totalProduced, 1);
  assert.equal(seoPayload.items[0].sourceCandidateId, "cand_pin_105");
  assert.equal(seoPayload.items[0].printMaster.widthPx, 10000);
  assert.equal(seoPayload.items[0].printMaster.heightPx, 11000);
});

test("getPinterestPodClient selects appropriate client based on environment", () => {
  const mockClient = getPinterestPodClient("mock");
  assert.equal(mockClient, mockPinterestPodClient);

  const devClient = getPinterestPodClient("development");
  assert.ok(devClient instanceof RealPinterestPodClient);

  const prodClient = getPinterestPodClient("production");
  assert.ok(prodClient instanceof RealPinterestPodClient);
});

test("RealPinterestPodClient wraps fetch errors into AppError with appropriate codes", async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "Pinterest session expired" }), {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "Content-Type": "application/json" },
      });

    await assert.rejects(
      async () => {
        await realPinterestPodClient.getAuthStatus();
      },
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, "PINTEREST_AUTH_CHECK_FAILED");
        assert.match(err.message, /Pinterest session expired/);
        return true;
      },
    );

    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:8765");
    };

    await assert.rejects(
      async () => {
        await realPinterestPodClient.createJob({
          niche: "test",
          product: "rug",
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof AppError);
        assert.equal(err.code, "PINTEREST_JOB_CREATION_FAILED");
        assert.match(err.message, /ECONNREFUSED/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// =======================================================
// Tests for Pipeline Runners, Standards & Service API
// =======================================================

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

  const login = await launchMockLogin();
  assert.equal(login.ok, true);
  assert.equal(login.logged_in, true);

  const cancel = await cancelMockJob("job_123");
  assert.equal(cancel.ok, true);
});

test("Runtime environment selector correctly switches runners", () => {
  assert.equal(getDiscoveryRunner("mock"), runMockDiscovery);
  assert.equal(getDiscoveryRunner("development"), runDiscovery);
  assert.equal(getDiscoveryRunner("production"), runDiscovery);

  assert.equal(getProductionRunner("mock"), runMockProduction);
  assert.equal(getProductionRunner("development"), runProduction);
  assert.equal(getProductionRunner("production"), runProduction);

  assert.equal(getPinterestAuthRunner("mock"), getMockAuthStatus);
  assert.equal(getPinterestAuthRunner("development"), getAuthStatus);

  const mockRunner = getPinterestPodRunner("mock");
  assert.equal(mockRunner.runDiscovery, runMockDiscovery);
  assert.equal(mockRunner.runProduction, runMockProduction);

  const devRunner = getPinterestPodRunner("development");
  assert.equal(devRunner.runDiscovery, runDiscovery);
  assert.equal(devRunner.runProduction, runProduction);
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

test("Mock client getStatus returns recent runs and deleteJob removes job", async () => {
  const status = await mockPinterestPodClient.getStatus();
  assert.equal(status.ok, true);
  assert.ok(Array.isArray(status.recent));
  assert.ok((status.recent?.length ?? 0) > 0);

  const created = await mockPinterestPodClient.createJob({
    niche: "nordic runner",
    product: "rug",
  });
  const updatedStatus = await mockPinterestPodClient.getStatus();
  assert.ok(updatedStatus.recent?.some((r) => r.jobId === created.jobId));

  const deleteRes = await mockPinterestPodClient.deleteJob(created.jobId);
  assert.equal(deleteRes.ok, true);

  const postDeleteStatus = await mockPinterestPodClient.getStatus();
  assert.equal(postDeleteStatus.recent?.some((r) => r.jobId === created.jobId), false);
});

test("Real client getStatus and deleteJob call respective endpoints with proper methods", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; method?: string }[] = [];

  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? "GET" });
    if (String(url).includes("/status")) {
      return new Response(
        JSON.stringify({ ok: true, recent: [{ id: "job_recent_1", status: "ready_for_review" }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ ok: true, message: "Deleted" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const status = await realPinterestPodClient.getStatus();
    assert.equal(status.ok, true);
    assert.equal(status.recent?.[0].id, "job_recent_1");
    assert.ok(calls.some((c) => c.url.includes("/api/pinterest-pod/status") && c.method === "GET"));

    const del = await realPinterestPodClient.deleteJob("job_del_test");
    assert.equal(del.ok, true);
    assert.ok(calls.some((c) => c.url.includes("/api/pinterest-pod/jobs/job_del_test/delete") && c.method === "POST"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("buildSeoDeliverables filters composedMockups with approvedMockupUrls while keeping printMaster intact", () => {
  const cand = { ...mockCandidates[0], id: "cand_001", image_url: "/api/assets/cand_001.jpg" };
  const jobStatus: PodJobStatusResponse = {
    ok: true,
    jobId: "wf_approval_test",
    status: "completed",
    candidates: [cand],
    deliverables: {
      comparison_rows: [
        {
          index: 1,
          product_label: "Vintage Rug",
          source_url: "/api/assets/cand_001.jpg",
          final_print_url: "/api/assets/wf_approval_test/design_01_cmyk_300dpi.jpg",
          ai_background_urls: [
            "/api/assets/wf_approval_test/mockup_room_1.jpg",
            "/api/assets/wf_approval_test/mockup_room_2.jpg",
            "/api/assets/wf_approval_test/mockup_room_3.jpg",
          ],
        },
      ],
    },
  };

  // Case 1: No approval filter passed (defaults to all mockups)
  const allPayload = buildSeoDeliverables(jobStatus, "rug");
  assert.equal(allPayload.items.length, 1);
  assert.equal(allPayload.items[0].printMaster.dpi, 300);
  assert.equal(allPayload.items[0].composedMockups.length, 3);

  // Case 2: User only approved mockup_room_1 and mockup_room_3 (deselected mockup_room_2)
  const approvedSet = new Set([
    "/api/assets/wf_approval_test/mockup_room_1.jpg",
    "/api/assets/wf_approval_test/mockup_room_3.jpg",
  ]);
  const filteredPayload = buildSeoDeliverables(jobStatus, "rug", undefined, approvedSet);
  assert.equal(filteredPayload.items.length, 1);
  assert.equal(filteredPayload.items[0].printMaster.dpi, 300);
  assert.equal(filteredPayload.items[0].printMaster.colorMode, "CMYK");
  assert.equal(filteredPayload.items[0].composedMockups.length, 2);
  assert.equal(filteredPayload.items[0].composedMockups[0].mockupUrl, "/api/assets/wf_approval_test/mockup_room_1.jpg");
  assert.equal(filteredPayload.items[0].composedMockups[1].mockupUrl, "/api/assets/wf_approval_test/mockup_room_3.jpg");

  // Case 3: Matching by filename
  const filenameApproved = new Set(["mockup_room_2.jpg"]);
  const filenameFilteredPayload = buildSeoDeliverables(jobStatus, "rug", undefined, filenameApproved);
  assert.equal(filenameFilteredPayload.items[0].composedMockups.length, 1);
  assert.equal(filenameFilteredPayload.items[0].composedMockups[0].mockupUrl, "/api/assets/wf_approval_test/mockup_room_2.jpg");
});

test("Mock client handoverToSeo returns proper response with accurate counts", async () => {
  const mockPayload = {
    workflowId: "wf_test_handover",
    success: true as const,
    productType: "rug" as const,
    totalProduced: 1,
    items: [
      {
        designId: "design_rug_1",
        sourceCandidateId: "cand_1",
        productType: "rug" as const,
        originalPinTitle: "Test Pin",
        trendKeywords: ["trend"],
        printMaster: {
          cmykUrl: "/api/cmyk.jpg",
          rgbUrl: "/api/rgb.png",
          widthPx: 4000,
          heightPx: 6400,
          dpi: 300 as const,
          colorMode: "CMYK" as const,
          label: "4000 x 6400 px @ 300 DPI (CMYK)",
          badge: "✓ Chuẩn in xưởng: 4000 x 6400 px @ 300 DPI (CMYK)",
        },
        cutoutProduct: {
          transparentUrl: "/api/trans.png",
          whiteBgUrl: "/api/white.jpg",
        },
        composedMockups: [
          {
            referenceImageId: "ref_1",
            mockupUrl: "/api/mock_1.jpg",
            detectedSceneType: "living_room",
            detectedSceneDescription: "Living room",
          },
          {
            referenceImageId: "ref_2",
            mockupUrl: "/api/mock_2.jpg",
            detectedSceneType: "bedroom",
            detectedSceneDescription: "Bedroom",
          },
        ],
      },
    ],
  };

  const res = await mockPinterestPodClient.handoverToSeo(mockPayload);
  assert.equal(res.success, true);
  assert.equal(res.printMasterCount, 1);
  assert.equal(res.approvedMockupCount, 2);
  assert.match(res.message, /Bàn giao sang SEO thành công/);
});

test("Real client handoverToSeo and handoverToSeo function send POST to /api/pinterest-pod/handover-seo", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; method?: string; body?: unknown }[] = [];

  globalThis.fetch = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(
      JSON.stringify({
        ok: true,
        success: true,
        message: "Bàn giao sang SEO thành công: 1 file in xưởng và 2 mockup AI đã duyệt.",
        receivedAt: 1726900000000,
        printMasterCount: 1,
        approvedMockupCount: 2,
        savedPath: "data/pinterest_pod/output/wf_post_test/seo_handoff_payload.json",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  try {
    const payload = {
      workflowId: "wf_post_test",
      success: true as const,
      productType: "rug" as const,
      totalProduced: 1,
      items: [
        {
          designId: "design_rug_1",
          sourceCandidateId: "cand_1",
          productType: "rug" as const,
          originalPinTitle: "Test Rug",
          trendKeywords: ["rug"],
          printMaster: {
            cmykUrl: "/api/cmyk.jpg",
            rgbUrl: "/api/rgb.png",
            widthPx: 4000,
            heightPx: 6400,
            dpi: 300 as const,
            colorMode: "CMYK" as const,
            label: "4000 x 6400 px @ 300 DPI (CMYK)",
            badge: "✓ Chuẩn in xưởng: 4000 x 6400 px @ 300 DPI (CMYK)",
          },
          cutoutProduct: { transparentUrl: "", whiteBgUrl: "" },
          composedMockups: [
            {
              referenceImageId: "ref_1",
              mockupUrl: "/api/mock_1.jpg",
              detectedSceneType: "living_room",
              detectedSceneDescription: "Living room",
            },
          ],
        },
      ],
    };

    const res = await realPinterestPodClient.handoverToSeo(payload);
    assert.equal(res.success, true);
    assert.equal(res.printMasterCount, 1);
    assert.equal(res.approvedMockupCount, 2);
    assert.ok(
      calls.some(
        (c) =>
          c.url.includes("/api/pinterest-pod/handover-seo") &&
          c.method === "POST" &&
          (c.body as { workflowId?: string })?.workflowId === "wf_post_test",
      ),
    );

    const directRes = await handoverToSeo(payload);
    assert.equal(directRes.success, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

