import { toPublicDataset, type DatasetRegistry } from '../datasets.ts';
import { errorResponse, jsonResponse } from '../http.ts';

export type PublicCatalogue = { readonly datasets: ReturnType<typeof toPublicDataset>[] };

const catalog = (registry: DatasetRegistry): PublicCatalogue => ({
  datasets: registry.datasets.map(toPublicDataset),
});

export const handleCatalogue = (request: Request, registry: DatasetRegistry): Response | undefined => {
  const path = new URL(request.url).pathname;
  if (path !== '/api/v1/datasets' && path !== '/api/v1/pricing') return undefined;
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed.');
  return jsonResponse(200, catalog(registry), { 'cache-control': 'public, max-age=60' });
};
