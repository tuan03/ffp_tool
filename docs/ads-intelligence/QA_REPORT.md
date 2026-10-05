# FFP Ads Intelligence — Quality Assurance & Security Audit Report

> **Step:** 19 · **Ticket:** FFP-ADS-019  
> **Evaluation Suite:** `gateway/__tests__/ads-intelligence-eval.test.ts` (30 Edge-Case Fixtures)  
> **Master Test Suite:** 101/101 Passing Tests across 11 Test Suites  
> **TypeScript Strict:** 100% Clean (`tsconfig.json`, `tsconfig.gateway.json`, `tsconfig.pipeline.json`)  
> **Status:** **PASS** (Ready for Closed-Loop Pilot)

---

## 1. Executive Summary

This QA and Security Audit evaluates the **FFP Ads Intelligence** module against the 25 mandatory business and technical invariants established in `docs/ads-intelligence/README.md` (Step 19) and the engineering backlog `docs/ads-intelligence/BACKLOG.md`.

All tests pass deterministically without network dependencies (calibrated offline fixtures with graceful upstream fallback). Zero secret or token leakage was detected during live inspections or mock execution.

| Evaluation Area | Target | Result | Status |
|---|---|---|---|
| Unit & Integration Tests | 100% Pass | 101 / 101 Passed | **PASS** |
| Step 19 QA Edge Cases | 30 Mandatory Fixtures | 30 / 30 Passed | **PASS** |
| TypeScript Strict Check | 0 Errors across 3 configs | 0 Errors | **PASS** |
| Secret & Credential Redaction | Zero tokens exposed in logs/MCP | Verified (0 leakage) | **PASS** |
| Mathematical Safety (NaN / Div0) | Zero `NaN`, `Infinity`, or `-0` | Verified | **PASS** |
| Observational Testing Guard | Refuse false A/B causality claims | Verified | **PASS** |
| Data Maturity Attribution Gating | Block scaling if < 7 days | Verified | **PASS** |
| Guarded Writes Kill Switch & Fences | Strict V1/V2 denial, <=20% cap | Verified | **PASS** |

---

## 2. Test Suite Breakdown

| Test Suite File | Tests | Focus Area | Status |
|---|---|---|---|
| `gateway/__tests__/ads-intelligence-eval.test.ts` | 30 | 30 Mandatory Edge Cases (Step 19 Matrix) | **PASS** |
| `gateway/__tests__/ads-intelligence-mcp.test.ts` | 6 | MCP Tool Registration, Execution, Aliases, HTTP Transport, OpenAPI Spec | **PASS** |
| `gateway/__tests__/ads-intelligence-briefs-experiments.test.ts` | 6 | Strategy Briefs, Test Plans & Experiment Memory | **PASS** |
| `gateway/__tests__/ads-intelligence-competitors.test.ts` | 5 | Ad Library Spy, Hook/Visual Style Classifier, Creative Gaps | **PASS** |
| `gateway/__tests__/ads-intelligence-conversions.test.ts` | 13 | Website-only purchase mapping, decimal precision, alias isolation | **PASS** |
| `gateway/__tests__/ads-intelligence-decisions.test.ts` | 13 | 6-Rule Decision Engine, Evidence Cards, AI Strategic Analyst | **PASS** |
| `gateway/__tests__/ads-intelligence-facts.test.ts` | 4 | Deterministic SHA256 snapshot hashing, 7-day maturity gating | **PASS** |
| `gateway/__tests__/ads-intelligence-insights.test.ts` | 11 | Date window calculations (DST-safe), Delivery normalization | **PASS** |
| `gateway/__tests__/ads-intelligence-reconciliation.test.ts` | 4 | 3-Way Reconciliation Matrix (Meta + GA4 + Shopify), Settlement Ledger | **PASS** |
| `gateway/__tests__/ads-intelligence-store-profile.test.ts` | 6 | Store Profile Loader, YAML/JSON parser, validation | **PASS** |
| `gateway/__tests__/ads-intelligence-cache-and-handler.test.ts` | 3 | Cost Guard TTL cache, Route multiplexing | **PASS** |
| **Total** | **101** | **All 11 Test Suites Passing** | **100% PASS** |

---

## 3. Mandatory Edge-Case Verification Matrix (Step 19)

| Fixture ID | Invariant Tested | Verified Behavior | Test Assertion |
|---|---|---|---|
| **Case 01** | Spend > 0, Purchase = 0 | CPA is set to `null` (not 0); evaluated for `PAUSE_CANDIDATE` if spend > 2x Target CPA. | `conv.cpa === null`, `conv.roas === 0` |
| **Case 02** | Baseline = 0 or metric null | `ratio()` helper safely returns `null` or formatted string without `NaN`, `Infinity`, or `-0`. | Zero division safe |
| **Case 03** | Reach across multiple days | Disallows naive arithmetic summation of daily uniques into whole-window reach. | Deduplicated reach <= naive sum |
| **Case 04** | Overlapping purchase aliases | Isolates `offsite_conversion.fb_pixel_purchase`; discards `omni_purchase` duplicates. | Single attribution count |
| **Case 05** | Partial pagination flag | Returns `isPartial: true`; does not falsely claim totals are complete. | Verified cursor tracking |
| **Case 06** | API upstream errors (401/403/429/500/timeout) | Structured error classification with backoff/retry boundaries; never converts error to $0 spend. | Typed error classifications |
| **Case 07** | Attribution model / snapshot drift | Changes in window or parameters alter deterministic SHA256 snapshot hash. | Verified SHA256 sensitivity |
| **Case 08** | Timezone / currency mismatch | Preserves distinct currency badges; rejects naive cross-currency addition without rate. | Throws on unhandled currencies |
| **Case 09** | Same-day or recent traffic (<7 days) | Flags data as `PROVISIONAL`; blocks automatic scale recommendations. | `dataMaturity === "PROVISIONAL"` |
| **Case 10** | Delayed refund updates | Historical facts remain immutable; new ledger snapshots generate distinct hash versions. | Ledger audit integrity |
| **Case 11** | Missing COGS / cost basis | Refuses to declare true net profit or break-even CPA when COGS missing. | Tagged `ESTIMATED` |
| **Case 12** | GA4 missing UTM / transaction ID | Sessions without UTMs remain unassigned rather than guessed by name/amount. | Unmatched sessions = null |
| **Case 13** | Multi-source discrepancy | Click-to-session drop categorized (<25% normal vs >50% technical issue). | Gaps report calculated |
| **Case 14** | One-to-many ad variant join | Ad variants sum to ad set spend; parent spend is never duplicated. | Total ad spend === ad set spend |
| **Case 15** | Budget ownership hierarchy | Points recommendations to correct budget owner (`CAMPAIGN` for CBO, `ADSET` for ABO). | Identified owner entity |
| **Case 16** | Cross-campaign cannibalization | Notes when ad set scaling shifts budget without net new store budget lift. | Net store spend change tracked |
| **Case 17** | High CTR with zero conversions | High link CTR (e.g. 8.5%) with 0 purchases is never designated a scale winner. | 0-purchase scale blocked |
| **Case 18** | Missing historical budget snapshot | Reports `UNKNOWN` or `BASELINE_BUILDING`; never fabricates past metrics. | Status `UNKNOWN` verified |
| **Case 19** | Competitor thumbnail-only media | Disclaims inability to analyze full video or audio content when only thumbnail seen. | Valid inspection level tag |
| **Case 20** | Expired competitor CDN URL | Retains competitor archive ID and historical copy; does not delete ad record. | Record persistence verified |
| **Case 21** | Competitor running duration | Never fabricates competitor CPA, ROAS, or spend based on ad longevity. | `roas === undefined`, `cpa === undefined` |
| **Case 22** | Prompt injection in ad copy | Malicious instructions in creative copy are safely quoted; tokens never leaked. | Redaction & isolation pass |
| **Case 23** | Unauthorized store access | Denies access for non-existent or unauthorized store profiles. | `Store profile not found` |
| **Case 24** | Guarded Writes V1/V2 denial | Mutating writes strictly denied with `DENIED_V1_V2` when `FFP_ADS_EXTERNAL_WRITES_ENABLED=false`. | Fails safe by default |
| **Case 25** | MCP vs UI snapshot parity | MCP tool queries and UI service queries on identical snapshots yield identical totals. | Exact numerical equality |
| **Case 26** | Guarded Writes 20% budget cap | Rejects budget increases > 20% in a 24-hour period. | `FENCE_VIOLATION` |
| **Case 27** | Guarded Writes state drift | Rejects execution if live entity status or budget drifted after preview creation. | `STATE_DRIFT` |
| **Case 28** | Guarded Writes tamper protection | Rejects approval when cryptographic hash does not match original proposal. | `Hash mismatch` error |
| **Case 29** | Emergency Kill Switch | Immediately halts all executions when `FFP_ADS_EMERGENCY_KILL_SWITCH=true`. | `BLOCKED` via kill switch |
| **Case 30** | Store Profile Loader validation | Rejects profiles with missing storeId, reportingCurrency, or marketCountries. | Strict validation error |

---

## 4. Security & OWASP Audit Findings

1. **Token & Credential Hygiene**:
   - Meta Access Tokens (`META_ACCESS_TOKEN`, `EAA...`) and Shopify Admin API Tokens are isolated in environment variables.
   - Profile loader reads secret references (e.g. `secretRef: "META_ACCESS_TOKEN"`) instead of storing plaintext keys.
   - MCP Server and REST endpoints sanitize profiles before returning to clients, stripping all tokens, secrets, and proxies.
2. **Untrusted Data Isolation**:
   - Competitor copy, user prompts, and creative headlines are treated as untrusted strings.
   - Prompt templates instruct models to analyze copy as observational text rather than executing embedded commands.
3. **Write Isolation (V1 / V2)**:
   - External mutation routes are guarded by `GuardedWritesService`.
   - In V1/V2, all mutations fail safe with HTTP 403 / status `DENIED_V1_V2`.
   - Preview generation and cryptographic hash validation remain available for audit and testing.

---

## 5. Sign-Off & Release Recommendation

Based on 101/101 passing unit tests, zero TypeScript errors across 3 configurations, and clean production Vite build, the FFP Ads Intelligence module **passes Step 19 QA Gates** and is approved for **Closed-Loop Pilot Execution (Step 20 · FFP-ADS-020)**.
