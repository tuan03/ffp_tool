/** Only a conservative physical-blank fallback when no pixels can be read. */
export interface TextProductSignals {
  readonly physicalProductIdentity?: string;
}

const PHYSICAL_IDENTITIES: readonly { readonly identity: string; readonly pattern: RegExp }[] = [
  { identity: "ceramic mug", pattern: /\bceramic mug\b/i },
  { identity: "mug", pattern: /\bcoffee mug\b|\bmug\b/i },
  { identity: "tote bag", pattern: /\btote bag\b|\btote\b/i },
  { identity: "handbag", pattern: /\bhandbag\b/i },
  { identity: "t-shirt", pattern: /\bt[- ]?shirt\b|\btee\b/i },
  { identity: "hoodie", pattern: /\bpullover hoodie\b|\bhoodie\b/i },
  { identity: "sweatshirt", pattern: /\bsweatshirt\b|\bcrewneck\b/i },
  { identity: "canvas print", pattern: /\bcanvas (print|art|wall art)\b/i },
  { identity: "poster", pattern: /\bposter\b/i },
  { identity: "area rug", pattern: /\barea rug\b|\bfloor rug\b|\brug\b/i },
  { identity: "bedding set", pattern: /\bbedding set\b|\bbedding\b|\bduvet\b/i },
  { identity: "blanket", pattern: /\bblanket\b/i },
  { identity: "quilt", pattern: /\bquilt\b/i },
  { identity: "comforter", pattern: /\bcomforter\b/i },
];

function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, " ");
}

export function extractTextProductSignals(input: {
  readonly title: string;
  readonly description: string;
  readonly niche: string;
}): TextProductSignals {
  const evidence = `${input.title} ${stripHtml(input.description)} ${input.niche}`.replace(/\s+/g, " ");
  const match = PHYSICAL_IDENTITIES.find((candidate) => candidate.pattern.test(evidence));
  return { physicalProductIdentity: match?.identity };
}
