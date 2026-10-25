import { isJudgmentDataset, toPublicDataset } from '../datasets.ts';
import { bazaarDeclaration, judgmentBazaarDeclaration } from '../bazaar.ts';
import { requirementsFor } from '../challenge.ts';
import { errorResponse, jsonResponse, publicUrlForPath } from '../http.ts';
import { judgmentRequirements } from '../pricing.ts';
import type { PaidRouteDeps } from '../routeTypes.ts';
import type { X402Settings } from '../settings.ts';

export const handleDiscovery = (request: Request, deps: PaidRouteDeps): Response | undefined => {
  const path = new URL(request.url).pathname;
  if (path === '/.well-known/x402') return handleManifest(request, deps.settings);
  if (path !== '/api/v1/discovery') return undefined;
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed.');
  const items = deps.registry.datasets.map((dataset) => isJudgmentDataset(dataset) ? ({
    ...toPublicDataset(dataset), resource: publicUrlForPath(request, '/api/v1/judge', deps.settings.publicBaseUrl),
    type: 'http', x402Version: 2, accepts: [judgmentRequirements(dataset, deps.settings)],
    extensions: { bazaar: judgmentBazaarDeclaration(dataset) },
  }) : ({
    ...toPublicDataset(dataset), resource: publicUrlForPath(request, '/api/v1/query', deps.settings.publicBaseUrl),
    type: 'http', x402Version: 2, accepts: [requirementsFor(dataset, 'local', deps.settings)],
    extensions: { bazaar: bazaarDeclaration(dataset, 'local') },
  }));
  return jsonResponse(200, { x402Version: 2, items, pagination: { limit: 20, offset: 0, total: items.length } }, { 'cache-control': 'public, max-age=300' });
};

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
    }],
    docs: 'https://github.com/sadofriod/graphrag-ts',
    attestation: { type: 'none' },
  }, { 'cache-control': 'public, max-age=300' });
};
