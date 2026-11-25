import { errorResponse } from '../http.ts';
import type { PaidRouteDeps } from '../routeTypes.ts';
import type { SnapshotRecord } from '../../integrity/types.ts';

export const SERVICE_VERSION = '0.1.25';
export const GRAPHRAG_TS_VERSION = '0.1.30';
// This host serves the graphrag-ts MCP server binary with x402 and integrity modules compiled in,
// so it is a subservice of the graphrag-ts release, not an independent product.
export const RELATIONSHIP = 'subservice';

const SERVICE_NAME = 'graphrag-ts-mcp-server';

export const handleVersion = async (request: Request, deps: PaidRouteDeps): Promise<Response | undefined> => {
  if (new URL(request.url).pathname !== '/version') return undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') return errorResponse(405, 'Method not allowed.');

  let snapshot: SnapshotRecord | undefined;
  try {
    snapshot = await deps.integrity.activeSnapshot();
  } catch {
    return errorResponse(503, 'Snapshot state unavailable.');
  }

  const body = {
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    graphrag_ts_version: GRAPHRAG_TS_VERSION,
    relationship: RELATIONSHIP,
    snapshot_id: snapshot?.id ?? null,
    snapshot: snapshot ? {
      built_at: new Date(snapshot.manifest.built_at).toISOString(),
      papers: snapshot.manifest.counts.papers,
      retractions: snapshot.manifest.counts.retractions,
      cites: snapshot.manifest.counts.cites,
    } : null,
    generated_at: new Date().toISOString(),
  };
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status: 200, headers: {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
  } });
};
