export type IntegrityToolName =
  | 'integrity_paper_status'
  | 'retraction_propagation'
  | 'integrity_evidence_audit';

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const publicTierPayload = (tool: IntegrityToolName, payload: unknown): unknown => {
  if (!isPlainObject(payload)) return payload;
  const projected = { ...payload };

  if (tool === 'retraction_propagation') {
    const roots = projected.retracted_roots;
    delete projected.retracted_roots;
    return {
      ...projected,
      retracted_roots_omitted: true,
      retracted_roots_count: Array.isArray(roots) ? roots.length : 0,
      upgrade: {
        route: 'POST /api/v1/judge',
        dataset: 'retraction-propagation',
        price_usd: '0.02',
      },
    };
  }

  if (tool === 'integrity_evidence_audit') {
    const evidencePath = projected.evidence_path;
    delete projected.evidence_path;
    return {
      ...projected,
      evidence_path_omitted: true,
      evidence_path_count: Array.isArray(evidencePath) ? evidencePath.length : 0,
      upgrade: {
        route: 'POST /api/v1/judge',
        dataset: 'retraction-evidence-audit',
        price_usd: '0.10',
      },
    };
  }

  return projected;
};
