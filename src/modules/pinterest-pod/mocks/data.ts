import type {
  CandidateItem,
  DeliverablesData,
  PinterestAuthStatus,
  SummaryMetrics,
} from "../types";

export const initialMockAuthStatus: PinterestAuthStatus = {
  ok: true,
  logged_in: true,
  browser_logged_in: true,
  status_text: "Pinterest: Đã đăng nhập",
};

/** Helper to create safe inline SVG placeholder data URIs */
export function createMockSvgDataUri(
  title: string,
  subtitle: string,
  bgColor: string,
  accentColor: string,
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
    <defs>
      <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${bgColor}" />
        <stop offset="100%" stop-color="#090d16" />
      </linearGradient>
      <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
        <path d="M 40 0 L 0 0 0 40" fill="none" stroke="${accentColor}" stroke-opacity="0.15" stroke-width="1" />
      </pattern>
    </defs>
    <rect width="600" height="400" fill="url(#g)" />
    <rect width="600" height="400" fill="url(#grid)" />
    <circle cx="300" cy="180" r="90" fill="${accentColor}" fill-opacity="0.18" />
    <rect x="230" y="110" width="140" height="140" rx="16" fill="none" stroke="${accentColor}" stroke-width="3" stroke-dasharray="6,4" />
    <text x="300" y="270" fill="#f8fafc" font-family="system-ui, sans-serif" font-size="18" font-weight="700" text-anchor="middle">${title}</text>
    <text x="300" y="300" fill="#94a3b8" font-family="system-ui, sans-serif" font-size="13" text-anchor="middle">${subtitle}</text>
  </svg>`;

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const mockCandidates: readonly CandidateItem[] = [
  {
    id: "cand_pin_101",
    image_id: "cand_pin_101",
    pin_id: "84090656167812345",
    title: "Washed Persian Medallion Rug in Earth Tones",
    query: "vintage rug",
    trend: "vintage distressed rug",
    pin_url: "https://pinterest.com/pin/84090656167812345",
    image_url: createMockSvgDataUri("Persian Medallion", "Vintage Earth Tones", "#1e1b4b", "#818cf8"),
    image_score: 96.0,
    printability_score: 94.0,
    flat_artwork_score: 92.5,
    is_direct_printable: true,
    recommended: true,
    reason: "Hoa văn phẳng chuẩn, tương phản cao, in xưởng sắc nét.",
  },
  {
    id: "cand_pin_102",
    image_id: "cand_pin_102",
    pin_id: "84090656167812346",
    title: "Boho Moroccan Geometric Runner with Diamond Motif",
    query: "boho rug",
    trend: "bohemian runner",
    pin_url: "https://pinterest.com/pin/84090656167812346",
    image_url: createMockSvgDataUri("Moroccan Geometric", "Boho Diamond Runner", "#14251e", "#34d399"),
    image_score: 88.0,
    printability_score: 85.0,
    flat_artwork_score: 86.0,
    is_direct_printable: true,
    recommended: false,
    reason: "Đường nét kỷ hà rõ nét, viền đối xứng, dễ căn chỉnh khi cắt xưởng.",
  },
  {
    id: "cand_pin_103",
    image_id: "cand_pin_103",
    pin_id: "84090656167812347",
    title: "Nordic Minimalist Wool Blend Rug Organic Texture",
    query: "nordic rug",
    trend: "minimalist home",
    pin_url: "https://pinterest.com/pin/84090656167812347",
    image_url: createMockSvgDataUri("Nordic Minimalist", "Organic Neutral Texture", "#241829", "#e879f9"),
    image_score: 94.0,
    printability_score: 92.0,
    flat_artwork_score: 90.0,
    is_direct_printable: true,
    recommended: true,
    reason: "Gam màu trung tính phong cách Bắc Âu, bố cục cân đối hoàn hảo.",
  },
  {
    id: "cand_pin_104",
    image_id: "cand_pin_104",
    pin_id: "84090656167812348",
    title: "Vintage Distressed Floral Medallion Accent Rug",
    query: "floral rug",
    trend: "distressed rug",
    pin_url: "https://pinterest.com/pin/84090656167812348",
    image_url: createMockSvgDataUri("Floral Medallion", "Distressed Accent Rug", "#2b1b17", "#fb923c"),
    image_score: 82.0,
    printability_score: 80.0,
    flat_artwork_score: 78.0,
    is_direct_printable: false,
    recommended: false,
    reason: "Mẫu có góc hơi nghiêng nhẹ, thuật toán AI Vision sẽ nắn phẳng trước khi in.",
  },
  {
    id: "cand_pin_105",
    image_id: "cand_pin_105",
    pin_id: "84090656167812349",
    title: "Retro 70s Wavy Checkered Accent Rug Vibrant",
    query: "retro rug",
    trend: "70s aesthetic",
    pin_url: "https://pinterest.com/pin/84090656167812349",
    image_url: createMockSvgDataUri("Retro 70s Wavy", "Checkered Accent Rug", "#1f2937", "#38bdf8"),
    image_score: 91.0,
    printability_score: 93.0,
    flat_artwork_score: 95.0,
    is_direct_printable: true,
    recommended: true,
    reason: "Màu sắc tương phản rực rỡ, độ phẳng tuyệt đối, đón đầu xu hướng Gen Z.",
  },
  {
    id: "cand_pin_106",
    image_id: "cand_pin_106",
    pin_id: "84090656167812350",
    title: "Japandi Wabi-Sabi Neutral Line Runner",
    query: "japandi rug",
    trend: "wabi sabi home",
    pin_url: "https://pinterest.com/pin/84090656167812350",
    image_url: createMockSvgDataUri("Japandi Line Runner", "Wabi-Sabi Aesthetics", "#18262a", "#2dd4bf"),
    image_score: 87.0,
    printability_score: 89.0,
    flat_artwork_score: 88.0,
    is_direct_printable: true,
    recommended: false,
    reason: "Tối giản, tông màu tự nhiên dịu mắt, chuyển sắc đồng đều.",
  },
];

export const mockSummaryMetrics: SummaryMetrics = {
  rgb_4k_count: 3,
  cmyk_count: 3,
  lifestyle_mockup_count: 6,
  cutouts_count: 3,
  mockups_count: 6,
};

export const mockDeliverables: DeliverablesData = {
  print_cmyk_images: [
    {
      filename: "design_01_cmyk_300dpi.jpg",
      url: createMockSvgDataUri("BẢN IN CMYK #1", "4000x6400px - 300 DPI", "#1e1b4b", "#818cf8"),
      download_url: createMockSvgDataUri("BẢN IN CMYK #1", "4000x6400px - 300 DPI", "#1e1b4b", "#818cf8"),
    },
    {
      filename: "design_02_cmyk_300dpi.jpg",
      url: createMockSvgDataUri("BẢN IN CMYK #2", "4000x6400px - 300 DPI", "#14251e", "#34d399"),
      download_url: createMockSvgDataUri("BẢN IN CMYK #2", "4000x6400px - 300 DPI", "#14251e", "#34d399"),
    },
    {
      filename: "design_03_cmyk_300dpi.jpg",
      url: createMockSvgDataUri("BẢN IN CMYK #3", "4000x6400px - 300 DPI", "#1f2937", "#38bdf8"),
      download_url: createMockSvgDataUri("BẢN IN CMYK #3", "4000x6400px - 300 DPI", "#1f2937", "#38bdf8"),
    },
  ],
  lifestyle_mockups: [
    {
      filename: "mockup_living_room_design_01.jpg",
      url: createMockSvgDataUri("MOCKUP PHÒNG KHÁCH AI #1", "Modern leather sofa with sunbeam", "#1a2238", "#60a5fa"),
      scene_type: "living_room",
      scene_description: "Phòng khách hiện đại với sofa da bò nâu, bàn trà gỗ tự nhiên và ánh sáng ban mai.",
    },
    {
      filename: "mockup_bedroom_design_01.jpg",
      url: createMockSvgDataUri("MOCKUP PHÒNG NGỦ AI #1", "Cozy minimalist bedroom with oak floor", "#2b1c2b", "#f472b6"),
      scene_type: "bedroom",
      scene_description: "Phòng ngủ phong cách tối giản ấm cúng với sàn gỗ sồi và chăn ga màu be.",
    },
    {
      filename: "mockup_living_room_design_02.jpg",
      url: createMockSvgDataUri("MOCKUP PHÒNG KHÁCH AI #2", "Boho chic studio with rattan furniture", "#132a1e", "#4ade80"),
      scene_type: "living_room",
      scene_description: "Căn hộ phong cách Boho mộc mạc với nội thất mây tre đan và cây xanh nhiệt đới.",
    },
    {
      filename: "mockup_reading_nook_design_02.jpg",
      url: createMockSvgDataUri("MOCKUP GÓC ĐỌC SÁCH AI #2", "Sunlit reading corner with velvet armchair", "#2d2315", "#facc15"),
      scene_type: "reading_nook",
      scene_description: "Góc đọc sách ngập tràn ánh nắng cùng ghế bành nhung vàng êm ái.",
    },
    {
      filename: "mockup_living_room_design_03.jpg",
      url: createMockSvgDataUri("MOCKUP PHÒNG KHÁCH AI #3", "Retro mid-century lounge space", "#1f2937", "#38bdf8"),
      scene_type: "living_room",
      scene_description: "Không gian phòng khách Mid-Century hiện đại với điểm nhấn sóng nước trẻ trung.",
    },
    {
      filename: "mockup_dining_area_design_03.jpg",
      url: createMockSvgDataUri("MOCKUP KHÔNG GIAN BẾP ĂN AI #3", "Nordic dining table with pendant lights", "#1e293b", "#a78bfa"),
      scene_type: "dining_room",
      scene_description: "Bàn ăn gia đình phong cách Bắc Âu thanh lịch dưới ánh đèn chùm ấm áp.",
    },
  ],
  product_cutouts_white: [
    {
      filename: "design_01_white.jpg",
      url: createMockSvgDataUri("PHÔI CẮT NỀN TRẮNG #1", "Pure White Background #ffffff", "#ffffff", "#0284c7"),
    },
    {
      filename: "design_02_white.jpg",
      url: createMockSvgDataUri("PHÔI CẮT NỀN TRẮNG #2", "Pure White Background #ffffff", "#ffffff", "#10b981"),
    },
    {
      filename: "design_03_white.jpg",
      url: createMockSvgDataUri("PHÔI CẮT NỀN TRẮNG #3", "Pure White Background #ffffff", "#ffffff", "#06b6d4"),
    },
  ],
  comparison_rows: [
    {
      index: 1,
      product_label: "Mẫu #1: Washed Persian Medallion",
      source_url: createMockSvgDataUri("Ảnh gốc Pinterest", "Original Pin 84090656167812345", "#1e1b4b", "#818cf8"),
      cutout_url: createMockSvgDataUri("Phôi bóc tách", "Transparent Cutout PNG", "#111827", "#818cf8"),
      cutout_white_url: createMockSvgDataUri("Phôi nền trắng", "Pure #ffffff for eCommerce", "#ffffff", "#818cf8"),
      final_print_url: createMockSvgDataUri("File CMYK 300DPI", "4000x6400px Print Master", "#1e1b4b", "#818cf8"),
      ai_background_urls: [
        createMockSvgDataUri("Mockup AI 1A", "Living Room", "#1a2238", "#60a5fa"),
        createMockSvgDataUri("Mockup AI 1B", "Bedroom", "#2b1c2b", "#f472b6"),
      ],
    },
    {
      index: 2,
      product_label: "Mẫu #2: Boho Moroccan Geometric",
      source_url: createMockSvgDataUri("Ảnh gốc Pinterest", "Original Pin 84090656167812346", "#14251e", "#34d399"),
      cutout_url: createMockSvgDataUri("Phôi bóc tách", "Transparent Cutout PNG", "#111827", "#34d399"),
      cutout_white_url: createMockSvgDataUri("Phôi nền trắng", "Pure #ffffff for eCommerce", "#ffffff", "#34d399"),
      final_print_url: createMockSvgDataUri("File CMYK 300DPI", "4000x6400px Print Master", "#14251e", "#34d399"),
      ai_background_urls: [
        createMockSvgDataUri("Mockup AI 2A", "Boho Studio", "#132a1e", "#4ade80"),
        createMockSvgDataUri("Mockup AI 2B", "Reading Nook", "#2d2315", "#facc15"),
      ],
    },
    {
      index: 3,
      product_label: "Mẫu #3: Retro 70s Wavy Checkered",
      source_url: createMockSvgDataUri("Ảnh gốc Pinterest", "Original Pin 84090656167812349", "#1f2937", "#38bdf8"),
      cutout_url: createMockSvgDataUri("Phôi bóc tách", "Transparent Cutout PNG", "#111827", "#38bdf8"),
      cutout_white_url: createMockSvgDataUri("Phôi nền trắng", "Pure #ffffff for eCommerce", "#ffffff", "#38bdf8"),
      final_print_url: createMockSvgDataUri("File CMYK 300DPI", "4000x6400px Print Master", "#1f2937", "#38bdf8"),
      ai_background_urls: [
        createMockSvgDataUri("Mockup AI 3A", "Mid-Century Lounge", "#1f2937", "#38bdf8"),
        createMockSvgDataUri("Mockup AI 3B", "Dining Room", "#1e293b", "#a78bfa"),
      ],
    },
  ],
};

export const initialMockLogs: readonly string[] = [
  "[15:24:02] Bắt đầu cào Pinterest niche: vintage distressed rug...",
  "[15:24:05] Pinterest Trends: Quét phát hiện 8 từ khóa hot theo thời gian thực.",
  "[15:24:08] AI Vision: Lọc thành công 6 mẫu đạt chuẩn độ nét và tỷ lệ phẳng.",
  "[15:24:12] Sẵn sàng duyệt mẫu ứng viên.",
];
