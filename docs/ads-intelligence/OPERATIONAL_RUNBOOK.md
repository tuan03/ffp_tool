# FFP Ads Intelligence — Operational Runbook & Multi-Store Handover

> **Step:** 22 · **Ticket:** FFP-ADS-022  
> **Target Audience:** Systems Operators, DevOps Engineers, and Senior Media Buyers  
> **Multi-Store Registry:** Chillgen (`chillgen`), Jeminise (`jeminise`), Wrydeco (`wrydeco`), Preaureum (`preaureum`)  
> **Version:** 1.0.0

---

## 1. Store Onboarding Procedure (<30 Minutes)

To onboard a new store into the FFP Ads Intelligence cluster without code modification:

### Step 1: Create Store Configuration Profile
Create `config/stores/<storeId>.ads.json` (or `.yaml`) by copying the template:

```json
{
  "storeId": "newstore",
  "storeName": "New Store Brand",
  "mode": "read_only",
  "marketCountries": ["US"],
  "reportingCurrency": "USD",
  "meta": {
    "accountIds": ["act_xxxxxxxxxxxxxxxx"],
    "apiVersion": "v26.0",
    "purchaseActionType": "offsite_conversion.fb_pixel_purchase",
    "accountTimezone": "America/New_York",
    "secretRef": "META_ACCESS_TOKEN",
    "proxyRef": "META_HTTP_PROXY"
  },
  "ga4": {
    "propertyId": "123456789",
    "credentialsRef": "GA4_CREDENTIALS_JSON"
  },
  "shopify": {
    "shopDomain": "newstore.myshopify.com",
    "tokenRef": "SHOPIFY_API_TOKEN"
  },
  "business": {
    "targetCpa": 25.00,
    "breakEvenRoas": 2.10,
    "breakEvenCpa": 32.00,
    "targetContributionPerOrder": 14.50
  },
  "rules": {
    "attributionMaturityDays": 7,
    "creativeFatigueCtrThreshold": 1.50,
    "killSpendMultiplierTargetCpa": 2.0
  },
  "competitors": {
    "primaryProvider": "scrapecreators",
    "monthlyCostCapUsd": 50.00,
    "watchlist": [
      { "pageId": "1000123456789", "pageName": "Competitor 1" }
    ]
  }
}
```

### Step 2: Validate Profile Syntax
Run the store profile loader test:
```bash
npx tsx -e "import { loadStoreAdsProfile } from './gateway/ads-intelligence/store-profile'; console.log(loadStoreAdsProfile('newstore'));"
```

### Step 3: Run Diagnostic Probe
Call the diagnostic health endpoint:
```bash
curl -s http://127.0.0.1:3001/api/ads-intelligence/health?storeId=newstore
```
Ensure `status: "HEALTHY"` or `issues: []` before enabling store in production UI.

---

## 2. Credential Management & Rotation SOP

### Secret Isolation Contract
- **Zero Raw Secrets in Profiles:** All profiles reference environment variables (`secretRef`, `tokenRef`) rather than storing plaintext credentials.
- **Credential Scoping:**
  - `META_ACCESS_TOKEN`: Requires `ads_read` permission for V1/V2. Do NOT grant `ads_management` until V3 write approval is granted.
  - `GA4_CREDENTIALS_JSON`: Service account with Viewer role on GA4 Property.
  - `SHOPIFY_API_TOKEN`: Read-only access to Orders (`read_orders`).

### Credential Rotation Checklist:
1. Generate the replacement token in the provider developer console.
2. Update the environment variable in `.env` or container environment:
   ```bash
   # In docker-compose or .env
   META_ACCESS_TOKEN="EAA..."
   ```
3. Restart the server container:
   ```bash
   docker restart ffp-server
   ```
4. Verify data health via `GET /api/ads-intelligence/health?storeId=chillgen&forceRefresh=true`.

---

## 3. Incident Response Playbooks

### Playbook A: Meta API Rate Limiting (HTTP 429)
- **Symptom:** Gateway logs `User request limit reached` (Meta code 17 or 613).
- **Automated Mitigation:** Gateway Cost Guard Cache shields downstream requests with a 6-hour TTL (`store:hierarchy`) and 15-minute TTL (`store:summary`).
- **Operator Action:**
  - Do not spam manual sync buttons.
  - Check Cost Guard Cache hit headers: `x-ads-cache: HIT`.
  - Stagger batch sync cron jobs by at least 15 minutes between different stores.

### Playbook B: Click-to-Session Drop Spike (>50%)
- **Symptom:** Funnel Health badge turns RED (`SEVERE_DROP`), decision engine flags `INVESTIGATE_TRACKING`.
- **Diagnostic Steps:**
  1. Inspect `reconciliation.gaps.clickDropPct`.
  2. Verify if Shopify store theme code was deployed recently (check for missing or broken GA4 `gtag` or Meta Pixel script).
  3. Test landing page URL redirect loops: URL shorteners can strip UTM query parameters.
  4. Review cookie consent banner rejection rate.

### Playbook C: Emergency Kill Switch Engagement
- **Action:** If an unexpected mutation occurs or unauthorized activity is detected, engage the global kill switch immediately:
  ```bash
  # In environment or runtime:
  export FFP_ADS_EMERGENCY_KILL_SWITCH=true
  ```
- All mutating writes are halted instantly with HTTP 400 / `BLOCKED`.
- Read-only analytics and decision inspection remain operational.

---

## 4. Multi-Tenant Data Isolation Verification

- Profiles and entities are strictly partitioned by `storeId`.
- An API request or MCP tool call specifying `storeId: "chillgen"` cannot access credentials, campaigns, or orders from `jeminise` or `wrydeco`.
- The database repository and cache keys prefix all records with `storeId:` (`${storeId}:summary`, `${storeId}:decisions`).
- Unauthorized store requests throw `AdsIntelligenceError: Không tìm thấy file cấu hình Store Ads Profile` (Verified in Step 19 QA Case 23).

---

## 5. Master Handover Checklist

- [x] All 22 implementation steps completed and verified.
- [x] 101/101 automated unit and evaluation tests passing.
- [x] 0 TypeScript errors across 3 configuration files.
- [x] Vite production bundle builds in <2.0s without warnings.
- [x] MCP Server operational on port 3001 and proxied via Nginx on port 3010.
- [x] OpenAPI 3.1.0 specification validated for Custom GPT Actions.
- [x] Operational runbooks and pilot test plans signed off.
