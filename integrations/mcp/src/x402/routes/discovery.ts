import { isJudgmentDataset, toPublicDataset } from '../datasets.ts';
import { bazaarDeclaration, dependencyScanBazaarDeclaration, judgmentBazaarDeclaration, referenceBatchBazaarDeclaration } from '../bazaar.ts';
import { errorResponse, jsonResponse, publicUrlForPath } from '../http.ts';
import { judgmentRequirements, requirementsForNetworks } from '../pricing.ts';
import type { PaidRouteDeps } from '../routeTypes.ts';
import type { X402Settings } from '../settings.ts';

export const handleDiscovery = (request: Request, deps: PaidRouteDeps): Response | undefined => {
  const path = new URL(request.url).pathname;
  if (path === '/.well-known/x402') return handleManifest(request, deps.settings);
  if (path !== '/api/v1/discovery') return undefined;
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed.');
  const items = deps.registry.datasets.map((dataset) => isJudgmentDataset(dataset) ? ({
    ...toPublicDataset(dataset), resource: publicUrlForPath(request, judgmentResourcePath(dataset.id), deps.settings.publicBaseUrl),
    type: 'http', x402Version: 2, accepts: judgmentRequirements(dataset, deps.settings),
    extensions: { bazaar: dataset.tool === 'reference_batch'
      ? referenceBatchBazaarDeclaration(dataset, false)
      : dataset.tool === 'dependency_scan' ? dependencyScanBazaarDeclaration(dataset) : judgmentBazaarDeclaration(dataset) },
  }) : ({
    ...toPublicDataset(dataset), resource: publicUrlForPath(request, '/api/v1/query', deps.settings.publicBaseUrl),
    type: 'http', x402Version: 2, accepts: requirementsForNetworks(dataset, 'local', deps.settings),
    extensions: { bazaar: bazaarDeclaration(dataset, 'local') },
  }));
  return jsonResponse(200, { x402Version: 2, items, pagination: { limit: 20, offset: 0, total: items.length } }, { 'cache-control': 'public, max-age=300' });
};

export const judgmentResourcePath = (datasetId: string): string => datasetId === 'reference-audit-10' ? '/api/v1/judge/batch-10'
  : datasetId === 'reference-audit-50' ? '/api/v1/judge/batch-50'
    : datasetId === 'dependency-scan-20' ? '/api/v1/deps/scan-20'
      : datasetId === 'dependency-scan-100' ? '/api/v1/deps/scan-100' : '/api/v1/judge';

export const handleManifest = (request: Request, settings: X402Settings): Response => {
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed.');
  return jsonResponse(200, {
    x402Version: 2,
    kind: 'resource-server',
    name: 'graphrag-ts',
    description: 'Paid GraphRAG queries over curated datasets.',
    resources: [{
      url: publicUrlForPath(request, '/api/v1/query', settings.publicBaseUrl),
      method: 'POST',
      description: 'Ask questions about a GraphRAG dataset.',
    }, {
      url: publicUrlForPath(request, '/api/v1/judge', settings.publicBaseUrl),
      method: 'POST', description: 'Assess academic retraction propagation and evidence.',
    }, {
      url: publicUrlForPath(request, '/api/v1/judge/batch-10', settings.publicBaseUrl),
      method: 'POST', description: 'Audit up to 10 references with per-item results.',
    }, {
      url: publicUrlForPath(request, '/api/v1/judge/batch-50', settings.publicBaseUrl),
      method: 'POST', description: 'Audit up to 50 references with per-item results.',
    }, {
      url: publicUrlForPath(request, '/api/v1/deps/scan-20', settings.publicBaseUrl),
      method: 'POST', description: 'Scan up to 20 package versions for OSV advisories.',
    }, {
      url: publicUrlForPath(request, '/api/v1/deps/scan-100', settings.publicBaseUrl),
      method: 'POST', description: 'Scan up to 100 package versions for OSV advisories.',
    }, {
      url: `${publicUrlForPath(request, '/api/v1/judge/paper', settings.publicBaseUrl)}?doi={DOI}`,
      method: 'GET', description: 'Free retraction status for a DOI: OpenAlex and Retraction Watch; Crossref only when an update-to notice exists.', free: true,
    }, {
      url: `${publicUrlForPath(request, '/api/v1/deps/check', settings.publicBaseUrl)}?name={NAME}&version={VERSION}&ecosystem={ECOSYSTEM}`,
      method: 'GET', description: 'Free OSV advisory lookup for one package version; ecosystem optional, default npm.', free: true,
    }],
    docs: 'https://github.com/sadofriod/graphrag-ts',
    attestation: { type: 'none' },
  }, { 'cache-control': 'public, max-age=300' });
};
