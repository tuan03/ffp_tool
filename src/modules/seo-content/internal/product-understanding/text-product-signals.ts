export interface TextProductSignals {
  readonly detectedEntities: readonly string[];
  readonly dominantColors: readonly string[];
  readonly visualStyle?: string;
  readonly productCategory?: string;
}

const KNOWN_COLORS: ReadonlyArray<{ readonly name: string; readonly patterns: readonly RegExp[] }> = [
  { name: "black", patterns: [/\bblack\b/i] },
  { name: "white", patterns: [/\bwhite\b/i] },
  { name: "cream", patterns: [/\bcream\b/i, /\boff[- ]white\b/i] },
  { name: "orange", patterns: [/\borange\b/i] },
  { name: "navy", patterns: [/\bnavy\b/i, /\bdark blue\b/i] },
  { name: "red", patterns: [/\bred\b/i] },
  { name: "pink", patterns: [/\bpink\b/i] },
  { name: "purple", patterns: [/\bpurple\b/i] },
  { name: "green", patterns: [/\bgreen\b/i] },
  { name: "brown", patterns: [/\bbrown\b/i] },
  { name: "beige", patterns: [/\bbeige\b/i] },
  { name: "gold", patterns: [/\bgold\b/i, /\bgolden\b/i] },
  { name: "silver", patterns: [/\bsilver\b/i] },
  { name: "gray", patterns: [/\bgra?y\b/i] },
];

const KNOWN_CATEGORIES: ReadonlyArray<{ readonly canonical: string; readonly patterns: readonly RegExp[] }> = [
  { canonical: "ceramic mug", patterns: [/\bceramic mug\b/i] },
  { canonical: "mug", patterns: [/\bcoffee mug\b/i, /\bmug\b/i] },
  { canonical: "tote bag", patterns: [/\btote bag\b/i, /\btote\b/i] },
  { canonical: "handbag", patterns: [/\bhandbag\b/i] },
  { canonical: "t-shirt", patterns: [/\bt[- ]?shirt\b/i, /\btee\b/i] },
  { canonical: "hoodie", patterns: [/\bpullover hoodie\b/i, /\bhoodie\b/i] },
  { canonical: "sweatshirt", patterns: [/\bsweatshirt\b/i, /\bcrewneck\b/i] },
  { canonical: "canvas print", patterns: [/\bcanvas (print|art|wall art)\b/i] },
  { canonical: "poster", patterns: [/\bposter\b/i] },
  { canonical: "rug", patterns: [/\barea rug\b/i, /\bfloor rug\b/i, /\brug\b/i] },
  { canonical: "bedding set", patterns: [/\bbedding set\b/i, /\bbedding\b/i, /\bduvet\b/i] },
  { canonical: "blanket", patterns: [/\bblanket\b/i] },
  { canonical: "quilt", patterns: [/\bquilt\b/i, /\bquilt set\b/i] },
  { canonical: "comforter", patterns: [/\bcomforter\b/i] },
];

const KNOWN_STYLES: ReadonlyArray<{ readonly canonical: string; readonly matchAll?: readonly RegExp[]; readonly matchAny?: readonly RegExp[] }> = [
  {
    canonical: "celtic",
    matchAny: [/\bceltic\b/i, /\btree of life\b/i, /\byggdrasil\b/i, /\bpagan\b/i, /\bnordic\b/i, /\bviking\b/i],
  },
  {
    canonical: "vintage retro",
    matchAny: [/\bvintage retro\b/i, /\bretro vintage\b/i],
    matchAll: [/\b(vintage|retro)\b/i],
  },
  {
    canonical: "minimalist typography",
    matchAll: [/\bminimal(ist)?\b/i, /\btypography\b/i],
  },
  {
    canonical: "cute cartoon",
    matchAny: [/\bcute cartoon\b/i, /\bchibi\b/i, /\bkawaii\b/i],
  },
  {
    canonical: "sporty varsity",
    matchAny: [/\b(varsity|sporty)\b/i],
  },
  {
    canonical: "watercolor floral",
    matchAll: [/\bwatercolor\b/i, /\bfloral\b/i],
  },
  {
    canonical: "gothic",
    matchAny: [/\bgothic\b/i],
  },
  {
    canonical: "boho",
    matchAny: [/\bboho\b/i, /\bbohemian\b/i],
  },
  {
    canonical: "rustic",
    matchAny: [/\brustic\b/i],
  },
];

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, " ");
}

function cleanText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function extractTextProductSignals(input: {
  readonly title: string;
  readonly description: string;
  readonly niche: string;
}): TextProductSignals {
  const title = input.title ?? "";
  const description = input.description ?? "";
  const niche = input.niche ?? "";
  const rawCombined = `${title} ${stripHtml(description)} ${niche}`;
  const cleanCombined = cleanText(rawCombined);

  if (!cleanCombined) {
    return {
      detectedEntities: [],
      dominantColors: [],
      visualStyle: undefined,
      productCategory: undefined,
    };
  }

  // 1. Dominant Colors detection
  const detectedColors: string[] = [];
  for (const item of KNOWN_COLORS) {
    if (item.patterns.some((pattern) => pattern.test(cleanCombined))) {
      detectedColors.push(item.name);
    }
  }

  // 2. Product Category detection (ordered from most specific, e.g. "ceramic mug" before "mug")
  let productCategory: string | undefined;
  for (const item of KNOWN_CATEGORIES) {
    if (item.patterns.some((pattern) => pattern.test(cleanCombined))) {
      productCategory = item.canonical;
      break;
    }
  }

  // 3. Visual Style detection
  let visualStyle: string | undefined;
  for (const item of KNOWN_STYLES) {
    let matched = false;
    if (item.matchAny && item.matchAny.some((pattern) => pattern.test(cleanCombined))) {
      matched = true;
    } else if (item.matchAll && item.matchAll.every((pattern) => pattern.test(cleanCombined))) {
      matched = true;
    }
    if (matched) {
      visualStyle = item.canonical;
      break;
    }
  }

  // 4. Detected Entities (conservative extraction of key domain phrases from niche and title)
  const candidateEntities: string[] = [];
  
  // Specific common entities
  const knownEntityPatterns = [
    /\bblack cat\b/i,
    /\bwhite cat\b/i,
    /\bcat\b/i,
    /\bmotorcycle\b/i,
    /\bcoffee cup\b/i,
    /\bretro sun\b/i,
    /\bpaw prints?\b/i,
    /\bbasketball\b/i,
    /\bvarsity emblem\b/i,
    /\bpumpkin\b/i,
    /\bmoon\b/i,
    /\bskull\b/i,
    /\bceltic knot\b/i,
    /\btree of life\b/i,
    /\byggdrasil\b/i,
  ];

  for (const pattern of knownEntityPatterns) {
    const match = cleanCombined.match(pattern);
    if (match) {
      candidateEntities.push(match[0].toLowerCase().trim());
    }
  }

  // Niche phrase (if not category and not already present)
  const cleanNiche = input.niche.trim().toLowerCase();
  if (
    cleanNiche &&
    cleanNiche !== productCategory &&
    !candidateEntities.includes(cleanNiche)
  ) {
    candidateEntities.push(cleanNiche);
  }

  const detectedEntities = Array.from(new Set(candidateEntities));

  return {
    detectedEntities,
    dominantColors: detectedColors.slice(0, 5),
    visualStyle,
    productCategory,
  };
}
