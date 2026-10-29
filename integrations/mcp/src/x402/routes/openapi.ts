import { errorResponse, jsonResponse } from '../http.ts';

const document = {
  openapi: '3.1.0',
  info: { title: 'Ashesborn public API', version: '1.0.0' },
  paths: {
    '/api/v1/datasets': {
      get: {
        summary: 'List available datasets',
        responses: { '200': { description: 'Public dataset catalogue.' } },
      },
    },
    '/api/v1/judge/paper': {
      get: {
        summary: 'Get paper status by DOI or paper ID',
        parameters: [
          { name: 'doi', in: 'query', required: false, schema: { type: 'string' } },
          { name: 'paper_id', in: 'query', required: false, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Paper status.' }, '400': { description: 'An identifier is required.' } },
      },
    },
    '/api/v1/judge': {
      post: {
        summary: 'Purchase a retraction judgment',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  {
                    type: 'object',
                    properties: { dataset_id: { type: 'string', minLength: 1 }, doi: { type: 'string', minLength: 1, maxLength: 300 } },
                    required: ['dataset_id', 'doi'],
                    additionalProperties: false,
                  },
                  {
                    type: 'object',
                    properties: { dataset_id: { type: 'string', minLength: 1 }, paper_id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9]*$' } },
                    required: ['dataset_id', 'paper_id'],
                    additionalProperties: false,
                  },
                ],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Judgment result.' },
          '400': { description: 'Invalid request body.' },
          '402': {
            description: 'Payment required.',
            headers: {
              'PAYMENT-REQUIRED': {
                description: 'x402 payment requirements to authorize the judgment.',
                schema: { type: 'string' },
              },
            },
          },
        },
      },
    },
    '/.well-known/x402': {
      get: { summary: 'Get x402 resource-server metadata', responses: { '200': { description: 'x402 metadata.' } } },
    },
  },
} as const;

export const handleOpenApi = (request: Request): Response | undefined => {
  if (new URL(request.url).pathname !== '/api/v1/openapi.json') return undefined;
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed.');
  return jsonResponse(200, document, { 'cache-control': 'public, max-age=60' });
};
