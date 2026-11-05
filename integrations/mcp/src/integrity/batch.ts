import type { Judge } from './judge.ts';
import type { JudgmentPayload } from './types.ts';

export const extractDoi = (text: string): string | undefined => {
  const trimmed = text.trim();
  const candidate = /^10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/.test(trimmed)
    ? trimmed
    : trimmed.match(/10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/)?.[0];
  return candidate?.replace(/[.,;\])]+$/, '') || undefined;
};

export type ReferenceBatchItem = {
  readonly input: string;
  readonly matched: boolean;
  readonly paper_id: string | null;
  readonly doi: string | null;
  readonly title: string | null;
  readonly year: number | null;
  readonly verdict: JudgmentPayload['verdict'];
  readonly confidence: number;
  readonly confidence_basis: JudgmentPayload['confidence_basis'];
  readonly retracted_roots: JudgmentPayload['retracted_roots'];
  readonly conflict_flags: JudgmentPayload['conflict_flags'];
  readonly coverage: JudgmentPayload['coverage'];
  readonly abstention_reason: JudgmentPayload['abstention_reason'];
};

const emptyUnmatched = (input: string, doi: string | undefined): ReferenceBatchItem => ({
  input, matched: false, paper_id: null, doi: doi ?? null, title: null, year: null,
  verdict: 'INSUFFICIENT_EVIDENCE', confidence: 0.25, confidence_basis: 'coverage',
  retracted_roots: [], conflict_flags: [], coverage: { references: 0, resolved: 0, ratio: 0, indexed: false },
  abstention_reason: 'paper_not_in_snapshot',
});

const judgeReference = async (judge: Judge, input: string): Promise<ReferenceBatchItem> => {
  const doi = extractDoi(input);
  if (!doi) return emptyUnmatched(input, undefined);
  const judgment = await judge.retractionPropagation({ doi });
  if (judgment.abstention_reason === 'paper_not_in_snapshot') {
    return { input, matched: false, paper_id: null, doi, title: null, year: null, verdict: judgment.verdict,
      confidence: judgment.confidence, confidence_basis: judgment.confidence_basis, retracted_roots: judgment.retracted_roots,
      conflict_flags: judgment.conflict_flags, coverage: judgment.coverage, abstention_reason: 'paper_not_in_snapshot' };
  }
  return {
    input, matched: true, paper_id: judgment.target.paper_id, doi: judgment.target.doi,
    title: judgment.target.title, year: judgment.target.year, verdict: judgment.verdict,
    confidence: judgment.confidence, confidence_basis: judgment.confidence_basis,
    retracted_roots: judgment.retracted_roots, conflict_flags: judgment.conflict_flags,
    coverage: judgment.coverage, abstention_reason: judgment.abstention_reason,
  };
};

export const runReferenceBatch = async (judge: Judge, refs: readonly string[], maxItems: number) => {
  if (refs.length > maxItems) throw new Error(`Reference batch exceeds max_items (${maxItems}).`);
  const snapshot = await judge.snapshot();
  const items = new Array<ReferenceBatchItem>(refs.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = next++;
      if (index >= refs.length) return;
      items[index] = await judgeReference(judge, refs[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, refs.length) }, () => worker()));
  const unmatched = items.filter((item) => !item.matched).map((item) => item.input);
  return {
    snapshot,
    items,
    summary: {
      requested: refs.length,
      matched: refs.length - unmatched.length,
      unmatched,
      retracted_root_count: items.reduce((total, item) => total + item.retracted_roots.length, 0),
    },
  };
};
