import type { GraphDataset, JudgmentDataset } from './datasets.ts';

const exampleQuestion = (dataset: GraphDataset): string => {
  const title = dataset.title.trim().replace(/[.!?]+$/, '');
  return `What does ${title} cover?`;
};

export const bazaarDeclaration = (dataset: GraphDataset, mode: 'local' | 'global') => ({
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

export const judgmentBazaarDeclaration = (dataset: JudgmentDataset) => ({
  info: {
    input: { type: 'http', method: 'POST', bodyType: 'json', body: { dataset_id: dataset.id, doi: '10.1234/example' } },
    output: { type: 'json', example: {
      verdict: 'INSUFFICIENT_EVIDENCE', confidence: 0, retracted_roots: [{ paper_id: 'W123', doi: '10.1234/retracted' }],
      conflict_flags: [], payment: { payment_id: '<uuid>', amount: dataset.pricing.per_call.atomic },
    } },
  },
  schema: {
    $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
    properties: {
      input: { type: 'object', properties: {
        type: { const: 'http' }, method: { enum: ['POST'] }, bodyType: { enum: ['json'] },
        body: { type: 'object', properties: { dataset_id: { type: 'string' }, doi: { type: 'string' }, paper_id: { type: 'string' } }, required: ['dataset_id'], additionalProperties: false },
      }, required: ['type', 'method', 'bodyType', 'body'], additionalProperties: false },
      output: { type: 'object', properties: { type: { type: 'string' }, example: { type: 'object' } }, required: ['type'] },
    }, required: ['input'], additionalProperties: false,
  },
});

export const referenceBatchBazaarDeclaration = (dataset: JudgmentDataset, includeDatasetId = true) => {
  const status = { source: 'retraction_watch', tier: 'A', is_retracted: true, retraction_date: '2010-02-02', uri: 'https://retractionwatch.com/example' };
  const coverage = { references: 42, resolved: 38, ratio: 0.905, indexed: true };
  const itemProperties = {
    input: { type: 'string' }, matched: { type: 'boolean' }, paper_id: { type: ['string', 'null'] },
    doi: { type: ['string', 'null'] }, title: { type: ['string', 'null'] }, year: { type: ['integer', 'null'] },
    verdict: { enum: ['CONTESTED', 'SUPPORTED', 'INSUFFICIENT_EVIDENCE'] }, confidence: { type: 'number' },
    confidence_basis: { enum: ['retraction_evidence', 'coverage'] },
    retracted_roots: { type: 'array', items: { type: 'object', properties: {
      paper_id: { type: 'string' }, doi: { type: ['string', 'null'] }, title: { type: ['string', 'null'] },
      year: { type: ['integer', 'null'] }, depth: { type: 'integer' }, status: { type: 'array', items: {
        type: 'object', properties: { source: { type: 'string' }, tier: { type: 'string' }, is_retracted: { type: 'boolean' }, retraction_date: { type: ['string', 'null'] }, uri: { type: 'string' } },
        required: ['source', 'tier', 'is_retracted', 'retraction_date', 'uri'], additionalProperties: false,
      } }, weight: { type: 'number' }, agreement: { type: 'string' }, dependence_acknowledged: { type: 'boolean' },
    }, required: ['paper_id', 'doi', 'title', 'year', 'depth', 'status', 'weight', 'agreement'], additionalProperties: true } },
    conflict_flags: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, paper_id: { type: 'string' }, detail: { type: 'string' } }, required: ['code', 'paper_id', 'detail'], additionalProperties: false } },
    coverage: { type: 'object', properties: { references: { type: 'integer' }, resolved: { type: 'integer' }, ratio: { type: 'number' }, indexed: { type: 'boolean' } }, required: ['references', 'resolved', 'ratio', 'indexed'], additionalProperties: false },
    abstention_reason: { type: ['string', 'null'] },
  };
  const itemRequired = ['input', 'matched', 'paper_id', 'doi', 'title', 'year', 'verdict', 'confidence', 'confidence_basis', 'retracted_roots', 'conflict_flags', 'coverage', 'abstention_reason'];
  return {
    info: {
      input: { type: 'http', method: 'POST', bodyType: 'json', body: {
        ...(includeDatasetId ? { dataset_id: dataset.id } : {}),
        references: ['10.1016/S0140-6736(97)11096-0', 'Wakefield AJ, et al. Ileal-lymphoid-nodular hyperplasia... Lancet. 1998;351:637-41. doi:10.1016/S0140-6736(97)11096-0'],
      } },
      output: { type: 'json', example: {
        dataset: { id: dataset.id, tool: dataset.tool },
        judgment: {
          snapshot: { id: 'ri-20261025-1526', built_at: '2026-10-25T00:00:00.000Z' },
          items: [{ input: '10.1016/S0140-6736(97)11096-0', matched: true, paper_id: 'W123', doi: '10.1016/S0140-6736(97)11096-0',
            title: 'Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children', year: 1998,
            verdict: 'CONTESTED', confidence: 0.96, confidence_basis: 'retraction_evidence', retracted_roots: [{
              paper_id: 'W123', doi: '10.1016/S0140-6736(97)11096-0', title: 'Retracted paper', year: 1998, depth: 0,
              status: [status], weight: 1, agreement: 'strong', dependence_acknowledged: false,
            }], conflict_flags: [], coverage, abstention_reason: null }],
          summary: { requested: 2, matched: 2, unmatched: [], retracted_root_count: 1 },
        },
        usage: { judge_ms: 87 },
        payment: { payment_id: '<uuid>', request_id: '<uuid>', scheme: 'exact', network: 'eip155:84532', asset: '0xasset', amount: dataset.pricing.per_call.atomic,
          payer: '0x0000000000000000000000000000000000000001', transaction: '0xtransaction', settled_at: '2026-10-25T00:00:00.000Z' },
      } },
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
      properties: {
        input: { type: 'object', properties: {
          type: { const: 'http' }, method: { const: 'POST' }, bodyType: { const: 'json' },
          body: { type: 'object', properties: {
            ...(includeDatasetId ? { dataset_id: { type: 'string', minLength: 1 } } : {}), references: { type: 'array', minItems: 1, maxItems: dataset.maxItems,
              items: { type: 'string', minLength: 1, maxLength: 500 } },
          }, required: includeDatasetId ? ['dataset_id', 'references'] : ['references'], additionalProperties: false },
        }, required: ['type', 'method', 'bodyType', 'body'], additionalProperties: false },
        output: {
          type: 'object',
          properties: {
            type: { const: 'json' },
            example: {
              type: 'object',
              properties: {
                dataset: { type: 'object', properties: { id: { type: 'string' }, tool: { const: 'reference_batch' } }, required: ['id', 'tool'], additionalProperties: false },
                judgment: { type: 'object', properties: {
                  snapshot: { type: 'object', properties: { id: { type: 'string' }, built_at: { type: 'string' } }, required: ['id', 'built_at'] },
                  items: { type: 'array', items: { type: 'object', properties: itemProperties, required: itemRequired, additionalProperties: false } },
                  summary: { type: 'object', properties: {
                    requested: { type: 'integer' }, matched: { type: 'integer' }, unmatched: { type: 'array', items: { type: 'string' } },
                    retracted_root_count: { type: 'integer' },
                  }, required: ['requested', 'matched', 'unmatched', 'retracted_root_count'], additionalProperties: false },
                }, required: ['snapshot', 'items', 'summary'], additionalProperties: false },
                usage: { type: 'object', properties: { judge_ms: { type: 'number' } }, required: ['judge_ms'] },
                payment: { type: 'object', properties: {
                  payment_id: { type: 'string' }, request_id: { type: 'string' }, scheme: { type: 'string' }, network: { type: 'string' },
                  asset: { type: 'string' }, amount: { type: 'string' }, payer: { type: 'string' }, transaction: { type: 'string' }, settled_at: { type: 'string' },
                }, required: ['payment_id', 'request_id', 'scheme', 'network', 'asset', 'amount', 'payer', 'transaction', 'settled_at'], additionalProperties: false },
              },
              required: ['dataset', 'judgment', 'usage', 'payment'], additionalProperties: false,
            },
          },
          required: ['type', 'example'], additionalProperties: false,
        },
      },
      required: ['input', 'output'], additionalProperties: false,
    },
  };
};

export const dependencyScanBazaarDeclaration = (dataset: JudgmentDataset) => {
  const advisoryProperties = {
    id: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' },
    severity_label: { enum: ['critical', 'high', 'medium', 'low', 'unknown'] }, fixed_versions: { type: 'array', items: { type: 'string' } },
    published: { type: ['string', 'null'] }, modified: { type: ['string', 'null'] }, source_uri: { type: 'string', format: 'uri' }, tier: { const: 'A' },
  };
  const example = {
    dataset: { id: dataset.id, tool: dataset.tool },
    judgment: {
      source: 'OSV', queried_at: '2026-11-05T00:00:00.000Z',
      items: [{ input: 'lodash@4.17.20', name: 'lodash', version: '4.17.20', ecosystem: 'npm', existence: 'confirmed', affected: true,
        advisories: [{ id: 'GHSA-35jh-r3h4-6jhm', aliases: ['CVE-2021-23337'], summary: 'Command injection vulnerability.',
          severity_label: 'high', fixed_versions: ['4.17.21'], published: '2021-02-15T00:00:00Z', modified: '2022-01-01T00:00:00Z',
          source_uri: 'https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm', tier: 'A' }], note: null, abstention_reason: null }],
      summary: { requested: 1, checked: 1, affected_packages: 1, advisory_count: 1, not_found_packages: 0, unchecked_packages: 0 },
    },
    usage: { judge_ms: 87 },
    payment: { payment_id: '<uuid>', request_id: '<uuid>', scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: dataset.pricing.per_call.atomic,
      payer: '0x0000000000000000000000000000000000000001', transaction: '0xtransaction', settled_at: '2026-11-05T00:00:00.000Z' },
  };
  return {
    info: {
      input: { type: 'http', method: 'POST', bodyType: 'json', body: { packages: ['lodash@4.17.20', { name: 'next', version: '14.0.0' }] } },
      output: { type: 'json', example },
    },
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
      properties: {
        input: { type: 'object', properties: {
          type: { const: 'http' }, method: { const: 'POST' }, bodyType: { const: 'json' },
          body: { type: 'object', properties: { packages: { type: 'array', minItems: 1, maxItems: dataset.maxItems,
            items: { oneOf: [
              { type: 'string', minLength: 1 },
              { type: 'object', properties: { name: { type: 'string' }, version: { type: 'string' }, ecosystem: { type: 'string' } }, required: ['name', 'version'], additionalProperties: false },
            ] } }, ecosystem: { type: 'string' } }, required: ['packages'], additionalProperties: false },
        }, required: ['type', 'method', 'bodyType', 'body'], additionalProperties: false },
        output: { type: 'object', properties: {
          type: { const: 'json' }, example: { type: 'object', properties: {
            dataset: { type: 'object', properties: { id: { type: 'string' }, tool: { const: 'dependency_scan' } }, required: ['id', 'tool'], additionalProperties: false },
            judgment: { type: 'object', properties: {
            source: { const: 'OSV' }, queried_at: { type: 'string', format: 'date-time' },
            items: { type: 'array', items: { type: 'object', properties: {
              input: { type: 'string' }, name: { type: 'string' }, version: { type: 'string' }, ecosystem: { type: 'string' },
              existence: { enum: ['confirmed', 'not_found', 'unchecked'] }, affected: { type: 'boolean' }, advisories: { type: 'array', items: { type: 'object', properties: advisoryProperties,
                required: ['id', 'aliases', 'summary', 'severity_label', 'fixed_versions', 'published', 'modified', 'source_uri', 'tier'], additionalProperties: false } },
              note: { type: ['string', 'null'] },
              abstention_reason: { enum: ['package_not_found', null] },
            }, required: ['input', 'name', 'version', 'ecosystem', 'existence', 'affected', 'advisories', 'note', 'abstention_reason'], additionalProperties: false } },
            summary: { type: 'object', properties: { requested: { type: 'integer' }, checked: { type: 'integer' }, affected_packages: { type: 'integer' }, advisory_count: { type: 'integer' }, not_found_packages: { type: 'integer' }, unchecked_packages: { type: 'integer' } },
              required: ['requested', 'checked', 'affected_packages', 'advisory_count', 'not_found_packages', 'unchecked_packages'], additionalProperties: false },
            }, required: ['source', 'queried_at', 'items', 'summary'], additionalProperties: false },
            usage: { type: 'object', properties: { judge_ms: { type: 'number' } }, required: ['judge_ms'], additionalProperties: false },
            payment: { type: 'object', properties: { payment_id: { type: 'string' }, request_id: { type: 'string' }, scheme: { type: 'string' }, network: { type: 'string' }, asset: { type: 'string' }, amount: { type: 'string' }, payer: { type: 'string' }, transaction: { type: 'string' }, settled_at: { type: 'string', format: 'date-time' } }, required: ['payment_id', 'request_id', 'scheme', 'network', 'asset', 'amount', 'payer', 'transaction', 'settled_at'], additionalProperties: false },
          }, required: ['dataset', 'judgment', 'usage', 'payment'], additionalProperties: false } }, required: ['type', 'example'], additionalProperties: false },
      }, required: ['input', 'output'], additionalProperties: false,
    },
  };
};
