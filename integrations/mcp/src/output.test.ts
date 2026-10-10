import { expect, test } from 'bun:test';
import type {
  GlobalRetrievalResult,
  RetrievalResult,
} from '@ashes_born/graph-rag-ts/retrieval/types/retrieval';
import { formatGlobalQueryOutput, formatQueryOutput } from './output.ts';

test('truncates answers and evidence within the configured response budget', () => {
  const result: RetrievalResult = {
    query: 'question',
    communities: [],
    evidence: [{ text: 'e'.repeat(800), sourceDocumentId: 'notes/a.md' }],
    answer: 'a'.repeat(4000),
  };
  const output = formatQueryOutput(result, { id: 'version-id', namespace: 'snapshot-id' }, 512);
  const parsed = JSON.parse(output) as {
    answer: string;
    sources: readonly unknown[];
    truncated: boolean;
    index_version: { id: string };
  };
  expect(output.length).toBeLessThanOrEqual(512);
  expect(parsed.answer.length).toBeLessThan(4000);
  expect(parsed.sources).toHaveLength(0);
  expect(parsed.truncated).toBe(true);
  expect(parsed.index_version.id).toBe('version-id');
});

test('formats global search metadata and truncates within the configured response budget', () => {
  const result: GlobalRetrievalResult = {
    query: 'question',
    communityLevel: 1,
    status: 'partial',
    answer: 'a'.repeat(4000),
    selectedMapAnswers: [{ answer: 'map answer', usefulness: 0.9, communityIds: ['community-1'] }],
    failedMapBatches: 1,
  };
  const output = formatGlobalQueryOutput(result, { id: 'version-id', namespace: 'snapshot-id' }, 512);
  const parsed = JSON.parse(output) as {
    answer: string;
    status: string;
    community_level: number;
    failed_map_batches: number;
    selected_map_answers: readonly unknown[];
    truncated: boolean;
  };
  expect(output.length).toBeLessThanOrEqual(512);
  expect(parsed.selected_map_answers).toHaveLength(0);
  expect(parsed.status).toBe('partial');
  expect(parsed.community_level).toBe(1);
  expect(parsed.failed_map_batches).toBe(1);
  expect(parsed.truncated).toBe(true);
});