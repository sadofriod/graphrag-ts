import { describe, expect, it } from 'bun:test';

import { modelLoaderSingleton } from '../../build/modelLoader';
import { parseGlobalMapOutput, runGlobalMap } from './globalMap';

describe('parseGlobalMapOutput', () => {
  it('accepts a valid scored answer', () => {
    expect(parseGlobalMapOutput('{"answer":"Cross-sector trend","usefulness":72}'))
      .toEqual({ answer: 'Cross-sector trend', usefulness: 72 });
  });

  it('allows an empty answer only when usefulness is zero', () => {
    expect(parseGlobalMapOutput('{"answer":"","usefulness":0}'))
      .toEqual({ answer: '', usefulness: 0 });
    expect(() => parseGlobalMapOutput('{"answer":"","usefulness":10}'))
      .toThrow('Global Map output contains an invalid answer or usefulness score.');
  });

  it('rejects invalid usefulness scores and malformed output', () => {
    expect(() => parseGlobalMapOutput('{"answer":"x","usefulness":101}'))
      .toThrow('Global Map output contains an invalid answer or usefulness score.');
    expect(() => parseGlobalMapOutput('{"answer":"x","usefulness":"80"}'))
      .toThrow('Global Map output contains an invalid answer or usefulness score.');
    expect(() => parseGlobalMapOutput('not json')).toThrow('LLM output is not valid JSON');
  });

  it('retries a failed batch and respects the configured concurrency limit', async () => {
    const originalModels = modelLoaderSingleton.models;
    let callCount = 0;
    let activeCalls = 0;
    let maxActiveCalls = 0;
    modelLoaderSingleton.models = {
    slice: {
      invoke: async () => {
        const currentCall = callCount + 1;
        callCount = currentCall;
        activeCalls += 1;
        maxActiveCalls = Math.max(activeCalls, maxActiveCalls);
        await new Promise((resolve) => setTimeout(resolve, 2));
        activeCalls -= 1;
        if (currentCall === 1) {
          throw new Error('temporary model failure');
        }
        return JSON.stringify({ answer: 'Relevant answer', usefulness: 80 });
      },
    },
    } as never;

    try {
    const result = await runGlobalMap(
      'query',
      [
        { content: 'summary one', communityIds: ['c1'] },
        { content: 'summary two', communityIds: ['c2'] },
        { content: 'summary three', communityIds: ['c3'] },
      ],
      2,
    );

    expect(result.answers).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(callCount).toBe(4);
    expect(maxActiveCalls).toBeLessThanOrEqual(2);
    } finally {
    modelLoaderSingleton.models = originalModels;
    }
  });
});
