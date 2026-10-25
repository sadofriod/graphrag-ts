import { TIER_WEIGHT, type ContextClass, type ConflictFlag, type RetractionRecord, type SourceTier } from './types.ts';

export const tierWeight = (tier: SourceTier): number => TIER_WEIGHT[tier];

export const agreementLabel = (tiers: readonly SourceTier[]): string =>
  [...tiers].sort((left, right) => left.localeCompare(right)).join('+');

export const evidenceWeight = (records: readonly RetractionRecord[]): number => {
  const asserting = records.filter((record) => record.is_retracted);
  const official = asserting.filter((record) => record.source_tier === 'A').map((record) => tierWeight(record.source_tier));
  const other = asserting.filter((record) => record.source_tier !== 'A').map((record) => tierWeight(record.source_tier));
  return Math.min(1, Math.max(0, ...official) + Math.max(0, ...other));
};

export const contextFactor = (context: ContextClass | null | undefined): number =>
  context === 'acknowledges_retraction' || context === 'critical' ? 1 : 0;

export const detectConflicts = (
  records: readonly RetractionRecord[],
  options: { readonly openAlexFlag?: boolean; readonly contexts?: readonly (ContextClass | null)[] } = {},
): readonly ConflictFlag[] => {
  const paperId = records[0]?.paper_id ?? '';
  const flags: ConflictFlag[] = [];
  if (hasTierAStatusConflict(records)) {
    flags.push({ code: 'SOURCE_STATUS_CONFLICT', paper_id: paperId, detail: 'Tier-A sources disagree on retraction status.' });
  }
  if (hasOfficialRetraction(records) && options.openAlexFlag === false) {
    flags.push({ code: 'AGGREGATOR_FALSE_NEGATIVE', paper_id: paperId, detail: 'Official retraction evidence conflicts with the OpenAlex false flag.' });
  }
  const asserting = records.filter((record) => record.is_retracted);
  if (isAggregatorOnly(asserting)) {
    flags.push({ code: 'AGGREGATOR_ONLY_EVIDENCE', paper_id: paperId, detail: 'Retraction is asserted only by tier-C aggregator evidence.' });
  }
  if (hasAcknowledgment(options.contexts) && asserting.length === 0) {
    flags.push({ code: 'RETRACTION_ACKNOWLEDGED_NOT_PROPAGATED', paper_id: paperId, detail: 'A citation acknowledges retraction but no retraction status was propagated.' });
  }
  return flags;
};

const hasTierAStatusConflict = (records: readonly RetractionRecord[]): boolean => {
  const tierA = records.filter((record) => record.source_tier === 'A');
  return tierA.some((record) => record.is_retracted) && tierA.some((record) => !record.is_retracted);
};

const hasOfficialRetraction = (records: readonly RetractionRecord[]): boolean =>
  records.some((record) => (record.source_tier === 'A' || record.source === 'retraction_watch') && record.is_retracted);

const isAggregatorOnly = (asserting: readonly RetractionRecord[]): boolean =>
  asserting.length > 0 && asserting.every((record) => record.source_tier === 'C');

const acknowledgingContexts: readonly ContextClass[] = ['acknowledges_retraction', 'critical'];
const hasAcknowledgment = (contexts: readonly (ContextClass | null)[] | undefined): boolean =>
  contexts?.some((context) => context !== null && acknowledgingContexts.includes(context)) ?? false;
