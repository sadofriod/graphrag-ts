export const agentRegistry = {
  ragSliceAgent: {
    file: 'ragSliceAgent.md',
    dir: './',
  },
  communitySummary: {
    file: 'communitySummary.agent.md',
    dir: './',
  },
  queryIntent: {
    file: 'queryIntent.agent.md',
    dir: './',
  },
  queryRewrite: {
    file: 'queryRewrite.agent.md',
    dir: './',
  },
  communityFilter: {
    file: 'communityFilter.agent.md',
    dir: './',
  },
  answerGeneration: {
    file: 'answerGeneration.agent.md',
    dir: './',
  },
} as const satisfies Record<string, { file: string; dir: string }>;

export type AgentRegistryKey = keyof typeof agentRegistry;
export type AgentTemplateEntry = (typeof agentRegistry)[AgentRegistryKey];
export type AgentTemplateName = AgentRegistryKey | AgentTemplateEntry;
