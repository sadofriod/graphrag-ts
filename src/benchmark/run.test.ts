import { describe, expect, it } from 'bun:test';

import type { BuildJob } from '../build/buildRegistry';
import type { BenchmarkQuery } from './dataset';
import { BENCHMARK_QUERIES } from './dataset';
import type { RagApiClient } from './client';
import { main, parseCliOptions, runBenchmark } from './run';

const queryOf = (id: string, volume: 1 | 2 | 3, query: string): BenchmarkQuery => ({
  id,
  volume,
  story: '故事线',
  fact: '事实',
  query,
  topK: 3,
  expectation: { entities: ['凯'], phrases: ['金属碎片'] },
});

const makeFakeClient = (options: {
  hitIds?: ReadonlySet<string>;
  buildStatus?: BuildJob['status'];
  buildError?: string;
} = {}): RagApiClient & { buildFolderCalls: string[] } => {
  const hitIds = options.hitIds ?? new Set(BENCHMARK_QUERIES.map(({ id }) => id));
  const buildFolderCalls: string[] = [];
  return {
    buildFolderCalls,
    buildFolder: async ({ path }) => {
      buildFolderCalls.push(path);
      return 'build-1';
    },
    getBuild: async () => ({
      id: 'build-1',
      status: options.buildStatus ?? 'succeeded',
      title: 't',
      namespace: 'ns',
      createdAt: 0,
      ...(options.buildError !== undefined ? { error: options.buildError } : {}),
    }),
    retrieve: async ({ query }) => {
      const item = BENCHMARK_QUERIES.find((candidate) => candidate.query === query);
      const context =
        item !== undefined && hitIds.has(item.id)
          ? [...item.expectation.entities, ...item.expectation.phrases].join(' ')
          : '';
      return {
        query,
        communities: [],
        evidence: context.length > 0 ? [{ text: context }] : [],
        answer: '',
      };
    },
  };
};

describe('runBenchmark', () => {
  it('evaluates each dataset query and aggregates the report', async () => {
    const client = makeFakeClient();
    const outcome = await runBenchmark({ client, namespace: 'ns' });

    expect(outcome.report.total).toBe(BENCHMARK_QUERIES.length);
    expect(outcome.report.hits).toBe(BENCHMARK_QUERIES.length);
    expect(outcome.report.strictHitRate).toBe(1);
    expect(outcome.results.length).toBe(BENCHMARK_QUERIES.length);
  });

  it('counts misses when the retrieval context lacks expectations', async () => {
    const client = makeFakeClient({ hitIds: new Set<string>() });
    const outcome = await runBenchmark({ client, namespace: 'ns' });

    expect(outcome.report.hits).toBe(0);
    expect(outcome.report.strictHitRate).toBe(0);
  });

  it('supports a custom dataset and topK override', async () => {
    const dataset = [queryOf('t1', 1, 'q1'), queryOf('t2', 2, 'q2')];
    const retrieveCalls: Array<{ query: string; topK: number; namespace: string }> = [];
    const client = {
      buildFolder: async () => 'build-1',
      getBuild: async () => jobOf('succeeded'),
      retrieve: async (input: { query: string; topK: number; namespace: string }) => {
        retrieveCalls.push(input);
        const hit = input.query === 'q1';
        return {
          query: input.query,
          communities: [],
          evidence: hit ? [{ text: '凯 金属碎片' }] : [],
          answer: '',
        };
      },
    } as unknown as RagApiClient;

    const outcome = await runBenchmark({ client, namespace: 'ns', dataset, topK: 7 });

    expect(outcome.report.total).toBe(2);
    expect(outcome.report.hits).toBe(1);
    expect(retrieveCalls[0]?.topK).toBe(7);
    expect(retrieveCalls[1]?.topK).toBe(7);
  });

  it('builds via the API before retrieving when build is enabled', async () => {
    const client = makeFakeClient();
    const outcome = await runBenchmark({
      client,
      namespace: 'ns',
      outlinePath: '/outline',
      build: true,
      pollIntervalMs: 1,
    });

    expect(client.buildFolderCalls).toEqual(['/outline']);
    expect(outcome.report.total).toBe(BENCHMARK_QUERIES.length);
  });

  it('requires outlinePath when build is enabled', async () => {
    const client = makeFakeClient();
    await expect(runBenchmark({ client, namespace: 'ns', build: true })).rejects.toThrow(
      'outlinePath is required',
    );
  });

  it('logs the retrieval flow when verbose is enabled', async () => {
    const client = makeFakeClient();
    const logged: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      logged.push(String(message));
    };
    try {
      await runBenchmark({ client, namespace: 'ns', verbose: true });
    } finally {
      console.log = originalLog;
    }

    expect(logged.some((line) => line.startsWith('[retrieve] v1-q1 ·'))).toBe(true);
    expect(logged.some((line) => line.includes('evidence[0]:'))).toBe(true);
  });

  it('logs and rethrows a retrieve failure when verbose is enabled', async () => {
    const failing = {
      buildFolder: async () => 'build-1',
      getBuild: async () => jobOf('succeeded'),
      retrieve: async () => {
        throw new Error('RAG API 500: boom');
      },
    } as unknown as RagApiClient;
    const errors: string[] = [];
    const originalError = console.error;
    console.error = (message?: unknown) => {
      errors.push(String(message));
    };
    try {
      await expect(
        runBenchmark({ client: failing, namespace: 'ns', verbose: true }),
      ).rejects.toThrow('RAG API 500: boom');
    } finally {
      console.error = originalError;
    }

    expect(errors.some((line) => line.includes('[retrieve] v1-q1 FAILED'))).toBe(true);
  });

  it('propagates build failures', async () => {
    const client = makeFakeClient({ buildStatus: 'failed', buildError: 'boom' });
    await expect(
      runBenchmark({ client, namespace: 'ns', outlinePath: '/outline', build: true }),
    ).rejects.toThrow('RAG build failed: boom');
  });
});

describe('parseCliOptions', () => {
  it('applies defaults', () => {
    const cli = parseCliOptions([], {});
    expect(cli.baseUrl).toBe('http://localhost:3000');
    expect(cli.namespace).toBe('default-namespace');
    expect(cli.build).toBe(false);
    expect(cli.includeAnswer).toBe(false);
    expect(cli.verbose).toBe(false);
    expect(cli.topK).toBeUndefined();
  });

  it('reads flags and env overrides', () => {
    const cli = parseCliOptions(
      ['--base-url', 'http://127.0.0.1:4000', '--topK', '7', '--build', '--include-answer', '--verbose'],
      { RAG_NAMESPACE: 'ns-env', RAG_OUTLINE_PATH: '/env/outline' },
    );
    expect(cli.baseUrl).toBe('http://127.0.0.1:4000');
    expect(cli.namespace).toBe('ns-env');
    expect(cli.outlinePath).toBe('/env/outline');
    expect(cli.build).toBe(true);
    expect(cli.includeAnswer).toBe(true);
    expect(cli.verbose).toBe(true);
    expect(cli.topK).toBe(7);
  });
});

describe('main', () => {
  it('runs the benchmark and prints a markdown report', async () => {
    const client = makeFakeClient();
    const logged: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown) => {
      logged.push(String(message));
    };
    try {
      await main([], {}, () => client);
    } finally {
      console.log = originalLog;
    }

    const output = logged.join('\n');
    expect(output).toContain('# GraphRAG 召回率 Benchmark');
    expect(output).toContain(`查询总数: ${BENCHMARK_QUERIES.length}`);
    expect(output).toContain('| v1-q1 | 第1卷 |');
  });
});

const jobOf = (status: BuildJob['status']): BuildJob => ({
  id: 'build-1',
  status,
  title: 't',
  namespace: 'ns',
  createdAt: 0,
});
