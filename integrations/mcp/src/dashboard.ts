import { AccessError, assertWorkspaceAccess, meteredOperations, type AccessAccount } from './access.ts';
import type { IndexStore } from './store.ts';
import { workspaceIdSchema } from './workspace.ts';

export const httpError = (status: number, message: string): Response =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const jsonResponse = (value: unknown): Response => new Response(JSON.stringify(value), {
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const usageResponse = async (store: IndexStore, account: AccessAccount): Promise<Response> => {
  const { period, usage } = await store.getUsage(account.id);
  return jsonResponse({
    account_id: account.id,
    plan: account.plan,
    expires_at: account.expires_at,
    period,
    unit: 'admitted_tool_attempt',
    usage: meteredOperations.map((operation) => {
      const used = usage.find((record) => record.operation === operation)?.units ?? 0;
      const limit = account.monthly_limits[operation];
      return { operation, used, limit, remaining: Math.max(0, limit - used) };
    }),
  });
};

const workspaceResource = async (
  store: IndexStore,
  workspaceId: string,
  pathParts: readonly string[],
): Promise<Response> => {
  const resource = pathParts[3];
  if (resource === 'graph' && pathParts.length === 4) {
    return jsonResponse(await store.getGraphSnapshot(workspaceId));
  }
  if (resource === 'jobs' && pathParts.length === 4) {
    return jsonResponse({ jobs: await store.listJobs(workspaceId) });
  }
  if (resource === 'jobs' && pathParts.length === 6 && pathParts[5] === 'logs') {
    const jobId = pathParts[4] ?? '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) {
      return httpError(400, 'Invalid job ID.');
    }
    return jsonResponse({ logs: await store.listJobLogs(workspaceId, jobId) });
  }
  if (resource === 'retrieval-logs' && pathParts.length === 4) {
    return jsonResponse({ logs: await store.listRetrievalLogs(workspaceId) });
  }
  return httpError(404, 'Not found.');
};

const workspaceList = async (store: IndexStore, account?: AccessAccount): Promise<Response> => {
  if (account && !account.operations.includes('read')) return httpError(403, 'Read access is not granted.');
  const workspaces = await store.listWorkspaces();
  return jsonResponse({
    workspaces: account ? workspaces.filter((workspace) => account.workspaces.includes(workspace)) : workspaces,
  });
};

export const dashboardResponse = async (
  request: Request,
  store: IndexStore,
  account?: AccessAccount,
): Promise<Response | undefined> => {
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/').filter(Boolean);
  if (url.pathname === '/api/usage' && account) {
    if (request.method !== 'GET') return httpError(405, 'Only GET is supported.');
    return usageResponse(store, account);
  }
  if (pathParts[0] !== 'api' || pathParts[1] !== 'workspaces') return undefined;
  if (request.method !== 'GET') return httpError(405, 'Only GET is supported.');
  try {
    if (pathParts.length === 2) {
      return workspaceList(store, account);
    }
    const workspace = workspaceIdSchema.safeParse(pathParts[2]);
    if (!workspace.success) return httpError(400, 'Invalid workspace ID.');
    if (account) assertWorkspaceAccess(account, workspace.data, 'read');
    return workspaceResource(store, workspace.data, pathParts);
  } catch (error) {
    if (error instanceof AccessError) return httpError(403, error.message);
    throw error;
  }
};
