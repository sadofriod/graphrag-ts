/**
 * Page anchor attribution.
 *
 * Source markdown produced by the pdfplumber pipeline carries one hint comment per content block:
 *
 *   <!-- page 3 bbox=64.1,375.65,505.3,445.26 ruled-lines -->
 *
 * The LLM chunker that produces parent/child chunk text may drop those comments, so anchors are
 * resolved by matching chunk text back to the parsed blocks: exact substring containment first,
 * character-bigram Dice over sliding block windows second. No model, no I/O, no randomness.
 */

export interface PageBlock {
  page: number;
  bbox: [number, number, number, number];
  kind?: string;
  text: string;
}

export type AnchorMethod = 'exact' | 'fuzzy' | 'none';

export interface PageAnchorMatch {
  /** First page covered by the chunk, or -1 when nothing matched. */
  page: number;
  /** Last page covered by the chunk, or -1 when nothing matched. */
  pageEnd: number;
  /** Bbox of the first matched block, or [0,0,0,0] when nothing matched. */
  bbox: [number, number, number, number];
  method: AnchorMethod;
  /** 1 for exact matches, the Dice coefficient for fuzzy matches, 0 for none. */
  score: number;
}

export interface AnchorCoverage {
  total: number;
  exact: number;
  fuzzy: number;
  none: number;
  /** (exact + fuzzy) / total, 0 when there is nothing to attribute. */
  coverage: number;
}

const ANCHOR_COMMENT =
  /<!--\s*page\s+(\d+)\s+bbox=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:\s+([^>]*?))?\s*-->/g;

const FUZZY_MIN_SCORE = 0.55;
const MAX_WINDOW = 3;
/** Blocks shorter than this are too generic to anchor on exact containment alone. */
const MIN_EXACT_BLOCK_CHARS = 12;
const MIN_CHUNK_CHARS = 12;

const NONE_MATCH: PageAnchorMatch = {
  page: -1,
  pageEnd: -1,
  bbox: [0, 0, 0, 0],
  method: 'none',
  score: 0,
};

export function normaliseWhitespace(value: string): string {
  return value.replace(/[\s\u00a0]+/g, ' ').trim();
}

/**
 * Split markdown into page-anchored blocks. Text before the first anchor comment is ignored
 * (it cannot be located), and an anchor comment with no following content is counted as orphan.
 */
export function parsePageAnchors(markdown: string): { blocks: PageBlock[]; orphanBlocks: number } {
  const blocks: PageBlock[] = [];
  const anchors: {
    page: number;
    bbox: [number, number, number, number];
    kind?: string;
    start: number;
    end: number;
  }[] = [];

  ANCHOR_COMMENT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANCHOR_COMMENT.exec(markdown)) !== null) {
    const kindRaw = match[6]?.trim();
    anchors.push({
      page: Number(match[1]),
      bbox: [Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5])],
      ...(kindRaw ? { kind: kindRaw } : {}),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  let orphanBlocks = 0;
  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index]!;
    const next = anchors[index + 1];
    const rawText = markdown.slice(anchor.end, next ? next.start : markdown.length);
    const text = normaliseWhitespace(rawText);
    if (text.length === 0) {
      orphanBlocks += 1;
      continue;
    }
    blocks.push({
      page: anchor.page,
      bbox: anchor.bbox,
      ...(anchor.kind ? { kind: anchor.kind } : {}),
      text,
    });
  }

  return { blocks, orphanBlocks };
}

function bigramCounts(value: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (let index = 0; index + 1 < value.length; index += 1) {
    const gram = value.slice(index, index + 2);
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

function diceSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  let totalA = 0;
  let totalB = 0;
  for (const count of a.values()) totalA += count;
  for (const count of b.values()) totalB += count;
  for (const [gram, countA] of a) {
    const countB = b.get(gram);
    if (countB !== undefined) intersection += Math.min(countA, countB);
  }
  return totalA + totalB === 0 ? 0 : (2 * intersection) / (totalA + totalB);
}

/** Block bigrams are recomputed for every chunk, so cache them per block object. */
const blockGramCache = new WeakMap<PageBlock, Map<string, number>>();

function blockGrams(block: PageBlock): Map<string, number> {
  const cached = blockGramCache.get(block);
  if (cached !== undefined) return cached;
  const grams = bigramCounts(block.text);
  blockGramCache.set(block, grams);
  return grams;
}

function exactMatch(chunkText: string, blocks: readonly PageBlock[]): PageAnchorMatch | null {
  const matched: PageBlock[] = [];
  for (const block of blocks) {
    if (block.text.length < MIN_EXACT_BLOCK_CHARS) continue;
    if (chunkText.includes(block.text)) {
      matched.push(block);
      continue;
    }
    // A chunk can be shorter than the block it came from (sentence-level evidence).
    if (chunkText.length >= MIN_CHUNK_CHARS && block.text.includes(chunkText)) {
      matched.push(block);
    }
  }
  if (matched.length === 0) return null;
  const pages = matched.map((block) => block.page);
  return {
    page: Math.min(...pages),
    pageEnd: Math.max(...pages),
    bbox: matched[0]!.bbox,
    method: 'exact',
    score: 1,
  };
}

function fuzzyMatch(chunkText: string, blocks: readonly PageBlock[]): PageAnchorMatch | null {
  if (chunkText.length < MIN_CHUNK_CHARS) return null;
  const chunkGrams = bigramCounts(chunkText);
  let best: PageAnchorMatch | null = null;

  for (let start = 0; start < blocks.length; start += 1) {
    for (let size = 1; size <= MAX_WINDOW && start + size <= blocks.length; size += 1) {
      const window = blocks.slice(start, start + size);
      const windowText = window.map((block) => block.text).join(' ');
      // Reuse cached bigrams for the single-block case, which is the common hit.
      const wholeGram = size === 1 ? blockGrams(window[0]!) : bigramCounts(windowText);
      const score = diceSimilarity(chunkGrams, wholeGram);
      if (score < FUZZY_MIN_SCORE) continue;
      // Stable tie-break: keep the earliest window on equal scores.
      if (best !== null && score <= best.score) continue;
      const pages = window.map((block) => block.page);
      best = {
        page: Math.min(...pages),
        pageEnd: Math.max(...pages),
        bbox: window[0]!.bbox,
        method: 'fuzzy',
        score: Number(score.toFixed(4)),
      };
    }
  }

  return best;
}

/** Attribute a single chunk of text to the page range it came from. */
export function attributeChunk(chunk: string, blocks: readonly PageBlock[]): PageAnchorMatch {
  const chunkText = normaliseWhitespace(chunk);
  if (chunkText.length === 0 || blocks.length === 0) return { ...NONE_MATCH };
  const exact = exactMatch(chunkText, blocks);
  if (exact) return exact;
  const fuzzy = fuzzyMatch(chunkText, blocks);
  if (fuzzy) return fuzzy;
  return { ...NONE_MATCH };
}

export function attributeChunks(
  chunks: readonly string[],
  blocks: readonly PageBlock[],
): PageAnchorMatch[] {
  return chunks.map((chunk) => attributeChunk(chunk, blocks));
}

export function anchorCoverage(matches: readonly PageAnchorMatch[]): AnchorCoverage {
  let exact = 0;
  let fuzzy = 0;
  let none = 0;
  for (const match of matches) {
    if (match.method === 'exact') exact += 1;
    else if (match.method === 'fuzzy') fuzzy += 1;
    else none += 1;
  }
  const total = matches.length;
  return {
    total,
    exact,
    fuzzy,
    none,
    coverage: total === 0 ? 0 : Number(((exact + fuzzy) / total).toFixed(4)),
  };
}
