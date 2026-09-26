import { SingleFlight } from "../single-flight";
export interface SiteNicheResolution {
  readonly niche: string;
  readonly source: "cache" | "inferred" | "fallback";
  readonly reason?: string;
}

export interface SiteNicheCache {
  get(domain: string): Promise<string | undefined>;
  set(domain: string, niche: string): Promise<void>;
}

export interface RenderedHomepageRenderer {
  render(url: string, signal?: AbortSignal): Promise<string>;
}

export interface HomepageNicheAnalyzer {
  analyze(renderedHtml: string, homepageUrl: string, signal?: AbortSignal): Promise<string>;
}

export class InMemorySiteNicheCache implements SiteNicheCache {
  private readonly entries = new Map<string, { readonly niche: string; readonly expiresAt: number }>();

  public constructor(private readonly ttlMs: number = 24 * 60 * 60 * 1000) {}

  public async get(domain: string): Promise<string | undefined> {
    const entry = this.entries.get(domain);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.entries.delete(domain);
      return undefined;
    }
    return entry.niche;
  }

  public async set(domain: string, niche: string): Promise<void> {
    this.entries.set(domain, { niche, expiresAt: Date.now() + this.ttlMs });
  }
}

export interface SiteNicheResolverDependencies {
  readonly cache: SiteNicheCache;
  readonly renderer: RenderedHomepageRenderer;
  readonly analyzer: HomepageNicheAnalyzer;
}

function normalizeDomain(siteDomain: string): { readonly key: string; readonly url: string } {
  const trimmed = siteDomain.trim();
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(candidate);
  if (!/^https?:$/.test(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error("siteDomain must be a public HTTP(S) storefront domain");
  }
  const hostname = url.hostname.toLowerCase();
  if (isPrivateOrLocalHost(hostname)) {
    throw new Error("siteDomain must not target a local or private address");
  }
  return { key: hostname, url: `${url.protocol}//${url.host}/` };
}

function safeReason(error: unknown): string {
  return error instanceof Error && error.message ? error.message.slice(0, 240) : "niche inference failed";
}

export class SiteNicheResolver {
  private readonly inFlight = new SingleFlight<SiteNicheResolution>();

  public constructor(private readonly dependencies: SiteNicheResolverDependencies) {}

  public async resolve(input: {
    readonly signal?: AbortSignal;
    readonly siteDomain: string;
    readonly fallbackNiche: string;
  }): Promise<SiteNicheResolution> {
    input.signal?.throwIfAborted();
    if (!input.siteDomain.trim()) {
      return { niche: input.fallbackNiche, source: "fallback" };
    }
    let normalized: { readonly key: string; readonly url: string };
    try {
      normalized = normalizeDomain(input.siteDomain);
    } catch (error) {
      return { niche: input.fallbackNiche, source: "fallback", reason: safeReason(error) };
    }

    const cached = await this.dependencies.cache.get(normalized.key);
    if (cached) return { niche: cached, source: "cache" };

    return this.inFlight.join(normalized.key, signal => this.infer(normalized, input.fallbackNiche, signal), input.signal);
  }

  private async infer(
    normalized: { readonly key: string; readonly url: string },
    fallbackNiche: string,
    signal: AbortSignal,
  ): Promise<SiteNicheResolution> {
    try {
      const renderedHtml = await this.dependencies.renderer.render(normalized.url, signal);
      signal.throwIfAborted();
      const niche = (await this.dependencies.analyzer.analyze(renderedHtml, normalized.url, signal)).trim();
      signal.throwIfAborted();
      if (!niche) throw new Error("niche analyzer returned an empty niche");
      await this.dependencies.cache.set(normalized.key, niche);
      return { niche, source: "inferred" };
    } catch (error) {
      signal.throwIfAborted();
      return { niche: fallbackNiche, source: "fallback", reason: safeReason(error) };
    }
  }
}
import { isPrivateOrLocalHost } from "../image-processing/image-source-loader";
