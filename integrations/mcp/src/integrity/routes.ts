import { jsonResponse, errorResponse } from '../x402/http.ts';
import { handlePaidJudgment } from '../x402/judgmentFlow.ts';
import { parseFixedBatchJudgmentRequestBody, parseFixedDependencyScanRequestBody, parseJudgmentRequestBody, type JudgmentInput, type PaidJudgmentInput } from '../x402/payload.ts';
import { findDataset, isJudgmentDataset } from '../x402/datasets.ts';
import { judgmentRequirements } from '../x402/pricing.ts';
import { buildJudgmentChallenge } from '../x402/challenge.ts';
import type { PaidRouteDeps } from '../x402/routeTypes.ts';
import { runDependencyScan } from '../deps/scan.ts';
import { OsvUnavailableError } from '../deps/osv.ts';

export const handleIntegrityRoute = async (request: Request, deps: PaidRouteDeps): Promise<Response | undefined> => {
  const url = new URL(request.url);
  if (url.pathname === '/api/v1/judge/paper') return handlePaperStatus(request, url, deps);
  if (url.pathname === '/api/v1/deps/check') return handleFreeDependencyCheck(request, url, deps);
  const dependencyScanDatasetId = url.pathname === '/api/v1/deps/scan-20' ? 'dependency-scan-20'
    : url.pathname === '/api/v1/deps/scan-100' ? 'dependency-scan-100' : undefined;
  if (dependencyScanDatasetId) return handleFixedDependencyScanRoute(request, dependencyScanDatasetId, deps);
  const fixedBatchDatasetId = url.pathname === '/api/v1/judge/batch-10' ? 'reference-audit-10'
    : url.pathname === '/api/v1/judge/batch-50' ? 'reference-audit-50' : undefined;
  if (!fixedBatchDatasetId && url.pathname !== '/api/v1/judge') return undefined;
  if (request.method !== 'POST') return errorResponse(405, 'Method not allowed.');
  if (fixedBatchDatasetId) return handleFixedBatchRoute(request, fixedBatchDatasetId, deps);
  const parsed = await parseJudgmentRequestBody(request);
  if (parsed.input) {
    if ('packages' in parsed.input) {
      const dataset = findDataset(deps.registry, parsed.input.dataset_id);
      if (!dataset || !isJudgmentDataset(dataset) || dataset.tool !== 'dependency_scan') {
        return jsonResponse(400, { error: 'dataset_is_not_a_dependency_scan_sku' });
      }
      if (parsed.input.packages.length === 0) return jsonResponse(400, { error: 'packages_required' });
      if (parsed.input.packages.length > (dataset.maxItems ?? 0)) {
        return jsonResponse(400, { error: 'too_many_packages', limit: dataset.maxItems });
      }
    }
    if ('references' in parsed.input) {
      const dataset = findDataset(deps.registry, parsed.input.dataset_id);
      if (!dataset || !isJudgmentDataset(dataset) || dataset.tool !== 'reference_batch') {
        return jsonResponse(400, { error: 'dataset_is_not_a_batch_sku' });
      }
      if (parsed.input.references.length > (dataset.maxItems ?? 0)) {
        return jsonResponse(400, { error: 'too_many_references', limit: dataset.maxItems });
      }
    } else {
      const dataset = findDataset(deps.registry, parsed.input.dataset_id);
      if (dataset && isJudgmentDataset(dataset) && dataset.tool === 'reference_batch') {
        return jsonResponse(400, { error: 'batch_references_required' });
      }
    }
    return handlePaidJudgment(request, parsed.input, deps);
  }
  const datasets = deps.registry.datasets.filter(isJudgmentDataset);
  const dataset = datasets.find((item) => item.tool === 'retraction_propagation') ?? datasets[0];
  if (dataset) return buildJudgmentChallenge(request, dataset, judgmentRequirements(dataset, deps.settings), deps.settings,
    parsed.error ?? 'invalid_request_body');
  return jsonResponse(400, {
    error: parsed.error ?? 'invalid_request_body',
    expected: { dataset_id: 'string, see GET /api/v1/datasets', target: 'exactly one of doi or paper_id' },
    docs: '/api/v1/openapi.json',
  });
};

const handleFixedDependencyScanRoute = async (request: Request, datasetId: string, deps: PaidRouteDeps): Promise<Response> => {
  const dataset = findDataset(deps.registry, datasetId);
  if (!dataset || !isJudgmentDataset(dataset) || dataset.tool !== 'dependency_scan') return errorResponse(404, 'Not found.');
  if (request.method !== 'POST') return errorResponse(405, 'Method not allowed.');
  const parsed = await parseFixedDependencyScanRequestBody(request);
  if (!parsed.input) return buildJudgmentChallenge(request, dataset, judgmentRequirements(dataset, deps.settings), deps.settings, parsed.error ?? 'invalid_request_body');
  if (!parsed.input.packages.length) return jsonResponse(400, { error: 'packages_required' });
  if (parsed.input.packages.length > (dataset.maxItems ?? 0)) return jsonResponse(400, { error: 'too_many_packages', limit: dataset.maxItems });
  return handlePaidJudgment(request, { dataset_id: datasetId, ...parsed.input }, deps);
};

const handleFreeDependencyCheck = async (request: Request, url: URL, deps: PaidRouteDeps): Promise<Response> => {
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed.');
  const name = url.searchParams.get('name')?.trim();
  const version = url.searchParams.get('version')?.trim();
  const ecosystem = url.searchParams.get('ecosystem')?.trim() || 'npm';
  if (!name || !version) return jsonResponse(400, { error: 'name_and_version_required' });
  try {
    const result = await runDependencyScan(deps.advisories, [{ name, version, ecosystem }], 1, ecosystem);
    return jsonResponse(200, result);
  } catch (error) {
    if (error instanceof OsvUnavailableError) return errorResponse(503, 'advisory_source_unavailable');
    return errorResponse(502, 'dependency_scan_failed');
  }
};

const handleFixedBatchRoute = async (request: Request, datasetId: string, deps: PaidRouteDeps): Promise<Response> => {
  const dataset = findDataset(deps.registry, datasetId);
  if (!dataset || !isJudgmentDataset(dataset) || dataset.tool !== 'reference_batch') {
    return errorResponse(404, 'Not found.');
  }
  const parsed = await parseFixedBatchJudgmentRequestBody(request);
  if (!parsed.input) {
    return buildJudgmentChallenge(request, dataset, judgmentRequirements(dataset, deps.settings), deps.settings,
      parsed.error ?? 'invalid_request_body', true);
  }
  if (parsed.input.dataset_id !== undefined && parsed.input.dataset_id !== datasetId) {
    return jsonResponse(400, { error: 'dataset_id_mismatch', expected: datasetId });
  }
  if (parsed.input.references.length > (dataset.maxItems ?? 0)) {
    return jsonResponse(400, { error: 'too_many_references', limit: dataset.maxItems });
  }
  return handlePaidJudgment(request, { dataset_id: datasetId, references: parsed.input.references }, deps, true);
};

const handlePaperStatus = async (request: Request, url: URL, deps: PaidRouteDeps): Promise<Response> => {
  if (request.method !== 'GET') return errorResponse(405, 'Method not allowed.');
  const doi = url.searchParams.get('doi') ?? undefined;
  const paperId = url.searchParams.get('paper_id') ?? undefined;
  if (!doi && !paperId) return errorResponse(400, 'Provide doi or paper_id.');
  try {
    const status = await deps.judge.paperStatus({ ...(doi ? { doi } : {}), ...(paperId ? { paper_id: paperId } : {}) });
    return jsonResponse(200, status);
  } catch (error) {
    const noSnapshot = error instanceof Error && error.message.includes('No active integrity snapshot');
    return errorResponse(noSnapshot ? 503 : 502, noSnapshot ? 'NO_SNAPSHOT' : 'PAPER_STATUS_FAILED');
  }
};

export type IntegrityRouteInput = JudgmentInput | PaidJudgmentInput;
