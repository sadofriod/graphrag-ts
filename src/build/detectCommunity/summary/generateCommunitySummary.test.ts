import { describe, expect, it } from 'bun:test';

import { modelLoaderSingleton } from '../../modelLoader';
import { generateCommunitySummary } from './generateCommunitySummary';
import type { Community } from '../types';

describe('generateCommunitySummary', () => {
  const originalModels = modelLoaderSingleton.models;

  const community: Community = { id: 3, members: ['A', 'B', 'C'] };

  it('assembles a grounded prompt and returns the parsed summary', async () => {
    modelLoaderSingleton.models = {
      slice: {
        invoke: async (prompt: string) => {
          expect(prompt).toContain('communityId');
          expect(prompt).toContain('communityName');
          expect(prompt).toContain('[Members] A, B, C');
          return JSON.stringify({
            communityName: 'Core Alliance',
            summaryContent: 'Members collaborate around a shared goal.',
          });
        },
      },
    } as any;

    try {
      const summary = await generateCommunitySummary(community, '[Members] A, B, C');
      expect(summary).toEqual({
        communityName: 'Core Alliance',
        summaryContent: 'Members collaborate around a shared goal.',
      });
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });

  it('accepts markdown-fenced JSON from the slice model', async () => {
    modelLoaderSingleton.models = {
      slice: {
        invoke: async () =>
          '```json\n' +
          JSON.stringify({
            communityName: 'Core Alliance',
            summaryContent: 'Members collaborate around a shared goal.',
          }) +
          '\n```',
      },
    } as any;

    try {
      const summary = await generateCommunitySummary(community, '[Members] A, B, C');
      expect(summary).toEqual({
        communityName: 'Core Alliance',
        summaryContent: 'Members collaborate around a shared goal.',
      });
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });

  it('throws when the slice model is not loaded', async () => {
    modelLoaderSingleton.models = {} as any;

    try {
      await expect(generateCommunitySummary(community, 'content')).rejects.toThrow(
        'Slice model is not loaded',
      );
    } finally {
      modelLoaderSingleton.models = originalModels;
    }
  });
});
