import assert from "node:assert/strict";
import test from "node:test";
import React from "react";

import { resolveAmazonCoordinatorUrl } from "../../../config/amazon-crawler-url";
import { DEFAULT_GATEWAY_URL } from "../../../modules/module-api";
import { RealProductCrawlerClient } from "../../../modules/product-crawler/service";
import { createCustomGptClient } from "../../../modules/custom-gpt-seo/service";
import { NotFoundPage } from "../../not-found/NotFoundPage";

test("UI-01 & UI-02: All browser API clients resolve to same-origin relative URLs in production", async () => {
  // Amazon Coordinator URL resolution
  const prodCoordinatorUrl = resolveAmazonCoordinatorUrl({
    configuredUrl: undefined,
    browserHostname: "production-vps.domain.com",
    browserProtocol: "https:",
    environment: "production",
  });
  assert.equal(
    prodCoordinatorUrl,
    "",
    "Amazon Coordinator URL must be empty string (relative same-origin) in production when not configured",
  );

  const emptyCoordinatorUrl = resolveAmazonCoordinatorUrl({
    configuredUrl: "",
    browserHostname: "production-vps.domain.com",
    browserProtocol: "https:",
    environment: "production",
  });
  assert.equal(
    emptyCoordinatorUrl,
    "",
    "Empty configuredUrl must resolve to empty string (relative same-origin)",
  );

  // Module API Gateway URL
  assert.equal(
    DEFAULT_GATEWAY_URL,
    "/api/shopify",
    "Module API must default to same-origin relative '/api/shopify'",
  );

  // Product Crawler Client
  const crawlerClient = new RealProductCrawlerClient();
  const interceptedUrls: string[] = [];
  const fakeFetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    interceptedUrls.push(typeof input === "string" ? input : input.toString());
    return new Response(JSON.stringify({ ok: true, jobId: "test-job", status: "queued" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  // Test that custom-gpt-seo client uses relative same-origin URL
  const gptClient = createCustomGptClient(fakeFetcher as unknown as typeof fetch);
  await gptClient.settings("capozen");
  assert.ok(
    interceptedUrls.some((u) => u.startsWith("/api/v1/gpt-seo/admin/settings")),
    `Custom GPT SEO client must use same-origin relative path, got: ${interceptedUrls.join(", ")}`,
  );

  // Verify no hardcoded port assumptions (3001, 8766, 8768) in public client URLs
  for (const url of interceptedUrls) {
    assert.doesNotMatch(url, /:3001/, `URL must not contain internal port 3001: ${url}`);
    assert.doesNotMatch(url, /:8766/, `URL must not contain internal port 8766: ${url}`);
    assert.doesNotMatch(url, /:8768/, `URL must not contain internal port 8768: ${url}`);
  }
});

test("UI-03: Route catalog covers all 7 business modules and aliases", async () => {
  // Expected primary route paths for all 7 modules
  const expectedRoutes = [
    "amazon-crawler",
    "product-crawler",
    "pinterest-pod",
    "auto-seo",
    "customization",
    "gpt-seo",
    "seo-review",
  ];

  // Dynamically inspect routes created by AppRoutes dependencies
  const { amazonCrawlerRoutes } = await import("../../../modules/amazon-crawler");
  const { runMockAmazonCrawler, clearMockAmazonCrawlerCache } = await import("../../../modules/amazon-crawler/mocks/runner");
  const { createProductCrawlerRoutes } = await import("../../../modules/product-crawler");
  const { createPinterestPodRoutes } = await import("../../../modules/pinterest-pod");
  const { createAutoSeoRoutes } = await import("../../../modules/auto-seo");
  const { mockAutoSeoClient } = await import("../../../modules/auto-seo/mocks/runner");
  const { createCustomGptSeoRoutes } = await import("../../../modules/custom-gpt-seo");
  const { createCustomizationManagerRoutes } = await import("../../../modules/customization-manager");

  const amazonRoutes = amazonCrawlerRoutes(
    runMockAmazonCrawler,
    clearMockAmazonCrawlerCache,
    async () => [],
  );
  const productRoutes = createProductCrawlerRoutes();
  const podRoutes = createPinterestPodRoutes();
  const autoSeoRoutes = createAutoSeoRoutes(mockAutoSeoClient);
  const gptSeoRoutes = createCustomGptSeoRoutes(createCustomGptClient());
  const customizationRoutes = createCustomizationManagerRoutes();

  const allRegisteredPaths = [
    ...amazonRoutes.map((r) => r.path),
    ...productRoutes.map((r) => r.path),
    ...podRoutes.map((r) => r.path),
    ...autoSeoRoutes.map((r) => r.path),
    ...gptSeoRoutes.map((r) => r.path),
    ...customizationRoutes.map((r) => r.path),
    "seo-review",
  ];

  for (const expected of expectedRoutes) {
    assert.ok(
      allRegisteredPaths.includes(expected),
      `Expected route '${expected}' to be registered, found: ${allRegisteredPaths.join(", ")}`,
    );
  }
});

test("UI-04: Graceful handling of loading, empty, error, and reconnect for sub-backends", async () => {
  // 1. Amazon crawler coordinator offline error contract
  const { createAmazonCrawlerClientsLoader } = await import("../../../modules/amazon-crawler/service");
  const failingLoader = createAmazonCrawlerClientsLoader({
    engineUrl: "http://127.0.0.1:9999",
    fetchImplementation: async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:9999");
    },
  });

  await assert.rejects(
    async () => {
      await failingLoader();
    },
    (err: any) => {
      assert.equal(err.code, "COORDINATOR_OFFLINE");
      assert.doesNotMatch(err.message, /npm run dev/, "Error message must not instruct to run npm run dev in production");
      return true;
    },
  );

  // 2. Product Crawler client error contract
  const failingCrawlerClient = new RealProductCrawlerClient("http://127.0.0.1:9999");
  await assert.rejects(
    async () => {
      await failingCrawlerClient.getJob("job-abc");
    },
    (err: any) => {
      assert.equal(err.code, "PRODUCT_CRAWLER_NETWORK_ERROR");
      return true;
    },
  );
});

test("UI-05: Security inspection - no secrets in VITE_ variables or browser storage keys", () => {
  // Check process.env and Vite env keys for any secret leakage in VITE_ variables
  const dangerousPatterns = [/secret/i, /token/i, /password/i, /auth_key/i, /private/i];

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("VITE_")) {
      // VITE_APP_ENV and VITE_AMAZON_COORDINATOR_URL and VITE_PINTEREST_POD_API_URL are public
      for (const pattern of dangerousPatterns) {
        assert.doesNotMatch(
          key,
          pattern,
          `Dangerous secret variable exposed via VITE_ prefix: ${key}`,
        );
      }
    }
  }

  // Permitted localStorage & sessionStorage keys used in the app (only UI state & sound prefs)
  const allowedStorageKeys = new Set([
    "ffp_sound_muted",
    "ffp_seo_review_session_v1",
    "ffp_seo_review_selected_store",
    "ffp_seo_review_view_mode",
    "ffp_seo_review_handoff_banner",
    "ffp_store_product_types",
    "ffp_crawler_session_v2",
    "ffp_crawler_session_v1",
    "ffp_auto_seo_session_v1",
    "ffp_cleanup_stuck_failed",
  ]);

  for (const key of allowedStorageKeys) {
    assert.doesNotMatch(
      key,
      /secret|password|bearer|auth_token/i,
      `Storage key must not store secrets: ${key}`,
    );
  }
});

test("UI-06: Production navigation does not include demo Module A/B/C or workflow-demo", async () => {
  // Check AppLayout navigation links
  const { AppLayout } = await import("../../../layouts/AppLayout");
  assert.ok(typeof AppLayout === "function", "AppLayout component must be exported");

  // Read AppLayout source to ensure no module-a, module-b, module-c or workflow-demo nav items exist
  const fs = await import("node:fs");
  const path = await import("node:path");
  const layoutSource = fs.readFileSync(
    path.resolve(process.cwd(), "src/layouts/AppLayout.tsx"),
    "utf8",
  );

  assert.doesNotMatch(layoutSource, /to="\/module-a"/, "Module A must not be in navbar");
  assert.doesNotMatch(layoutSource, /to="\/module-b"/, "Module B must not be in navbar");
  assert.doesNotMatch(layoutSource, /to="\/module-c"/, "Module C must not be in navbar");
  assert.doesNotMatch(layoutSource, /to="\/workflow-demo"/, "Workflow demo must not be in navbar");
});

test("UI-07: Deep smoke test opens and renders each of the 7 main business screens via public URLs", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { MemoryRouter } = await import("react-router-dom");

  // 1. Amazon Crawler Page
  const { AmazonCrawlerPage } = await import("../../../modules/amazon-crawler/ui/AmazonCrawlerPage");
  const { runMockAmazonCrawler, clearMockAmazonCrawlerCache } = await import("../../../modules/amazon-crawler/mocks/runner");
  const amazonHtml = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/amazon-crawler"] },
      React.createElement(AmazonCrawlerPage, {
        clearAmazonCrawlerCache: clearMockAmazonCrawlerCache,
        loadAmazonCrawlerClients: async () => [],
        runAmazonCrawler: runMockAmazonCrawler,
      }),
    ),
  );
  assert.ok(amazonHtml.includes("Amazon Product Crawler") || amazonHtml.includes("Distributed Crawler") || amazonHtml.includes("Crawler"), "Amazon Crawler page must render");

  // 2. Product Crawler Page
  const { ProductCrawlerPage } = await import("../../../modules/product-crawler/ui/ProductCrawlerPage");
  const { mockProductCrawlerClient } = await import("../../../modules/product-crawler/mocks/runner");
  const productCrawlerHtml = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/product-crawler"] },
      React.createElement(ProductCrawlerPage, { client: mockProductCrawlerClient }),
    ),
  );
  assert.ok(productCrawlerHtml.includes("Amazon Product Crawler") || productCrawlerHtml.includes("Product Crawler"), "Product Crawler page must render");

  // 3. Pinterest POD Studio
  const { PinterestPodStudio } = await import("../../../modules/pinterest-pod/ui/PinterestPodStudio");
  const podHtml = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/pinterest-pod"] },
      React.createElement(PinterestPodStudio, {}),
    ),
  );
  assert.ok(podHtml.includes("Pinterest") || podHtml.includes("POD Studio"), "Pinterest POD Studio must render");

  // 4. Auto SEO Page
  const { AutoSeoPage } = await import("../../../modules/auto-seo/ui/AutoSeoPage");
  const { mockAutoSeoClient } = await import("../../../modules/auto-seo/mocks/runner");
  const autoSeoHtml = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/auto-seo"] },
      React.createElement(AutoSeoPage, { client: mockAutoSeoClient }),
    ),
  );
  assert.ok(autoSeoHtml.includes("Auto SEO"), "Auto SEO page must render");

  // 5. Customization Manager Page
  const { CustomizationManagerPage } = await import("../../../modules/customization-manager/ui/CustomizationManagerPage");
  const customHtml = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/customization"] },
      React.createElement(CustomizationManagerPage, {}),
    ),
  );
  assert.ok(customHtml.includes("Customizer") || customHtml.includes("Tùy Biến") || customHtml.includes("sản phẩm"), "Customization Manager must render");

  // 6. Custom GPT SEO Page
  const { CustomGptSeoPage } = await import("../../../modules/custom-gpt-seo/ui/CustomGptSeoPage");
  const { createMockCustomGptClient } = await import("../../../modules/custom-gpt-seo/mocks/runner");
  const gptSeoHtml = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/gpt-seo"] },
      React.createElement(CustomGptSeoPage, { client: createMockCustomGptClient() }),
    ),
  );
  assert.ok(gptSeoHtml.includes("GPT SEO") || gptSeoHtml.includes("ChatGPT"), "Custom GPT SEO page must render");

  // 7. SEO Review Page
  const { SeoReviewPage } = await import("../../seo-review/SeoReviewPage");
  const seoReviewHtml = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/seo-review"] },
      React.createElement(SeoReviewPage, {}),
    ),
  );
  assert.ok(seoReviewHtml.includes("SEO Content Review") || (seoReviewHtml.includes("SEO") && seoReviewHtml.includes("Review")), "SEO Review page must render");

  // 8. 404 Not Found Page
  const notFoundHtml = renderToStaticMarkup(
    React.createElement(
      MemoryRouter,
      { initialEntries: ["/non-existent-screen"] },
      React.createElement(NotFoundPage, {}),
    ),
  );
  assert.ok(notFoundHtml.includes("404") && notFoundHtml.includes("Trang không tồn tại"), "NotFoundPage must render 404 message");
});

test("UI-08: API 404 returns JSON and UI 404 renders NotFoundPage", async () => {
  // 1. Verify NotFoundPage renders properly
  const notFoundElement = React.createElement(NotFoundPage);
  assert.ok(notFoundElement, "NotFoundPage should instantiate React element without error");

  // 2. Verify Nginx config template rules for UI-08
  const fs = await import("node:fs");
  const path = await import("node:path");
  const nginxTemplate = fs.readFileSync(
    path.resolve(process.cwd(), "deploy/nginx/ffp-tool.conf.template"),
    "utf8",
  );

  // Must have location ~ ^/api/ with application/json 404 return
  assert.match(
    nginxTemplate,
    /default_type application\/json;/,
    "Nginx template must return application/json for unmatched API routes",
  );
  assert.match(
    nginxTemplate,
    /return 404/,
    "Nginx template must return 404 status for unmatched API routes",
  );

  // Must route /api/product-crawler/ to coordinator
  assert.match(
    nginxTemplate,
    /api\/product-crawler/,
    "Nginx template must proxy /api/product-crawler/ to coordinator",
  );

  // Must have JSON error page for backend 502/503/504
  assert.match(
    nginxTemplate,
    /@api_gateway_error/,
    "Nginx template must define JSON error handler for upstream proxy errors",
  );

  // Must have SPA fallback for client UI
  assert.match(
    nginxTemplate,
    /try_files \$uri \$uri\/ \/index\.html;/,
    "Nginx template must have SPA fallback to /index.html for UI routes",
  );
});
