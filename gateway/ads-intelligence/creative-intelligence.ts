import type {
  AdsHierarchyAd,
  CompetitorAd,
  CompetitorHookType,
  CompetitorMediaType,
  CompetitorVisualStyle,
  CreativeGap,
} from "./types";

export interface CreativeGapAnalysisInput {
  readonly competitorAds: readonly CompetitorAd[];
  readonly ownAds: readonly AdsHierarchyAd[];
  readonly storeNiche?: string;
}

export interface CreativeGapAnalysisResult {
  readonly creativeGaps: readonly CreativeGap[];
  readonly topWinningHooks: readonly {
    readonly hookType: CompetitorHookType;
    readonly count: number;
    readonly avgDaysActive: number;
    readonly description: string;
  }[];
  readonly formatDistribution: readonly {
    readonly format: string;
    readonly percentage: number;
    readonly count: number;
  }[];
}

const HOOK_DESCRIPTIONS: Record<CompetitorHookType, string> = {
  UNBOXING: "Mở hộp & Phản ứng cảm xúc chân thực (UGC Unboxing Reaction)",
  PROBLEM_AGITATION: "Nhấn mạnh nỗi đau phòng ốc nhàm chán & Giải pháp decor (Pain-point & Fix)",
  BEFORE_AFTER: "Đối chiếu trực quan trước và sau khi trang trí không gian (Visual Transformation)",
  FOUNDER_STORY: "Câu chuyện người thợ/xưởng thủ công tự làm từ tâm (Behind The Craft Story)",
  SOCIAL_PROOF: "Hơn 4,800 đánh giá 5 sao & Review độ bền giặt máy (Customer Proof)",
  AESTHETIC_SHOWCASE: "Cận cảnh chi tiết sợi dệt cao cấp và màu sắc sống động (Product Aesthetic)",
  DISCOUNT_OFFER: "Khuyến mãi giới hạn thời gian & Miễn phí cá nhân hóa (Promotional Offer)",
  UNKNOWN: "Góc tiếp cận quảng cáo chưa phân loại",
};

const SUGGESTED_BRIEFS: Record<CompetitorHookType, {
  readonly hookAngle: string;
  readonly storyboardIdea: string;
  readonly recommendedFormat: string;
  readonly callToAction: string;
}> = {
  UNBOXING: {
    hookAngle: "Quay cảnh mở hộp bất ngờ: người nhận thốt lên khi thấy tên/hình thú cưng của mình",
    storyboardIdea: "0-3s: Cận cảnh xé băng dính hộp quà, biểu cảm sững sờ. 3-15s: Trải thảm ra sàn, zoom vào đường may sắc nét và sợi lông mềm. 15-30s: Đặt vào góc phòng yêu thích + Kêu gọi bấm Shop Now để nhận mã giảm 15%.",
    recommendedFormat: "Vertical Video 9:16 (Quay camera điện thoại chân thực, phong cách TikTok UGC)",
    callToAction: "Customize Your Rug Now",
  },
  PROBLEM_AGITATION: {
    hookAngle: "So sánh sàn nhà trống trải lạnh lẽo vs Không gian ấm cúng đầy cá tính",
    storyboardIdea: "0-3s: Quay nhanh góc phòng ngủ tẻ nhạt với dòng chữ 'Căn phòng của bạn đang thiếu điểm nhấn?'. 3-15s: Đặt chiếc thảm dệt cá nhân hóa vào, ánh đèn đổi ấm áp, tổng thể căn phòng bừng sáng. 15-30s: Giới thiệu kích thước tùy chỉnh + Freeship.",
    recommendedFormat: "Carousel 1:1 hoặc Video ngắn 15s (Graphic text overlay đậm)",
    callToAction: "Xem Bộ Sưu Tập 50+ Mẫu",
  },
  BEFORE_AFTER: {
    hookAngle: "Thử thách thay đổi diện mạo góc làm việc / phòng khách trong 30 giây",
    storyboardIdea: "0-3s: Split-screen chia đôi màn hình: Bên trái phòng trống / Bên phải thảm đã trải hoàn thiện. 3-15s: Timelapse quy trình dệt sợi và cảm giác dẫm chân lên êm ái. 15-30s: Ưu đãi Mua 1 Tặng 1 Giảm 30%.",
    recommendedFormat: "Video 9:16 hoặc Ảnh so sánh Before/After chất lượng cao",
    callToAction: "Nâng Cấp Phòng Của Bạn",
  },
  FOUNDER_STORY: {
    hookAngle: "Tâm sự của người sáng lập: 'Tại sao tôi bỏ việc văn phòng để làm thảm thủ công?'",
    storyboardIdea: "0-3s: Bắt đầu bằng tiếng súng bắn tufting 'tạch tạch' nhịp nhàng và gương mặt tập trung của nghệ nhân. 3-15s: Kể ngắn về từng đường kim mũi chỉ, bảo hành 2 năm và cam kết chất lượng. 15-30s: Mời khách hàng đặt thảm theo yêu cầu riêng.",
    recommendedFormat: "Video 9:16 phong cách tài liệu ngắn (Story-driven UGC)",
    callToAction: "Khám Phá Câu Chuyện Của Chúng Tôi",
  },
  SOCIAL_PROOF: {
    hookAngle: "Khách hàng quay video kiểm chứng độ bền sau 6 tháng giặt máy liên tục",
    storyboardIdea: "0-3s: 'Chiếc thảm mua trên mạng sau 6 tháng giặt máy sẽ ra sao?'. 3-15s: Lấy thảm từ máy giặt ra, lông vẫn mềm, màu không phai, mặt cao su chống trượt nguyên vẹn. 15-30s: Trích dẫn các review 5 sao + Chính sách đổi trả 30 ngày.",
    recommendedFormat: "Video 9:16 (Testimonial Review)",
    callToAction: "Đọc 4,800+ Đánh Giá Thực Tế",
  },
  AESTHETIC_SHOWCASE: {
    hookAngle: "Góc quay ASMR: Cận cảnh sợi len cao cấp và tiếng kéo tỉa thảm sắc lẹm",
    storyboardIdea: "0-3s: Âm thanh tỉa viền thảm thỏa mãn thính giác (ASMR carving). 3-15s: Di chuyển góc quay 360 độ quanh tác phẩm hoàn chỉnh dưới ánh sáng tự nhiên. 15-30s: Đặt câu hỏi tương tác 'Bạn muốn thảm màu gì?' + Link đặt hàng.",
    recommendedFormat: "Video ngắn 15s tập trung hình ảnh & âm thanh sống động",
    callToAction: "Tạo Thiết Kế Riêng",
  },
  DISCOUNT_OFFER: {
    hookAngle: "Flash Sale cuối tuần: Giảm ngay 30% cho 50 đơn hàng đầu tiên",
    storyboardIdea: "0-3s: Đồng hồ đếm ngược với text lớn 'Weekend Flash Sale'. 3-15s: Show nhanh 4 mẫu bán chạy nhất trên nền nhạc sôi động. 15-30s: Hướng dẫn nhập mã giảm giá khi thanh toán.",
    recommendedFormat: "Ảnh Carousel 3-5 thẻ hoặc Video ngắn 10s",
    callToAction: "Nhận Mã Giảm Giá Ngay",
  },
  UNKNOWN: {
    hookAngle: "Giới thiệu sản phẩm mới trong bộ sưu tập",
    storyboardIdea: "Giới thiệu tính năng, màu sắc và kiểu dáng sản phẩm.",
    recommendedFormat: "Static Image hoặc Video",
    callToAction: "Shop Now",
  },
};

/**
 * Analyze Creative Gaps between Watchlist Competitor Ads and Own Store's Ads
 */
export function analyzeCreativeGaps(input: CreativeGapAnalysisInput): CreativeGapAnalysisResult {
  const { competitorAds, ownAds } = input;

  // 1. Group competitor ads by Hook Type
  const hookGroups: Map<CompetitorHookType, CompetitorAd[]> = new Map();
  const formatCounts: Record<string, number> = { VIDEO: 0, IMAGE: 0, CAROUSEL: 0 };

  for (const ad of competitorAds) {
    const hook = ad.taxonomy.hookType;
    if (!hookGroups.has(hook)) {
      hookGroups.set(hook, []);
    }
    hookGroups.get(hook)!.push(ad);

    const fmt = ad.mediaType;
    formatCounts[fmt] = (formatCounts[fmt] ?? 0) + 1;
  }

  // 2. Identify what Own Ads are running
  const ownAdTexts = ownAds.map(a => `${a.name}`).join(" ").toLowerCase();

  const ownHasHook = (hook: CompetitorHookType): boolean => {
    switch (hook) {
      case "UNBOXING":
        return /unbox|package|arrival/i.test(ownAdTexts);
      case "PROBLEM_AGITATION":
        return /tired|boring|problem|struggle|fix/i.test(ownAdTexts);
      case "BEFORE_AFTER":
        return /before|after|makeover|transformation/i.test(ownAdTexts);
      case "FOUNDER_STORY":
        return /story|founder|handmade|craft/i.test(ownAdTexts);
      case "SOCIAL_PROOF":
        return /review|star|customer|viral/i.test(ownAdTexts);
      case "DISCOUNT_OFFER":
        return /sale|discount|off|deal/i.test(ownAdTexts);
      default:
        return false;
    }
  };

  // 3. Generate Creative Gaps
  const creativeGaps: CreativeGap[] = [];
  const topWinningHooks: {
    hookType: CompetitorHookType;
    count: number;
    avgDaysActive: number;
    description: string;
  }[] = [];

  for (const [hook, ads] of hookGroups.entries()) {
    if (hook === "UNKNOWN") continue;

    const totalDays = ads.reduce((sum, a) => sum + a.daysActive, 0);
    const avgDaysActive = Math.round(totalDays / ads.length);
    const competitorNames = [...new Set(ads.map(a => a.pageName))];

    topWinningHooks.push({
      hookType: hook,
      count: ads.length,
      avgDaysActive,
      description: HOOK_DESCRIPTIONS[hook],
    });

    // Check status against own store
    const isTested = ownHasHook(hook);
    const ownStatus: CreativeGap["ownStatus"] = isTested
      ? "TESTING"
      : "UNTESTED";

    // Select top 3 sample ads for this pattern
    const sampleCompetitorAds = ads.slice(0, 3).map(a => ({
      pageName: a.pageName,
      archiveAdId: a.archiveAdId,
      daysActive: a.daysActive,
      headline: a.headline,
      mediaUrl: a.thumbnailUrl || a.mediaUrls[0],
    }));

    const suggestedBrief = SUGGESTED_BRIEFS[hook] ?? SUGGESTED_BRIEFS.UNKNOWN;

    let whyTestNext = "";
    if (ownStatus === "UNTESTED") {
      whyTestNext = `${competitorNames.length} đối thủ lớn (${competitorNames.join(", ")}) đang chạy bền bỉ dạng này (trung bình ${avgDaysActive} ngày). Đây là cơ hội mở rộng tệp khán giả mới mà store của bạn chưa từng khai thác.`;
    } else {
      whyTestNext = `Store đã có ad kiểm thử dạng này. Cân nhắc làm mới angle/hook theo phong cách của ${competitorNames[0]} để giảm độ mỏi creative (ad fatigue).`;
    }

    creativeGaps.push({
      id: `gap-${hook.toLowerCase()}`,
      patternName: HOOK_DESCRIPTIONS[hook],
      hookType: hook,
      visualStyle: ads[0]?.taxonomy.visualStyle ?? "UGC_LOFI",
      format: ads[0]?.mediaType ?? "VIDEO",
      competitorOccurrences: ads.length,
      competitorNames,
      sampleCompetitorAds,
      ownStatus,
      whyTestNext,
      limitation: "Dữ liệu công khai từ Facebook Ad Library. Doanh thu và ROAS của đối thủ là không xác định. Việc đối thủ chạy dài ngày chỉ là tín hiệu tham khảo để thiết lập giả thuyết thử nghiệm.",
      suggestedBrief,
    });
  }

  // Sort Gaps: Put UNTESTED first, then by competitor occurrences descending
  creativeGaps.sort((a, b) => {
    if (a.ownStatus === "UNTESTED" && b.ownStatus !== "UNTESTED") return -1;
    if (a.ownStatus !== "UNTESTED" && b.ownStatus === "UNTESTED") return 1;
    return b.competitorOccurrences - a.competitorOccurrences;
  });

  // Sort winning hooks by average days active descending
  topWinningHooks.sort((a, b) => b.avgDaysActive - a.avgDaysActive);

  // Format distribution
  const totalFormatAds = competitorAds.length || 1;
  const formatDistribution = Object.entries(formatCounts).map(([fmt, cnt]) => ({
    format: fmt,
    count: cnt,
    percentage: Math.round((cnt / totalFormatAds) * 100),
  }));

  return {
    creativeGaps,
    topWinningHooks,
    formatDistribution,
  };
}
