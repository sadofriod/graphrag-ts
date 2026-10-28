import type { Dataset } from './datasets.ts';

const exampleQuestion = (dataset: Dataset): string => {
  const title = dataset.title.trim().replace(/[.!?]+$/, '');
  return `What does ${title} cover?`;
};

export const bazaarDeclaration = (dataset: Dataset, mode: 'local' | 'global') => ({
  info: {
    input: {
      type: 'http',
      method: 'POST',
      bodyType: 'json',
      body: { dataset_id: dataset.id, query: exampleQuestion(dataset), mode, max_results: 5 },
    },
    output: {
      type: 'json',
      example: {
        answer: '…',
        mode,
        dataset: { id: dataset.id, version: '<uuid>', workspace_id: dataset.workspaceId },
        sources: [{ source: 'contracts/vault.md', excerpt: '…' }],
        usage: { query_ms: 812, map_answers: 0 },
      },
    },
  },
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    properties: {
      input: {
        type: 'object',
        properties: {
          type: { const: 'http' },
          method: { enum: ['POST'] },
          bodyType: { enum: ['json'] },
          body: {
            type: 'object',
            properties: {
              dataset_id: { type: 'string' },
              query: { type: 'string' },
              mode: { enum: ['local', 'global'] },
              max_results: { type: 'integer' },
            },
            required: ['dataset_id', 'query'],
          },
        },
        required: ['type', 'method', 'bodyType', 'body'],
        additionalProperties: false,
      },
      output: {
        type: 'object',
        properties: { type: { type: 'string' }, example: { type: 'object' } },
        required: ['type'],
      },
    },
    required: ['input'],
    additionalProperties: false,
  },
});
