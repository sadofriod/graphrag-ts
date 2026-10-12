export interface JsonSchema {
  readonly type: 'object' | 'array' | 'string' | 'number';
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly items?: JsonSchema;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
}

export type AgentOutputFormat =
  | { readonly type: 'text' }
  | { readonly type: 'json_object'; readonly schema: JsonSchema };

export interface AgentInvocation {
  readonly inputFormat: 'text';
  readonly prompt: string;
  readonly outputFormat: AgentOutputFormat;
}

export type AgentTemplateInput = string | Readonly<Record<string, string | number | boolean | null | undefined>>;

export interface AgentTemplateContract {
  readonly file: string;
  readonly dir: string;
  readonly inputFormat: AgentInvocation['inputFormat'];
  readonly inputVariables: readonly string[];
  readonly outputFormat: AgentOutputFormat;
}

const textOutput: AgentOutputFormat = { type: 'text' };

export const agentRegistry = {
  ragSliceAgent: {
    file: 'ragSliceAgent.md',
    dir: './',
    inputFormat: 'text',
    inputVariables: ['content'],
    outputFormat: {
      type: 'json_object',
      schema: {
        type: 'object',
        required: ['chunks'],
        additionalProperties: false,
        properties: {
          chunks: {
            type: 'array',
            items: {
              type: 'object',
              required: ['parentContent', 'childChunks', 'edges', 'claims', 'entities'],
              additionalProperties: false,
              properties: {
                parentContent: { type: 'string' },
                childChunks: { type: 'array', items: { type: 'string' } },
                edges: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['source', 'target', 'relation'],
                    additionalProperties: false,
                    properties: {
                      source: { type: 'string' },
                      target: { type: 'string' },
                      relation: { type: 'string' },
                      weight: { type: 'number' },
                    },
                  },
                },
                claims: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['subject', 'description'],
                    additionalProperties: false,
                    properties: {
                      subject: { type: 'string' },
                      object: { type: 'string' },
                      description: { type: 'string' },
                      childIndex: { type: 'number', minimum: 0 },
                    },
                  },
                },
                entities: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['name'],
                    additionalProperties: false,
                    properties: {
                      name: { type: 'string' },
                      description: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  communitySummary: {
    file: 'communitySummary.agent.md',
    dir: './',
    inputFormat: 'text',
    inputVariables: ['communityId', 'communityName', 'content'],
    outputFormat: {
      type: 'json_object',
      schema: {
        type: 'object',
        required: ['communityName', 'summaryContent'],
        additionalProperties: false,
        properties: {
          communityName: { type: 'string' },
          summaryContent: { type: 'string' },
        },
      },
    },
  },
  queryIntent: {
    file: 'queryIntent.agent.md',
    dir: './',
    inputFormat: 'text',
    inputVariables: ['query'],
    outputFormat: {
      type: 'json_object',
      schema: {
        type: 'object',
        required: ['entities', 'keywords', 'themes'],
        additionalProperties: false,
        properties: {
          entities: { type: 'array', items: { type: 'string' } },
          keywords: { type: 'array', items: { type: 'string' } },
          themes: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  queryRewrite: {
    file: 'queryRewrite.agent.md',
    dir: './',
    inputFormat: 'text',
    inputVariables: ['query'],
    outputFormat: {
      type: 'json_object',
      schema: {
        type: 'object',
        required: ['rewrittenQuery', 'expandedKeywords'],
        additionalProperties: false,
        properties: {
          rewrittenQuery: { type: 'string' },
          expandedKeywords: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  communityFilter: {
    file: 'communityFilter.agent.md',
    dir: './',
    inputFormat: 'text',
    inputVariables: ['query', 'content'],
    outputFormat: {
      type: 'json_object',
      schema: {
        type: 'object',
        required: ['selectedCommunityIds'],
        additionalProperties: false,
        properties: { selectedCommunityIds: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
  answerGeneration: {
    file: 'answerGeneration.agent.md',
    dir: './',
    inputFormat: 'text',
    inputVariables: ['query', 'content'],
    outputFormat: textOutput,
  },
  globalMap: {
    file: 'globalMap.agent.md',
    dir: './',
    inputFormat: 'text',
    inputVariables: ['query', 'content'],
    outputFormat: {
      type: 'json_object',
      schema: {
        type: 'object',
        required: ['answer', 'usefulness'],
        additionalProperties: false,
        properties: {
          answer: { type: 'string' },
          usefulness: { type: 'number', minimum: 0, maximum: 100 },
        },
      },
    },
  },
  globalReduce: {
    file: 'globalReduce.agent.md',
    dir: './',
    inputFormat: 'text',
    inputVariables: ['query', 'content'],
    outputFormat: {
      type: 'json_object',
      schema: {
        type: 'object',
        required: ['answer'],
        additionalProperties: false,
        properties: { answer: { type: 'string' } },
      },
    },
  },
} as const satisfies Record<string, AgentTemplateContract>;

export type AgentRegistryKey = keyof typeof agentRegistry;
export type AgentTemplateEntry = (typeof agentRegistry)[AgentRegistryKey];
export type AgentTemplateName = AgentRegistryKey | AgentTemplateEntry;
