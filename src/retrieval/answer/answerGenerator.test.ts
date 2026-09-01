import { describe, expect, it } from 'bun:test';

import { modelLoaderSingleton } from '../../build/modelLoader';
import type { EvidenceSnippet } from '../types/graph';
import { generateAnswer } from './answerGenerator';

const evidence: EvidenceSnippet[] = [
  { claimId: 'cl1', text: 'Evidence A', sourceDocumentId: 'd1' },
  { claimId: 'cl2', text: 'Evidence B' },
];

describe('generateAnswer', () => {
  it('generates an answer through the LLM from summaries and evidence', async () => {
    const originalModels = modelLoaderSingleton.models;

    modelLoaderSingleton.models = {
      embedding: {},
      slice: {
        invoke: async (prompt: string) => {
          expect(prompt).toContain('Community One Summary');
          expect(prompt).toContain('Evidence A');
          return 'Apple and Banana have a partnership.';
        },
      },
    } as never;

    try {
      const answer = await generateAnswer('q', ['Community One Summary'], evidence);

      expect(answer).toBe('Apple and Banana have a partnership.');
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });
});
