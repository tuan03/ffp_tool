# FFP Ads Intelligence — Pilot Execution & Closed-Loop Validation Runbook

> **Step:** 20 · **Ticket:** FFP-ADS-020  
> **Pilot Store:** Chillgen Store (`chillgen`)  
> **Duration:** 30 Days (4 Operational Phases)  
> **Target Accounts:** Meta Ad Account `act_1010295448281555` · GA4 Property `555699138` · Shopify Store `chillgen.myshopify.com`  
> **Version:** 1.0.0

---

## 1. Pilot Objectives & Separation of Success

The 30-day Chillgen pilot evaluates whether FFP Ads Intelligence delivers reliable decision support and measurably impacts acquisition economics without introducing operational risk.

Two distinct dimensions of success must be measured separately:
1. **System Operational Reliability**:
   - Multi-source data reconciliation reflects platform reality within <5% discrepancy.
   - 100% of decision cards trace directly to immutable evidence snapshots.
   - Zero unauthorized or automated mutations executed against live Meta campaigns.
   - Analyst recommendation review saves at least 30 minutes of media buyer investigation per day.
2. **Economic & Acquisition Impact**:
   - Verified improvement or stabilization in Blended CPA and Contribution Margin after accounting for creative production and platform costs.
   - *Note:* Agreement between AI recommendations and human reviewers does not substitute for real profit lift.

---

## 2. 30-Day Pilot Phasing Timeline

```text
Week 1: Baseline Capture & Calibration (Days 1–7)
  ├── Lock baseline facts snapshot & calculate baseline MER / Blended CPA
  ├── Verify Meta pixel vs GA4 session tracking fidelity (<25% drop)
  └── Establish starting unit economics (AOV: $53.35, Target CPA: $25.00)

Week 2: Shadow Mode Operations (Days 8–14)
  ├── FFP generates daily Decision Cards & AI Strategic Diagnoses
  ├── Human media buyer reviews cards without making premature adjustments
  └── Log reviewer agreement scorecard (Target: >=90% action family consensus)

Weeks 3–4: Controlled Observational Testing (Days 15–28)
  ├── Execute 3 prioritized test cycles manually in Meta Ads Manager
  ├── Register test plans & control ads in FFP Experiment Memory
  └── Enforce 7-day attribution maturity gate before evaluating outcomes

Week 5: Pilot Evaluation & Multi-Store Handover Review (Days 29–30)
  ├── Reconcile full 30-day Shopify settlement ledger
  ├── Conduct financial contribution analysis
  └── Store Owner & Media Buyer sign-off for multi-store rollout
```

---

## 3. Test Cycle Designs (Chillgen Store)

### Test Cycle 1: Creative Angle Variation (UGC Unboxing vs Aesthetic Catalog)
- **Hypothesis:** Introducing a 30s UGC Unboxing video ad (addressing a verified Competitor Creative Gap) will improve link CTR above 2.5% and reduce CPA on cold traffic compared to static catalog images.
- **Entity Under Test:** Ad Set `set_cold_rugs_1` (Budget Owner: `CAMPAIGN` `cmp_cold_traffic`).
- **Control Ad:** `ad_catalog_aesthetic` (Static Catalog Image).
- **Variant Ad:** `ad_ugc_unboxing_v1` (30s UGC Unboxing Video).
- **Primary Metric:** Meta Attributed Purchases & CPA (at 7-day maturity).
- **Risk Cap:** $100.00 max spend on variant.
- **Kill Criteria:** Pause variant if spend reaches 2x Target CPA ($50.00) with 0 purchases, or Link CTR < 1.0% after 2,000 impressions.
- **Attribution & Confounder Logging:** Meta ABO may unevenly distribute impressions; confounder noted in experiment ledger.

### Test Cycle 2: High Burn Zero-Purchase Kill Execution
- **Hypothesis:** Manually pausing fatigued creative `ad_fatigued_video_old` which burned $120.00 with 0 purchases will eliminate wasted spend without decreasing overall store purchase volume.
- **Entity Under Test:** Ad `ad_fatigued_video_old`.
- **Action:** Manual Pause in Meta Ads Manager; status updated in FFP.
- **Verification:** Re-verify daily store spend and total Shopify orders across 7 subsequent days.
- **Success Criteria:** Store net contribution increases by at least $80/week from avoided budget bleed.

### Test Cycle 3: Landing Page Checkout Drop Resolution
- **Hypothesis:** Reconciled funnel data reveals high Add-to-Cart (48 events) but low Checkout Initiate (12 events), indicating high checkout shipping surprise. Adding upfront "Free Shipping over $50" banner to product page will increase checkout initiation by >30%.
- **Entity Under Test:** Landing page product template.
- **Measurement Method:** GA4 purchase funnel events (`begin_checkout` / `add_to_cart` ratio).
- **Review Window:** 14 completed days.

---

## 4. Observational Outcome Scorecard Format

For each test cycle, record findings in the following standard table:

| Field | Record Value |
|---|---|
| **Test ID & Title** | `EXP-CHILLGEN-001`: UGC Unboxing vs Aesthetic Catalog |
| **Initial Evidence** | Link CTR on static catalog dropped to 1.2%; competitor spy revealed unboxing format winning across 4 niche brands. |
| **Action Taken** | Launched variant `ad_ugc_unboxing_v1` on 2026-10-05 with $15/day budget. |
| **Approved By** | Media Buyer (Human Digital Sign-off) |
| **Test Design** | Observational cohort with concurrent control ad in same ad set. |
| **Actual Spend** | Control: $145.00 · Variant: $98.50 |
| **Purchases** | Control: 3 purchases ($48.33 CPA) · Variant: 5 purchases ($19.70 CPA) |
| **Primary Metric Lift** | Variant CPA was 59% lower than control; ROAS reached 2.85. |
| **Maturity Status** | `FINALIZED` (Window completed > 7 days ago). |
| **Uncertainties & Confounders** | Meta favored the variant with 65% of impressions; external weekend sale overlap noted. |
| **Learning Recorded** | UGC Unboxing angle validated for Custom Rugs. Added to permanent Creative Playbook. |
| **Next Step** | Draft new brief testing 3 alternative opening hooks on the winning unboxing angle. |

---

## 5. Store-Wide Economic Impact Reconciliation

Individual ad winners can cannibalize other campaigns. Store-wide impact must be reconciled against the Shopify settlement ledger:

$$\text{MER} = \frac{\text{Shopify Net Sales}}{\text{Total Meta Ad Spend}}$$

$$\text{Blended CPA} = \frac{\text{Total Meta Ad Spend}}{\text{Total Shopify Orders}}$$

$$\text{Net Contribution} = \text{Net Sales} - (\text{Meta Spend} + \text{COGS} + \text{Payment Fees})$$

If MER increases from 1.70 to >= 2.20 while Blended CPA remains <= $25.00 over the 30-day pilot window, the pilot is considered an **Economic Success**.
