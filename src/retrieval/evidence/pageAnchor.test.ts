import { describe, expect, it } from 'bun:test';

import type { ClaimRecord } from '../types/graph';
import { fetchEvidenceForCommunity } from './evidenceRetriever';
import {
  anchorCoverage,
  attributeChunk,
  attributeChunks,
  normaliseWhitespace,
  parsePageAnchors,
  type PageAnchorMatch,
} from './pageAnchor';

const BLOCK_ONE = '营业收入 1,234 亿元，同比增长 12.3%，主要来自白酒主业。';
const BLOCK_TWO = '经营活动产生的现金流量净额为 456 亿元。';

const SAMPLE_MARKDOWN = [
  'Untitled preface that cannot be anchored',
  '<!-- page 3 bbox=64.1,375.65,505.3,445.26 ruled-lines -->',
  BLOCK_ONE,
  '<!-- page 4 bbox=90.14,143.78,532.3,242.66 ruled-lines -->',
  BLOCK_TWO,
  '<!-- page 5 bbox=10,10,20,20 -->',
].join('\n');

describe('parsePageAnchors', () => {
  it('parses the real pdfplumber comment format into page, bbox, kind and text', () => {
    const { blocks, orphanBlocks } = parsePageAnchors(SAMPLE_MARKDOWN);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      page: 3,
      bbox: [64.1, 375.65, 505.3, 445.26],
      kind: 'ruled-lines',
      text: BLOCK_ONE,
    });
    expect(blocks[1]!.page).toBe(4);
    expect(blocks[1]!.kind).toBe('ruled-lines');
    expect(orphanBlocks).toBe(1);
  });

  it('tolerates CRLF line endings', () => {
    const crlf = SAMPLE_MARKDOWN.replace(/\n/g, '\r\n');
    const { blocks, orphanBlocks } = parsePageAnchors(crlf);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.text).toBe(BLOCK_ONE);
    expect(orphanBlocks).toBe(1);
  });

  it('returns nothing for markdown without anchors', () => {
    expect(parsePageAnchors('# plain markdown\n\nno anchors here')).toEqual({
      blocks: [],
      orphanBlocks: 0,
    });
  });
});

describe('attributeChunk', () => {
  const { blocks } = parsePageAnchors(SAMPLE_MARKDOWN);

  it('anchors a chunk that contains a whole block exactly', () => {
    const match = attributeChunk(`结论：${BLOCK_ONE}`, blocks);

    expect(match.method).toBe('exact');
    expect(match.page).toBe(3);
    expect(match.pageEnd).toBe(3);
    expect(match.bbox).toEqual([64.1, 375.65, 505.3, 445.26]);
    expect(match.score).toBe(1);
  });

  it('reports a page span when the chunk covers several blocks', () => {
    const match = attributeChunk(`${BLOCK_ONE}\n\n${BLOCK_TWO}`, blocks);

    expect(match.method).toBe('exact');
    expect(match.page).toBe(3);
    expect(match.pageEnd).toBe(4);
    expect(match.bbox).toEqual([64.1, 375.65, 505.3, 445.26]);
  });

  it('anchors a chunk shorter than its block exactly', () => {
    const match = attributeChunk('同比增长 12.3%，主要来自白酒主业。', blocks);

    expect(match.method).toBe('exact');
    expect(match.page).toBe(3);
  });

  it('falls back to fuzzy matching for a near-miss paraphrase', () => {
    const paraphrase = '营业收入 1,234 亿元，同比增长 12.4%，主要来自白酒主业';
    const match = attributeChunk(paraphrase, blocks);

    expect(match.method).toBe('fuzzy');
    expect(match.page).toBe(3);
    expect(match.score).toBeGreaterThanOrEqual(0.55);
    expect(match.score).toBeLessThan(1);
  });

  it('returns no anchor for unrelated text', () => {
    const match = attributeChunk('本文讨论新能源汽车电池供应链与锂矿价格波动', blocks);

    expect(match.method).toBe('none');
    expect(match.page).toBe(-1);
    expect(match.score).toBe(0);
  });

  it('is deterministic across repeated calls', () => {
    const chunks = [`结论：${BLOCK_ONE}`, '本文讨论新能源汽车电池供应链与锂矿价格波动', BLOCK_TWO];
    expect(attributeChunks(chunks, blocks)).toEqual(attributeChunks(chunks, blocks));
  });
});

describe('anchorCoverage', () => {
  it('counts methods and reports the covered ratio', () => {
    const matches: PageAnchorMatch[] = [
      { page: 3, pageEnd: 3, bbox: [0, 0, 1, 1], method: 'exact', score: 1 },
      { page: 4, pageEnd: 4, bbox: [0, 0, 1, 1], method: 'fuzzy', score: 0.7 },
      { page: -1, pageEnd: -1, bbox: [0, 0, 0, 0], method: 'none', score: 0 },
      { page: 9, pageEnd: 10, bbox: [0, 0, 1, 1], method: 'exact', score: 1 },
    ];

    expect(anchorCoverage(matches)).toEqual({
      total: 4,
      exact: 2,
      fuzzy: 1,
      none: 1,
      coverage: 0.75,
    });
    expect(anchorCoverage([])).toEqual({ total: 0, exact: 0, fuzzy: 0, none: 0, coverage: 0 });
  });
});

describe('normaliseWhitespace', () => {
  it('collapses runs of whitespace and non-breaking spaces', () => {
    expect(normaliseWhitespace('  a\u00a0 b\n\nc\t ')).toBe('a b c');
  });
});

describe('fetchEvidenceForCommunity with page anchors', () => {
  const claims: ClaimRecord[] = [
    { id: 'cl1', entityIds: ['A'], text: 'A works with B', sourceChunkId: 'ch1' },
    { id: 'cl2', entityIds: ['A'], text: 'A has no anchor', sourceChunkId: 'ch2' },
  ];
  const anchors = new Map<string, PageAnchorMatch>([
    ['ch1', { page: 7, pageEnd: 8, bbox: [1, 2, 3, 4], method: 'exact', score: 1 }],
  ]);

  it('carries page and bbox when the source chunk has an anchor', () => {
    const [snippet] = fetchEvidenceForCommunity(new Set(['A']), [claims[0]!], anchors);

    expect(snippet).toEqual({
      claimId: 'cl1',
      text: 'A works with B',
      sourceChunkId: 'ch1',
      page: 7,
      pageEnd: 8,
      bbox: [1, 2, 3, 4],
      anchorMethod: 'exact',
    });
  });

  it('omits anchor fields when the chunk is unknown or no map is passed', () => {
    const [unknown] = fetchEvidenceForCommunity(new Set(['A']), [claims[1]!], anchors);
    const [withoutMap] = fetchEvidenceForCommunity(new Set(['A']), [claims[0]!]);

    expect(unknown).toEqual({ claimId: 'cl2', text: 'A has no anchor', sourceChunkId: 'ch2' });
    expect(withoutMap).toEqual({ claimId: 'cl1', text: 'A works with B', sourceChunkId: 'ch1' });
  });
});
