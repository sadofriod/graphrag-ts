import { estimateTokens } from './estimateTokens';

export interface CommunityContextInput {
  members: string[];
  entities: Array<{ name: string; description?: string }>;
  edges: Array<{ source: string; target: string; relationshipDesc: string }>;
  claims: Array<{ subject: string; object?: string; description: string }>;
}

export interface CommunityContextOptions {
  maxTokens: number;
}

const DEFAULT_MAX_TOKENS = 4000;

export const getCommunityContextMaxTokens = (): number => {
  const raw = process.env.RAG_COMMUNITY_CONTEXT_MAX_TOKENS;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_TOKENS;
};

const computeDegrees = (edges: readonly CommunityContextInput['edges'][number][]) => {
  const degree = new Map<string, number>();
  for (const { source, target } of edges) {
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  }
  return degree;
};

const buildCoreLines = (
  members: readonly string[],
  entityDescriptions: ReadonlyMap<string, string | undefined>,
): string[] => {
  const lines = [`【成员】${members.join('、')}`];
  const described = members
    .map((name) => {
      const description = entityDescriptions.get(name.trim());
      return description ? { name: name.trim(), description } : null;
    })
    .filter((entity) => entity !== null);

  if (described.length > 0) {
    lines.push('【节点摘要】');
    for (const entity of described) {
      lines.push(`- ${entity.name}: ${entity.description}`);
    }
  }
  return lines;
};

/**
 * 把社区真实内容组装成接地文本：四段结构【成员】【节点摘要】【关键关系】【事实声明】。
 * 边按两端点度之和降序，声明按其引用实体的最高度降序；超预算时按优先级截断低显著项。
 */
export const buildCommunityContext = (
  input: CommunityContextInput,
  opts: CommunityContextOptions,
): string => {
  const maxTokens = opts.maxTokens;
  const degree = computeDegrees(input.edges);
  const priorityOf = (name: string) => degree.get(name) ?? 0;
  const priorityOfClaim = (claim: CommunityContextInput['claims'][number]) =>
    Math.max(priorityOf(claim.subject), claim.object ? priorityOf(claim.object) : 0);

  const sortedEdges = [...input.edges].sort(
    (a, b) =>
      priorityOf(b.source) + priorityOf(b.target) - (priorityOf(a.source) + priorityOf(a.target)),
  );
  const sortedClaims = [...input.claims].sort(
    (a, b) => priorityOfClaim(b) - priorityOfClaim(a),
  );

  const entityDescriptions = new Map(
    input.entities.map((entity) => [entity.name.trim(), entity.description?.trim()]),
  );

  const kept = buildCoreLines(input.members, entityDescriptions);
  let used = kept.reduce((total, line) => total + estimateTokens(line), 0);

  const appendSection = (header: string, lines: string[]) => {
    if (estimateTokens(header) > maxTokens - used) {
      return;
    }
    kept.push(header);
    used += estimateTokens(header);
    for (const line of lines) {
      const lineTokens = estimateTokens(line);
      if (used + lineTokens > maxTokens) {
        return;
      }
      kept.push(line);
      used += lineTokens;
    }
  };

  if (sortedEdges.length > 0) {
    appendSection(
      '【关键关系】',
      sortedEdges.map(
        (edge, index) => `${index + 1}. ${edge.source} --${edge.relationshipDesc}--> ${edge.target}`,
      ),
    );
  }

  if (sortedClaims.length > 0) {
    appendSection(
      '【事实声明】',
      sortedClaims.map((claim, index) => {
        const suffix = claim.object ? `（关联 ${claim.object}）` : '';
        return `${index + 1}. ${claim.subject}${suffix}: ${claim.description}`;
      }),
    );
  }

  return kept.join('\n');
};

