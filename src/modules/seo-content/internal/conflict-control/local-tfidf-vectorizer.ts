import { canonicalizeKeyword } from "./keyword-candidate";
import type {
  EmbeddingOptions,
  TextEmbeddingProvider,
} from "./text-embedding-provider";

/**
 * Deterministic domain-specific synonym canonicalization map for offline local matching.
 */
const LOCAL_SYNONYM_MAP: Readonly<Record<string, string>> = {
  retro: "vintage",
  tee: "t-shirt",
  tshirt: "t-shirt",
  shirt: "t-shirt",
  personalised: "personalized",
  customized: "custom",
  kitty: "cat",
  feline: "cat",
  kitten: "cat",
  apparel: "clothing",
  clothes: "clothing",
  garment: "clothing",
  halloween: "halloween",
  spooky: "halloween",
};

/**
 * Feature weights for multi-scale lexical representation:
 * - Unigrams provide fundamental topic coverage.
 * - Bigrams reward strict phrase/compound coherence.
 * - Trigrams capture subword/morphological stems.
 */
const UNIGRAM_WEIGHT = 2.0;
const BIGRAM_WEIGHT = 2.5;
const CHAR_TRIGRAM_WEIGHT = 0.5;

/**
 * Extracts normalized tokens and applies domain synonym mappings.
 */
export function extractCanonicalTokens(text: string): string[] {
  const canonical = canonicalizeKeyword(text);
  if (!canonical) {
    return [];
  }

  // Split on whitespace or non-alphanumeric except hyphen
  const rawTokens = canonical.split(/[\s,._/]+/).filter(Boolean);
  return rawTokens.map((token) => LOCAL_SYNONYM_MAP[token] || token);
}

/**
 * Generates character 3-grams for subword matching.
 */
function extractCharTrigrams(word: string): string[] {
  if (word.length < 3) {
    return [word];
  }
  const trigrams: string[] = [];
  for (let i = 0; i <= word.length - 3; i++) {
    trigrams.push(`c3:${word.substring(i, i + 3)}`);
  }
  return trigrams;
}

/**
 * Extracts weighted multi-scale features for a document.
 */
function extractFeatures(text: string): Map<string, number> {
  const tokens = extractCanonicalTokens(text);
  const featureCounts = new Map<string, number>();

  // 1. Unigrams
  for (const token of tokens) {
    const key = `u:${token}`;
    featureCounts.set(key, (featureCounts.get(key) ?? 0) + 1);

    // Character trigrams
    for (const tri of extractCharTrigrams(token)) {
      featureCounts.set(tri, (featureCounts.get(tri) ?? 0) + 1);
    }
  }

  // 2. Word Bigrams
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigramKey = `b:${tokens[i]}_${tokens[i + 1]}`;
    featureCounts.set(bigramKey, (featureCounts.get(bigramKey) ?? 0) + 1);
  }

  return featureCounts;
}

export interface LocalTfidfCorpusOptions {
  readonly referenceTexts: readonly string[];
  readonly candidateTexts: readonly string[];
}

/**
 * Local Deterministic TF-IDF Vectorizer with Subword and Bigram support.
 * Implements TextEmbeddingProvider interface with zero external network dependencies.
 */
export class LocalTfidfVectorizer implements TextEmbeddingProvider {
  public readonly providerId = "local_tfidf";
  private vocabulary: string[] = [];
  private idfMap = new Map<string, number>();

  constructor(corpusOptions?: LocalTfidfCorpusOptions) {
    if (corpusOptions) {
      this.buildVocabulary([
        ...corpusOptions.referenceTexts,
        ...corpusOptions.candidateTexts,
      ]);
    }
  }

  /**
   * Builds the fixed vocabulary and IDF table from all corpus documents.
   */
  public buildVocabulary(documents: readonly string[]): void {
    const docCount = documents.length;
    if (docCount === 0) {
      this.vocabulary = [];
      this.idfMap.clear();
      return;
    }

    const docFreq = new Map<string, number>();

    for (const doc of documents) {
      const features = extractFeatures(doc);
      for (const feature of features.keys()) {
        docFreq.set(feature, (docFreq.get(feature) ?? 0) + 1);
      }
    }

    // Sort vocabulary alphabetically for guaranteed determinism
    this.vocabulary = Array.from(docFreq.keys()).sort();
    this.idfMap.clear();

    for (const feature of this.vocabulary) {
      const df = docFreq.get(feature) ?? 1;
      // Standard smooth IDF: log((N + 1) / (df + 1)) + 1
      const idf = Math.log((docCount + 1) / (df + 1)) + 1;
      this.idfMap.set(feature, idf);
    }
  }

  /**
   * Vectorizes a single text string into a normalized L2 vector.
   */
  public vectorize(text: string): readonly number[] {
    if (this.vocabulary.length === 0) {
      // Auto-initialize with this single document
      this.buildVocabulary([text]);
    }

    const features = extractFeatures(text);
    const vector = new Array<number>(this.vocabulary.length).fill(0);
    let normSq = 0;

    for (let i = 0; i < this.vocabulary.length; i++) {
      const feature = this.vocabulary[i];
      const count = features.get(feature) ?? 0;
      if (count > 0) {
        const idf = this.idfMap.get(feature) ?? 1;

        let weightMultiplier = UNIGRAM_WEIGHT;
        if (feature.startsWith("b:")) {
          weightMultiplier = BIGRAM_WEIGHT;
        } else if (feature.startsWith("c3:")) {
          weightMultiplier = CHAR_TRIGRAM_WEIGHT;
        }

        const tfIdfScore = count * idf * weightMultiplier;
        vector[i] = tfIdfScore;
        normSq += tfIdfScore * tfIdfScore;
      }
    }

    // L2 Normalization
    if (normSq > 0) {
      const norm = Math.sqrt(normSq);
      for (let i = 0; i < vector.length; i++) {
        vector[i] = vector[i] / norm;
      }
    }

    return vector;
  }

  async embed(
    texts: readonly string[],
    _options: EmbeddingOptions,
  ): Promise<readonly (readonly number[])[]> {
    if (this.vocabulary.length === 0 && texts.length > 0) {
      this.buildVocabulary(texts);
    }

    return texts.map((text) => this.vectorize(text));
  }
}
