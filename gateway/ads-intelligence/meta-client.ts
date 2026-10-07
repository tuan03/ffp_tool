/**
 * FFP Ads Intelligence — Meta Marketing API Client (v26.0)
 * Read-only adapter using ProxyAgent for reliable delivery.
 */
import { ProxyAgent, fetch as undiciFetch } from "undici";

export interface MetaAccountRaw {
  readonly id: string;
  readonly name: string;
  readonly account_status: number;
  readonly currency: string;
  readonly timezone_name: string;
}

export interface MetaCampaignRaw {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly effective_status: string;
  readonly daily_budget?: string;
  readonly lifetime_budget?: string;
  readonly objective?: string;
  readonly created_time?: string;
}

export interface MetaAdSetRaw {
  readonly id: string;
  readonly name: string;
  readonly campaign_id: string;
  readonly status: string;
  readonly effective_status: string;
  readonly daily_budget?: string;
  readonly lifetime_budget?: string;
  readonly optimization_goal?: string;
  readonly created_time?: string;
}

export interface MetaAdRaw {
  readonly id: string;
  readonly name: string;
  readonly campaign_id: string;
  readonly adset_id: string;
  readonly status: string;
  readonly effective_status: string;
  readonly created_time?: string;
}

export interface MetaActionRaw {
  readonly action_type: string;
  readonly value: string;
}

export interface MetaInsightRaw {
  readonly campaign_id?: string;
  readonly campaign_name?: string;
  readonly adset_id?: string;
  readonly adset_name?: string;
  readonly ad_id?: string;
  readonly ad_name?: string;
  readonly spend: string;
  readonly impressions: string;
  readonly clicks: string;
  readonly cpc?: string;
  readonly cpm?: string;
  readonly ctr?: string;
  readonly date_start?: string;
  readonly date_stop?: string;
  readonly actions?: readonly MetaActionRaw[];
  readonly action_values?: readonly MetaActionRaw[];
}

export interface MetaClientOptions {
  readonly accessToken: string;
  readonly proxyUrl?: string;
  readonly apiVersion?: string;
}

export class MetaClient {
  private readonly baseUrl: string;
  private readonly dispatcher?: ProxyAgent;

  constructor(private readonly options: MetaClientOptions) {
    const version = options.apiVersion ?? "v26.0";
    this.baseUrl = `https://graph.facebook.com/${version}`;
    if (options.proxyUrl) {
      this.dispatcher = new ProxyAgent(options.proxyUrl);
    }
  }

  private isRetryable(status: number, errorCode?: number): boolean {
    if (status === 429 || status === 502 || status === 503 || status === 504) return true;
    // Meta specific rate-limit / transient error codes:
    // 17: User request limit reached
    // 32: Page request limit reached
    // 80004: There have been too many calls to this ad-account
    // 1: An unknown error occurred (transient internal Meta glitch)
    // 2: An unexpected error has occurred
    if (errorCode === 17 || errorCode === 32 || errorCode === 80004 || errorCode === 1 || errorCode === 2) {
      return true;
    }
    return false;
  }

  private async request<T>(endpoint: string, queryParams: Record<string, string> = {}, maxRetries = 2): Promise<T> {
    const url = new URL(`${this.baseUrl}/${endpoint.replace(/^\//, "")}`);
    url.searchParams.set("access_token", this.options.accessToken);
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v);
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await undiciFetch(url.toString(), {
          dispatcher: this.dispatcher,
          headers: {
            Accept: "application/json",
          },
        });

        const json = (await res.json()) as { error?: { message: string; type: string; code: number; error_subcode?: number } };
        if (!res.ok || json.error) {
          const err = json.error;
          const status = res.status;
          const code = err?.code ?? status;

          if (attempt < maxRetries && this.isRetryable(status, err?.code)) {
            const delayMs = 300 * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
            await new Promise((r) => setTimeout(r, delayMs));
            continue;
          }

          throw new Error(`Meta API error (${res.status}): ${err?.message ?? "Unknown error"} [code: ${code}]`);
        }

        return json as T;
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        const isNetworkErr = err?.code === "ECONNRESET" || err?.code === "ETIMEDOUT" || err?.message?.includes("fetch failed");
        if (attempt < maxRetries && isNetworkErr) {
          const delayMs = 300 * Math.pow(2, attempt) + Math.floor(Math.random() * 100);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw lastError;
      }
    }

    throw lastError ?? new Error("Meta API request failed after retries");
  }

  async getAccount(accountId: string): Promise<MetaAccountRaw> {
    const normalizedId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
    return this.request<MetaAccountRaw>(normalizedId, {
      fields: "id,name,account_status,currency,timezone_name",
    });
  }

  async getAdAccounts(): Promise<readonly MetaAccountRaw[]> {
    const res = await this.request<{ data?: readonly MetaAccountRaw[] }>("me/adaccounts", {
      fields: "id,name,account_status,currency,timezone_name",
      limit: "100",
    });
    return res.data ?? [];
  }

  async getAccountInsights(accountId: string, datePreset = "maximum"): Promise<readonly MetaInsightRaw[]> {
    const normalizedId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
    const res = await this.request<{ data?: readonly MetaInsightRaw[] }>(`${normalizedId}/insights`, {
      date_preset: datePreset,
      fields: "spend,impressions,clicks,cpc,cpm,ctr,actions,action_values,date_start,date_stop",
    });
    return res.data ?? [];
  }

  async getCampaigns(accountId: string): Promise<readonly MetaCampaignRaw[]> {
    const normalizedId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
    const res = await this.request<{ data?: readonly MetaCampaignRaw[] }>(`${normalizedId}/campaigns`, {
      fields: "id,name,status,effective_status,daily_budget,lifetime_budget,objective,created_time",
      limit: "50",
    });
    return res.data ?? [];
  }

  async getAdSets(accountId: string): Promise<readonly MetaAdSetRaw[]> {
    const normalizedId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
    const res = await this.request<{ data?: readonly MetaAdSetRaw[] }>(`${normalizedId}/adsets`, {
      fields: "id,name,campaign_id,status,effective_status,daily_budget,lifetime_budget,optimization_goal,created_time",
      limit: "100",
    });
    return res.data ?? [];
  }

  async getAds(accountId: string): Promise<readonly MetaAdRaw[]> {
    const normalizedId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
    const res = await this.request<{ data?: readonly MetaAdRaw[] }>(`${normalizedId}/ads`, {
      fields: "id,name,campaign_id,adset_id,status,effective_status,created_time",
      limit: "100",
    });
    return res.data ?? [];
  }

  async getInsightsByLevel(accountId: string, level: "campaign" | "adset" | "ad", datePreset = "maximum"): Promise<readonly MetaInsightRaw[]> {
    const normalizedId = accountId.startsWith("act_") ? accountId : `act_${accountId}`;
    const idField = level === "campaign" ? "campaign_id,campaign_name" : level === "adset" ? "adset_id,adset_name" : "ad_id,ad_name";
    const res = await this.request<{ data?: readonly MetaInsightRaw[] }>(`${normalizedId}/insights`, {
      level,
      date_preset: datePreset,
      fields: `${idField},spend,impressions,clicks,cpc,cpm,ctr,actions,action_values,date_start,date_stop`,
      limit: "100",
    });
    return res.data ?? [];
  }
}
