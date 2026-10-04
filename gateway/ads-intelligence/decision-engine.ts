/**
 * FFP Ads Intelligence — Backend Decision Engine
 * Implements 6 quantitative business rules with evidence pack, observations,
 * counter-hypotheses, review triggers, and strict policy gates.
 */
import type {
  AdsHierarchyCampaign,
  AdsReconciliationReport,
  AdsStoreSummary,
  DecisionCard,
  DecisionObservation,
  DecisionPriority,
  StoreAdsProfile,
} from "./types";

export interface DecisionEngineInput {
  readonly summary: AdsStoreSummary;
  readonly campaigns?: readonly AdsHierarchyCampaign[];
  readonly reconciliation?: AdsReconciliationReport | null;
  readonly profile: StoreAdsProfile;
}

export class DecisionEngine {
  /**
   * Evaluates all 6 business rules across store, funnel, reconciliation, and hierarchy.
   */
  evaluate(input: DecisionEngineInput): readonly DecisionCard[] {
    const { summary, campaigns = [], reconciliation, profile } = input;
    const cards: DecisionCard[] = [];
    const policyVersion = profile.rules.policyVersion || "2.0";
    const nowIso = new Date().toISOString();

    const targetCpa = profile.business.targetCpa ?? 20.0;
    const breakEvenRoas = profile.business.breakEvenRoas ?? 2.50;
    const breakEvenCpa = profile.business.breakEvenCpa ?? 24.0;
    const maturityDays = profile.rules.maturityDays ?? 7;

    // Determine data maturity
    const stopTime = new Date(summary.periodEnd).getTime();
    const daysSinceStop = Math.max(0, Math.floor((Date.now() - stopTime) / 86400000));
    const isProvisional = summary.maturity === "PROVISIONAL" || daysSinceStop < maturityDays;

    // -------------------------------------------------------------
    // RULE 1: Maturity Gate (WAIT)
    // -------------------------------------------------------------
    if (isProvisional) {
      cards.push({
        id: `dec-${summary.storeId}-store-maturity-gate`,
        storeId: summary.storeId,
        entity: {
          type: "store",
          id: summary.storeId,
          name: summary.accountName || summary.storeId,
        },
        decision: "WAIT",
        priority: "HIGH",
        confidence: "HIGH",
        title: "🛡️ Cổng kiểm soát độ chín dữ liệu (Maturity Gate: PROVISIONAL)",
        summary: `Dữ liệu kỳ quan sát kết thúc trong vòng ${daysSinceStop} ngày gần nhất (ngưỡng an toàn: ${maturityDays} ngày). Chu kỳ ghi nhận phân bổ chuyển đổi Pixel (7-day click / 1-day view) chưa khép lại. Chặn tự động tăng ngân sách và chặn tắt quảng cáo vội vàng.`,
        observations: [
          {
            metric: "data_maturity_age_days",
            current: daysSinceStop,
            benchmark: maturityDays,
            unit: "days",
          },
          {
            metric: "maturity_status",
            current: "PROVISIONAL",
            benchmark: "FINALIZED",
            unit: "status",
          },
        ],
        hypotheses: [
          "Chuyển đổi từ khách hàng xem quảng cáo (view-through) và click có thể tiếp tục đổ về trong 1-7 ngày tới.",
          "Tăng ngân sách vội vàng khi attribution window chưa đóng dễ làm thuật toán Meta đấu thầu sai lệch.",
        ],
        missingEvidence: [
          "Settled Shopify settlement ledger qua 7 ngày hoàn tất",
          "Full 7-day attribution closeout từ Meta Conversion API",
        ],
        recommendedNextStep:
          "Duy trì ngân sách hiện tại, theo dõi settlement ledger trên Shopify và đợi dữ liệu đạt trạng thái FINALIZED sau 7 ngày.",
        blockedActions: [
          "AUTOMATIC_BUDGET_CHANGE",
          "SCALE_CAMPAIGN_BUDGET",
          "KILL_ON_INCOMPLETE_ATTRIBUTION",
        ],
        reviewTrigger: `Sau ngày ${summary.periodEnd} đủ ${maturityDays} ngày hoặc khi Shopify đối chiếu đủ đơn hàng.`,
        policyVersion,
        createdAt: nowIso,
      });
    }

    // -------------------------------------------------------------
    // RULE 5: Landing Page / Tracking Drop (CHECK_LANDING / INVESTIGATE_TRACKING)
    // -------------------------------------------------------------
    if (reconciliation?.gaps?.clickDropPct) {
      const dropPct = parseFloat(reconciliation.gaps.clickDropPct) || 0;
      if (dropPct > 25.0) {
        cards.push({
          id: `dec-${summary.storeId}-drop-landing-ga4`,
          storeId: summary.storeId,
          entity: {
            type: "store",
            id: summary.storeId,
            name: summary.accountName || summary.storeId,
          },
          decision: "CHECK_LANDING",
          priority: "HIGH",
          confidence: "HIGH",
          title: `⚠️ Tỷ lệ rơi rụng từ Click sang Session GA4 cao (${dropPct.toFixed(1)}%)`,
          summary: `Chênh lệch giữa link clicks trên Meta (${reconciliation.meta.linkClicks}) và phiên truy cập ghi nhận trên GA4 (${reconciliation.ga4.sessions}) lên tới ${dropPct.toFixed(1)}% (vượt ngưỡng thông thường ngành E-commerce: 15% - 25%).`,
          observations: [
            {
              metric: "click_to_session_drop",
              current: `${dropPct.toFixed(1)}%`,
              benchmark: "20.0%",
              unit: "%",
            },
            {
              metric: "meta_link_clicks",
              current: reconciliation.meta.linkClicks,
              benchmark: String(reconciliation.ga4.sessions),
              unit: "clicks",
            },
          ],
          hypotheses: [
            "Tốc độ tải trang trên thiết bị di động (LCP > 3.5s) khiến khách hàng thoát trang trước khi thẻ GA4/Pixel tải xong.",
            "Lỗi chuyển hướng URL (redirect chain), hoặc trang 404 trên các biến thể UTM chiến dịch.",
            "Người dùng trên iOS 14.5+ hoặc trình duyệt chặn cookie bên thứ ba (Ad blocker, Brave).",
          ],
          missingEvidence: [
            "Google PageSpeed mobile audit report",
            "GA4 real-time server-side tracking validation log",
          ],
          recommendedNextStep:
            "Kiểm tra tốc độ tải trang mobile qua Google PageSpeed Insights, nén ảnh hero banner, và rà soát cấu hình Meta Conversions API (CAPI) Server-side.",
          blockedActions: ["SCALE_CAMPAIGN_BUDGET"],
          reviewTrigger: "Kiểm tra lại sau khi tối ưu web và cập nhật tracking tag.",
          policyVersion,
          createdAt: nowIso,
        });
      }
    }

    // -------------------------------------------------------------
    // RULE 6: Checkout Funnel Drop (CHECK_CHECKOUT)
    // -------------------------------------------------------------
    const atcNum = Number(summary.atc) || 0;
    const checkoutNum = Number(summary.checkout) || 0;
    if (atcNum >= 10) {
      const checkoutRatio = checkoutNum / atcNum;
      const dropPct = (1 - checkoutRatio) * 100;
      if (checkoutRatio < 0.50) {
        cards.push({
          id: `dec-${summary.storeId}-funnel-checkout-drop`,
          storeId: summary.storeId,
          entity: {
            type: "store",
            id: summary.storeId,
            name: summary.accountName || summary.storeId,
          },
          decision: "CHECK_CHECKOUT",
          priority: "HIGH",
          confidence: "MEDIUM",
          title: `🛒 Rơi rụng nghiêm trọng ở bước Thanh toán (${dropPct.toFixed(1)}% bỏ giỏ hàng)`,
          summary: `Ghi nhận ${atcNum} lượt thêm vào giỏ nhưng chỉ có ${checkoutNum} lượt tiến hành thanh toán. Khách hàng hào hứng với sản phẩm nhưng gặp rào cản tâm lý khi chuyển sang giỏ hàng.`,
          observations: [
            {
              metric: "atc_to_checkout_drop",
              current: `${dropPct.toFixed(1)}%`,
              benchmark: "35.0%",
              unit: "%",
            },
            {
              metric: "add_to_cart_events",
              current: atcNum,
              benchmark: checkoutNum,
              unit: "events",
            },
          ],
          hypotheses: [
            "Khách hàng thấy chi phí vận chuyển phát sinh bất ngờ ở bước checkout.",
            "Thiếu các cổng thanh toán nhanh 1-chạm phổ biến (Apple Pay, Shop Pay, PayPal).",
            "Chưa có thông báo ngưỡng miễn phí vận chuyển (Free Shipping bar) rõ ràng tại Cart drawer.",
          ],
          recommendedNextStep:
            "Thiết lập Free Shipping progress bar trong Cart drawer, bổ sung huy hiệu an tâm (bảo hành, 30 ngày đổi trả) và kích hoạt Shop Pay / PayPal Express.",
          blockedActions: ["SCALE_BUDGET"],
          reviewTrigger: "Theo dõi tỷ lệ hoàn tất checkout trong vòng 48h sau khi tinh chỉnh trang thanh toán.",
          policyVersion,
          createdAt: nowIso,
        });
      }
    }

    // -------------------------------------------------------------
    // Scan Hierarchy (Campaigns, AdSets, Ads) for Rules 2, 3, 4
    // -------------------------------------------------------------
    for (const campaign of campaigns) {
      const campSpend = Number(campaign.spend) || 0;
      const campPurchases = Number(campaign.purchases) || 0;
      const campRoas = Number(campaign.roas) || 0;
      const campCpa = campaign.cpa ? Number(campaign.cpa) : null;

      // Campaign level Star Performer check
      if (
        (campRoas >= breakEvenRoas && campPurchases >= 5) ||
        (campCpa !== null && campCpa <= targetCpa && campPurchases >= 5)
      ) {
        cards.push({
          id: `dec-${summary.storeId}-camp-${campaign.id}-scale`,
          storeId: summary.storeId,
          entity: {
            type: "campaign",
            id: campaign.id,
            name: campaign.name,
          },
          decision: "SCALE_CANDIDATE",
          priority: "HIGH",
          confidence: isProvisional ? "MEDIUM" : "HIGH",
          title: `🟢 Chiến dịch sinh lời mạnh — Ứng viên Scale (${campaign.name})`,
          summary: `Chiến dịch đạt ROAS ${campRoas.toFixed(2)}× và CPA $${campCpa ? campCpa.toFixed(2) : "—"} với ${campPurchases} đơn hàng. Hiệu quả vượt ngưỡng hòa vốn (${breakEvenRoas.toFixed(2)}×).`,
          observations: [
            {
              metric: "meta_roas",
              current: `${campRoas.toFixed(2)}×`,
              benchmark: `${breakEvenRoas.toFixed(2)}×`,
              unit: "ratio",
            },
            {
              metric: "meta_cpa",
              current: campCpa ? `$${campCpa.toFixed(2)}` : "—",
              benchmark: `$${targetCpa.toFixed(2)}`,
              unit: "USD",
            },
            {
              metric: "purchases",
              current: campPurchases,
              benchmark: 5,
              unit: "orders",
            },
          ],
          hypotheses: [
            "Tập khách hàng và creative của chiến dịch đã được thuật toán tối ưu hóa tốt.",
            "Cần kiểm tra biên lợi nhuận (marginal ROAS) khi tăng ngân sách để tránh hiện tượng bão hòa tệp audience.",
          ],
          recommendedNextStep: isProvisional
            ? `Dữ liệu đang PROVISIONAL: chỉ thử nghiệm tăng tối đa 10% - 15% trong phạm vi authorized experiment cap ($${profile.budgets.experimentAuthorizedCap ?? 20}/ngày).`
            : `Đề xuất tăng 15% - 20% ngân sách chiến dịch mỗi 24h, không vượt authorized cap ($${profile.budgets.totalDailyAuthorizedCap ?? 100}/ngày).`,
          blockedActions: isProvisional
            ? ["AUTOMATIC_BUDGET_CHANGE", "INCREASE_BUDGET_OVER_20PCT"]
            : ["INCREASE_BUDGET_OVER_50PCT"],
          reviewTrigger: `Sau 24 giờ kể từ khi tăng ngân sách hoặc khi CPA vượt ngưỡng hòa vốn $${breakEvenCpa.toFixed(2)}.`,
          policyVersion,
          createdAt: nowIso,
        });
      }

      // Check adsets and ads
      for (const adset of campaign.adsets) {
        for (const ad of adset.ads) {
          const adSpend = Number(ad.spend) || 0;
          const adPurchases = Number(ad.purchases) || 0;
          const adRoas = Number(ad.roas) || 0;
          const adCpa = ad.cpa ? Number(ad.cpa) : null;
          const adImpressions = Number(ad.impressions) || 0;
          const adLinkClicks = Number(ad.linkClicks) || 0;
          const adLinkCtr = parseFloat(ad.linkCtr) || 0;

          // RULE 2: High Burn / Zero Purchase (PAUSE_CANDIDATE)
          const burnThreshold = 2 * targetCpa;
          if (adSpend > burnThreshold && adPurchases === 0) {
            cards.push({
              id: `dec-${summary.storeId}-ad-${ad.id}-high-burn`,
              storeId: summary.storeId,
              entity: {
                type: "ad",
                id: ad.id,
                name: ad.name,
              },
              decision: "PAUSE_CANDIDATE",
              priority: "HIGH",
              confidence: adSpend >= 3 * targetCpa ? "HIGH" : "MEDIUM",
              title: `🔴 Chi tiêu vượt 2× Target CPA nhưng 0 đơn hàng (${ad.name})`,
              summary: `Đã tiêu $${adSpend.toFixed(2)} vượt ngưỡng 2× Target CPA ($${burnThreshold.toFixed(2)}) nhưng ghi nhận 0 đơn hàng website. Tiếp tục chạy sẽ gây thâm hụt biên lợi nhuận.`,
              observations: [
                {
                  metric: "spend",
                  current: `$${adSpend.toFixed(2)}`,
                  benchmark: `$${burnThreshold.toFixed(2)}`,
                  unit: "USD",
                },
                {
                  metric: "purchases",
                  current: 0,
                  benchmark: 1,
                  unit: "orders",
                },
              ],
              hypotheses: [
                "Hook hoặc hình ảnh visual không tiếp cận đúng đối tượng có ý định mua sắm thực sự.",
                "Giá bán hoặc chính sách giao hàng tại trang đích chưa đủ sức cạnh tranh.",
                "Tracking pixel sự kiện Purchase có thể gặp sự cố kỹ thuật trên trình duyệt này.",
              ],
              recommendedNextStep:
                "Tạm dừng (Pause) quảng cáo này ngay lập tức để cắt giảm lãng phí, chuyển dồn ngân sách vào các ad set có ROAS cao.",
              blockedActions: ["SCALE_BUDGET", "ENABLE_BID_CAP"],
              reviewTrigger: "Kiểm tra lại sau khi team creative sản xuất xong angle mới hoặc tối ưu trang đích.",
              policyVersion,
              createdAt: nowIso,
            });
            continue; // Stop further checks on this burned ad
          }

          // RULE 3: Star Performer (SCALE_CANDIDATE)
          const isAdStar =
            (adRoas >= breakEvenRoas && adPurchases >= 3) ||
            (adCpa !== null && adCpa <= targetCpa && adPurchases >= 3);

          if (isAdStar) {
            cards.push({
              id: `dec-${summary.storeId}-ad-${ad.id}-star`,
              storeId: summary.storeId,
              entity: {
                type: "ad",
                id: ad.id,
                name: ad.name,
              },
              decision: "SCALE_CANDIDATE",
              priority: "HIGH",
              confidence: isProvisional ? "MEDIUM" : "HIGH",
              title: `🟢 Quảng cáo hiệu quả xuất sắc — Ứng viên Scale (${ad.name})`,
              summary: `ROAS đạt ${adRoas.toFixed(2)}× và CPA $${adCpa ? adCpa.toFixed(2) : "—"} (Target CPA: $${targetCpa.toFixed(2)}) với ${adPurchases} đơn hàng thành công.`,
              observations: [
                {
                  metric: "meta_roas",
                  current: `${adRoas.toFixed(2)}×`,
                  benchmark: `${breakEvenRoas.toFixed(2)}×`,
                  unit: "ratio",
                },
                {
                  metric: "meta_cpa",
                  current: adCpa ? `$${adCpa.toFixed(2)}` : "—",
                  benchmark: `$${targetCpa.toFixed(2)}`,
                  unit: "USD",
                },
                {
                  metric: "purchases",
                  current: adPurchases,
                  benchmark: 3,
                  unit: "orders",
                },
              ],
              hypotheses: [
                "Creative đánh trúng insight nỗi đau của tệp khách hàng mục tiêu, tỷ lệ click chuyển đổi cao.",
                "Thuật toán phân phối đã tối ưu tốt nhóm đối tượng có hành vi mua sắm cao.",
              ],
              recommendedNextStep: isProvisional
                ? `Do dữ liệu PROVISIONAL, đề xuất nhân bản test ad sang adset riêng với ngân sách nhỏ ($${profile.budgets.experimentAuthorizedCap ?? 20}/ngày) thay vì tăng trực tiếp ngân sách gốc.`
                : `Đề xuất tăng 15-20% ngân sách theo từng chu kỳ 24h, không tăng đột ngột vượt quá authorized cap ($${profile.budgets.totalDailyAuthorizedCap ?? 100}/ngày).`,
              blockedActions: isProvisional
                ? ["AUTOMATIC_BUDGET_CHANGE", "INCREASE_BUDGET_OVER_20PCT"]
                : ["INCREASE_BUDGET_OVER_50PCT"],
              reviewTrigger: `Sau 24 giờ kể từ khi tăng ngân sách hoặc khi CPA tăng vượt $${breakEvenCpa.toFixed(2)}.`,
              policyVersion,
              createdAt: nowIso,
            });
          }

          // RULE 4: Creative Fatigue / Low Hook (TEST_CREATIVE)
          if (adImpressions >= 1500 && adLinkCtr < 1.50) {
            cards.push({
              id: `dec-${summary.storeId}-ad-${ad.id}-low-hook`,
              storeId: summary.storeId,
              entity: {
                type: "ad",
                id: ad.id,
                name: ad.name,
              },
              decision: "TEST_CREATIVE",
              priority: "MEDIUM",
              confidence: "HIGH",
              title: `🟡 Tỷ lệ Link CTR thấp / Bão hòa Creative (${ad.name})`,
              summary: `Link CTR đạt ${adLinkCtr.toFixed(2)}% (thấp hơn benchmark 1.50%) sau ${adImpressions} lượt hiển thị, cho thấy móc câu (Hook) chưa tạo đủ sức hút kích thích nhấp chuột.`,
              observations: [
                {
                  metric: "meta_link_ctr",
                  current: `${adLinkCtr.toFixed(2)}%`,
                  benchmark: "1.50%",
                  unit: "%",
                },
                {
                  metric: "impressions",
                  current: adImpressions,
                  benchmark: 1500,
                  unit: "impressions",
                },
                {
                  metric: "link_clicks",
                  current: adLinkClicks,
                  benchmark: Math.round(adImpressions * 0.015),
                  unit: "clicks",
                },
              ],
              hypotheses: [
                "3 giây đầu video chưa làm rõ vấn đề khách hàng đang gặp phải, tỷ lệ drop-off sớm cao.",
                "Hình ảnh thumbnail hoặc headline thiếu điểm nhấn thị giác so với feed của đối thủ.",
                "Creative có thể đã tiếp cận lặp lại nhiều lần cùng tệp đối tượng (ad fatigue).",
              ],
              missingEvidence: [
                "Video 3-second hook retention breakdown",
                "Video 25%, 50%, 75% watch rate breakdown",
              ],
              recommendedNextStep:
                "Giữ nguyên cấu trúc ad set, sản xuất và A/B test 3 hook mới (tập trung vào Problem-Agitate-Solution và Social Proof review).",
              blockedActions: ["SCALE_BUDGET"],
              reviewTrigger: "Sau khi test creative mới đạt tối thiểu 1,000 impressions.",
              policyVersion,
              createdAt: nowIso,
            });
          }

          // If ad is active, healthy, and not triggering scale or test, mark as KEEP
          if (
            ad.status === "ACTIVE" &&
            !isAdStar &&
            !(adSpend > burnThreshold && adPurchases === 0) &&
            !(adImpressions >= 1500 && adLinkCtr < 1.50)
          ) {
            cards.push({
              id: `dec-${summary.storeId}-ad-${ad.id}-keep`,
              storeId: summary.storeId,
              entity: {
                type: "ad",
                id: ad.id,
                name: ad.name,
              },
              decision: "KEEP",
              priority: "LOW",
              confidence: "MEDIUM",
              title: `⚪ Duy trì theo dõi ổn định (${ad.name})`,
              summary: `Quảng cáo đang vận hành trong biên độ kiểm soát (Chi tiêu: $${adSpend.toFixed(2)}, CTR: ${adLinkCtr.toFixed(2)}%, Đơn: ${adPurchases}). Chưa có tín hiệu cần can thiệp khẩn cấp.`,
              observations: [
                {
                  metric: "spend",
                  current: `$${adSpend.toFixed(2)}`,
                  benchmark: `$${burnThreshold.toFixed(2)}`,
                  unit: "USD",
                },
                {
                  metric: "meta_link_ctr",
                  current: `${adLinkCtr.toFixed(2)}%`,
                  benchmark: "1.50%",
                  unit: "%",
                },
              ],
              hypotheses: [
                "Hiệu suất quảng cáo nằm trong khoảng dao động thông thường của tệp đối tượng.",
              ],
              recommendedNextStep:
                "Tiếp tục duy trì và theo dõi dữ liệu tích lũy cho đến khi đạt độ chín.",
              blockedActions: [],
              reviewTrigger: "Đánh giá lại khi chi tiêu tích lũy tăng thêm 1× Target CPA.",
              policyVersion,
              createdAt: nowIso,
            });
          }
        }
      }
    }

    // Sort decision cards by priority (HIGH -> MEDIUM -> LOW)
    const priorityWeight: Record<DecisionPriority, number> = {
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1,
    };

    return cards.sort((a, b) => priorityWeight[b.priority] - priorityWeight[a.priority]);
  }
}

export const decisionEngine = new DecisionEngine();
