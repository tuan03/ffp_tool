import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemorySiteNicheCache,
  SiteNicheResolver,
} from "../internal/site-niche/site-niche-resolver";
import {
  extractHomepageEvidence,
  parseNicheResponse,
} from "../internal/site-niche/site-niche-runtime";

test("cancelled niche inference does not start an AI request after homepage rendering", async () => {
  let finish: (() => void) | undefined;
  let analyses = 0;
  const resolver = new SiteNicheResolver({
    cache: new InMemorySiteNicheCache(),
    renderer: { async render() { await new Promise<void>(resolve => { finish = resolve; }); return "homepage"; } },
    analyzer: { async analyze() { analyses++; return "custom rugs"; } },
  });
  const controller = new AbortController();
  const request = resolver.resolve({ siteDomain: "example.com", fallbackNiche: "rugs", signal: controller.signal });
  const rejected = assert.rejects(request, { name: "AbortError" });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  finish?.();
  await rejected;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(analyses, 0);
});

test("SiteNicheResolver shares one rendered homepage inference across concurrent requests", async () => {
  let renderCount = 0;
  let analyzeCount = 0;
  let analyzedHomepageUrl: string | undefined;
  const resolver = new SiteNicheResolver({
    cache: new InMemorySiteNicheCache(),
    renderer: {
      async render(): Promise<string> {
        renderCount++;
        return "<html><head><title>Acme Outdoor</title></head><body><h1>Camping gear</h1></body></html>";
      },
    },
    analyzer: {
      async analyze(_renderedHtml: string, homepageUrl: string): Promise<string> {
        analyzeCount++;
        analyzedHomepageUrl = homepageUrl;
        return "outdoor camping gear";
      },
    },
  });

  const [first, second] = await Promise.all([
    resolver.resolve({ siteDomain: "acme.example", fallbackNiche: "general" }),
    resolver.resolve({ siteDomain: "https://acme.example/", fallbackNiche: "general" }),
  ]);

  assert.equal(first.niche, "outdoor camping gear");
  assert.equal(second.niche, "outdoor camping gear");
  assert.equal(renderCount, 1);
  assert.equal(analyzeCount, 1);
  assert.equal(analyzedHomepageUrl, "https://acme.example/");
});

test("SiteNicheResolver reuses a cached niche until its expiry", async () => {
  let rendered = 0;
  const resolver = new SiteNicheResolver({
    cache: new InMemorySiteNicheCache(),
    renderer: { async render(): Promise<string> { rendered++; return "<html />"; } },
    analyzer: { async analyze(): Promise<string> { return "custom rugs"; } },
  });

  const first = await resolver.resolve({ siteDomain: "cache.example", fallbackNiche: "manual" });
  const second = await resolver.resolve({ siteDomain: "cache.example", fallbackNiche: "manual" });

  assert.equal(first.source, "inferred");
  assert.equal(second.source, "cache");
  assert.equal(rendered, 1);
});

test("SiteNicheResolver refreshes an expired niche cache entry", async () => {
  let rendered = 0;
  const resolver = new SiteNicheResolver({
    cache: new InMemorySiteNicheCache(-1),
    renderer: { async render(): Promise<string> { rendered++; return "<html />"; } },
    analyzer: { async analyze(): Promise<string> { return "custom rugs"; } },
  });

  await resolver.resolve({ siteDomain: "expiry.example", fallbackNiche: "manual" });
  await resolver.resolve({ siteDomain: "expiry.example", fallbackNiche: "manual" });

  assert.equal(rendered, 2);
});

test("SiteNicheResolver returns the supplied niche when homepage inference fails", async () => {
  const resolver = new SiteNicheResolver({
    cache: new InMemorySiteNicheCache(),
    renderer: { async render(): Promise<string> { throw new Error("navigation failed"); } },
    analyzer: { async analyze(): Promise<string> { return "unused"; } },
  });

  const resolution = await resolver.resolve({
    siteDomain: "shop.example",
    fallbackNiche: "handmade gifts",
  });

  assert.deepEqual(resolution, {
    niche: "handmade gifts",
    source: "fallback",
    reason: "navigation failed",
  });
});

test("SiteNicheResolver uses manual niche without calling dependencies when siteDomain is absent", async () => {
  let calls = 0;
  const resolver = new SiteNicheResolver({
    cache: new InMemorySiteNicheCache(),
    renderer: { async render(): Promise<string> { calls++; return "<html />"; } },
    analyzer: { async analyze(): Promise<string> { calls++; return "unused"; } },
  });

  const resolution = await resolver.resolve({ siteDomain: "   ", fallbackNiche: "manual niche" });

  assert.deepEqual(resolution, { niche: "manual niche", source: "fallback" });
  assert.equal(calls, 0);
});

test("SiteNicheResolver blocks private storefront addresses before rendering", async () => {
  let rendered = false;
  const resolver = new SiteNicheResolver({
    cache: new InMemorySiteNicheCache(),
    renderer: { async render(): Promise<string> { rendered = true; return "<html />"; } },
    analyzer: { async analyze(): Promise<string> { return "unused"; } },
  });

  const resolution = await resolver.resolve({
    siteDomain: "http://172.16.0.1",
    fallbackNiche: "manual niche",
  });

  assert.equal(resolution.source, "fallback");
  assert.equal(rendered, false);
});

test("SiteNicheResolver blocks bracketed IPv6 loopback before rendering", async () => {
  let rendered = false;
  const resolver = new SiteNicheResolver({
    cache: new InMemorySiteNicheCache(),
    renderer: { async render(): Promise<string> { rendered = true; return "<html />"; } },
    analyzer: { async analyze(): Promise<string> { return "unused"; } },
  });

  const resolution = await resolver.resolve({
    siteDomain: "http://[::1]",
    fallbackNiche: "manual niche",
  });

  assert.equal(resolution.source, "fallback");
  assert.equal(rendered, false);
});

test("extractHomepageEvidence keeps bounded storefront signals without raw markup", () => {
  const evidence = extractHomepageEvidence(`
    <html>
      <head>
        <title>ChillGen Custom Rugs</title>
        <meta name="description" content="Personalized rugs for kids and classrooms">
        <script type="application/ld+json">{"@type":"Store","name":"ChillGen"}</script>
      </head>
      <body>
        <h1>Personalized rugs made for every room</h1>
        <h2>Kids rugs and classroom rugs</h2>
        <p>Make a custom rug with a name, photo, or school design.</p>
        <a href="/collections/kids-rugs">Kids rugs</a>
        <a href="https://other.example/products/item">External link</a>
        <script>window.secret = "must not appear";</script>
      </body>
    </html>
  `, "https://chillgen.com/");

  assert.match(evidence, /ChillGen Custom Rugs/);
  assert.match(evidence, /Personalized rugs made for every room/);
  assert.match(evidence, /Kids rugs\s*\|\s*\/collections\/kids-rugs/);
  assert.match(evidence, /\"@type\":\"Store\"/);
  assert.doesNotMatch(evidence, /window\.secret|<script|<h1/i);
});

test("parseNicheResponse accepts a structured niche wrapped in harmless model prose", () => {
  assert.equal(
    parseNicheResponse('Here is the JSON you requested: {"niche":"personalized kids rugs"}'),
    "personalized kids rugs",
  );
});
