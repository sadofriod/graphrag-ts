import { jsonResponse, errorResponse } from '../x402/http.ts';
import { handlePaidJudgment } from '../x402/judgmentFlow.ts';
import { parseJudgmentRequestBody, type JudgmentInput } from '../x402/payload.ts';
import type { PaidRouteDeps } from '../x402/routeTypes.ts';

export const handleIntegrityRoute = async (request: Request, deps: PaidRouteDeps): Promise<Response | undefined> => {
  const url = new URL(request.url);
  if (url.pathname === '/api/v1/judge/paper') return handlePaperStatus(request, url, deps);
  if (url.pathname !== '/api/v1/judge') return undefined;
  if (request.method !== 'POST') return errorResponse(405, 'Method not allowed.');
  const parsed = await parseJudgmentRequestBody(request);
  return parsed.input ? handlePaidJudgment(request, parsed.input, deps) : jsonResponse(400, {
    error: parsed.error ?? 'invalid_request_body',
    expected: { dataset_id: 'string, see GET /api/v1/datasets', target: 'exactly one of doi or paper_id' },
    docs: '/api/v1/openapi.json',
  });
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

export type IntegrityRouteInput = JudgmentInput;
