import { validateSafeUrl } from "../image-processing/image-source-loader";
import { GoogleGenAIVertexContentGenerator } from "../product-understanding/gemini-content-generator";
import {
  type HomepageNicheAnalyzer,
  InMemorySiteNicheCache,
  type RenderedHomepageRenderer,
  type SiteNicheCache,
  SiteNicheResolver,
} from "./site-niche-resolver";

const NICHE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: { niche: { type: "string" } },
  required: ["niche"],
  additionalProperties: false,
};

const MAX_EVIDENCE_CHARS = 24_000;
const MAX_EVIDENCE_ITEMS = 24;

function compactText(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getAttribute(attributes: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attributes.match(new RegExp(`\\b${escapedName}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match?.[2]?.trim();
}

function collectMatches(html: string, expression: RegExp): readonly string[] {
  const values: string[] = [];
  for (const match of html.matchAll(expression)) {
    const value = compactText(match[1] ?? "");
    if (value) values.push(value);
    if (values.length >= MAX_EVIDENCE_ITEMS) break;
  }
  return values;
}

/** Creates bounded, markup-free homepage evidence for the niche-only Gemini prompt. */
export function extractHomepageEvidence(renderedHtml: string, homepageUrl: string): string {
  const title = collectMatches(renderedHtml, /<title[^>]*>([\s\S]*?)<\/title>/gi)[0];
  const meta: string[] = [];
  for (const match of renderedHtml.matchAll(/<meta\s+([^>]+)>/gi)) {
    const attributes = match[1] ?? "";
    const name = getAttribute(attributes, "name") ?? getAttribute(attributes, "property");
    const content = getAttribute(attributes, "content");
    if (name && content && /^(description|keywords|og:title|og:description)$/i.test(name)) {
      meta.push(`${name}: ${compactText(content)}`);
    }
    if (meta.length >= MAX_EVIDENCE_ITEMS) break;
  }

  const headings = collectMatches(renderedHtml, /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi);
  const links: string[] = [];
  const homepageOrigin = new URL(homepageUrl).origin;
  for (const match of renderedHtml.matchAll(/<a\s+([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = getAttribute(match[1] ?? "", "href");
    const label = compactText(match[2] ?? "");
    if (!href || !label) continue;
    try {
      const target = new URL(href, homepageUrl);
      if (target.origin === homepageOrigin) links.push(`${label} | ${target.pathname}`);
    } catch {
      // Invalid href values are irrelevant to this bounded evidence.
    }
    if (links.length >= MAX_EVIDENCE_ITEMS) break;
  }

  const jsonLd: string[] = [];
  for (const match of renderedHtml.matchAll(/<script\s+[^>]*type\s*=\s*(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi)) {
    const value = compactText(match[2] ?? "");
    if (value) jsonLd.push(value);
    if (jsonLd.length >= MAX_EVIDENCE_ITEMS) break;
  }
  const visibleText = compactText(
    renderedHtml.replace(/<(script|style|template|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " "),
  );

  return [
    title ? `Title: ${title}` : "",
    meta.length ? `Meta: ${meta.join("; ")}` : "",
    headings.length ? `Headings: ${headings.join(" | ")}` : "",
    links.length ? `Internal links: ${links.join("; ")}` : "",
    jsonLd.length ? `JSON-LD: ${jsonLd.join(" | ")}` : "",
    visibleText ? `Visible text: ${visibleText}` : "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_EVIDENCE_CHARS);
}

/** Reads the only accepted field while tolerating harmless Markdown/prose wrappers from a model. */
export function parseNicheResponse(rawText: string): string {
  const trimmed = rawText.trim().replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/\s*```$/, "");
  const jsonCandidate = trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch (error) {
    throw new Error(`Gemini returned invalid niche JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const niche = parsed && typeof parsed === "object" ? (parsed as { niche?: unknown }).niche : undefined;
  if (typeof niche !== "string" || !niche.trim()) {
    throw new Error("Gemini returned an invalid niche response");
  }
  return niche.trim();
}

type BetterSqlite3Database = {
  exec(sql: string): void;
  prepare(sql: string): {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): unknown;
  };
};

class SqliteSiteNicheCache implements SiteNicheCache {
  private dbPromise: Promise<BetterSqlite3Database> | undefined;

  private async getDb(): Promise<BetterSqlite3Database> {
    if (!this.dbPromise) {
      this.dbPromise = (async () => {
        const dynamicImport = new Function("specifier", "return import(specifier)") as (
          specifier: string,
        ) => Promise<unknown>;
        const [databaseModule, fsModule, pathModule] = await Promise.all([
          dynamicImport("better-sqlite3") as Promise<{ default?: new (filename: string) => BetterSqlite3Database } | (new (filename: string) => BetterSqlite3Database)>,
          dynamicImport("node:fs") as Promise<{ default?: typeof import("node:fs") } & typeof import("node:fs")>,
          dynamicImport("node:path") as Promise<{ default?: typeof import("node:path") } & typeof import("node:path")>,
        ]);
        const Database = (typeof databaseModule === "function" ? databaseModule : (databaseModule as { default: new (filename: string) => BetterSqlite3Database }).default);
        const path = pathModule.default ?? pathModule;
        const fs = fsModule.default ?? fsModule;
        const cachePath = path.resolve(process.cwd(), ".local-data", "seo-content-niche.sqlite3");
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        const db = new Database(cachePath);
        db.exec("CREATE TABLE IF NOT EXISTS site_niche_cache (domain TEXT PRIMARY KEY, niche TEXT NOT NULL, expires_at INTEGER NOT NULL)");
        return db;
      })();
    }
    return this.dbPromise;
  }

  public async get(domain: string): Promise<string | undefined> {
    const db = await this.getDb();
    const row = db.prepare("SELECT niche FROM site_niche_cache WHERE domain = ? AND expires_at > ?").get(domain, Date.now()) as { niche?: string } | undefined;
    return row?.niche;
  }

  public async set(domain: string, niche: string): Promise<void> {
    const db = await this.getDb();
    db.prepare("INSERT INTO site_niche_cache(domain, niche, expires_at) VALUES (?, ?, ?) ON CONFLICT(domain) DO UPDATE SET niche = excluded.niche, expires_at = excluded.expires_at").run(domain, niche, Date.now() + 86_400_000);
  }
}

class PlaywrightHomepageRenderer implements RenderedHomepageRenderer {
  public async render(url: string): Promise<string> {
    validateSafeUrl(url);
    const dynamicImport = new Function("specifier", "return import(specifier)") as (
      specifier: string,
    ) => Promise<unknown>;
    const module = await dynamicImport("playwright");
    if (!module || typeof module !== "object" || !("chromium" in module)) {
      throw new Error("Playwright Chromium is unavailable");
    }
    const chromium = (module as { chromium: { launch(): Promise<{
      newPage(options: { userAgent: string }): Promise<{
        goto(target: string, options: { waitUntil: "domcontentloaded"; timeout: number }): Promise<unknown>;
        waitForLoadState(state: "networkidle", options: { timeout: number }): Promise<void>;
        content(): Promise<string>;
        url(): string;
        route(
          pattern: string,
          handler: (route: {
            request(): { url(): string };
            continue(): Promise<void>;
            abort(reason: string): Promise<void>;
          }) => Promise<void>,
        ): Promise<void>;
      }>;
      close(): Promise<void>;
    }> } }).chromium;
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ userAgent: "FFP SEO Niche Resolver/1.0" });
      await page.route("**/*", async (route) => {
        const requestUrl = route.request().url();
        try {
          if (/^https?:/i.test(requestUrl)) validateSafeUrl(requestUrl);
          await route.continue();
        } catch {
          await route.abort("blockedbyclient");
        }
      });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
      try {
        await page.waitForLoadState("networkidle", { timeout: 5_000 });
      } catch {
        // Long-polling storefronts can remain active indefinitely; retain the rendered DOM.
      }
      validateSafeUrl(page.url());
      return await page.content();
    } finally {
      await browser.close();
    }
  }
}

class GeminiHomepageNicheAnalyzer implements HomepageNicheAnalyzer {
  public async analyze(renderedHtml: string, homepageUrl: string): Promise<string> {
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    if (!projectId) throw new Error("GOOGLE_CLOUD_PROJECT is required for dynamic niche inference");
    const evidence = extractHomepageEvidence(renderedHtml, homepageUrl);
    const generator = new GoogleGenAIVertexContentGenerator({ projectId });
    const response = await generator.generateStructuredText?.({
      systemInstruction: "Infer the storefront's concise ecommerce niche from rendered homepage evidence. The niche must be 2 to 8 words. Return JSON only.",
      prompt: `Homepage evidence:\n${evidence}`,
      responseJsonSchema: NICHE_SCHEMA,
      maxOutputTokens: 256,
      temperature: 0,
      thinkingBudget: 0,
    });
    if (!response) throw new Error("Gemini structured text generation is unavailable");
    return parseNicheResponse(response.rawText);
  }
}

let defaultResolver: SiteNicheResolver | undefined;

export function getDefaultSiteNicheResolver(): SiteNicheResolver {
  if (typeof window !== "undefined") {
    defaultResolver ??= new SiteNicheResolver({
      cache: new InMemorySiteNicheCache(),
      renderer: {
        async render(): Promise<string> {
          throw new Error("Homepage rendering is not supported in the browser");
        },
      },
      analyzer: {
        async analyze(): Promise<string> {
          throw new Error("Homepage analysis is not supported in the browser");
        },
      },
    });
    return defaultResolver;
  }

  const isTestEnvironment =
    typeof process !== "undefined" &&
    (process.env?.NODE_ENV === "test" ||
      (Array.isArray(process.execArgv) && process.execArgv.includes("--test")) ||
      (Array.isArray(process.argv) && process.argv.some((argument) => argument.endsWith(".test.ts") || argument.endsWith(".test.js"))));
  defaultResolver ??= new SiteNicheResolver({
    cache: new SqliteSiteNicheCache(),
    renderer: isTestEnvironment
      ? { async render(): Promise<string> { throw new Error("Homepage rendering is disabled in tests"); } }
      : new PlaywrightHomepageRenderer(),
    analyzer: new GeminiHomepageNicheAnalyzer(),
  });
  return defaultResolver;
}
