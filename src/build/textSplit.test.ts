import { describe, expect, it } from 'bun:test';

import { buildChildInsertSql } from './helper/buildChildInsertSql';
import { prismaClient } from './helper/prismaClient';
import { modelLoaderSingleton } from './modelLoader';
import { textSplit } from './textSplit';

describe('buildChildInsertSql', () => {
  it('builds a single insert statement that computes fts tokens in SQL', () => {
    const sql = buildChildInsertSql(
      [
        { parentId: 'parent-1', content: 'hello world', embedding: [0.1, 0.2] },
        { parentId: 'parent-1', content: 'goodbye world', embedding: [0.3, 0.4] },
      ],
      'ns-a',
    );

    const text = sql.text;

    expect(text).toContain('INSERT INTO "rag_children"');
    expect(text).toContain('"id"');
    expect(text).toContain('"namespace"');
    expect(text).toContain('"parent_id"');
    expect(text).toContain('"updated_at"');
    expect(text).toContain('to_tsvector(\'english\'');
    expect(text).toContain('CAST(');
    expect(text).toContain('now()');
    expect(text).toContain('RETURNING "id"');
    expect(text.match(/INSERT INTO "rag_children"/g)).toHaveLength(1);
  });

  it('documents the HNSW migration for the embedding vector column', () => {
    const migration = [
      'CREATE INDEX IF NOT EXISTS ragchild_embedding_hnsw_idx ON "rag_children"',
      'USING hnsw ("embedding" vector_cosine_ops)',
    ].join(' ');

    expect(migration).toContain('CREATE INDEX IF NOT EXISTS ragchild_embedding_hnsw_idx');
    expect(migration).toContain('USING hnsw');
    expect(migration).toContain('vector_cosine_ops');
  });
});

describe('textSplit', () => {
  const originalModels = modelLoaderSingleton.models;

  const stubModels = (options: {
    invoke?: () => Promise<string>;
    embed?: () => Promise<number[]>;
  } = {}) => {
    modelLoaderSingleton.models = {
      slice: {
        invoke: options.invoke ?? (async () =>
          JSON.stringify([
            {
              parentContent: 'parent content',
              childChunks: ['child one', 'child two'],
              edges: [
                { source: 'A', target: 'B', relation: 'collaborates_with' },
                { source: 'B', target: 'C', relation: 'reports_to' },
              ],
              claims: [
                { subject: 'A', object: 'B', description: 'A collaborates with B', childIndex: 0 },
              ],
              entities: [{ name: 'A', description: 'Entity A' }],
            },
          ])),
      },
      embedding: {
        embedQuery: options.embed ?? (async () => [0.1, 0.2]),
      },
    } as never;
  };

  const restoreModels = () => {
    modelLoaderSingleton.models = originalModels;
  };

  const installFakeTx = (
    createdParents: Array<{ data: { namespace: string; content: string; title?: string } }>,
  ) => {
    const originalTransaction = prismaClient.$transaction;
    const fakeTx = {
      rAGParent: {
        create: (args: { data: { namespace: string; content: string; title?: string } }) => {
          createdParents.push(args);
          return Promise.resolve({ id: `parent-${createdParents.length}` });
        },
      },
      $queryRaw: async () => [{ id: 'child-1' }, { id: 'child-2' }],
    };
    prismaClient.$transaction = ((callback: (tx: typeof fakeTx) => Promise<unknown>) =>
      callback(fakeTx)) as never;
    return { originalTransaction };
  };

  it('stamps the source file title and namespace on created parents and returns their edges', async () => {
    stubModels();
    const createdParents: Array<{ data: { namespace: string; content: string; title?: string } }> = [];
    const { originalTransaction } = installFakeTx(createdParents);

    try {
      const result = await textSplit({ content: 'hello', title: 'doc.md', namespace: 'ns-a', mode: 'llm' });

      expect(createdParents[0]?.data.title).toBe('doc.md');
      expect(createdParents[0]?.data.namespace).toBe('ns-a');
      expect(result).toEqual([
        {
          parentId: 'parent-1',
          childIds: ['child-1', 'child-2'],
          edges: [
            { source: 'A', target: 'B', relation: 'collaborates_with' },
            { source: 'B', target: 'C', relation: 'reports_to' },
          ],
          claims: [
            { subject: 'A', object: 'B', description: 'A collaborates with B', childIndex: 0 },
          ],
          entities: [{ name: 'A', description: 'Entity A' }],
        },
      ]);
    } finally {
      prismaClient.$transaction = originalTransaction;
      restoreModels();
    }
  });

  it('omits the title on parents when no source file is given', async () => {
    stubModels();
    const createdParents: Array<{ data: { namespace: string; content: string; title?: string } }> = [];
    const { originalTransaction } = installFakeTx(createdParents);

    try {
      await textSplit({ content: 'hello', namespace: 'ns-a', mode: 'llm' });

      expect(createdParents[0]?.data.title).toBeUndefined();
      expect(createdParents[0]?.data.namespace).toBe('ns-a');
    } finally {
      prismaClient.$transaction = originalTransaction;
      restoreModels();
    }
  });

  it('accepts markdown-fenced JSON from the slice model', async () => {
    stubModels({
      invoke: async () =>
        '```json\n' +
        JSON.stringify([
          {
            parentContent: 'parent content',
            childChunks: ['child one', 'child two'],
            edges: [{ source: 'A', target: 'B', relation: 'collaborates_with' }],
            claims: [],
            entities: [],
          },
        ]) +
        '\n```',
    });
    const createdParents: Array<{ data: { namespace: string; content: string; title?: string } }> = [];
    const { originalTransaction } = installFakeTx(createdParents);

    try {
      const result = await textSplit({ content: 'hello', title: 'doc.md', namespace: 'ns-a', mode: 'llm' });
      expect(result[0]?.edges).toEqual([
        { source: 'A', target: 'B', relation: 'collaborates_with' },
      ]);
    } finally {
      prismaClient.$transaction = originalTransaction;
      restoreModels();
    }
  });

  it('falls back to deterministic splitting when the slice model output is not JSON', async () => {
    stubModels({ invoke: async () => '抱歉，我无法输出 JSON。' });
    const createdParents: Array<{ data: { namespace: string; content: string; title?: string } }> = [];
    const { originalTransaction } = installFakeTx(createdParents);

    try {
      const result = await textSplit({ content: 'hello', namespace: 'ns-a', mode: 'llm' });
      expect(createdParents).toHaveLength(1);
      expect(createdParents[0]?.data.content).toBe('hello');
      expect(result[0]?.edges).toEqual([]);
    } finally {
      prismaClient.$transaction = originalTransaction;
      restoreModels();
    }
  });

  it('uses deterministic splitting for short content in auto mode (skips LLM)', async () => {
    let llmCalls = 0;
    stubModels({ invoke: async () => { llmCalls += 1; return '[]'; } });
    const createdParents: Array<{ data: { namespace: string; content: string; title?: string } }> = [];
    const { originalTransaction } = installFakeTx(createdParents);

    try {
      const result = await textSplit({ content: 'short text', namespace: 'ns-a' });
      expect(llmCalls).toBe(0);
      expect(createdParents).toHaveLength(1);
      expect(createdParents[0]?.data.content).toBe('short text');
      expect(result[0]?.edges).toEqual([]);
    } finally {
      prismaClient.$transaction = originalTransaction;
      restoreModels();
    }
  });

  it('uses LLM splitting for long non-markdown content in auto mode', async () => {
    let llmCalls = 0;
    stubModels({
      invoke: async () => {
        llmCalls += 1;
        return JSON.stringify([
          { parentContent: 'p', childChunks: ['c1', 'c2'], edges: [{ source: 'A', target: 'B', relation: 'r' }], claims: [], entities: [{ name: 'A' }] },
        ]);
      },
    });
    const createdParents: Array<{ data: { namespace: string; content: string; title?: string } }> = [];
    const { originalTransaction } = installFakeTx(createdParents);

    try {
      const result = await textSplit({ content: 'plain long content '.repeat(100), title: 'notes.txt', namespace: 'ns-a' });
      expect(llmCalls).toBe(1);
      expect(result[0]?.edges).toEqual([{ source: 'A', target: 'B', relation: 'r' }]);
    } finally {
      prismaClient.$transaction = originalTransaction;
      restoreModels();
    }
  });

  it('falls back to deterministic when the LLM output is empty or signal-less', async () => {
    stubModels({
      invoke: async () =>
        JSON.stringify([{ parentContent: 'p', childChunks: ['c1'], edges: [], claims: [], entities: [] }]),
    });
    const createdParents: Array<{ data: { namespace: string; content: string; title?: string } }> = [];
    const { originalTransaction } = installFakeTx(createdParents);

    try {
      const result = await textSplit({ content: 'plain long content '.repeat(100), namespace: 'ns-a' });
      expect(result[0]?.edges).toEqual([]);
      expect(result[0]?.entities).toEqual([]);
    } finally {
      prismaClient.$transaction = originalTransaction;
      restoreModels();
    }
  });

  it('splits long markdown by top-level headings then LLM per section in auto mode', async () => {
    let llmCalls = 0;
    stubModels({
      invoke: async () => {
        llmCalls += 1;
        return JSON.stringify([
          { parentContent: 'p', childChunks: ['c1'], edges: [{ source: 'A', target: 'B', relation: 'r' }], claims: [], entities: [{ name: 'A' }] },
        ]);
      },
    });
    const createdParents: Array<{ data: { namespace: string; content: string; title?: string } }> = [];
    const { originalTransaction } = installFakeTx(createdParents);

    const content =
      '# 时空设定\n\n' +
      '世界规则描述。'.repeat(300) +
      '\n\n# 角色设定\n\n' +
      '林默与苏晚的故事。'.repeat(300);

    try {
      const result = await textSplit({ content, title: 'doc.md', namespace: 'ns-a' });
      expect(llmCalls).toBe(2);
      expect(createdParents).toHaveLength(2);
      expect(createdParents[0]?.data.title).toBe('doc.md#时空设定');
      expect(createdParents[1]?.data.title).toBe('doc.md#角色设定');
      expect(result).toHaveLength(2);
    } finally {
      prismaClient.$transaction = originalTransaction;
      restoreModels();
    }
  });

  it('uses deterministic splitting when mode is deterministic', async () => {
    let llmCalls = 0;
    stubModels({ invoke: async () => { llmCalls += 1; return '[]'; } });
    const createdParents: Array<{ data: { namespace: string; content: string; title?: string } }> = [];
    const { originalTransaction } = installFakeTx(createdParents);

    try {
      await textSplit({ content: 'plain long content '.repeat(100), namespace: 'ns-a', mode: 'deterministic' });
      expect(llmCalls).toBe(0);
      expect(createdParents).toHaveLength(1);
    } finally {
      prismaClient.$transaction = originalTransaction;
      restoreModels();
    }
  });
});
