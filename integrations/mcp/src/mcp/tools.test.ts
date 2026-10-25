import { describe, expect, test } from 'bun:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { loadConfig } from '../config.ts';
import type { Logger } from '../log.ts';
import { communityLevelSchema, createMcpServer, createQueryLimiter, globalCommunityLevelSchema, integrityPaperRefSchema } from './tools.ts';
import type { Judge } from '../integrity/judge.ts';
import type { IntegrityStore } from '../integrity/store.ts';
import type { IndexStore } from '../store.ts';

const logger: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const config = loadConfig({ DATABASE_URL: 'postgresql://localhost/unused' });

const callIntegrityTool = async (toolName: string, judge: Judge, arguments_: Record<string, string> = { doi: '10.1234/test' }) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createMcpServer({} as IndexStore, config, logger, undefined, undefined, {
    integrity: { store: {} as IntegrityStore, judge },
  });
  const client = new Client({ name: 'integrity-test', version: '1' });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return await client.callTool({ name: toolName, arguments: arguments_ });
  } finally {
    await client.close();
    await server.close();
  }
};

const resultText = (result: unknown): string => {
  if (typeof result !== 'object' || result === null || !('content' in result) || !Array.isArray(result.content)) {
    throw new Error('MCP tool returned no content.');
  }
  const first = result.content[0];
  if (typeof first !== 'object' || first === null || !('text' in first) || typeof first.text !== 'string') {
    throw new Error('MCP tool returned no text content.');
  }
  return first.text;
};

describe('community level schema', () => {
  test('accepts an exact level or all terminal communities', () => {
    expect(communityLevelSchema.parse(2)).toBe(2);
    expect(communityLevelSchema.parse(undefined)).toBeUndefined();
    expect(() => communityLevelSchema.parse(-1)).toThrow();
    expect(() => communityLevelSchema.parse('leaf')).toThrow();
    expect(globalCommunityLevelSchema.parse(2)).toBe(2);
    expect(globalCommunityLevelSchema.parse('leaf')).toBe('leaf');
    expect(globalCommunityLevelSchema.parse(undefined)).toBeUndefined();
  });
});

describe('query limiter', () => {
  test('shares a bounded number of active query slots', () => {
    const limiter = createQueryLimiter(1);
    const release = limiter.tryAcquire();
    expect(typeof release).toBe('function');
    expect(limiter.tryAcquire()).toBeUndefined();

    release?.();
    const replacement = limiter.tryAcquire();
    expect(typeof replacement).toBe('function');
    expect(limiter.tryAcquire()).toBeUndefined();
  });

  test('releasing a slot more than once does not exceed the limit', () => {
    const limiter = createQueryLimiter(1);
    const release = limiter.tryAcquire();
    release?.();
    release?.();

    expect(typeof limiter.tryAcquire()).toBe('function');
    expect(limiter.tryAcquire()).toBeUndefined();
  });
});

describe('integrity judgment MCP tools', () => {
  const payloads = {
    status: { paper: { paper_id: 'p1' }, statuses: [] },
    propagation: { verdict: 'SUPPORTED' },
    audit: { verdict: 'INSUFFICIENT_EVIDENCE', evidence_path: [] },
  };

  const fakeJudge = (overrides: Partial<Judge> = {}): Judge => ({
    paperStatus: async () => payloads.status,
    retractionPropagation: async () => payloads.propagation,
    evidenceAudit: async () => payloads.audit,
    ...overrides,
  }) as Judge;

  test('returns judge payloads as JSON text for all three tools', async () => {
    const judge = fakeJudge();
    for (const [toolName, payload] of [
      ['integrity_paper_status', payloads.status],
      ['retraction_propagation', payloads.propagation],
      ['integrity_evidence_audit', payloads.audit],
    ] as const) {
      const result = await callIntegrityTool(toolName, judge);
      expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(payload) }]);
      expect(result.isError).not.toBe(true);
    }
  });

  test('rejects references that omit both DOI and paper ID', () => {
    expect(() => integrityPaperRefSchema.parse({})).toThrow();
    expect(integrityPaperRefSchema.parse({ doi: '10.1234/test' })).toEqual({ doi: '10.1234/test' });
    expect(integrityPaperRefSchema.parse({ paper_id: 'p1' })).toEqual({ paper_id: 'p1' });
  });

  test('maps missing active snapshots to NO_SNAPSHOT', async () => {
    const judge = fakeJudge({ paperStatus: async () => { throw new Error('No active integrity snapshot'); } });
    const result = await callIntegrityTool('integrity_paper_status', judge);
    expect(result.isError).toBe(true);
    expect(JSON.parse(resultText(result))).toMatchObject({ error: { code: 'NO_SNAPSHOT' } });
  });

  test('maps missing paper status to PAPER_NOT_FOUND', async () => {
    const judge = fakeJudge({ paperStatus: async () => ({ paper: null, statuses: [], abstention_reason: 'paper_not_in_snapshot' }) });
    const result = await callIntegrityTool('integrity_paper_status', judge);
    expect(result.isError).toBe(true);
    expect(JSON.parse(resultText(result))).toMatchObject({ error: { code: 'PAPER_NOT_FOUND' } });
  });
});
