import { estimateTokens } from './estimateTokens';

export interface ChildCommunitySummary {
  communityName: string;
  summaryContent: string;
}

const SUBCOMMUNITY_HEADER = '[Sub-community reports]';

export const buildHierarchySummaryContext = (
  elementContext: string,
  boundedElementContext: string,
  childSummaries: readonly ChildCommunitySummary[],
  maxTokens: number,
): string => {
  if (estimateTokens(elementContext) <= maxTokens || childSummaries.length === 0) {
    return estimateTokens(elementContext) <= maxTokens ? elementContext : boundedElementContext;
  }

  const selectedReports = [...childSummaries]
    .sort((left, right) =>
      estimateTokens(right.summaryContent) - estimateTokens(left.summaryContent)
    )
    .reduce(
      (selection, summary) => {
        const report = `- ${summary.communityName}: ${summary.summaryContent}`;
        const nextReports = [...selection.reports, report];
        const nextContext = `${SUBCOMMUNITY_HEADER}\n${nextReports.join('\n')}`;

        return estimateTokens(nextContext) <= maxTokens
          ? { reports: nextReports, context: nextContext }
          : selection;
      },
      { reports: [] as string[], context: '' },
    );

  return selectedReports.reports.length > 0
    ? selectedReports.context
    : boundedElementContext;
};