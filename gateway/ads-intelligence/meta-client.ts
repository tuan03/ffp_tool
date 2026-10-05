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

  private async request<T>(endpoint: string, queryParams: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/${endpoint.replace(/^\//, "")}`);
    url.searchParams.set("access_token", this.options.accessToken);
    for (const [k, v] of Object.entries(queryParams)) {
      url.searchParams.set(k, v);
    }

    const res = await undiciFetch(url.toString(), {
      dispatcher: this.dispatcher,
      headers: {
        Accept: "application/json",
      },
    });

    const json = (await res.json()) as { error?: { message: string; type: string; code: number; error_subcode?: number } };
    if (!res.ok || json.error) {
      const err = json.error;
      throw new Error(`Meta API error (${res.status}): ${err?.message ?? "Unknown error"} [code: ${err?.code ?? res.status}]`);
    }

    return json as T;
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
