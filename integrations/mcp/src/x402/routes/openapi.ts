import { errorResponse, jsonResponse } from '../http.ts';

const datasetResponse = {
  type: 'object', properties: { datasets: { type: 'array', items: { oneOf: [
    { type: 'object', properties: {
      id: { type: 'string' }, workspace_id: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, synthetic: { type: 'boolean' },
      license: { type: 'object', properties: { spdx: { type: 'string' }, url: { type: 'string', format: 'uri' } }, required: ['spdx', 'url'] },
      tags: { type: 'array', items: { type: 'string' } },
      pricing: { type: 'object', properties: {
        local: { type: 'object', properties: { usd: { type: 'string' }, atomic: { type: 'string' } }, required: ['usd', 'atomic'] },
        global: { type: 'object', properties: { scheme: { type: 'string', enum: ['upto', 'exact'] }, upto: { type: 'object', properties: { usd: { type: 'string' }, atomic: { type: 'string' } }, required: ['usd', 'atomic'] }, base: { type: 'object', properties: { usd: { type: 'string' }, atomic: { type: 'string' } }, required: ['usd', 'atomic'] }, per_map_answer: { type: 'object', properties: { usd: { type: 'string' }, atomic: { type: 'string' } }, required: ['usd', 'atomic'] } }, required: ['scheme', 'upto', 'base', 'per_map_answer'] },
      }, required: ['local', 'global'] },
    }, required: ['id', 'workspace_id', 'title', 'description', 'synthetic', 'license', 'tags', 'pricing'] },
    { type: 'object', properties: {
        id: { type: 'string' }, product: { type: 'string', enum: ['judgment', 'advisory'] }, tool: { type: 'string', enum: ['retraction_propagation', 'evidence_audit', 'reference_batch', 'dependency_scan'] },
       title: { type: 'string' }, description: { type: 'string' }, synthetic: { type: 'boolean' },
       max_items: { type: 'integer', minimum: 1, maximum: 100 },
      license: { type: 'object', properties: { spdx: { type: 'string' }, url: { type: 'string', format: 'uri' } }, required: ['spdx', 'url'] },
      tags: { type: 'array', items: { type: 'string' } },
      pricing: { type: 'object', properties: { per_call: { type: 'object', properties: { usd: { type: 'string' }, atomic: { type: 'string' } }, required: ['usd', 'atomic'] } }, required: ['per_call'] },
    }, required: ['id', 'product', 'tool', 'title', 'description', 'synthetic', 'license', 'tags', 'pricing'] },
  ] } } }, required: ['datasets'],
} as const;

const paperStatusSchema = {
  type: 'object', properties: {
    paper: { type: ['object', 'null'], properties: { paper_id: { type: 'string' }, doi: { type: ['string', 'null'] }, title: { type: ['string', 'null'] }, year: { type: ['integer', 'null'] }, source_tier: { type: ['string', 'null'] } }, required: ['paper_id', 'doi', 'title', 'year', 'source_tier'] },
    statuses: { type: 'array', items: { type: 'object', properties: { source: { type: 'string', enum: ['openalex', 'crossref', 'retraction_watch'] }, tier: { type: 'string', enum: ['A', 'B', 'C'] }, status: { type: 'boolean' }, retraction_date: { type: ['string', 'null'] } }, required: ['source', 'tier', 'status', 'retraction_date'] } },
    abstention_reason: { type: 'string' },
  }, required: ['paper', 'statuses'],
} as const;

const judgmentResultSchema = {
  type: 'object', properties: {
    dataset: { type: 'object', properties: { id: { type: 'string' }, tool: { type: 'string' } }, required: ['id', 'tool'] },
    judgment: { type: 'object', properties: {
      snapshot: { type: 'object', properties: { id: { type: 'string' }, built_at: { type: 'string', format: 'date-time' } }, required: ['id', 'built_at'] },
      target: { type: 'object', properties: { paper_id: { type: 'string' }, doi: { type: ['string', 'null'] }, title: { type: ['string', 'null'] }, year: { type: ['integer', 'null'] }, source_tier: { type: ['string', 'null'] } }, required: ['paper_id', 'doi', 'title', 'year', 'source_tier'] },
      verdict: { type: 'string', enum: ['CONTESTED', 'SUPPORTED', 'INSUFFICIENT_EVIDENCE'] }, confidence: { type: 'number', minimum: 0, maximum: 1 }, confidence_basis: { type: 'string', enum: ['retraction_evidence', 'coverage'] },
      retracted_roots: { type: 'array', items: { type: 'object', properties: { paper_id: { type: 'string' }, doi: { type: ['string', 'null'] }, title: { type: ['string', 'null'] }, year: { type: ['integer', 'null'] }, depth: { type: 'integer' }, status: { type: 'array', items: { type: 'object', properties: { source: { type: 'string', enum: ['crossref', 'retraction_watch', 'openalex'] }, tier: { type: 'string', enum: ['A', 'B', 'C', 'D'] }, is_retracted: { type: 'boolean' }, retraction_date: { type: ['string', 'null'] }, uri: { type: 'string' } }, required: ['source', 'tier', 'is_retracted', 'retraction_date', 'uri'] } }, weight: { type: 'number' }, agreement: { type: 'string' }, dependence_acknowledged: { type: 'boolean' } }, required: ['paper_id', 'doi', 'title', 'year', 'depth', 'status', 'weight', 'agreement'] } },
      conflict_flags: { type: 'array', items: { type: 'object', properties: { code: { type: 'string' }, paper_id: { type: 'string' }, detail: { type: 'string' } }, required: ['code', 'paper_id', 'detail'] } },
      coverage: { type: 'object', properties: { references: { type: 'integer' }, resolved: { type: 'integer' }, ratio: { type: 'number' }, indexed: { type: 'boolean' } }, required: ['references', 'resolved', 'ratio', 'indexed'] },
      abstention_reason: { type: ['string', 'null'] }, dependence_acknowledged: { type: 'boolean' },
      evidence_path: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, depth: { type: 'integer' }, edge: { type: 'object', properties: { kind: { type: 'string', const: 'CITES' }, tier: { type: 'string', enum: ['A', 'B', 'C', 'D'] }, uri: { type: 'string' }, context_class: { type: ['string', 'null'] } }, required: ['kind', 'tier', 'uri', 'context_class'] } }, required: ['from', 'to', 'depth', 'edge'] } },
      tier_distribution: { type: 'object', properties: { A: { type: 'number' }, B: { type: 'number' }, C: { type: 'number' }, D: { type: 'number' } }, required: ['A', 'B', 'C', 'D'] }, explain: { type: 'string' },
    }, required: ['snapshot', 'target', 'verdict', 'confidence', 'confidence_basis', 'retracted_roots', 'conflict_flags', 'coverage', 'abstention_reason'] },
    usage: { type: 'object', properties: { judge_ms: { type: 'integer' } }, required: ['judge_ms'] },
    payment: { type: 'object', properties: { payment_id: { type: 'string' }, request_id: { type: 'string' }, scheme: { type: 'string' }, network: { type: 'string' }, asset: { type: 'string' }, amount: { type: 'string' }, payer: { type: 'string' }, transaction: { type: 'string' }, settled_at: { type: 'string', format: 'date-time' } }, required: ['payment_id', 'request_id', 'scheme', 'network', 'asset', 'amount', 'payer', 'transaction', 'settled_at'] },
  }, required: ['dataset', 'judgment', 'usage', 'payment'],
} as const;

const batchJudgmentItemSchema = {
  type: 'object', properties: {
    input: { type: 'string' }, matched: { type: 'boolean' }, paper_id: { type: ['string', 'null'] }, doi: { type: ['string', 'null'] },
    title: { type: ['string', 'null'] }, year: { type: ['integer', 'null'] }, verdict: { type: 'string', enum: ['CONTESTED', 'SUPPORTED', 'INSUFFICIENT_EVIDENCE'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 }, confidence_basis: { type: 'string', enum: ['retraction_evidence', 'coverage'] },
    retracted_roots: judgmentResultSchema.properties.judgment.properties.retracted_roots,
    conflict_flags: judgmentResultSchema.properties.judgment.properties.conflict_flags,
    coverage: judgmentResultSchema.properties.judgment.properties.coverage,
    abstention_reason: { type: ['string', 'null'] },
  }, required: ['input', 'matched', 'paper_id', 'doi', 'title', 'year', 'verdict', 'confidence', 'confidence_basis', 'retracted_roots', 'conflict_flags', 'coverage', 'abstention_reason'],
} as const;

const referenceBatchResultSchema = {
  type: 'object', properties: {
    dataset: { type: 'object', properties: { id: { type: 'string' }, tool: { type: 'string', const: 'reference_batch' } }, required: ['id', 'tool'] },
    judgment: { type: 'object', properties: {
      snapshot: { type: 'object', properties: { id: { type: 'string' }, built_at: { type: 'string', format: 'date-time' } }, required: ['id', 'built_at'] },
      items: { type: 'array', items: batchJudgmentItemSchema },
      summary: { type: 'object', properties: { requested: { type: 'integer' }, matched: { type: 'integer' }, unmatched: { type: 'array', items: { type: 'string' } }, retracted_root_count: { type: 'integer' } }, required: ['requested', 'matched', 'unmatched', 'retracted_root_count'] },
    }, required: ['snapshot', 'items', 'summary'] },
    usage: judgmentResultSchema.properties.usage,
    payment: judgmentResultSchema.properties.payment,
  }, required: ['dataset', 'judgment', 'usage', 'payment'],
} as const;

const queryResultSchema = {
  type: 'object', properties: {
    answer: { type: 'string' }, mode: { type: 'string', enum: ['local', 'global'] },
    dataset: { type: 'object', properties: { id: { type: 'string' }, version: { type: 'string' }, workspace_id: { type: 'string' } }, required: ['id', 'version', 'workspace_id'] },
    sources: { type: 'array', items: { type: 'object', properties: { source: { type: 'string' }, excerpt: { type: 'string' } }, required: ['source', 'excerpt'] } },
    usage: { type: 'object', properties: { query_ms: { type: 'number' }, map_answers: { type: 'integer' } }, required: ['query_ms', 'map_answers'] },
    payment: { type: 'object', properties: { payment_id: { type: 'string' }, request_id: { type: 'string' }, scheme: { type: 'string' }, network: { type: 'string' }, asset: { type: 'string' }, amount: { type: 'string' }, payer: { type: 'string' }, transaction: { type: 'string' }, settled_at: { type: 'string', format: 'date-time' } }, required: ['payment_id', 'request_id', 'scheme', 'network', 'asset', 'amount', 'payer', 'transaction', 'settled_at'] },
  }, required: ['answer', 'mode', 'dataset', 'sources', 'usage', 'payment'],
} as const;

const dependencyScanResultSchema = {
  type: 'object', properties: {
    source: { const: 'OSV' }, queried_at: { type: 'string', format: 'date-time' }, query_ms: { type: 'integer', minimum: 0 }, partial: { type: 'boolean' },
    items: { type: 'array', items: { type: 'object', properties: {
      input: { type: 'string' }, name: { type: 'string' }, version: { type: 'string' }, ecosystem: { type: 'string' },
      existence: { type: 'string', enum: ['confirmed', 'not_found', 'unchecked'] }, affected: { type: 'boolean' },
      advisories: { type: 'array', items: { type: 'object', properties: {
        id: { type: 'string' }, aliases: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' },
        severity_label: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'unknown'] },
        fixed_versions: { type: 'array', items: { type: 'string' } }, published: { type: ['string', 'null'] }, modified: { type: ['string', 'null'] },
        source_uri: { type: 'string', format: 'uri' }, tier: { type: 'string', const: 'A' },
      }, required: ['id', 'aliases', 'summary', 'severity_label', 'fixed_versions', 'published', 'modified', 'source_uri', 'tier'], additionalProperties: false } },
      note: { type: ['string', 'null'] },
      abstention_reason: { type: ['string', 'null'], enum: ['package_not_found', 'budget_exceeded', null] },
    }, required: ['input', 'name', 'version', 'ecosystem', 'existence', 'affected', 'advisories', 'note', 'abstention_reason'], additionalProperties: false } },
    summary: { type: 'object', properties: {
      requested: { type: 'integer' }, checked: { type: 'integer' }, affected_packages: { type: 'integer' }, advisory_count: { type: 'integer' }, not_found_packages: { type: 'integer' }, unchecked_packages: { type: 'integer' }, budget_exceeded_packages: { type: 'integer' },
    }, required: ['requested', 'checked', 'affected_packages', 'advisory_count', 'not_found_packages', 'unchecked_packages', 'budget_exceeded_packages'], additionalProperties: false },
  }, required: ['source', 'queried_at', 'query_ms', 'partial', 'items', 'summary'], additionalProperties: false,
} as const;

const dependencyScanOperation = (limit: 20 | 100, price: '0.02' | '0.10', datasetId: 'dependency-scan-20' | 'dependency-scan-100') => ({
  post: {
    summary: `Scan up to ${limit} package versions for vulnerabilities`,
    description: `Pay $${price} with USDC on Base or Arbitrum to query OSV for up to ${limit} package versions in one call.`,
    'x-price-usdc': price,
    'x-networks': ['eip155:8453', 'eip155:42161'],
    requestBody: { required: true, content: { 'application/json': {
      schema: { type: 'object', properties: {
        packages: { type: 'array', minItems: 1, maxItems: limit, items: { oneOf: [
          { type: 'string', minLength: 1 },
          { type: 'object', properties: { name: { type: 'string', minLength: 1 }, version: { type: 'string', minLength: 1 }, ecosystem: { type: 'string', minLength: 1 } }, required: ['name', 'version'], additionalProperties: false },
        ] } }, ecosystem: { type: 'string' },
      }, required: ['packages'], additionalProperties: false },
      example: { packages: ['lodash@4.17.20', { name: 'next', version: '14.0.0' }] },
    } } },
    responses: {
      '200': { description: 'Settled OSV advisory scan result.', content: { 'application/json': { schema: {
        type: 'object', properties: {
          dataset: { type: 'object', properties: { id: { type: 'string' }, tool: { const: 'dependency_scan' } }, required: ['id', 'tool'] },
          judgment: dependencyScanResultSchema,
          usage: { type: 'object', properties: { judge_ms: { type: 'number' } }, required: ['judge_ms'] },
          payment: judgmentResultSchema.properties.payment,
        }, required: ['dataset', 'judgment', 'usage', 'payment'], additionalProperties: false,
      }, example: {
        dataset: { id: datasetId, tool: 'dependency_scan' },
        judgment: { source: 'OSV', queried_at: '2026-11-05T00:00:00.000Z', query_ms: 812, partial: false, items: [{ input: 'lodash@4.17.20', name: 'lodash', version: '4.17.20', ecosystem: 'npm', existence: 'confirmed', affected: true,
          advisories: [{ id: 'GHSA-35jh-r3h4-6jhm', aliases: ['CVE-2021-23337'], summary: 'Command injection vulnerability.', severity_label: 'high', fixed_versions: ['4.17.21'], published: '2021-02-15T00:00:00Z', modified: '2022-01-01T00:00:00Z', source_uri: 'https://osv.dev/vulnerability/GHSA-35jh-r3h4-6jhm', tier: 'A' }], note: null, abstention_reason: null }],
          summary: { requested: 1, checked: 1, affected_packages: 1, advisory_count: 1, not_found_packages: 0, unchecked_packages: 0, budget_exceeded_packages: 0 } },
        usage: { judge_ms: 87 }, payment: { payment_id: 'payment-id', request_id: 'request-id', scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: price === '0.02' ? '20000' : '100000', payer: '0x0000000000000000000000000000000000000001', transaction: '0xtransaction', settled_at: '2026-01-01T00:00:00.000Z' },
      } } } },
      '402': { description: 'Payment required.', headers: { 'PAYMENT-REQUIRED': { description: 'x402 payment requirements for this fixed dependency scan SKU.', schema: { type: 'string' } } } },
      '503': { description: 'OSV advisory source unavailable; no scan result is returned.' },
    },
  },
});

const batchJudgeOperation = (limit: 10 | 50, datasetId: 'reference-audit-10' | 'reference-audit-50', price: '0.50' | '2.00', amount: '500000' | '2000000') => ({
  post: {
    summary: `Audit up to ${limit} references`,
    description: `Pay $${price} with USDC on Base or Arbitrum to audit up to ${limit} references in one call. The dataset is fixed by this URL; do not include dataset_id.`,
    'x-price-usdc': price,
    'x-networks': ['eip155:8453', 'eip155:42161'],
    requestBody: { required: true, content: { 'application/json': {
      schema: { type: 'object', properties: { references: { type: 'array', minItems: 1, maxItems: limit, items: { type: 'string', minLength: 1, maxLength: 500 } } }, required: ['references'], additionalProperties: false },
      example: { references: ['10.1016/S0140-6736(97)11096-0', 'Wakefield AJ et al. Lancet. 1998;351:637-41.'] },
    } } },
    responses: {
      '200': { description: 'Settled reference audit results.', content: { 'application/json': { schema: referenceBatchResultSchema, example: {
        dataset: { id: datasetId, tool: 'reference_batch' }, judgment: {
          snapshot: { id: 'ri-20261025-1526', built_at: '2026-10-25T00:00:00.000Z' }, items: [{
            input: '10.1016/S0140-6736(97)11096-0', matched: true, paper_id: 'W123', doi: '10.1016/S0140-6736(97)11096-0',
            title: 'Example paper', year: 1998, verdict: 'CONTESTED', confidence: 0.96, confidence_basis: 'retraction_evidence',
            retracted_roots: [], conflict_flags: [], coverage: { references: 42, resolved: 38, ratio: 0.905, indexed: true }, abstention_reason: null,
          }],
          summary: { requested: 2, matched: 1, unmatched: ['Wakefield et al.'], retracted_root_count: 1 },
        }, usage: { judge_ms: 87 }, payment: { payment_id: 'payment-id', request_id: 'request-id', scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount, payer: '0x0000000000000000000000000000000000000001', transaction: '0xtransaction', settled_at: '2026-01-01T00:00:00.000Z' },
      } } } },
      '402': { description: 'Payment required.', headers: { 'PAYMENT-REQUIRED': { description: 'x402 payment requirements for this fixed batch SKU.', schema: { type: 'string' } } } },
    },
  },
});

const document = {
  openapi: '3.1.0',
  servers: [{ url: 'https://pay.ashesborn.cloud', description: 'production' }],
  info: { title: 'Ashesborn public API', version: '1.0.0', description: 'Free retraction status lookups and x402-paid evidence checks. GraphRAG query datasets are synthetic and provided for testing only.' },
  paths: {
    '/api/v1/datasets': { get: {
      summary: 'List available datasets', description: 'List public graph and evidence-check datasets with pricing and license metadata.',
      responses: { '200': { description: 'Public dataset catalogue.', content: { 'application/json': { schema: datasetResponse, example: { datasets: [
        { id: 'retraction-propagation', product: 'judgment', tool: 'retraction_propagation', title: 'Retraction propagation', description: 'Retraction evidence check.', synthetic: false, license: { spdx: 'CC0-1.0', url: 'https://ashesborn.cloud/datasets/' }, tags: ['integrity'], pricing: { per_call: { usd: '$0.02', atomic: '20000' } } },
        { id: 'reference-audit-10', product: 'judgment', tool: 'reference_batch', max_items: 10, title: 'Reference list audit - 10 references', description: 'Audit up to 10 references in one call.', synthetic: false, license: { spdx: 'CC0-1.0', url: 'https://ashesborn.cloud/datasets/' }, tags: ['integrity', 'citations'], pricing: { per_call: { usd: '$0.50', atomic: '500000' } } },
      ] } } } } },
    } },
    '/api/v1/telemetry': { get: {
      summary: 'Public aggregate telemetry', description: 'Aggregate corpus, settlements, and public-tier call telemetry.',
      responses: { '200': { description: 'Public telemetry document.', content: { 'application/json': { schema: { type: 'object', properties: { generated_at: { type: 'string', format: 'date-time' }, corpus: { type: ['object', 'null'], additionalProperties: true }, payments: { type: 'object', additionalProperties: true }, public_calls: { type: 'object', additionalProperties: true }, verify: { type: 'object', additionalProperties: true } }, required: ['generated_at', 'corpus', 'payments', 'public_calls', 'verify'] }, example: { generated_at: '2026-01-01T00:00:00.000Z', corpus: null, payments: { mainnet: { settlements: 0, volume_usdc: '0.00', networks: [] }, testnet: { settlements: 0, volume_usdc: '0.00', networks: [] }, unclassified: [], recent_mainnet: [] }, public_calls: { window_days: 30, calls: 0, callers: 0, p95_latency_ms: null }, verify: { datasets: 'https://pay.ashesborn.cloud/api/v1/datasets', openapi: 'https://pay.ashesborn.cloud/api/v1/openapi.json', note: 'Aggregate counters.' } } } } }, '503': { description: 'Telemetry temporarily unavailable.' } },
    } },
    '/api/v1/judge/paper': { get: {
      summary: 'Get paper status by DOI or paper ID', description: 'Free DOI/paper lookup: OpenAlex and Retraction Watch; Crossref only when an update-to notice exists.',
      parameters: [
        { name: 'doi', in: 'query', required: false, schema: { type: 'string' }, example: '10.1016/S0140-6736(97)11096-0' },
        { name: 'paper_id', in: 'query', required: false, schema: { type: 'string' }, example: 'W123' },
      ],
      responses: { '200': { description: 'Paper and source status records.', content: { 'application/json': { schema: paperStatusSchema, example: { paper: { paper_id: 'W123', doi: '10.1016/S0140-6736(97)11096-0', title: 'Example paper', year: 1997, source_tier: 'C' }, statuses: [{ source: 'openalex', tier: 'C', status: false, retraction_date: null }, { source: 'crossref', tier: 'A', status: true, retraction_date: '2000-01-01' }, { source: 'retraction_watch', tier: 'A', status: true, retraction_date: '2000-01-01' }] } } } }, '400': { description: 'An identifier is required.' } },
    } },
    '/api/v1/deps/check': { get: {
      summary: 'Free OSV advisory lookup for one package version',
      parameters: [
        { name: 'name', in: 'query', required: true, schema: { type: 'string' }, example: 'lodash' },
        { name: 'version', in: 'query', required: true, schema: { type: 'string' }, example: '4.17.20' },
        { name: 'ecosystem', in: 'query', required: false, schema: { type: 'string', default: 'npm' } },
      ],
      responses: { '200': { description: 'OSV advisory scan for one package.', content: { 'application/json': { schema: dependencyScanResultSchema } } }, '400': { description: 'Package name and version are required.' }, '503': { description: 'OSV advisory source unavailable.' } },
    } },
    '/api/v1/judge': { post: {
      summary: 'Purchase a retraction evidence check', description: 'Pay with USDC on Base or Arbitrum for a retraction propagation evidence check or a full evidence audit. For batch reference audits use /api/v1/judge/batch-10 ($0.50) or /api/v1/judge/batch-50 ($2.00).',
      'x-price-usdc': { 'retraction-propagation': '0.02', 'retraction-evidence-audit': '0.10' }, 'x-networks': ['eip155:8453', 'eip155:42161'],
      requestBody: { required: true, content: { 'application/json': {
        schema: { oneOf: [
           { type: 'object', properties: { dataset_id: { type: 'string', minLength: 1 }, doi: { type: 'string', minLength: 1, maxLength: 300 } }, required: ['dataset_id', 'doi'], additionalProperties: false, example: { dataset_id: 'retraction-propagation', doi: '10.1016/S0140-6736(97)11096-0' } },
           { type: 'object', properties: { dataset_id: { type: 'string', minLength: 1 }, paper_id: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9]*$' } }, required: ['dataset_id', 'paper_id'], additionalProperties: false, example: { dataset_id: 'retraction-evidence-audit', paper_id: 'W123' } },
           { type: 'object', properties: { dataset_id: { type: 'string', minLength: 1 }, references: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'string', minLength: 1, maxLength: 500 } } }, required: ['dataset_id', 'references'], additionalProperties: false, example: { dataset_id: 'reference-audit-10', references: ['10.1016/S0140-6736(97)11096-0', 'Wakefield AJ, et al. Ileal-lymphoid-nodular hyperplasia in children. Lancet. 1998;351:637-41. doi:10.1016/S0140-6736(97)11096-0'] } },
         ] },
      } } },
      responses: {
        '200': { description: 'Settled evidence-check result.', content: { 'application/json': {
           schema: { oneOf: [judgmentResultSchema, referenceBatchResultSchema] },
           examples: {
             single: { value: { dataset: { id: 'retraction-propagation', tool: 'retraction_propagation' }, judgment: { verdict: 'SUPPORTED', confidence: 0.9 }, usage: { judge_ms: 42 }, payment: { payment_id: 'payment-id', request_id: 'request-id', scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '20000', payer: '0x0000000000000000000000000000000000000001', transaction: '0xtransaction', settled_at: '2026-01-01T00:00:00.000Z' } } },
             batch: { value: { dataset: { id: 'reference-audit-10', tool: 'reference_batch' }, judgment: { snapshot: { id: 'ri-20261025-1526', built_at: '2026-10-25T00:00:00.000Z' }, items: [{ input: '10.1016/S0140-6736(97)11096-0', matched: true, paper_id: 'W123', doi: '10.1016/S0140-6736(97)11096-0', title: 'Ileal-lymphoid-nodular hyperplasia, non-specific colitis, and pervasive developmental disorder in children', year: 1998, verdict: 'CONTESTED', confidence: 0.96, confidence_basis: 'retraction_evidence', retracted_roots: [{ paper_id: 'W123', doi: '10.1016/S0140-6736(97)11096-0', title: 'Retracted paper', year: 1998, depth: 0, status: [{ source: 'retraction_watch', tier: 'A', is_retracted: true, retraction_date: '2010-02-02', uri: 'https://retractionwatch.com/example' }], weight: 1, agreement: 'strong' }], conflict_flags: [], coverage: { references: 42, resolved: 38, ratio: 0.905, indexed: true }, abstention_reason: null }], summary: { requested: 2, matched: 1, unmatched: ['Wakefield et al.'], retracted_root_count: 1 } }, usage: { judge_ms: 87 }, payment: { payment_id: 'payment-id', request_id: 'request-id', scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '500000', payer: '0x0000000000000000000000000000000000000001', transaction: '0xtransaction', settled_at: '2026-01-01T00:00:00.000Z' } } },
           },
        } } },
        '402': { description: 'Payment required.', headers: { 'PAYMENT-REQUIRED': { description: 'x402 payment requirements to authorize the evidence check.', schema: { type: 'string' } } } },
      },
    } },
    '/api/v1/judge/batch-10': batchJudgeOperation(10, 'reference-audit-10', '0.50', '500000'),
    '/api/v1/judge/batch-50': batchJudgeOperation(50, 'reference-audit-50', '2.00', '2000000'),
    '/api/v1/deps/scan-20': dependencyScanOperation(20, '0.02', 'dependency-scan-20'),
    '/api/v1/deps/scan-100': dependencyScanOperation(100, '0.10', 'dependency-scan-100'),
    '/api/v1/query': { post: {
      summary: 'Purchase a GraphRAG query', description: 'Paid GraphRAG query over a SYNTHETIC smart-contract sample corpus (fiction, for testing only). For real retraction evidence checks use /api/v1/judge.',
      'x-price-usdc': { local: '0.02', global: 'upto 0.10' }, 'x-networks': ['eip155:8453', 'eip155:42161'],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', properties: { dataset_id: { type: 'string', minLength: 1 }, query: { type: 'string', minLength: 1, maxLength: 4000 }, mode: { type: 'string', enum: ['local', 'global'], default: 'local' }, max_results: { type: 'integer', minimum: 1, maximum: 20, default: 5 } }, required: ['dataset_id', 'query'], additionalProperties: false }, example: { dataset_id: 'synthetic-contracts', query: 'Summarize the sample contract.' } } } },
      responses: { '200': { description: 'GraphRAG query result.', content: { 'application/json': { schema: queryResultSchema, example: { answer: 'Synthetic example answer.', mode: 'local', dataset: { id: 'web3-security', version: 'sample-version', workspace_id: 'sample' }, sources: [{ source: 'contract.md', excerpt: 'Synthetic evidence excerpt.' }], usage: { query_ms: 12, map_answers: 0 }, payment: { payment_id: 'payment-id', request_id: 'request-id', scheme: 'exact', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', amount: '20000', payer: '0x0000000000000000000000000000000000000001', transaction: '0xtransaction', settled_at: '2026-01-01T00:00:00.000Z' } } } } }, '402': { description: 'Payment required.', headers: { 'PAYMENT-REQUIRED': { description: 'x402 payment requirements.', schema: { type: 'string' } } } } },
    } },
    '/.well-known/x402': { get: {
      summary: 'Get x402 resource-server metadata', description: 'Discover paid and free API resources.',
      responses: { '200': { description: 'x402 metadata.', content: { 'application/json': { schema: { type: 'object', properties: { x402Version: { type: 'integer' }, kind: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, resources: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, method: { type: 'string' }, description: { type: 'string' }, free: { type: 'boolean' } }, required: ['url', 'method', 'description'] } }, docs: { type: 'string' }, attestation: { type: 'object' } }, required: ['x402Version', 'kind', 'name', 'description', 'resources', 'docs', 'attestation'] }, example: { x402Version: 2, kind: 'resource-server', name: 'graphrag-ts', description: 'Paid GraphRAG queries over curated datasets.', resources: [{ url: 'https://pay.ashesborn.cloud/api/v1/judge/paper?doi={DOI}', method: 'GET', description: 'Free retraction status for a DOI.', free: true }], docs: 'https://github.com/sadofriod/graphrag-ts', attestation: { type: 'none' } } } } } },
    } },
  },
} as const;

export const handleOpenApi = (request: Request): Response | undefined => {
  if (new URL(request.url).pathname !== '/api/v1/openapi.json') return undefined;
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed.');
  return jsonResponse(200, document, { 'cache-control': 'public, max-age=60' });
};
