import { useEffect, useMemo, useState } from "react";

import { AddStoreModal, type AddedStoreInfo } from "../../../../shared/components/AddStoreModal";
import { DeleteStoreModal } from "../../../../shared/components/DeleteStoreModal";
import { notifyUser } from "../../../../shared/utils";
import type {
  ImageProcessingProfile,
  PinterestPodShopifySettings,
  PodPricePresetDefinition,
  PodPriceVariantItem,
} from "../../types";
import {
  DEFAULT_PINTEREST_POD_SHOPIFY_SETTINGS,
  DEFAULT_POD_PRICE_VARIANTS,
} from "../../types";

export interface StoreProfile {
  readonly storeId: string;
  readonly shopDomain: string;
  readonly productTypes?: readonly string[];
  readonly defaultProductType?: string;
}

export const DEFAULT_POD_STORE_PROFILES: readonly StoreProfile[] = [
  {
    storeId: "chillgen",
    shopDomain: "bbjttb-n9.myshopify.com",
    productTypes: ["Rug", "Doormat"],
    defaultProductType: "Rug",
  },
  {
    storeId: "capozen",
    shopDomain: "capozen.myshopify.com",
    productTypes: ["Rug", "Doormat", "Area Rug"],
    defaultProductType: "Rug",
  },
  {
    storeId: "jeminise",
    shopDomain: "b6-theme-test.myshopify.com",
    productTypes: ["Blanket", "Bedding Set", "Quilt", "Comforter", "Pillow"],
    defaultProductType: "Blanket",
  },
];

export const DEFAULT_STORE_PRODUCT_TYPES: Record<
  string,
  { productTypes: string[]; defaultProductType: string }
> = {
  chillgen: {
    productTypes: ["Rug", "Doormat"],
    defaultProductType: "Rug",
  },
  capozen: {
    productTypes: ["Rug", "Doormat", "Area Rug"],
    defaultProductType: "Rug",
  },
  jeminise: {
    productTypes: ["Blanket", "Bedding Set", "Quilt", "Comforter", "Pillow"],
    defaultProductType: "Blanket",
  },
};

export const COMMON_PRODUCT_TYPES = [
  { label: "Rug (Thảm trải sàn)", value: "Rug" },
  { label: "Doormat (Thảm cửa)", value: "Doormat" },
  { label: "Blanket (Chăn lông / Fleece Blanket)", value: "Blanket" },
  { label: "Quilt (Chăn chần bông)", value: "Quilt" },
  { label: "Comforter (Bộ chăn ga)", value: "Comforter" },
  { label: "Pillow (Gối / Vỏ gối)", value: "Pillow" },
  { label: "Tote Bag (Túi vải Canvas)", value: "Tote Bag" },
  { label: "Backpack (Ba lô)", value: "Backpack" },
  { label: "Canvas (Tranh Canvas)", value: "Canvas" },
  { label: "T-Shirt (Áo thun)", value: "T-Shirt" },
  { label: "Hoodie (Áo nỉ có mũ)", value: "Hoodie" },
  { label: "Tumbler (Ly giữ nhiệt)", value: "Tumbler" },
  { label: "Ornament (Đồ trang trí)", value: "Ornament" },
  { label: "Sign (Biển hiệu)", value: "Sign" },
];

export const POD_PRICE_PRESETS: readonly PodPricePresetDefinition[] = [
  // --- STORE CHILLGEN & CAPOZEN (Rug & Doormat store) ---
  {
    id: "rug_3_sizes",
    name: "Rug: Thảm chữ nhật 3 kích thước (36x60, 48x72, 60x96)",
    productType: "Rug",
    targetStoreIds: ["chillgen", "capozen"],
    description: "3 kích thước tiêu chuẩn cho Rug phòng khách & phòng ngủ",
    variants: [
      { label: '36" x 60" (3x5 ft)', basePrice: 49.99, optionName: "Size" },
      { label: '48" x 72" (4x6 ft)', basePrice: 79.99, optionName: "Size" },
      { label: '60" x 96" (5x8 ft)', basePrice: 129.99, optionName: "Size" },
    ],
  },
  {
    id: "rug_round_2_sizes",
    name: "Rug: Thảm tròn 2 kích thước (3ft, 5ft Round)",
    productType: "Rug",
    targetStoreIds: ["chillgen", "capozen"],
    description: "2 kích thước thảm tròn điểm nhấn",
    variants: [
      { label: '3 ft Round (36")', basePrice: 39.99, optionName: "Size" },
      { label: '5 ft Round (60")', basePrice: 69.99, optionName: "Size" },
    ],
  },
  {
    id: "doormat_3_sizes",
    name: "Doormat: Thảm cửa 3 kích thước (16x24, 18x30, 24x36)",
    productType: "Doormat",
    targetStoreIds: ["chillgen", "capozen"],
    description: "3 kích thước thảm chùi chân / cửa ra vào",
    variants: [
      { label: '16" x 24"', basePrice: 24.99, optionName: "Size" },
      { label: '18" x 30"', basePrice: 29.99, optionName: "Size" },
      { label: '24" x 36"', basePrice: 39.99, optionName: "Size" },
    ],
  },
  {
    id: "area_rug_3_sizes",
    name: "Area Rug: Cao cấp 3 kích thước (4x6, 5x8, 8x10 ft)",
    productType: "Area Rug",
    targetStoreIds: ["capozen"],
    description: "3 kích thước thảm trải sàn cao cấp",
    variants: [
      { label: '48" x 72" (4x6 ft)', basePrice: 89.99, optionName: "Size" },
      { label: '60" x 96" (5x8 ft)', basePrice: 149.99, optionName: "Size" },
      { label: '96" x 120" (8x10 ft)', basePrice: 249.99, optionName: "Size" },
    ],
  },
  // --- STORE JEMINISE (Bedding, Blanket, Quilt, Pillow, Comforter) ---
  {
    id: "blanket_3_sizes",
    name: "Blanket: Chăn Fleece 3 kích thước (30x40, 50x60, 60x80)",
    productType: "Blanket",
    targetStoreIds: ["jeminise"],
    description: "Baby, Throw và Queen size cho chăn nỉ",
    variants: [
      { label: '30" x 40" (Baby)', basePrice: 29.99, optionName: "Size" },
      { label: '50" x 60" (Throw)', basePrice: 44.99, optionName: "Size" },
      { label: '60" x 80" (Queen)', basePrice: 59.99, optionName: "Size" },
    ],
  },
  {
    id: "quilt_3_sizes",
    name: "Quilt: Chăn chần bông 3 kích thước (Twin, Queen, King)",
    productType: "Quilt",
    targetStoreIds: ["jeminise"],
    description: "Twin, Queen và King size",
    variants: [
      { label: 'Twin (68" x 88")', basePrice: 59.99, optionName: "Size" },
      { label: 'Queen (88" x 88")', basePrice: 79.99, optionName: "Size" },
      { label: 'King (104" x 88")', basePrice: 99.99, optionName: "Size" },
    ],
  },
  {
    id: "bedding_set_3_sizes",
    name: "Bedding Set: Bộ chăn ga 3 kích thước (Twin, Queen, King)",
    productType: "Bedding Set",
    targetStoreIds: ["jeminise"],
    description: "Trọn bộ chăn ga gối",
    variants: [
      { label: "Twin Set (68x88)", basePrice: 69.99, optionName: "Size" },
      { label: "Queen Set (88x88)", basePrice: 89.99, optionName: "Size" },
      { label: "King Set (104x88)", basePrice: 109.99, optionName: "Size" },
    ],
  },
  {
    id: "pillow_2_sizes",
    name: "Pillow: Vỏ gối 2 kích thước (18x18, 20x20 in)",
    productType: "Pillow",
    targetStoreIds: ["jeminise"],
    description: "Vỏ gối vuông trang trí",
    variants: [
      { label: '18" x 18"', basePrice: 19.99, optionName: "Size" },
      { label: '20" x 20"', basePrice: 24.99, optionName: "Size" },
    ],
  },
  {
    id: "comforter_3_sizes",
    name: "Comforter: Chăn Comforter 3 kích thước (Twin, Queen, King)",
    productType: "Comforter",
    targetStoreIds: ["jeminise"],
    description: "Chăn bông mùa đông",
    variants: [
      { label: "Twin (68x88)", basePrice: 64.99, optionName: "Size" },
      { label: "Queen (88x88)", basePrice: 84.99, optionName: "Size" },
      { label: "King (104x88)", basePrice: 104.99, optionName: "Size" },
    ],
  },
  // --- GENERIC / CUSTOM PRESETS ---
  {
    id: "tote_bag_3_sizes",
    name: "Tote Bag: Túi Canvas 3 kích thước (Small, Medium, Large)",
    productType: "Tote Bag",
    description: "Small, Medium và Large túi canvas",
    variants: [
      { label: 'Small (13" x 13")', basePrice: 19.99, optionName: "Size" },
      { label: 'Medium (16" x 16")', basePrice: 24.99, optionName: "Size" },
      { label: 'Large (18" x 18")', basePrice: 29.99, optionName: "Size" },
    ],
  },
  {
    id: "single_size",
    name: "Giá đơn 1 kích thước tiêu chuẩn ($29.99)",
    productType: "Custom",
    description: "Sản phẩm chỉ có 1 biến thể duy nhất",
    variants: [
      { label: "Standard (One Size)", basePrice: 29.99, optionName: "Size" },
    ],
  },
];

export function getPresetsForStore(
  storeId: string,
  storeProductTypes?: readonly string[],
): readonly PodPricePresetDefinition[] {
  const cleanStore = (storeId || "chillgen").trim().toLowerCase();

  // 1. Direct targetStoreIds match
  const storeSpecific = POD_PRICE_PRESETS.filter(
    (p) => p.targetStoreIds && p.targetStoreIds.some((s) => s.toLowerCase() === cleanStore),
  );

  // 2. Type matches based on store's allowed product types
  const types = (storeProductTypes || []).map((t) => t.toLowerCase().trim());
  const typeMatches = POD_PRICE_PRESETS.filter((p) => {
    if (storeSpecific.some((sp) => sp.id === p.id)) return false;
    const pType = p.productType.toLowerCase().trim();
    return types.some((t) => pType.includes(t) || t.includes(pType));
  });

  const combined = [...storeSpecific, ...typeMatches];

  // 3. Include generic single size
  const single = POD_PRICE_PRESETS.find((p) => p.id === "single_size");
  if (single && !combined.some((c) => c.id === single.id)) {
    combined.push(single);
  }

  return combined.length > 0 ? combined : POD_PRICE_PRESETS;
}

export function findDefaultPresetForProductType(
  productType?: string,
  storeId?: string,
  storeProductTypes?: readonly string[],
): PodPricePresetDefinition {
  const pool = storeId ? getPresetsForStore(storeId, storeProductTypes) : POD_PRICE_PRESETS;
  const normalized = (productType || "").toLowerCase().trim();

  if (normalized) {
    const matched = pool.find((p) => {
      const pt = p.productType.toLowerCase().trim();
      const pName = p.name.toLowerCase().trim();
      return pt.includes(normalized) || normalized.includes(pt) || pName.includes(normalized);
    });
    if (matched) return matched;
  }

  return pool[0] || POD_PRICE_PRESETS[0];
}

function NumberSetting({
  label,
  value,
  min,
  max,
  onChange,
}: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <label className="grid gap-1 text-sm text-slate-300">
      {label}
      <input
        className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
        max={max}
        min={min}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

export interface ShopifyPricingConfigSectionProps {
  readonly settings: PinterestPodShopifySettings;
  readonly onChange: (nextSettings: PinterestPodShopifySettings) => void;
  readonly onReset?: () => void;
  readonly disabled?: boolean;
}

export function ShopifyPricingConfigSection({
  settings,
  onChange,
  onReset,
  disabled = false,
}: ShopifyPricingConfigSectionProps): React.JSX.Element {
  // Stores state
  const [availableStores, setAvailableStores] = useState<StoreProfile[]>(() => [
    ...DEFAULT_POD_STORE_PROFILES,
  ]);
  const [customStoreProductTypes, setCustomStoreProductTypes] = useState<Record<string, string[]>>(() => {
    try {
      const raw = localStorage.getItem("ffp_store_product_types");
      return raw ? (JSON.parse(raw) as Record<string, string[]>) : {};
    } catch {
      return {};
    }
  });

  const [newProductTypeInput, setNewProductTypeInput] = useState("");
  const [isAddingNewType, setIsAddingNewType] = useState(false);
  const [isAddStoreOpen, setIsAddStoreOpen] = useState(false);
  const [isEditStoreOpen, setIsEditStoreOpen] = useState(false);
  const [isDeleteStoreOpen, setIsDeleteStoreOpen] = useState(false);

  // Collections state
  const [availableCollections, setAvailableCollections] = useState<
    Array<{ id: string; title: string; productsCount?: number }>
  >([]);
  const [isLoadingCollections, setIsLoadingCollections] = useState(false);
  const [isCollectionListOpen, setIsCollectionListOpen] = useState(false);

  // Image Processing state
  const [imageProfiles, setImageProfiles] = useState<ImageProcessingProfile[]>([]);
  const [editingImageProfile, setEditingImageProfile] = useState<ImageProcessingProfile | null>(null);
  const [isImageProfileEditorOpen, setIsImageProfileEditorOpen] = useState(false);
  const [imageProfileMessage, setImageProfileMessage] = useState<string | null>(null);
  const [imageProfilePreview, setImageProfilePreview] = useState<string | null>(null);

  // Store products search & sample copying state
  const [isStoreSearchOpen, setIsStoreSearchOpen] = useState(false);
  const [storeSearchQuery, setStoreSearchQuery] = useState("");
  const [storeProducts, setStoreProducts] = useState<
    Array<{ id: string; title: string; handle: string; productType?: string }>
  >([]);
  const [isLoadingStoreProducts, setIsLoadingStoreProducts] = useState(false);
  const [isLoadingProductVariants, setIsLoadingProductVariants] = useState(false);
  const [storeProductLoadError, setStoreProductLoadError] = useState<string | null>(null);

  // New variant inline row state
  const [newVariantLabel, setNewVariantLabel] = useState("");
  const [newVariantPrice, setNewVariantPrice] = useState<number>(39.99);
  const [isAddingVariant, setIsAddingVariant] = useState(false);

  // Quick custom price states for manual pricing mode
  const [quickSinglePrice, setQuickSinglePrice] = useState<number>(29.99);
  const [quickBulkPrice, setQuickBulkPrice] = useState<number>(29.99);

  // Per-Store Pricing Isolation Cache
  const [storePricingCache, setStorePricingCache] = useState<
    Record<
      string,
      {
        readonly productType: string;
        readonly priceAddition: number;
        readonly discountPercent: number;
        readonly profileSlug: "default" | "jeminise";
        readonly applyJeminisePreset: boolean;
        readonly priceSetMode: "preset" | "store_product" | "custom";
        readonly priceSetPresetId?: string;
        readonly storeSampleProductId?: string;
        readonly storeSampleProductTitle?: string;
        readonly variants: readonly PodPriceVariantItem[];
      }
    >
  >(() => {
    try {
      const raw = localStorage.getItem("ffp_pod_store_pricing_cache");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  // Custom presets saved by user per store
  const [storeCustomPresets, setStoreCustomPresets] = useState<
    Record<string, readonly PodPriceVariantItem[]>
  >(() => {
    try {
      const raw = localStorage.getItem("ffp_pod_store_custom_presets");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  // 1. Fetch available stores from Gateway /api/shopify
  useEffect(() => {
    let isMounted = true;
    async function loadStores(): Promise<void> {
      try {
        const response = await fetch("/api/shopify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation: "stores.list", payload: {} }),
        });
        const result = await response.json();
        if (isMounted && result.success && Array.isArray(result.data?.stores) && result.data.stores.length > 0) {
          const fetched: StoreProfile[] = (result.data.stores as Array<{ storeId: string; shopDomain: string }>).map((s) => ({
            storeId: s.storeId,
            shopDomain: s.shopDomain,
          }));

          setAvailableStores((prev) => {
            const map = new Map<string, StoreProfile>();
            for (const s of prev) map.set(s.storeId.toLowerCase(), s);
            for (const s of fetched) {
              const existing = map.get(s.storeId.toLowerCase());
              map.set(s.storeId.toLowerCase(), {
                storeId: s.storeId,
                shopDomain: s.shopDomain,
                productTypes: existing?.productTypes,
                defaultProductType: existing?.defaultProductType,
              });
            }
            return Array.from(map.values());
          });
        }
      } catch {
        // Keep fallback stores
      }
    }
    void loadStores();
    return () => {
      isMounted = false;
    };
  }, []);

  // 2. Fetch collections for selected store
  useEffect(() => {
    let isMounted = true;
    const targetStore = settings.storeId || "chillgen";
    async function loadCollections(): Promise<void> {
      setIsLoadingCollections(true);
      try {
        const response = await fetch("/api/shopify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId: targetStore,
            operation: "collections.list",
            payload: { limit: 250 },
          }),
        });
        const result = await response.json();
        if (isMounted) {
          if (result.success && Array.isArray(result.data?.collections)) {
            setAvailableCollections(
              result.data.collections as Array<{ id: string; title: string; productsCount?: number }>,
            );
          } else {
            setAvailableCollections([]);
          }
        }
      } catch {
        if (isMounted) setAvailableCollections([]);
      } finally {
        if (isMounted) setIsLoadingCollections(false);
      }
    }
    void loadCollections();
    return () => {
      isMounted = false;
    };
  }, [settings.storeId]);

  // 3. Fetch image processing profiles from coordinator API
  useEffect(() => {
    let isMounted = true;
    async function fetchProfiles(): Promise<void> {
      try {
        const res = await fetch("/api/v1/image-profiles");
        const data = await res.json();
        if (isMounted && data && Array.isArray(data.profiles)) {
          const list = data.profiles as ImageProcessingProfile[];
          setImageProfiles(list);
          const found = list.find((p) => p.slug === settings.imageProfileSlug) ?? list[0];
          if (found && !editingImageProfile) {
            setEditingImageProfile(found);
          }
        }
      } catch {
        // Fallback default
        if (isMounted) {
          setImageProfiles([
            {
              slug: "default",
              name: "Mặc định (Default)",
              enabled: true,
              revision: "1",
              hasLogo: false,
              randomPixels: 100,
              pixelDelta: 3,
              jpegQuality: 92,
              output: { width: 1500, height: 1500, fit: "contain", upscale: true, background: "#ffffff" },
              logo: {
                enabled: false,
                width: 50,
                height: 50,
                maxPercent: 15,
                padding: 10,
                position: "bottom-right",
              },
            },
          ]);
        }
      }
    }
    void fetchProfiles();
    return () => {
      isMounted = false;
    };
  }, [settings.imageProfileSlug]);

  const currentStoreId = (settings.storeId || "chillgen").trim().toLowerCase();

  const selectedStoreProfile = useMemo(() => {
    return availableStores.find((s) => s.storeId.toLowerCase() === currentStoreId);
  }, [availableStores, currentStoreId]);

  const activeStoreId = selectedStoreProfile?.storeId || settings.storeId || "chillgen";
  const activeShopDomain = selectedStoreProfile?.shopDomain || `${activeStoreId}.myshopify.com`;
  const computedVendor = (activeStoreId.split("--")[0] || activeStoreId).trim().toUpperCase();

  const activeStoreAllowedProductTypes = useMemo(() => {
    const custom = customStoreProductTypes[currentStoreId];
    if (custom && custom.length > 0) return custom;
    if (selectedStoreProfile?.productTypes && selectedStoreProfile.productTypes.length > 0) {
      return selectedStoreProfile.productTypes;
    }
    return DEFAULT_STORE_PRODUCT_TYPES[currentStoreId]?.productTypes || ["Rug", "Doormat"];
  }, [customStoreProductTypes, currentStoreId, selectedStoreProfile]);

  const storeFilteredPresets = useMemo(() => {
    return getPresetsForStore(activeStoreId, activeStoreAllowedProductTypes);
  }, [activeStoreId, activeStoreAllowedProductTypes]);

  const storeCustomSavedPreset = storeCustomPresets[activeStoreId.toLowerCase()];

  const activeCollectionIds = useMemo(() => {
    const fromArray = Array.isArray(settings.collectionIds) ? settings.collectionIds : [];
    if (fromArray.length > 0) return fromArray;
    return settings.collectionId ? [settings.collectionId] : [];
  }, [settings.collectionIds, settings.collectionId]);

  const selectedCollections = useMemo(() => {
    return availableCollections.filter((c) => activeCollectionIds.includes(c.id));
  }, [availableCollections, activeCollectionIds]);

  function updateSetting<K extends keyof PinterestPodShopifySettings>(
    key: K,
    val: PinterestPodShopifySettings[K],
  ): void {
    onChange({
      ...settings,
      [key]: val,
    });
  }

  function handleSaveCurrentAsStorePreset(): void {
    const cleanId = activeStoreId.toLowerCase();
    const updatedMap = {
      ...storeCustomPresets,
      [cleanId]: activeVariants,
    };
    setStoreCustomPresets(updatedMap);
    try {
      localStorage.setItem("ffp_pod_store_custom_presets", JSON.stringify(updatedMap));
    } catch {}
    notifyUser({
      title: `💾 Đã lưu bộ giá cho ${activeStoreId.toUpperCase()}`,
      message: `Đã lưu cấu hình ${activeVariants.length} kích thước thành bộ giá riêng cho store ${activeStoreId.toUpperCase()}.`,
      type: "success",
    });
  }

  function handleStoreChange(nextStore: string): void {
    const prevStoreLower = (settings.storeId || "chillgen").trim().toLowerCase();
    const nextStoreLower = nextStore.trim().toLowerCase();

    // 1. Lưu lại snapshot định giá của store cũ vào cache để không bị mất/lẫn
    const currentSnapshot = {
      productType: settings.productType || "Rug",
      priceAddition: settings.priceAddition ?? 6.95,
      discountPercent: settings.discountPercent ?? 0,
      profileSlug: settings.profileSlug ?? "default",
      applyJeminisePreset: settings.applyJeminisePreset ?? false,
      priceSetMode: settings.priceSetMode ?? "preset",
      priceSetPresetId: settings.priceSetPresetId,
      storeSampleProductId: settings.storeSampleProductId,
      storeSampleProductTitle: settings.storeSampleProductTitle,
      variants: activeVariants,
    };
    const updatedCache = {
      ...storePricingCache,
      [prevStoreLower]: currentSnapshot,
    };
    setStorePricingCache(updatedCache);
    try {
      localStorage.setItem("ffp_pod_store_pricing_cache", JSON.stringify(updatedCache));
    } catch {}

    // 2. Tìm danh mục sản phẩm cho store mới
    const storeDef = availableStores.find((s) => s.storeId.toLowerCase() === nextStoreLower);
    const customTypes = customStoreProductTypes[nextStoreLower];
    const nextStoreTypes =
      customTypes ||
      storeDef?.productTypes ||
      DEFAULT_STORE_PRODUCT_TYPES[nextStoreLower]?.productTypes ||
      ["Rug"];

    const defaultType =
      storeDef?.defaultProductType ||
      DEFAULT_STORE_PRODUCT_TYPES[nextStoreLower]?.defaultProductType ||
      nextStoreTypes[0] ||
      "Rug";

    // 3. Khôi phục cấu hình từ cache của store mới nếu đã từng lưu
    const cached = updatedCache[nextStoreLower];

    let targetProductType = defaultType;
    let targetPriceAddition = nextStoreLower === "jeminise" ? 0 : 6.95;
    let targetDiscountPercent = 0;
    let targetProfileSlug: "default" | "jeminise" = nextStoreLower === "jeminise" ? "jeminise" : "default";
    let targetApplyJeminise = nextStoreLower === "jeminise";
    let targetMode: "preset" | "store_product" | "custom" = "preset";
    let targetPresetId: string | undefined = undefined;
    let targetSampleProductId: string | undefined = undefined;
    let targetSampleProductTitle: string | undefined = undefined;
    let targetVariants: readonly PodPriceVariantItem[];

    if (cached && cached.variants && cached.variants.length > 0) {
      targetProductType = cached.productType;
      targetPriceAddition = cached.priceAddition;
      targetDiscountPercent = cached.discountPercent;
      targetProfileSlug = cached.profileSlug;
      targetApplyJeminise = cached.applyJeminisePreset;
      targetMode = cached.priceSetMode;
      targetPresetId = cached.priceSetPresetId;
      targetSampleProductId = cached.storeSampleProductId;
      targetSampleProductTitle = cached.storeSampleProductTitle;
      targetVariants = cached.variants;
    } else {
      const storeDefaultPreset = findDefaultPresetForProductType(defaultType, nextStore, nextStoreTypes);
      targetPresetId = storeDefaultPreset.id;
      targetVariants = storeDefaultPreset.variants;
    }

    setStoreProducts([]);
    setStoreSearchQuery("");

    onChange({
      ...settings,
      storeId: nextStore,
      vendor: (nextStore.split("--")[0] || nextStore).trim().toUpperCase(),
      collectionIds: [],
      collectionId: "",
      productType: targetProductType,
      priceAddition: targetPriceAddition,
      discountPercent: targetDiscountPercent,
      profileSlug: targetProfileSlug,
      applyJeminisePreset: targetApplyJeminise,
      priceSetMode: targetMode,
      priceSetPresetId: targetPresetId,
      storeSampleProductId: targetSampleProductId,
      storeSampleProductTitle: targetSampleProductTitle,
      variants: targetVariants,
    });

    notifyUser({
      title: `Đã chuyển sang store ${nextStore.toUpperCase()}`,
      message: `Đã tự động tải cấu hình & bộ giá riêng của store ${nextStore}.`,
      type: "info",
    });
  }

  function handleProductTypeChange(nextType: string): void {
    const nextPreset = findDefaultPresetForProductType(nextType, activeStoreId, activeStoreAllowedProductTypes);
    if (settings.priceSetMode === "store_product" || settings.priceSetMode === "custom") {
      onChange({
        ...settings,
        productType: nextType,
      });
    } else {
      onChange({
        ...settings,
        productType: nextType,
        priceSetMode: "preset",
        priceSetPresetId: nextPreset.id,
        variants: nextPreset.variants,
      });
    }
  }

  const activeVariants = useMemo(() => {
    return settings.variants && settings.variants.length > 0
      ? settings.variants
      : DEFAULT_POD_PRICE_VARIANTS;
  }, [settings.variants]);

  const currentPriceMode: "preset" | "store_product" | "custom" =
    settings.priceSetMode ?? (settings.storeSampleProductTitle ? "store_product" : "preset");

  function handleSwitchMode(mode: "preset" | "store_product" | "custom"): void {
    if (mode === "preset") {
      const preset = findDefaultPresetForProductType(settings.productType, activeStoreId, activeStoreAllowedProductTypes);
      onChange({
        ...settings,
        priceSetMode: "preset",
        priceSetPresetId: preset.id,
        storeSampleProductId: undefined,
        storeSampleProductTitle: undefined,
        variants: preset.variants,
      });
      notifyUser({
        title: "📋 Đã chuyển sang Bộ giá mẫu",
        message: `Đang áp dụng bộ giá mẫu "${preset.name}" cho store ${activeStoreId.toUpperCase()}.`,
        type: "info",
      });
    } else if (mode === "store_product") {
      setIsStoreSearchOpen(true);
      void loadStoreProducts();
    } else if (mode === "custom") {
      onChange({
        ...settings,
        priceSetMode: "custom",
        priceSetPresetId: undefined,
        storeSampleProductId: undefined,
        storeSampleProductTitle: undefined,
      });
      notifyUser({
        title: "✍️ Chế độ Tự set giá thủ công",
        message: "Bạn có thể tự do chỉnh sửa bảng giá, thêm bớt kích thước hoặc áp dụng giá tùy chỉnh theo ý muốn.",
        type: "info",
      });
    }
  }

  function handleApplySinglePrice(price: number): void {
    const safePrice = Math.max(0, Number(price) || 0);
    const singleVariant: PodPriceVariantItem = {
      id: "var_custom_single",
      label: "Standard (One Size)",
      basePrice: safePrice,
      optionName: "Size",
    };
    onChange({
      ...settings,
      priceSetMode: "custom",
      priceSetPresetId: undefined,
      storeSampleProductId: undefined,
      storeSampleProductTitle: undefined,
      variants: [singleVariant],
    });
    notifyUser({
      title: "⚡ Đã đặt 1 giá duy nhất",
      message: `Sản phẩm được thiết lập 1 kích thước tiêu chuẩn với giá gốc $${safePrice.toFixed(2)}.`,
      type: "success",
    });
  }

  function handleApplyBulkPrice(price: number): void {
    const safePrice = Math.max(0, Number(price) || 0);
    const updated = activeVariants.map((v) => ({
      ...v,
      basePrice: safePrice,
    }));
    onChange({
      ...settings,
      priceSetMode: "custom",
      priceSetPresetId: undefined,
      storeSampleProductId: undefined,
      storeSampleProductTitle: undefined,
      variants: updated,
    });
    notifyUser({
      title: "⚡ Đã đặt đồng giá",
      message: `Đã áp dụng đồng giá $${safePrice.toFixed(2)} cho tất cả ${updated.length} kích thước.`,
      type: "success",
    });
  }

  function handleResetToBlankMatrix(): void {
    const blankVariant: PodPriceVariantItem = {
      id: `var_custom_${Date.now()}`,
      label: "Size 1",
      basePrice: 29.99,
      optionName: "Size",
    };
    onChange({
      ...settings,
      priceSetMode: "custom",
      priceSetPresetId: undefined,
      storeSampleProductId: undefined,
      storeSampleProductTitle: undefined,
      variants: [blankVariant],
    });
    notifyUser({
      title: "✨ Bảng giá mới",
      message: "Đã tạo bảng giá mới. Bạn có thể tự nhập tên kích thước và giá theo ý mình.",
      type: "info",
    });
  }

  function handleSetDirectPricingZeroMarkup(): void {
    onChange({
      ...settings,
      priceAddition: 0,
    });
    notifyUser({
      title: "🎯 Định giá trực tiếp",
      message: "Đã đặt Giá cộng thêm = $0. Giá bạn gõ trong bảng sẽ là giá bán chính xác trên Shopify.",
      type: "success",
    });
  }

  function handleUpdateVariant(index: number, patch: Partial<PodPriceVariantItem>): void {
    const nextList = [...activeVariants];
    nextList[index] = { ...nextList[index], ...patch };
    onChange({
      ...settings,
      priceSetMode: "custom",
      variants: nextList,
    });
  }

  function handleRemoveVariant(index: number): void {
    if (activeVariants.length <= 1) {
      notifyUser({
        title: "⚠️ Không thể xóa",
        message: "Sản phẩm cần có ít nhất 1 biến thể giá.",
        type: "warning",
      });
      return;
    }
    const nextList = activeVariants.filter((_, i) => i !== index);
    onChange({
      ...settings,
      priceSetMode: "custom",
      variants: nextList,
    });
  }

  function handleAddVariant(): void {
    const label = newVariantLabel.trim() || `Size ${activeVariants.length + 1}`;
    const basePrice = Math.max(0, Number(newVariantPrice) || 29.99);
    const nextList = [
      ...activeVariants,
      {
        id: `var_custom_${Date.now()}_${activeVariants.length + 1}`,
        label,
        basePrice,
        optionName: "Size",
      },
    ];
    onChange({
      ...settings,
      priceSetMode: "custom",
      variants: nextList,
    });
    setNewVariantLabel("");
    setNewVariantPrice(39.99);
    setIsAddingVariant(false);
  }

  function handleApplyPreset(presetId: string): void {
    if (presetId === "custom_store_preset") {
      const saved = storeCustomPresets[activeStoreId.toLowerCase()];
      if (saved && saved.length > 0) {
        onChange({
          ...settings,
          priceSetMode: "custom",
          priceSetPresetId: "custom_store_preset",
          storeSampleProductId: undefined,
          storeSampleProductTitle: undefined,
          variants: saved,
        });
        notifyUser({
          title: `★ Đã nạp bộ giá riêng của ${activeStoreId.toUpperCase()}`,
          message: `Đang áp dụng bộ giá riêng của store ${activeStoreId.toUpperCase()} (${saved.length} kích thước).`,
          type: "success",
        });
        return;
      }
    }

    const preset = POD_PRICE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    onChange({
      ...settings,
      priceSetMode: "preset",
      priceSetPresetId: preset.id,
      storeSampleProductId: undefined,
      storeSampleProductTitle: undefined,
      variants: preset.variants,
    });
  }

  function handleResetToProductTypePreset(): void {
    const preset = findDefaultPresetForProductType(settings.productType, activeStoreId, activeStoreAllowedProductTypes);
    onChange({
      ...settings,
      priceSetMode: "preset",
      priceSetPresetId: preset.id,
      storeSampleProductId: undefined,
      storeSampleProductTitle: undefined,
      variants: preset.variants,
    });
  }

  async function loadStoreProducts(search?: string): Promise<void> {
    setIsLoadingStoreProducts(true);
    setStoreProductLoadError(null);
    try {
      const response = await fetch("/api/shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: activeStoreId,
          operation: "products.list",
          payload: {
            limit: 50,
            query: search && search.trim().length > 0 ? search.trim() : undefined,
          },
        }),
      });
      const result = await response.json();
      if (result.success && Array.isArray(result.data?.products)) {
        setStoreProducts(result.data.products);
      } else {
        setStoreProducts([]);
      }
    } catch (err) {
      setStoreProductLoadError(err instanceof Error ? err.message : "Không tải được sản phẩm từ Store");
    } finally {
      setIsLoadingStoreProducts(false);
    }
  }

  async function handleSelectStoreProduct(productItem: { id: string; title: string }): Promise<void> {
    setIsLoadingProductVariants(true);
    setStoreProductLoadError(null);
    try {
      const response = await fetch("/api/shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: activeStoreId,
          operation: "products.get",
          payload: { id: productItem.id },
        }),
      });
      const result = await response.json();
      const product = result.data?.product;
      const rawVariants = product?.variants;
      const variantList = Array.isArray(rawVariants)
        ? rawVariants
        : Array.isArray(rawVariants?.edges)
        ? (rawVariants.edges as Array<{ node: unknown }>).map((e) => e.node)
        : [];

      if (variantList.length === 0) {
        throw new Error(`Sản phẩm "${productItem.title}" không có biến thể nào.`);
      }

      const extractedVariants: PodPriceVariantItem[] = (variantList as Array<{
        id?: string;
        title?: string;
        price?: string | number;
        sku?: string;
      }>).map((v) => {
        const rawTitle = (v.title || "").trim();
        const label = !rawTitle || rawTitle === "Default Title" ? "Standard" : rawTitle;
        const priceNum = typeof v.price === "number" ? v.price : parseFloat(String(v.price || "")) || 29.99;
        return {
          id: v.id,
          label,
          basePrice: priceNum,
          sku: v.sku || undefined,
          optionName: "Size",
        };
      });

      onChange({
        ...settings,
        priceSetMode: "store_product",
        storeSampleProductId: productItem.id,
        storeSampleProductTitle: productItem.title,
        variants: extractedVariants,
      });

      setIsStoreSearchOpen(false);
      notifyUser({
        title: "📦 Đã nạp bộ giá từ Store!",
        message: `Đã sao chép ${extractedVariants.length} biến thể từ sản phẩm "${productItem.title}".`,
        type: "success",
        sound: "chime",
      });
    } catch (err) {
      setStoreProductLoadError(err instanceof Error ? err.message : "Lỗi khi lấy thông tin biến thể");
    } finally {
      setIsLoadingProductVariants(false);
    }
  }

  function toggleCollection(colId: string): void {
    const current = new Set(activeCollectionIds);
    if (current.has(colId)) {
      current.delete(colId);
    } else {
      current.add(colId);
    }
    const nextList = Array.from(current);
    onChange({
      ...settings,
      collectionIds: nextList,
      collectionId: nextList[0] || "",
    });
  }

  function handleSelectAllCollections(): void {
    const allIds = availableCollections.map((c) => c.id);
    onChange({
      ...settings,
      collectionIds: allIds,
      collectionId: allIds[0] || "",
    });
  }

  function handleClearCollections(): void {
    onChange({
      ...settings,
      collectionIds: [],
      collectionId: "",
    });
  }

  const currentStoreProductTypes = useMemo(() => {
    if (customStoreProductTypes[currentStoreId] && customStoreProductTypes[currentStoreId].length > 0) {
      return customStoreProductTypes[currentStoreId];
    }
    const matchedStore = availableStores.find((s) => s.storeId.toLowerCase() === currentStoreId);
    if (matchedStore?.productTypes && matchedStore.productTypes.length > 0) {
      return matchedStore.productTypes;
    }
    if (DEFAULT_STORE_PRODUCT_TYPES[currentStoreId]?.productTypes) {
      return DEFAULT_STORE_PRODUCT_TYPES[currentStoreId].productTypes;
    }
    return ["Rug", "Doormat", "Blanket", "Quilt", "Tote Bag"];
  }, [availableStores, customStoreProductTypes, currentStoreId]);

  const storeFilteredProductTypes = useMemo(() => {
    return currentStoreProductTypes.map((typeName) => {
      const matched = COMMON_PRODUCT_TYPES.find(
        (c) => c.value.toLowerCase() === typeName.toLowerCase(),
      );
      return {
        value: typeName,
        label: matched ? matched.label : typeName,
      };
    });
  }, [currentStoreProductTypes]);

  function handleAddProductType(newType: string): void {
    const trimmed = newType.trim();
    if (!trimmed) return;
    const existing = currentStoreProductTypes;
    if (existing.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      updateSetting("productType", trimmed);
      setIsAddingNewType(false);
      setNewProductTypeInput("");
      return;
    }
    const updated = [...existing, trimmed];
    const newCustomMap = { ...customStoreProductTypes, [currentStoreId]: updated };
    setCustomStoreProductTypes(newCustomMap);
    try {
      localStorage.setItem("ffp_store_product_types", JSON.stringify(newCustomMap));
    } catch {}
    updateSetting("productType", trimmed);
    setIsAddingNewType(false);
    setNewProductTypeInput("");
  }

  function handleRemoveProductType(typeToRemove: string): void {
    const existing = currentStoreProductTypes;
    const updated = existing.filter((t) => t.toLowerCase() !== typeToRemove.toLowerCase());
    const newCustomMap = { ...customStoreProductTypes, [currentStoreId]: updated };
    setCustomStoreProductTypes(newCustomMap);
    try {
      localStorage.setItem("ffp_store_product_types", JSON.stringify(newCustomMap));
    } catch {}
    if (settings.productType?.toLowerCase() === typeToRemove.toLowerCase()) {
      updateSetting("productType", updated[0] || "Rug");
    }
  }

  async function refreshImageProfiles(selectedSlug?: string): Promise<void> {
    try {
      const res = await fetch("/api/v1/image-profiles");
      const data = await res.json();
      if (data && Array.isArray(data.profiles)) {
        const profiles = data.profiles as ImageProcessingProfile[];
        setImageProfiles(profiles);
        const selected =
          profiles.find((p) => p.slug === (selectedSlug ?? settings.imageProfileSlug)) ??
          profiles[0] ??
          null;
        setEditingImageProfile(selected);
        if (selected) updateSetting("imageProfileSlug", selected.slug);
      }
    } catch {
      // ignore
    }
  }

  async function handleSaveImageProfile(): Promise<void> {
    if (!editingImageProfile) return;
    try {
      const res = await fetch(`/api/v1/image-profiles/${encodeURIComponent(editingImageProfile.slug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingImageProfile),
      });
      const saved = await res.json();
      await refreshImageProfiles(saved.slug);
      setImageProfileMessage(`Đã lưu image profile ${saved.name || editingImageProfile.name}.`);
    } catch (caught: unknown) {
      setImageProfileMessage(caught instanceof Error ? caught.message : "Không lưu được image profile.");
    }
  }

  async function handleCreateImageProfile(): Promise<void> {
    const template = imageProfiles.find((p) => p.slug === settings.imageProfileSlug) ?? imageProfiles[0];
    const slug = `image-profile-${Date.now()}`;
    if (template) {
      setEditingImageProfile({ ...template, slug, name: "New image profile", revision: "new", hasLogo: false });
    } else {
      setEditingImageProfile({
        slug,
        name: "New image profile",
        enabled: true,
        revision: "new",
        hasLogo: false,
        randomPixels: 100,
        pixelDelta: 3,
        jpegQuality: 92,
        output: { width: 1500, height: 1500, fit: "contain", upscale: true, background: "#ffffff" },
        logo: {
          enabled: false,
          width: 50,
          height: 50,
          maxPercent: 15,
          padding: 10,
          position: "bottom-right",
        },
      });
    }
    setIsImageProfileEditorOpen(true);
  }

  async function handleDeleteImageProfile(): Promise<void> {
    if (!editingImageProfile || editingImageProfile.slug === "default") return;
    try {
      await fetch(`/api/v1/image-profiles/${encodeURIComponent(editingImageProfile.slug)}`, {
        method: "DELETE",
      });
      await refreshImageProfiles("default");
      setImageProfileMessage("Đã xóa image profile.");
    } catch (caught: unknown) {
      setImageProfileMessage(caught instanceof Error ? caught.message : "Không xóa được image profile.");
    }
  }

  async function handleImageProfileLogo(file: File | undefined): Promise<void> {
    if (!file || !editingImageProfile) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
      reader.addEventListener("error", () => reject(reader.error ?? new Error("Không đọc được logo.")), {
        once: true,
      });
      reader.readAsDataURL(file);
    });

    try {
      const isUnsaved = !imageProfiles.some((p) => p.slug === editingImageProfile.slug);
      if (isUnsaved) {
        await fetch(`/api/v1/image-profiles/${encodeURIComponent(editingImageProfile.slug)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editingImageProfile),
        });
      }
      const res = await fetch(`/api/v1/image-profiles/${encodeURIComponent(editingImageProfile.slug)}/logo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      const saved = await res.json();
      await refreshImageProfiles(saved.slug);
      setImageProfileMessage("Đã tải logo lên profile.");
    } catch (caught: unknown) {
      setImageProfileMessage(caught instanceof Error ? caught.message : "Không tải được logo.");
    }
  }

  async function handleImageProfilePreview(file: File | undefined): Promise<void> {
    if (!file || !editingImageProfile) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
      reader.addEventListener("error", () => reject(reader.error ?? new Error("Không đọc được ảnh preview.")), {
        once: true,
      });
      reader.readAsDataURL(file);
    });

    try {
      const res = await fetch(`/api/v1/image-profiles/${encodeURIComponent(editingImageProfile.slug)}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile: editingImageProfile, dataUrl }),
      });
      const payload = await res.json();
      if (payload && typeof payload.dataUrl === "string") {
        setImageProfilePreview(payload.dataUrl);
        setImageProfileMessage("Preview dùng chính cấu hình hiện tại, chưa cần bấm lưu.");
      }
    } catch (caught: unknown) {
      setImageProfileMessage(caught instanceof Error ? caught.message : "Không tạo được preview.");
    }
  }

  return (
    <section className="rounded-2xl border border-slate-700/80 bg-slate-950/70 p-5 sm:p-6 shadow-xl space-y-5">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-100 tracking-tight flex items-center gap-2">
            <span>⚙️ Cấu hình Shopify &amp; Định giá</span>
          </h2>
          <button
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900/90 px-2 py-0.5 text-[11px] font-medium text-slate-400 transition-colors hover:border-slate-500 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            disabled={disabled}
            title="Đặt lại cấu hình về mặc định"
            type="button"
            onClick={() => {
              if (onReset) {
                onReset();
              } else {
                onChange(DEFAULT_PINTEREST_POD_SHOPIFY_SETTINGS);
              }
            }}
          >
            <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Reset</span>
          </button>
        </div>
        {settings.storeId && (
          <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
            <span>{settings.storeId}</span>
            {settings.productType && <span>• {settings.productType}</span>}
            {selectedCollections.length > 0 && <span>• {selectedCollections.length} collections</span>}
          </div>
        )}
      </div>

      {/* Row 1: Store, Collection & Product Type */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* 1. Store selector */}
        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-slate-200">Shopify Store</label>
              <span className="text-[11px] font-mono text-slate-400" title="Shopify Vendor">
                ({computedVendor})
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsEditStoreOpen(true)}
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/80 px-2 py-1 text-xs font-medium text-slate-300 shadow-xs transition-all hover:border-slate-600 hover:bg-slate-700 hover:text-white cursor-pointer"
                title={`Chỉnh sửa cấu hình App hoặc Proxy của store ${activeStoreId}`}
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Sửa</span>
              </button>
              <button
                type="button"
                onClick={() => setIsDeleteStoreOpen(true)}
                className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-1 text-xs font-medium text-rose-300 shadow-xs transition-all hover:border-rose-500/50 hover:bg-rose-500/20 hover:text-rose-200 cursor-pointer"
                title={`Xóa store ${activeStoreId} khỏi danh sách`}
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>Xóa</span>
              </button>
              <button
                type="button"
                onClick={() => setIsAddStoreOpen(true)}
                className="inline-flex items-center gap-1 rounded-md border border-cyan-500/50 bg-cyan-500/10 px-2 py-1 text-xs font-semibold text-cyan-300 shadow-xs transition-all hover:border-cyan-400 hover:bg-cyan-500/20 hover:text-white cursor-pointer"
                title="Thêm và kết nối Shopify Store mới"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path d="M12 4v16m8-8H4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Thêm</span>
              </button>
            </div>
          </div>
          <select
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-slate-500 text-sm cursor-pointer"
            value={settings.storeId || "chillgen"}
            onChange={(e) => handleStoreChange(e.target.value)}
          >
            {availableStores.map((s) => (
              <option key={s.storeId} value={s.storeId}>
                {s.storeId} ({s.shopDomain})
              </option>
            ))}
          </select>
        </div>

        {/* 2. Collection multi-selector */}
        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-200 flex items-center gap-1.5">
              <span>Collections</span>
              {selectedCollections.length > 0 && (
                <span className="text-xs text-slate-300 font-mono">({selectedCollections.length})</span>
              )}
              {isLoadingCollections && (
                <span className="text-[11px] text-slate-400 animate-pulse font-normal">Đang tải...</span>
              )}
            </label>
            <div className="flex items-center gap-2 text-xs">
              {selectedCollections.length > 0 ? (
                <button
                  type="button"
                  onClick={handleClearCollections}
                  className="text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                >
                  Bỏ chọn hết
                </button>
              ) : (
                availableCollections.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSelectAllCollections}
                    className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                  >
                    Chọn tất cả
                  </button>
                )
              )}
            </div>
          </div>

          {/* Selected Pills */}
          {selectedCollections.length > 0 && (
            <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto pr-1">
              {selectedCollections.map((col) => (
                <span
                  key={col.id}
                  className="inline-flex items-center gap-1 rounded bg-slate-800 border border-slate-700 px-2 py-0.5 text-xs text-slate-200"
                >
                  <span className="truncate max-w-[130px]">{col.title}</span>
                  <button
                    type="button"
                    onClick={() => toggleCollection(col.id)}
                    className="text-slate-400 hover:text-rose-400 ml-0.5 text-xs cursor-pointer"
                    title="Bỏ chọn"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Add Collection dropdown */}
          <div className="grid grid-cols-[1fr_auto] gap-1.5">
            <select
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-100 outline-none focus:border-slate-500 disabled:opacity-50 text-sm cursor-pointer"
              disabled={isLoadingCollections || availableCollections.length === 0}
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  toggleCollection(e.target.value);
                }
              }}
            >
              <option value="">+ Thêm / Bỏ Collection...</option>
              {availableCollections.map((c) => {
                const isSelected = activeCollectionIds.includes(c.id);
                return (
                  <option key={c.id} value={c.id}>
                    {isSelected ? "✓ " : "+ "}
                    {c.title} ({c.productsCount ?? 0})
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              onClick={() => setIsCollectionListOpen(!isCollectionListOpen)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                isCollectionListOpen
                  ? "border-slate-600 bg-slate-700 text-white"
                  : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
              title="Bật/tắt danh sách checklist"
            >
              {isCollectionListOpen ? "Thu gọn" : "Chi tiết ▾"}
            </button>
          </div>

          {/* Expandable Checklist */}
          {isCollectionListOpen && availableCollections.length > 0 && (
            <div className="max-h-36 overflow-y-auto space-y-1 rounded-lg border border-slate-800 bg-slate-950/80 p-2 text-xs">
              {availableCollections.map((c) => {
                const isChecked = activeCollectionIds.includes(c.id);
                return (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 text-slate-300 hover:text-slate-100 cursor-pointer py-0.5 select-none"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleCollection(c.id)}
                      className="rounded border-slate-700 text-slate-400 focus:ring-0 cursor-pointer"
                    />
                    <span className={`truncate flex-1 ${isChecked ? "text-white font-medium" : ""}`}>
                      {c.title}
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">{c.productsCount ?? 0}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* 3. Product Type selector */}
        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5 sm:col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-200">Loại sản phẩm</label>
            {settings.productType ? (
              <button
                type="button"
                onClick={() => handleProductTypeChange("Rug")}
                className="text-xs text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
              >
                Mặc định Rug
              </button>
            ) : (
              <span className="text-xs text-slate-500">Mặc định</span>
            )}
          </div>

          {/* Store-Scoped Quick Pills & Inline Add */}
          <div className="flex flex-wrap items-center gap-1.5">
            {currentStoreProductTypes.map((pill) => {
              const isActive = settings.productType?.toLowerCase() === pill.toLowerCase();
              return (
                <div key={pill} className="group relative inline-flex items-center">
                  <button
                    type="button"
                    className={`rounded px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer ${
                      isActive
                        ? "bg-slate-100 text-slate-950 font-semibold shadow-xs"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100"
                    }`}
                    onClick={() => handleProductTypeChange(isActive ? "" : pill)}
                  >
                    {pill}
                  </button>
                  {currentStoreProductTypes.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveProductType(pill);
                      }}
                      className="hidden group-hover:inline-flex ml-0.5 text-[10px] text-slate-500 hover:text-rose-400 px-0.5 cursor-pointer"
                      title={`Bỏ loại '${pill}' khỏi store ${currentStoreId}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}

            {/* Inline Add Button or Input */}
            {isAddingNewType ? (
              <div className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-xs border border-slate-600 shadow-xs">
                <input
                  type="text"
                  autoFocus
                  placeholder="Loại mới..."
                  value={newProductTypeInput}
                  onChange={(e) => setNewProductTypeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddProductType(newProductTypeInput);
                    } else if (e.key === "Escape") {
                      setIsAddingNewType(false);
                      setNewProductTypeInput("");
                    }
                  }}
                  className="w-20 bg-transparent text-xs text-slate-100 outline-none placeholder:text-slate-500"
                />
                <button
                  type="button"
                  onClick={() => handleAddProductType(newProductTypeInput)}
                  className="text-xs text-slate-300 font-bold hover:text-white cursor-pointer"
                >
                  ✓
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingNewType(false);
                    setNewProductTypeInput("");
                  }}
                  className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsAddingNewType(true)}
                className="rounded border border-dashed border-slate-700 bg-slate-900/60 px-2 py-0.5 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-200 transition-colors cursor-pointer"
                title={`Thêm loại sản phẩm mới cho store ${currentStoreId}`}
              >
                + Thêm
              </button>
            )}
          </div>

          {/* Dropdown & Direct Text Input Combo */}
          <div className="grid grid-cols-[1fr_auto] gap-1.5">
            <input
              type="text"
              placeholder="Hoặc nhập loại khác..."
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-100 outline-none focus:border-slate-500 text-sm placeholder:text-slate-500"
              value={settings.productType || ""}
              onChange={(e) => handleProductTypeChange(e.target.value)}
            />
            <select
              className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-slate-200 outline-none focus:border-slate-500 text-xs cursor-pointer"
              value={settings.productType || ""}
              onChange={(e) => {
                if (e.target.value) {
                  handleProductTypeChange(e.target.value);
                }
              }}
            >
              <option value="">{`-- Chọn loại SP (${currentStoreId.toUpperCase()}) --`}</option>
              {Boolean(settings.productType) &&
                !storeFilteredProductTypes.some(
                  (t) => t.value.toLowerCase() === (settings.productType || "").toLowerCase(),
                ) && (
                  <option value={settings.productType}>
                    {settings.productType} (Tùy chỉnh)
                  </option>
                )}
              {storeFilteredProductTypes.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Row 2: Price Addition & Compare-At Discount */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Price Addition */}
        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-200">Giá cộng thêm ($)</label>
            <div className="flex flex-wrap gap-1">
              {[
                { label: "+$0", value: 0 },
                { label: "+$5.99", value: 5.99 },
                { label: "+$6.95", value: 6.95 },
                { label: "+$9.99", value: 9.99 },
                { label: "+$14.99", value: 14.99 },
              ].map((btn) => (
                <button
                  key={btn.label}
                  type="button"
                  className={`rounded px-2 py-0.5 text-xs font-semibold transition-colors cursor-pointer ${
                    settings.priceAddition === btn.value
                      ? "bg-slate-100 text-slate-950 shadow-xs"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                  onClick={() => updateSetting("priceAddition", btn.value)}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
          <div className="relative">
            <span className="absolute left-3 top-2 text-sm text-slate-500 pointer-events-none font-mono">$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 pl-7 pr-3 py-2 text-slate-100 outline-none focus:border-slate-500 font-mono text-sm"
              value={settings.priceAddition ?? 0}
              onChange={(e) => {
                const val = Math.max(0, Number(e.target.value) || 0);
                updateSetting("priceAddition", val);
              }}
            />
          </div>
        </div>

        {/* Compare-At Discount % */}
        <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-slate-200">Giá gạch ngang (Compare-At)</label>
            <span className="text-xs font-mono text-slate-300 font-semibold">{settings.discountPercent ?? 0}%</span>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <select
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-slate-500 text-sm cursor-pointer"
              value={
                [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95].includes(
                  settings.discountPercent ?? 0,
                )
                  ? settings.discountPercent ?? 0
                  : "custom"
              }
              onChange={(e) => {
                if (e.target.value !== "custom") {
                  updateSetting("discountPercent", Number(e.target.value));
                }
              }}
            >
              <option value={0}>0% (Không hiển thị giá giảm)</option>
              {Array.from({ length: 19 }, (_, i) => (i + 1) * 5).map((pct) => (
                <option key={pct} value={pct}>
                  Giảm {pct}%
                </option>
              ))}
              {![0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95].includes(
                settings.discountPercent ?? 0,
              ) && <option value="custom">Tự nhập: {settings.discountPercent}%</option>}
            </select>
            <div className="relative">
              <input
                type="number"
                step="1"
                min="0"
                max="95"
                placeholder="%"
                className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 pr-6 text-slate-100 outline-none focus:border-slate-500 font-mono text-sm text-right"
                value={settings.discountPercent ?? 0}
                onChange={(e) => {
                  const val = Math.min(95, Math.max(0, Number(e.target.value) || 0));
                  updateSetting("discountPercent", val);
                }}
              />
              <span className="absolute right-2 top-2 text-xs text-slate-500 pointer-events-none">%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Live Calculation Preview Box */}
      {(() => {
        const sampleBase = 20.0;
        const addition = settings.priceAddition ?? 0;
        const discount = settings.discountPercent ?? 0;
        const selling = sampleBase + addition;
        const compareAt = discount > 0 && discount < 100 ? selling / (1 - discount / 100) : undefined;

        return (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4 py-2.5 text-xs text-slate-400">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-slate-300">Ví dụ gốc $20.00:</span>
              <span className="text-slate-200 font-mono">
                Bán <strong className="text-white">${selling.toFixed(2)}</strong>
              </span>
              {compareAt !== undefined && (
                <span className="text-slate-400 font-mono">
                  Gạch ngang: <span className="line-through">${compareAt.toFixed(2)}</span>
                  <span className="ml-1 text-slate-300 font-semibold">(-{discount}%)</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px] text-slate-500">
              <span>{settings.storeId || "chillgen"}</span>
              {settings.productType && <span>• {settings.productType}</span>}
            </div>
          </div>
        );
      })()}

      {/* Row 3: Bộ giá & Biến thể sản phẩm (Price Set & Variant Matrix) */}
      <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        {/* Header with Title and Mode Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base">🏷️</span>
              <h3 className="text-sm font-semibold text-slate-100">
                Bộ giá &amp; Biến thể sản phẩm (Variant &amp; Price Matrix)
              </h3>
              <span className="rounded-full bg-cyan-950 px-2 py-0.5 text-[10px] font-mono font-medium text-cyan-300 border border-cyan-800/50">
                {activeVariants.length} kích thước
              </span>
              <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[10px] font-bold text-cyan-200 border border-slate-700">
                Store: {activeStoreId.toUpperCase()}
              </span>
              {currentPriceMode === "custom" && (
                <span className="rounded-full bg-amber-950 px-2 py-0.5 text-[10px] font-semibold text-amber-300 border border-amber-800/50">
                  ✍️ Tự set giá
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Bộ giá và biến thể được <strong>phân lập riêng theo từng store</strong> (đang áp dụng cho <strong className="text-cyan-300">{activeStoreId.toUpperCase()}</strong>). Khi chuyển store, cấu hình sẽ tự động chuyển đổi tương ứng để tránh nhầm lẫn.
            </p>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-slate-950/80 border border-slate-800">
            {/* Tab 1: Preset */}
            <button
              type="button"
              onClick={() => handleSwitchMode("preset")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                currentPriceMode === "preset"
                  ? "bg-cyan-500 text-slate-950 shadow-xs"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <span>📋 Bộ giá mẫu</span>
            </button>

            {/* Tab 2: Store Product */}
            <button
              type="button"
              onClick={() => handleSwitchMode("store_product")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                currentPriceMode === "store_product"
                  ? "bg-cyan-500 text-slate-950 shadow-xs"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
              }`}
            >
              <span>🏪 Sao chép Store</span>
            </button>

            {/* Tab 3: Custom / Tự set giá */}
            <button
              type="button"
              onClick={() => handleSwitchMode("custom")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                currentPriceMode === "custom"
                  ? "bg-gradient-to-r from-amber-400 to-amber-500 text-slate-950 shadow-xs"
                  : "text-amber-400 hover:text-amber-300 hover:bg-amber-950/40"
              }`}
            >
              <span>✍️ Tự set giá thủ công</span>
            </button>
          </div>
        </div>

        {/* Sub-bar for PRESET mode */}
        {currentPriceMode === "preset" && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/50 p-2.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-medium">Bộ giá ({activeStoreId.toUpperCase()}):</span>
              <select
                className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-cyan-500 cursor-pointer"
                value={settings.priceSetPresetId || storeFilteredPresets[0]?.id}
                onChange={(e) => handleApplyPreset(e.target.value)}
              >
                {storeCustomSavedPreset && (
                  <optgroup label={`Bộ giá đã lưu của store ${activeStoreId.toUpperCase()}`}>
                    <option value="custom_store_preset">
                      ★ Bộ giá riêng đã lưu của {activeStoreId.toUpperCase()} ({storeCustomSavedPreset.length} kích thước)
                    </option>
                  </optgroup>
                )}
                <optgroup label={`Bộ giá mẫu cho store ${activeStoreId.toUpperCase()}`}>
                  {storeFilteredPresets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSaveCurrentAsStorePreset}
                className="inline-flex items-center gap-1 rounded-lg border border-cyan-700/60 bg-cyan-950/50 px-2.5 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-900/60 hover:text-white transition cursor-pointer"
                title={`Lưu cấu hình biến thể hiện tại thành bộ giá riêng cho store ${activeStoreId.toUpperCase()}`}
              >
                <span>💾 Lưu thành mẫu của {activeStoreId.toUpperCase()}</span>
              </button>
              <button
                type="button"
                onClick={handleResetToProductTypePreset}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 hover:text-white transition cursor-pointer"
                title="Khôi phục bộ giá mặc định cho loại sản phẩm hiện tại"
              >
                <span>↺ Đặt lại theo loại SP</span>
              </button>
            </div>
          </div>
        )}

        {/* Sub-bar for STORE PRODUCT mode */}
        {currentPriceMode === "store_product" && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-800/60 bg-cyan-950/30 p-2.5 text-xs text-cyan-200">
            <div className="flex items-center gap-2">
              <span className="text-base">🏪</span>
              {settings.storeSampleProductTitle ? (
                <span>
                  Đang dùng bộ giá sao chép từ SP Store: <strong className="text-white">{settings.storeSampleProductTitle}</strong>
                </span>
              ) : (
                <span>Chưa chọn sản phẩm mẫu nào trên store {activeStoreId}.</span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsStoreSearchOpen(true);
                  void loadStoreProducts();
                }}
                className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 transition cursor-pointer shadow-xs"
              >
                🔍 Chọn SP khác từ store...
              </button>
              <button
                type="button"
                onClick={handleResetToProductTypePreset}
                className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer"
              >
                Về mẫu chuẩn
              </button>
            </div>
          </div>
        )}

        {/* Sub-bar for CUSTOM (TỰ SET GIÁ THỦ CÔNG) mode */}
        {currentPriceMode === "custom" && (
          <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-950/20 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-500/20 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="text-base">✍️</span>
                <div>
                  <span className="font-bold text-amber-300 text-xs">Chế độ: Tự set giá thủ công</span>
                  <p className="text-[11px] text-amber-200/80">
                    Bảng giá của bạn được bảo lưu độc lập, không bị tự động reset khi chọn loại sản phẩm khác.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {settings.priceAddition !== 0 && (
                  <button
                    type="button"
                    onClick={handleSetDirectPricingZeroMarkup}
                    className="rounded-lg border border-amber-500/50 bg-amber-900/40 px-2.5 py-1 text-[11px] font-medium text-amber-200 hover:bg-amber-800/60 hover:text-white transition cursor-pointer"
                    title="Đặt Giá cộng thêm = $0 để giá nhập trong bảng chính là giá bán trên Shopify"
                  >
                    🎯 Đặt Giá cộng thêm = $0 (Giá bán trực tiếp)
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleResetToBlankMatrix}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                  title="Xóa trắng bảng giá để tự thêm kích thước từ đầu"
                >
                  + Tạo bảng giá mới từ đầu
                </button>
                <button
                  type="button"
                  onClick={handleResetToProductTypePreset}
                  className="text-[11px] text-slate-400 hover:text-amber-200 underline cursor-pointer"
                  title="Khôi phục về bộ giá mẫu ban đầu"
                >
                  ↺ Về mẫu chuẩn
                </button>
              </div>
            </div>

            {/* Quick Pricing Tools */}
            <div className="grid gap-3 sm:grid-cols-2">
              {/* Tool 1: Single Price */}
              <div className="flex flex-col gap-2 rounded-lg border border-amber-500/20 bg-slate-950/60 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">1. Đặt 1 mức giá duy nhất (1 Size):</span>
                  <div className="flex gap-1">
                    {[19.99, 24.99, 29.99, 39.99, 49.99].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setQuickSinglePrice(p)}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-mono transition cursor-pointer ${
                          quickSinglePrice === p
                            ? "bg-amber-400 text-slate-950 font-bold"
                            : "bg-slate-800 text-slate-400 hover:text-white"
                        }`}
                      >
                        ${p}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1.5 text-slate-500 pointer-events-none font-mono">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={quickSinglePrice}
                      onChange={(e) => setQuickSinglePrice(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full rounded border border-slate-700 bg-slate-900 pl-6 pr-2 py-1.5 text-xs text-white font-mono outline-none focus:border-amber-400"
                      placeholder="29.99"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleApplySinglePrice(quickSinglePrice)}
                    className="rounded bg-gradient-to-r from-amber-400 to-amber-500 px-3 py-1.5 font-bold text-slate-950 hover:from-amber-300 hover:to-amber-400 transition cursor-pointer shrink-0 shadow-xs"
                  >
                    ⚡ Áp dụng làm 1 giá duy nhất
                  </button>
                </div>
              </div>

              {/* Tool 2: Bulk Uniform Price */}
              <div className="flex flex-col gap-2 rounded-lg border border-amber-500/20 bg-slate-950/60 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200">2. Đặt đồng giá cho mọi kích thước:</span>
                  <div className="flex gap-1">
                    {[29.99, 39.99, 49.99, 69.99, 99.99].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setQuickBulkPrice(p)}
                        className={`rounded px-1.5 py-0.5 text-[10px] font-mono transition cursor-pointer ${
                          quickBulkPrice === p
                            ? "bg-amber-400 text-slate-950 font-bold"
                            : "bg-slate-800 text-slate-400 hover:text-white"
                        }`}
                      >
                        ${p}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-2.5 top-1.5 text-slate-500 pointer-events-none font-mono">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={quickBulkPrice}
                      onChange={(e) => setQuickBulkPrice(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full rounded border border-slate-700 bg-slate-900 pl-6 pr-2 py-1.5 text-xs text-white font-mono outline-none focus:border-amber-400"
                      placeholder="29.99"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleApplyBulkPrice(quickBulkPrice)}
                    className="rounded bg-slate-800 border border-amber-500/40 px-3 py-1.5 font-semibold text-amber-300 hover:bg-amber-950/60 hover:text-white transition cursor-pointer shrink-0 shadow-xs"
                  >
                    ⚡ Áp dụng đồng giá {activeVariants.length} kích thước
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Interactive Variant Table */}
        <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="py-2.5 px-3 w-10 text-center">#</th>
                <th className="py-2.5 px-3">Kích thước / Biến thể (Option)</th>
                <th className="py-2.5 px-3 w-32">Giá gốc ($)</th>
                <th className="py-2.5 px-3 w-36">Giá bán cuối ($)</th>
                <th className="py-2.5 px-3 w-32">Giá gạch ngang ($)</th>
                <th className="py-2.5 px-3 w-16 text-center">Xóa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {activeVariants.map((variant, idx) => {
                const base = Number(variant.basePrice) || 0;
                const addition = settings.priceAddition ?? 0;
                const discount = settings.discountPercent ?? 0;
                const selling = base + addition;
                const compareAt = discount > 0 && discount < 100 ? selling / (1 - discount / 100) : undefined;

                return (
                  <tr key={variant.id || `${variant.label}-${idx}`} className="hover:bg-slate-900/40 transition">
                    <td className="py-2 px-3 text-center text-slate-500 font-mono text-[11px]">
                      {idx + 1}
                    </td>
                    <td className="py-2 px-3">
                      <input
                        type="text"
                        value={variant.label}
                        onChange={(e) => handleUpdateVariant(idx, { label: e.target.value })}
                        className="w-full rounded border border-slate-700/80 bg-slate-900 px-2.5 py-1 text-xs text-slate-100 outline-none focus:border-cyan-500"
                        placeholder="VD: 36x60 inch..."
                      />
                    </td>
                    <td className="py-2 px-3">
                      <div className="relative">
                        <span className="absolute left-2.5 top-1.5 text-slate-500 pointer-events-none font-mono text-xs">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={variant.basePrice}
                          onChange={(e) =>
                            handleUpdateVariant(idx, {
                              basePrice: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="w-full rounded border border-slate-700/80 bg-slate-900 pl-6 pr-2 py-1 text-xs text-slate-100 font-mono outline-none focus:border-cyan-500"
                          title="Giá gốc cơ sở"
                        />
                      </div>
                    </td>
                    <td className="py-2 px-3">
                      <div className="relative">
                        <span className="absolute left-2.5 top-1.5 text-slate-500 pointer-events-none font-mono text-xs">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={selling.toFixed(2)}
                          onChange={(e) => {
                            const nextSelling = Math.max(0, Number(e.target.value) || 0);
                            const nextBase = Math.max(0, nextSelling - (settings.priceAddition ?? 0));
                            handleUpdateVariant(idx, { basePrice: Number(nextBase.toFixed(2)) });
                          }}
                          className="w-full rounded border border-slate-700/80 bg-slate-900 pl-6 pr-2 py-1 text-xs text-white font-mono font-semibold outline-none focus:border-amber-400"
                          title="Giá bán cuối trên Shopify (Gõ trực tiếp vào đây để tự set giá bán)"
                        />
                      </div>
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-400">
                      {compareAt !== undefined ? (
                        <span className="line-through">${compareAt.toFixed(2)}</span>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveVariant(idx)}
                        disabled={activeVariants.length <= 1}
                        className="rounded p-1 text-slate-500 hover:text-rose-400 hover:bg-rose-950/30 transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                        title="Xóa biến thể này"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Add Row or Quick Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {isAddingVariant ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-700 bg-slate-950/80 p-2 text-xs w-full sm:w-auto">
              <span className="text-slate-400 font-medium">Biến thể mới:</span>
              <input
                type="text"
                autoFocus
                placeholder="Tên kích thước (VD: 72x96)..."
                value={newVariantLabel}
                onChange={(e) => setNewVariantLabel(e.target.value)}
                className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 outline-none placeholder:text-slate-500 focus:border-cyan-500 w-44"
              />
              <div className="relative">
                <span className="absolute left-2 top-1 text-slate-500 pointer-events-none font-mono text-xs">$</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Giá gốc"
                  value={newVariantPrice}
                  onChange={(e) => setNewVariantPrice(Math.max(0, Number(e.target.value) || 0))}
                  className="w-24 rounded border border-slate-700 bg-slate-900 pl-5 pr-2 py-1 text-xs text-slate-100 font-mono outline-none focus:border-cyan-500"
                />
              </div>
              <button
                type="button"
                onClick={handleAddVariant}
                className="rounded bg-cyan-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-cyan-400 transition cursor-pointer"
              >
                ✓ Thêm
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAddingVariant(false);
                  setNewVariantLabel("");
                }}
                className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 transition cursor-pointer"
              >
                ✕ Hủy
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setIsAddingVariant(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-700 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 hover:border-slate-500 hover:text-white transition cursor-pointer"
            >
              <span>+ Thêm kích thước / biến thể</span>
            </button>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSaveCurrentAsStorePreset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-950/40 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-900/50 hover:text-white transition cursor-pointer shadow-xs"
              title={`Lưu cấu hình kích thước và giá hiện tại thành mẫu riêng cho store ${activeStoreId.toUpperCase()}`}
            >
              <span>💾 Lưu bộ giá riêng cho store {activeStoreId.toUpperCase()}</span>
            </button>

            <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
              <span>
                Dải giá bán:{" "}
                <strong className="text-slate-200">
                  ${Math.min(...activeVariants.map((v) => (Number(v.basePrice) || 0) + (settings.priceAddition ?? 0))).toFixed(2)} - $
                  {Math.max(...activeVariants.map((v) => (Number(v.basePrice) || 0) + (settings.priceAddition ?? 0))).toFixed(2)}
                </strong>
              </span>
            </div>
          </div>
        </div>

        {/* Modal / Flyout for Store Product Search */}
        {isStoreSearchOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
            <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🔍</span>
                  <div>
                    <h3 className="font-semibold text-slate-100 text-sm">
                      Chọn sản phẩm mẫu trên store &ldquo;{activeStoreId}&rdquo;
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Hệ thống sẽ đọc toàn bộ kích thước và giá gốc của sản phẩm này để áp dụng cho thiết kế POD
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsStoreSearchOpen(false)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Search bar */}
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Nhập tên sản phẩm để tìm kiếm..."
                  value={storeSearchQuery}
                  onChange={(e) => {
                    setStoreSearchQuery(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void loadStoreProducts(storeSearchQuery);
                    }
                  }}
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 outline-none focus:border-cyan-500"
                />
                <button
                  type="button"
                  onClick={() => void loadStoreProducts(storeSearchQuery)}
                  disabled={isLoadingStoreProducts}
                  className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-semibold text-white hover:bg-cyan-500 transition disabled:opacity-50 cursor-pointer"
                >
                  {isLoadingStoreProducts ? "Đang tìm..." : "Tìm"}
                </button>
              </div>

              {storeProductLoadError && (
                <div className="rounded-lg border border-rose-800 bg-rose-950/60 p-2.5 text-xs text-rose-300">
                  ⚠️ {storeProductLoadError}
                </div>
              )}

              {/* Product list */}
              <div className="max-h-72 overflow-y-auto space-y-1.5 pr-1 divide-y divide-slate-800/60">
                {isLoadingStoreProducts ? (
                  <div className="py-8 text-center text-xs text-slate-400 animate-pulse">
                    Đang tải danh sách sản phẩm từ Shopify store {activeStoreId}...
                  </div>
                ) : storeProducts.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500">
                    Không tìm thấy sản phẩm nào trên store {activeStoreId}. Hãy thử tìm từ khóa khác.
                  </div>
                ) : (
                  storeProducts.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between gap-3 pt-2 pb-1 hover:bg-slate-800/40 px-2 rounded-lg transition"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-slate-200 truncate">
                          {p.title}
                        </p>
                        <p className="text-[11px] text-slate-500 font-mono truncate">
                          {p.productType ? `${p.productType} • ` : ""}{p.handle}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={isLoadingProductVariants}
                        onClick={() => void handleSelectStoreProduct(p)}
                        className="rounded-md bg-slate-800 border border-slate-700 px-2.5 py-1 text-xs font-medium text-cyan-300 hover:bg-cyan-600 hover:text-white transition cursor-pointer shrink-0 disabled:opacity-50"
                      >
                        {isLoadingProductVariants ? "Đang nạp..." : "Lấy bộ giá →"}
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="flex justify-end border-t border-slate-800 pt-3">
                <button
                  type="button"
                  onClick={() => setIsStoreSearchOpen(false)}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Row 4: Profile & Image Processing */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm text-slate-300">
          Profile
          <select
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 cursor-pointer"
            value={settings.profileSlug}
            onChange={(event) => {
              const nextProfile = event.target.value === "jeminise" ? "jeminise" : "default";
              updateSetting("profileSlug", nextProfile);
              if (nextProfile === "jeminise") {
                updateSetting("applyJeminisePreset", true);
              } else {
                updateSetting("applyJeminisePreset", false);
              }
            }}
          >
            <option value="default">Default</option>
            <option value="jeminise">Jeminise</option>
          </select>
        </label>
        <label className="flex items-center gap-3 self-end rounded-lg border border-slate-700 p-2 text-sm text-slate-200 cursor-pointer">
          <input
            checked={settings.applyJeminisePreset}
            disabled={settings.profileSlug !== "jeminise"}
            type="checkbox"
            onChange={(event) => updateSetting("applyJeminisePreset", event.target.checked)}
          />
          Thay variants bằng preset Jeminise 47 variants
        </label>
        <label className="grid gap-1 text-sm text-slate-300">
          Xử lý ảnh
          <select
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 cursor-pointer"
            value={settings.imageProfileSlug}
            onChange={(event) => {
              const slug = event.target.value;
              updateSetting("imageProfileSlug", slug);
              setEditingImageProfile(imageProfiles.find((profile) => profile.slug === slug) ?? null);
            }}
          >
            {imageProfiles.map((profile) => (
              <option key={profile.slug} value={profile.slug}>
                {profile.name}
                {profile.enabled ? " · bật" : " · tắt"}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button
            className="rounded-lg border border-cyan-700 px-3 py-2 text-sm text-cyan-200 hover:bg-cyan-950/60 transition cursor-pointer"
            type="button"
            onClick={() => setIsImageProfileEditorOpen((open) => !open)}
          >
            Cấu hình ảnh
          </button>
          <button
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800 transition cursor-pointer"
            type="button"
            onClick={() => void handleCreateImageProfile()}
          >
            Tạo profile
          </button>
        </div>
      </div>

      {/* Image Profile Editor Popup */}
      {isImageProfileEditorOpen && editingImageProfile ? (
        <section className="space-y-4 rounded-xl border border-cyan-900 bg-slate-950/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-cyan-200">Image profile · {editingImageProfile.slug}</h2>
            <span className="text-xs text-slate-500">Revision {editingImageProfile.revision}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm">
              Tên
              <input
                className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100"
                value={editingImageProfile.name}
                onChange={(event) => setEditingImageProfile({ ...editingImageProfile, name: event.target.value })}
              />
            </label>
            <label className="flex items-center gap-2 self-end p-2 text-sm cursor-pointer">
              <input
                checked={editingImageProfile.enabled}
                type="checkbox"
                onChange={(event) => setEditingImageProfile({ ...editingImageProfile, enabled: event.target.checked })}
              />
              Bật xử lý ảnh
            </label>
            <label className="grid gap-2 text-sm">
              Logo PNG/JPEG/WebP
              {editingImageProfile.logoUrl ? (
                <span className="flex h-24 items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-white/90 p-2">
                  <img
                    alt={`Logo hiện tại của ${editingImageProfile.name}`}
                    className="max-h-full max-w-full object-contain"
                    src={editingImageProfile.logoUrl}
                  />
                </span>
              ) : (
                <span className="flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-700 text-xs text-slate-500">
                  Chưa có logo
                </span>
              )}
              <input
                accept="image/png,image/jpeg,image/webp"
                className="text-xs"
                type="file"
                onChange={(event) => void handleImageProfileLogo(event.target.files?.[0])}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Ảnh thử preview
              <input
                accept="image/png,image/jpeg,image/webp"
                className="text-xs"
                type="file"
                onChange={(event) => void handleImageProfilePreview(event.target.files?.[0])}
              />
            </label>
            <NumberSetting
              label="Random pixels"
              min={0}
              max={10000}
              value={editingImageProfile.randomPixels}
              onChange={(value) => setEditingImageProfile({ ...editingImageProfile, randomPixels: value })}
            />
            <NumberSetting
              label="Pixel delta"
              min={1}
              max={20}
              value={editingImageProfile.pixelDelta}
              onChange={(value) => setEditingImageProfile({ ...editingImageProfile, pixelDelta: value })}
            />
            <NumberSetting
              label="JPEG quality"
              min={70}
              max={98}
              value={editingImageProfile.jpegQuality}
              onChange={(value) => setEditingImageProfile({ ...editingImageProfile, jpegQuality: value })}
            />
            <NumberSetting
              label="Output width"
              min={100}
              max={4000}
              value={editingImageProfile.output.width}
              onChange={(value) =>
                setEditingImageProfile({
                  ...editingImageProfile,
                  output: { ...editingImageProfile.output, width: value },
                })
              }
            />
            <NumberSetting
              label="Output height"
              min={100}
              max={4000}
              value={editingImageProfile.output.height}
              onChange={(value) =>
                setEditingImageProfile({
                  ...editingImageProfile,
                  output: { ...editingImageProfile.output, height: value },
                })
              }
            />
            <label className="grid gap-1 text-sm">
              Fit
              <select
                className="rounded border border-slate-700 bg-slate-900 px-3 py-2"
                value={editingImageProfile.output.fit}
                onChange={(event) =>
                  setEditingImageProfile({
                    ...editingImageProfile,
                    output: {
                      ...editingImageProfile.output,
                      fit: event.target.value === "cover" ? "cover" : "contain",
                    },
                  })
                }
              >
                <option value="contain">Contain</option>
                <option value="cover">Cover</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              Background
              <input
                className="h-10 rounded border border-slate-700 bg-slate-900"
                type="color"
                value={editingImageProfile.output.background}
                onChange={(event) =>
                  setEditingImageProfile({
                    ...editingImageProfile,
                    output: { ...editingImageProfile.output, background: event.target.value },
                  })
                }
              />
            </label>
            <label className="flex items-center gap-2 self-end p-2 text-sm cursor-pointer">
              <input
                checked={editingImageProfile.logo.enabled}
                disabled={!editingImageProfile.hasLogo}
                type="checkbox"
                onChange={(event) =>
                  setEditingImageProfile({
                    ...editingImageProfile,
                    logo: { ...editingImageProfile.logo, enabled: event.target.checked },
                  })
                }
              />
              Bật logo {editingImageProfile.hasLogo ? "" : "(chưa có file)"}
            </label>
            <label className="grid gap-1 text-sm">
              Vị trí logo
              <select
                className="rounded border border-slate-700 bg-slate-900 px-3 py-2"
                value={editingImageProfile.logo.position}
                onChange={(event) =>
                  setEditingImageProfile({
                    ...editingImageProfile,
                    logo: {
                      ...editingImageProfile.logo,
                      position: event.target.value as "top-left" | "top-right" | "bottom-left" | "bottom-right",
                    },
                  })
                }
              >
                <option value="top-left">Top left</option>
                <option value="top-right">Top right</option>
                <option value="bottom-left">Bottom left</option>
                <option value="bottom-right">Bottom right</option>
              </select>
            </label>
            <NumberSetting
              label="Logo max %"
              min={1}
              max={100}
              value={editingImageProfile.logo.maxPercent}
              onChange={(value) =>
                setEditingImageProfile({
                  ...editingImageProfile,
                  logo: { ...editingImageProfile.logo, maxPercent: value },
                })
              }
            />
            <NumberSetting
              label="Logo padding"
              min={0}
              max={4000}
              value={editingImageProfile.logo.padding}
              onChange={(value) =>
                setEditingImageProfile({
                  ...editingImageProfile,
                  logo: { ...editingImageProfile.logo, padding: value },
                })
              }
            />
          </div>
          {imageProfilePreview ? (
            <img
              alt="Image processing preview"
              className="max-h-80 rounded-lg border border-slate-700 object-contain"
              src={imageProfilePreview}
            />
          ) : null}
          <div className="flex gap-2">
            <button
              className="rounded bg-cyan-500 px-4 py-2 font-semibold text-slate-950 hover:bg-cyan-400 transition cursor-pointer"
              type="button"
              onClick={() => void handleSaveImageProfile()}
            >
              Lưu profile
            </button>
            <button
              className="rounded border border-rose-700 px-4 py-2 text-rose-300 disabled:opacity-40 hover:bg-rose-950/40 transition cursor-pointer"
              disabled={editingImageProfile.slug === "default"}
              type="button"
              onClick={() => void handleDeleteImageProfile()}
            >
              Xóa profile
            </button>
          </div>
          {imageProfileMessage ? <p className="text-sm text-amber-200">{imageProfileMessage}</p> : null}
        </section>
      ) : null}

      {/* Add / Edit Store Modal */}
      <AddStoreModal
        isOpen={isAddStoreOpen || isEditStoreOpen}
        editStoreId={isEditStoreOpen ? activeStoreId : null}
        onClose={() => {
          setIsAddStoreOpen(false);
          setIsEditStoreOpen(false);
        }}
        onStoreAdded={(newStore: AddedStoreInfo) => {
          setIsAddStoreOpen(false);
          setAvailableStores((prev) => {
            const cleanNewId = newStore.storeId.toLowerCase();
            const filtered = prev.filter((s) => s.storeId.toLowerCase() !== cleanNewId);
            return [
              ...filtered,
              {
                storeId: newStore.storeId,
                shopDomain: newStore.shopDomain,
                productTypes: newStore.productTypes,
                defaultProductType: newStore.defaultProductType,
              },
            ];
          });
          handleStoreChange(newStore.storeId);
          if (newStore.productTypes && newStore.productTypes.length > 0) {
            const newMap = {
              ...customStoreProductTypes,
              [newStore.storeId.toLowerCase()]: [...newStore.productTypes],
            };
            setCustomStoreProductTypes(newMap);
            try {
              localStorage.setItem("ffp_store_product_types", JSON.stringify(newMap));
            } catch {}
          }
          notifyUser({
            title: "Kết nối store thành công",
            message: `Store ${newStore.storeId} (${newStore.shopDomain}) đã sẵn sàng hoạt động!`,
            type: "success",
          });
        }}
        onStoreUpdated={(updatedStore: AddedStoreInfo) => {
          setIsEditStoreOpen(false);
          setAvailableStores((prev) =>
            prev.map((s) =>
              s.storeId.toLowerCase() === updatedStore.storeId.toLowerCase()
                ? {
                    ...s,
                    shopDomain: updatedStore.shopDomain,
                    productTypes: updatedStore.productTypes || s.productTypes,
                    defaultProductType: updatedStore.defaultProductType || s.defaultProductType,
                  }
                : s,
            ),
          );
          if (updatedStore.productTypes && updatedStore.productTypes.length > 0) {
            const newMap = {
              ...customStoreProductTypes,
              [updatedStore.storeId.toLowerCase()]: [...updatedStore.productTypes],
            };
            setCustomStoreProductTypes(newMap);
            try {
              localStorage.setItem("ffp_store_product_types", JSON.stringify(newMap));
            } catch {}
          }
          notifyUser({
            title: "Cập nhật store thành công",
            message: `Store ${updatedStore.storeId} (${updatedStore.shopDomain}) đã được cập nhật cấu hình!`,
            type: "success",
          });
        }}
      />

      {/* Delete Store Modal */}
      <DeleteStoreModal
        isOpen={isDeleteStoreOpen}
        storeId={activeStoreId}
        shopDomain={activeShopDomain}
        onClose={() => setIsDeleteStoreOpen(false)}
        onStoreDeleted={(deletedId) => {
          setIsDeleteStoreOpen(false);
          setAvailableStores((prev) => {
            const remaining = prev.filter((s) => s.storeId.toLowerCase() !== deletedId.toLowerCase());
            if ((settings.storeId || "").toLowerCase() === deletedId.toLowerCase()) {
              const fallback = remaining[0]?.storeId || "chillgen";
              handleStoreChange(fallback);
            }
            return remaining;
          });
          notifyUser({
            title: "Đã xóa store",
            message: `Store ${deletedId} đã được xóa thành công.`,
            type: "info",
          });
        }}
      />
    </section>
  );
}
