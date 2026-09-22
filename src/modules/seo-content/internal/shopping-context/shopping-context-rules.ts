export interface CategoryRuleDefinition {
  readonly audiences: readonly string[];
  readonly occasions: readonly string[];
  readonly useCases: readonly string[];
  readonly defaultCategoryNoun: string;
}

export const CATEGORY_RULES: Record<string, CategoryRuleDefinition> = {
  "t-shirt": {
    audiences: ["graphic apparel shoppers"],
    occasions: ["everyday wear"],
    useCases: ["everyday casual wear"],
    defaultCategoryNoun: "t-shirt",
  },
  "tee": {
    audiences: ["graphic apparel shoppers"],
    occasions: ["everyday wear"],
    useCases: ["everyday casual wear"],
    defaultCategoryNoun: "t-shirt",
  },
  "shirt": {
    audiences: ["graphic apparel shoppers"],
    occasions: ["everyday wear"],
    useCases: ["everyday casual wear"],
    defaultCategoryNoun: "shirt",
  },
  "hoodie": {
    audiences: ["casual apparel shoppers"],
    occasions: ["cool weather outings"],
    useCases: ["casual layering"],
    defaultCategoryNoun: "hoodie",
  },
  "sweatshirt": {
    audiences: ["casual apparel shoppers"],
    occasions: ["cool weather outings"],
    useCases: ["casual layering"],
    defaultCategoryNoun: "sweatshirt",
  },
  "ceramic mug": {
    audiences: ["coffee and tea drinkers"],
    occasions: ["everyday use"],
    useCases: ["daily coffee or tea"],
    defaultCategoryNoun: "mug",
  },
  "coffee mug": {
    audiences: ["coffee and tea drinkers"],
    occasions: ["everyday use"],
    useCases: ["daily coffee or tea"],
    defaultCategoryNoun: "coffee mug",
  },
  "mug": {
    audiences: ["coffee and tea drinkers"],
    occasions: ["everyday use"],
    useCases: ["daily coffee or tea"],
    defaultCategoryNoun: "mug",
  },
  "tumbler": {
    audiences: ["drinkware shoppers"],
    occasions: ["on the go hydration"],
    useCases: ["daily beverage carry"],
    defaultCategoryNoun: "tumbler",
  },
  "leather handbag": {
    audiences: ["handbag shoppers"],
    occasions: ["everyday use"],
    useCases: ["everyday carry"],
    defaultCategoryNoun: "handbag",
  },
  "handbag": {
    audiences: ["handbag shoppers"],
    occasions: ["everyday use"],
    useCases: ["everyday carry"],
    defaultCategoryNoun: "handbag",
  },
  "tote bag": {
    audiences: ["tote bag shoppers"],
    occasions: ["everyday use"],
    useCases: ["daily essentials carry"],
    defaultCategoryNoun: "tote bag",
  },
  "area rug": {
    audiences: ["home decor shoppers"],
    occasions: ["home refresh"],
    useCases: ["room styling"],
    defaultCategoryNoun: "area rug",
  },
  "rug": {
    audiences: ["home decor shoppers"],
    occasions: ["home refresh"],
    useCases: ["room styling"],
    defaultCategoryNoun: "rug",
  },
  "blanket": {
    audiences: ["home comfort shoppers"],
    occasions: ["everyday use"],
    useCases: ["lounging at home"],
    defaultCategoryNoun: "blanket",
  },
  "quilt": {
    audiences: ["home comfort shoppers"],
    occasions: ["home refresh"],
    useCases: ["bed or couch layering"],
    defaultCategoryNoun: "quilt",
  },
  "comforter": {
    audiences: ["home comfort shoppers"],
    occasions: ["bedroom refresh"],
    useCases: ["bedding warmth and comfort"],
    defaultCategoryNoun: "comforter",
  },
  "bedding set": {
    audiences: ["home decor shoppers"],
    occasions: ["bedroom refresh"],
    useCases: ["bedroom styling"],
    defaultCategoryNoun: "bedding set",
  },
  "poster": {
    audiences: ["wall art shoppers"],
    occasions: ["home decorating"],
    useCases: ["wall decor"],
    defaultCategoryNoun: "poster",
  },
  "canvas print": {
    audiences: ["wall art shoppers"],
    occasions: ["home decorating"],
    useCases: ["wall display"],
    defaultCategoryNoun: "canvas print",
  },
  "canvas": {
    audiences: ["wall art shoppers"],
    occasions: ["home decorating"],
    useCases: ["wall display"],
    defaultCategoryNoun: "canvas",
  },
  "throw pillow": {
    audiences: ["home decor shoppers"],
    occasions: ["home refresh"],
    useCases: ["living room accent"],
    defaultCategoryNoun: "throw pillow",
  },
  "pillow": {
    audiences: ["home decor shoppers"],
    occasions: ["home refresh"],
    useCases: ["living room accent"],
    defaultCategoryNoun: "pillow",
  },
  "phone case": {
    audiences: ["phone accessory shoppers"],
    occasions: ["everyday use"],
    useCases: ["phone protection"],
    defaultCategoryNoun: "phone case",
  },
  "cap": {
    audiences: ["headwear shoppers"],
    occasions: ["sunny days out"],
    useCases: ["outdoor casual wear"],
    defaultCategoryNoun: "cap",
  },
  "hat": {
    audiences: ["headwear shoppers"],
    occasions: ["sunny days out"],
    useCases: ["outdoor casual wear"],
    defaultCategoryNoun: "hat",
  },
  "tank top": {
    audiences: ["casual apparel shoppers"],
    occasions: ["warm weather outings"],
    useCases: ["workout or casual layering"],
    defaultCategoryNoun: "tank top",
  },
  "sticker": {
    audiences: ["sticker collectors"],
    occasions: ["everyday use"],
    useCases: ["laptop or water bottle decoration"],
    defaultCategoryNoun: "sticker",
  },
};

export const DEFAULT_CATEGORY_RULE: CategoryRuleDefinition = {
  audiences: ["general shoppers"],
  occasions: ["everyday use"],
  useCases: ["personal use"],
  defaultCategoryNoun: "product",
};

export const ENTITY_AUDIENCE_ALLOWLIST: Record<string, string> = {
  "cat": "cat lovers",
  "black cat": "cat lovers",
  "kitten": "cat lovers",
  "dog": "dog lovers",
  "puppy": "dog lovers",
  "book": "book lovers",
  "reading": "book lovers",
  "dragon": "dragon enthusiasts",
  "butterfly": "butterfly lovers",
  "plant": "plant lovers",
  "coffee": "coffee lovers",
  "guitar": "guitar players",
  "fishing": "fishing enthusiasts",
  "camping": "outdoor enthusiasts",
  "hiking": "hiking enthusiasts",
  "gamer": "gamers",
  "gaming": "gamers",
  "anime": "anime fans",
  "nurse": "nurses",
  "teacher": "teachers",
  "doctor": "doctors",
  "engineer": "engineers",
  "mom": "mothers",
  "mother": "mothers",
  "dad": "fathers",
  "father": "fathers",
  "grandma": "grandmothers",
  "grandmother": "grandmothers",
  "grandpa": "grandfathers",
  "grandfather": "grandfathers",
  "horse": "horse lovers",
  "flower": "flower lovers",
  "floral": "floral aesthetic lovers",
  "beer": "beer lovers",
  "wine": "wine lovers",
  "car": "car enthusiasts",
};

export interface RoleRecipientDefinition {
  readonly roleKeyword: string;
  readonly audiences: readonly string[];
  readonly occasion: string;
  readonly giftKeyword: string;
}

export const ROLE_RECIPIENT_RULES: Record<string, RoleRecipientDefinition> = {
  nurse: {
    roleKeyword: "nurse",
    audiences: ["nurses", "nurse gift shoppers"],
    occasion: "nurse appreciation",
    giftKeyword: "gift for nurse",
  },
  teacher: {
    roleKeyword: "teacher",
    audiences: ["teachers", "teacher gift shoppers"],
    occasion: "teacher appreciation",
    giftKeyword: "gift for teacher",
  },
  doctor: {
    roleKeyword: "doctor",
    audiences: ["doctors", "doctor gift shoppers"],
    occasion: "doctor appreciation",
    giftKeyword: "gift for doctor",
  },
  mom: {
    roleKeyword: "mom",
    audiences: ["mothers", "mom gift shoppers"],
    occasion: "mother's day gifting",
    giftKeyword: "gift for mom",
  },
  mother: {
    roleKeyword: "mother",
    audiences: ["mothers", "mom gift shoppers"],
    occasion: "mother's day gifting",
    giftKeyword: "gift for mother",
  },
  dad: {
    roleKeyword: "dad",
    audiences: ["fathers", "dad gift shoppers"],
    occasion: "father's day gifting",
    giftKeyword: "gift for dad",
  },
  father: {
    roleKeyword: "father",
    audiences: ["fathers", "dad gift shoppers"],
    occasion: "father's day gifting",
    giftKeyword: "gift for father",
  },
  grandma: {
    roleKeyword: "grandma",
    audiences: ["grandmothers", "grandma gift shoppers"],
    occasion: "grandparents day gifting",
    giftKeyword: "gift for grandma",
  },
  grandmother: {
    roleKeyword: "grandmother",
    audiences: ["grandmothers", "grandma gift shoppers"],
    occasion: "grandparents day gifting",
    giftKeyword: "gift for grandmother",
  },
  grandpa: {
    roleKeyword: "grandpa",
    audiences: ["grandfathers", "grandpa gift shoppers"],
    occasion: "grandparents day gifting",
    giftKeyword: "gift for grandpa",
  },
  grandfather: {
    roleKeyword: "grandfather",
    audiences: ["grandfathers", "grandpa gift shoppers"],
    occasion: "grandparents day gifting",
    giftKeyword: "gift for grandfather",
  },
  friend: {
    roleKeyword: "friend",
    audiences: ["friends", "gift shoppers"],
    occasion: "friendship celebration",
    giftKeyword: "gift for friend",
  },
  bestie: {
    roleKeyword: "bestie",
    audiences: ["friends", "gift shoppers"],
    occasion: "friendship celebration",
    giftKeyword: "gift for bestie",
  },
};

export const OCCASION_RULES: Record<string, readonly string[]> = {
  halloween: ["halloween celebration", "halloween party"],
  christmas: ["christmas celebration", "holiday gifting"],
  xmas: ["christmas celebration", "holiday gifting"],
  valentine: ["valentine's day", "romantic gifting"],
  "mother's day": ["mother's day", "mother's day gifting"],
  "father's day": ["father's day", "father's day gifting"],
  birthday: ["birthday celebration", "birthday gifting"],
  graduation: ["graduation celebration", "graduation gifting"],
  anniversary: ["anniversary celebration", "anniversary gifting"],
  thanksgiving: ["thanksgiving celebration", "fall gathering"],
  "st. patrick": ["st. patrick's day"],
  "st patrick": ["st. patrick's day"],
};

export const STYLE_RULES: Record<string, string> = {
  "vintage retro": "vintage aesthetic enthusiasts",
  "vintage": "vintage aesthetic enthusiasts",
  "retro": "vintage aesthetic enthusiasts",
  "gothic": "gothic style enthusiasts",
  "grunge": "gothic style enthusiasts",
  "minimalist": "minimalist style shoppers",
  "minimalism": "minimalist style shoppers",
  "boho": "boho style shoppers",
  "bohemian": "boho style shoppers",
  "cute": "cute graphic style shoppers",
  "cute cartoon": "cute graphic style shoppers",
  "kawaii": "cute graphic style shoppers",
  "streetwear": "streetwear enthusiasts",
  "urban": "streetwear enthusiasts",
  "cottagecore": "cottagecore aesthetic lovers",
};

export const PERSONALIZATION_SIGNALS: readonly string[] = [
  "personalized",
  "personalize",
  "custom",
  "customized",
  "your name",
  "custom name",
  "upload photo",
  "custom photo",
  "monogram",
];
