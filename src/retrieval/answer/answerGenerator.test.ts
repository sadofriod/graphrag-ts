import { describe, expect, it } from 'bun:test';

import { modelLoaderSingleton } from '../../build/modelLoader';
import type { EvidenceSnippet } from '../types/graph';
import { generateAnswer } from './answerGenerator';

const evidence: EvidenceSnippet[] = [
  { claimId: 'cl1', text: '证据甲', sourceDocumentId: 'd1' },
  { claimId: 'cl2', text: '证据乙' },
];

describe('generateAnswer', () => {
  it('generates an answer through the LLM from summaries and evidence', async () => {
    const originalModels = modelLoaderSingleton.models;

    modelLoaderSingleton.models = {
      embedding: {},
      slice: {
        invoke: async (prompt: string) => {
          expect(prompt).toContain('社区一摘要');
          expect(prompt).toContain('证据甲');
          return '苹果与香蕉存在合作关系。';
        },
      },
    } as never;

    try {
      const answer = await generateAnswer('q', ['社区一摘要'], evidence);

      expect(answer).toBe('苹果与香蕉存在合作关系。');
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });
});
