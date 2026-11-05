import { isJudgmentDataset, toPublicDataset, type DatasetRegistry } from '../datasets.ts';
import { errorResponse, jsonResponse, publicUrlForPath } from '../http.ts';
import { judgmentResourcePath } from './discovery.ts';
import type { X402Settings } from '../settings.ts';

export type PublicCatalogue = { readonly datasets: (ReturnType<typeof toPublicDataset> & { resource?: string })[] };

const catalog = (request: Request, registry: DatasetRegistry, settings: X402Settings, includeResources: boolean): PublicCatalogue => ({
  datasets: registry.datasets.map((dataset) => ({
    ...toPublicDataset(dataset),
    ...(includeResources && isJudgmentDataset(dataset) ? {
      resource: publicUrlForPath(request, judgmentResourcePath(dataset.id), settings.publicBaseUrl),
    } : {}),
  })),
});

export const handleCatalogue = (request: Request, registry: DatasetRegistry, settings: X402Settings): Response | undefined => {
  const path = new URL(request.url).pathname;
  if (path !== '/api/v1/datasets' && path !== '/api/v1/pricing') return undefined;
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed.');
  return jsonResponse(200, catalog(request, registry, settings, path === '/api/v1/datasets'), { 'cache-control': 'public, max-age=60' });
};
