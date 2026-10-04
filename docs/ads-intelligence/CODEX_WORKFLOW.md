# FFP Ads Intelligence — Codex & Custom GPT Integration Workflow

> **Document Version:** 1.0.0  
> **Applicable Tickets:** FFP-ADS-016 (Codex MCP Tools) & FFP-ADS-017 (Codex Workflow Context)  
> **Master Reference:** `docs/ads-intelligence/README.md` (Steps 16 & 17)

---

## 1. Overview & Dual Integration Architecture

The FFP Ads Intelligence system supports two primary AI agent integration protocols without exposing raw platform tokens (Meta, GA4, Shopify) to client LLMs:

```
                      ┌──────────────────────────────────────────────┐
                      │            AI Agent / LLM Client             │
                      │  (Codex CLI, Claude Desktop, Custom GPT)     │
                      └──────────────┬───────────────────────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 │                                       │
     (MCP Streamable HTTP)                     (REST / OpenAPI 3.1)
                 │                                       │
                 ▼                                       ▼
      POST /mcp/ads-intelligence              GET /api/ads-intelligence/*
      POST /mcp/ads                           POST /api/ads-intelligence/*
                 │                                       │
                 └───────────────────┬───────────────────┘
                                     │
                                     ▼
                      ┌──────────────────────────────┐
                      │    FFP Node.js Gateway       │
                      │    Port 3001 (Docker)        │
                      └──────────────┬───────────────┘
                                     │
         ┌───────────────────────────┼───────────────────────────┐
         ▼                           ▼                           ▼
  Meta Graph API v26.0         GA4 Data API             PostgreSQL / Memory
  (Ad Account act_1010...)     (Property 555699138)     (Briefs & Experiments)
```

1. **Model Context Protocol (MCP)**:
   - Implemented via `@modelcontextprotocol/sdk` using the standard **Streamable HTTP** transport.
   - Endpoint: `POST http://localhost:3001/mcp/ads` (or `/mcp/ads-intelligence`).
   - Info probe: `GET http://localhost:3001/mcp/ads` returns server capabilities and tool counts.
2. **OpenAPI 3.1.0 for Custom GPT Actions**:
   - Schema served dynamically at `GET http://localhost:3001/api/ads-intelligence/openapi.json`.
   - Static schema stored at `docs/ads-intelligence/openapi.json` for copy-pasting directly into OpenAI's Custom GPT Builder.

---

## 2. Tool Catalog & Dual Naming Convention

To ensure compatibility with both ticket specifications (`ads_*`) and the master README Step 16 catalog (`ffp_*`), every tool is registered with both names:

| Canonical Tool Name | README Step 16 Alias | Type | Description |
|---|---|---|---|
| `ads_get_store_overview` | `ffp_get_store_context` | Read-Only | Read unit economics, targets, guardrails, review windows, and current performance metrics. Zero tokens or secrets exposed. |
| `ads_get_data_health` | `ffp_get_data_health` | Read-Only | Verify sync freshness, attribution maturity (`MATURED` vs `PROVISIONAL`), and list blocked decisions. |
| `ads_query_performance` | `ffp_query_performance` | Read-Only | Query performance metrics at `account`, `campaign`, `adset`, or `ad` grain with verified metric definitions. |
| `ads_get_funnel_evidence` | `ffp_get_funnel_evidence` | Read-Only | Inspect three-way reconciliation (Meta vs GA4 vs Shopify) and click-to-session drop rates. |
| `ads_get_decision_cards` | `ffp_get_decision_cards` | Read-Only | Retrieve 6-rule synthesized decision cards with observation benchmarks, hypotheses, and recommended next steps. |
| `ads_get_competitor_creative_gaps` | `ffp_get_creative_gaps` | Read-Only | Analyze competitor ad library intelligence, angles running >30 days, and prioritized creative gaps with citations. |
| `ads_get_experiments` | `ffp_get_experiments` | Read-Only | Access the Observational Experiment Memory Ledger (running & completed tests, confounders, and reviewed learnings). |
| `ads_generate_brief` | `ffp_generate_brief` | Safe Write | Generate an international-standard 12-section Creative Brief from a decision card or competitor gap, with 30s storyboard and derived kill criteria. |
| `ads_create_experiment` | `ffp_create_experiment` | Safe Write | Register an observational test in the Memory Ledger from an approved brief, locking in baseline control metrics and confounders. |
| `ads_get_evidence` | `ffp_get_evidence` | Read-Only | Look up an immutable snapshot evidence pack for audit verification. |

---

## 3. Custom GPT Builder Setup Guide

To configure a ChatGPT Custom GPT (e.g., "FFP Senior Media Buyer"):

1. Open **ChatGPT $\to$ Explore GPTs $\to$ Create a GPT**.
2. In the **Configure** tab:
   - **Name**: `FFP Ads Intelligence Analyst`
   - **Description**: `Senior Performance Media Buyer & Experiment Strategist for FFP Stores (Chillgen, Jeminise, Wrydeco).`
   - **Instructions**: Copy the entire text from `prompts/ads/codex-analyst-system-prompt.md`.
3. Under **Actions**:
   - Click **Create new action**.
   - In the **Schema** field, either import the URL `https://<your-host>/api/ads-intelligence/openapi.json` or paste the contents of `docs/ads-intelligence/openapi.json`.
   - **Authentication**: Select `None` (for private network access) or `API Key` (Bearer) if `GATEWAY_AUTH_TOKEN` is enabled.
4. Test with typical prompt queries:
   - *"Kiểm tra sức khỏe dữ liệu và hiệu quả quảng cáo store Chillgen tuần qua."*
   - *"Có creative gap nào từ đối thủ đáng để test không? Hãy tạo Creative Brief 12 mục."*
   - *"Tạo một thử nghiệm quan sát từ brief vừa tạo và ghi nhận confounders."*

---

## 4. MCP Client Configuration (Claude Desktop & Codex CLI)

To connect Claude Desktop or a custom MCP client to FFP Ads Intelligence:

### Claude Desktop (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "ffp-ads": {
      "command": "node",
      "args": [
        "-e",
        "import('@modelcontextprotocol/sdk/client/streamableHttp.js').then(...) // Or point directly to HTTP gateway"
      ],
      "url": "http://localhost:3001/mcp/ads"
    }
  }
}
```

---

## 5. Security & Safety Invariants

1. **Zero Secret Exposure**: All Meta Access Tokens, GA4 Service Account private keys, and database connection strings remain securely enclosed inside the Gateway backend. Tool outputs never include API keys or PII.
2. **Untrusted Data Isolation**: Ad copy, competitor video transcripts, and external URLs are flagged as untrusted. AI models are instructed to ignore embedded prompt injections.
3. **Maturity Gate Enforcement**: Tool descriptions and prompt guidelines strictly instruct the agent to refuse scaling recommendations when attribution is `PROVISIONAL` (< 7 days).
4. **No Automated Live Ad Mutations**: V1/V2 tools strictly generate analysis, briefs, and experiment records. No tool mutates Meta live campaigns or budgets without explicit human review.
