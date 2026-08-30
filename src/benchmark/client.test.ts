import { describe, expect, it } from 'bun:test';

import { createRagApiClient, type FetchLike } from './client';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

interface RecordedCall {
  url: string;
  init: Parameters<FetchLike>[1];
}

const makeFetch = (responses: readonly Response[]): { fetchImpl: FetchLike; calls: RecordedCall[] } => {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push({ url: String(input), init });
    const response = responses[index] ?? jsonResponse({});
    index += 1;
    return response;
  };
  return { fetchImpl, calls };
};

const headerOf = (call: RecordedCall, name: string): string | undefined =>
  new Headers(call.init?.headers).get(name) ?? undefined;

describe('createRagApiClient', () => {
  it('buildFolder posts to /api/rag/folders with namespace and returns buildId', async () => {
    const { fetchImpl, calls } = makeFetch([jsonResponse({ buildId: 'build-1' }, 202)]);
    const client = createRagApiClient({ baseUrl: 'http://localhost:3000/', fetch: fetchImpl });

    const buildId = await client.buildFolder({ path: '/outline', namespace: 'ns-1' });

    expect(buildId).toBe('build-1');
    expect(calls[0]?.url).toBe('http://localhost:3000/api/rag/folders');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(headerOf(calls[0]!, 'x-namespace')).toBe('ns-1');
    expect(headerOf(calls[0]!, 'content-type')).toBe('application/json');
    const body = JSON.parse(String(calls[0]?.init?.body)) as { path: string; namespace: string };
    expect(body.path).toBe('/outline');
    expect(body.namespace).toBe('ns-1');
  });

  it('buildFolder includes exclude only when provided', async () => {
    const { fetchImpl, calls } = makeFetch([jsonResponse({ buildId: 'build-1' }, 202)]);
    const client = createRagApiClient({ baseUrl: 'http://localhost:3000', fetch: fetchImpl });

    await client.buildFolder({ path: '/outline', namespace: 'ns-1', exclude: ['drafts'] });

    const body = JSON.parse(String(calls[0]?.init?.body)) as { exclude?: string[] };
    expect(body.exclude).toEqual(['drafts']);
  });

  it('buildFolder throws when response lacks buildId', async () => {
    const { fetchImpl } = makeFetch([jsonResponse({ error: 'nope' }, 400)]);
    const client = createRagApiClient({ baseUrl: 'http://localhost:3000', fetch: fetchImpl });

    await expect(client.buildFolder({ path: '/outline', namespace: 'ns-1' })).rejects.toThrow(
      'RAG API 400',
    );
  });

  it('getBuild GETs /api/rag/builds/:id with namespace', async () => {
    const { fetchImpl, calls } = makeFetch([
      jsonResponse({
        id: 'build-1',
        status: 'running',
        title: 't',
        namespace: 'ns-1',
        createdAt: 0,
      }),
    ]);
    const client = createRagApiClient({ baseUrl: 'http://localhost:3000', fetch: fetchImpl });

    const job = await client.getBuild('build-1', 'ns-1');

    expect(job.status).toBe('running');
    expect(calls[0]?.url).toBe('http://localhost:3000/api/rag/builds/build-1');
    expect(calls[0]?.init?.method).toBeUndefined();
    expect(headerOf(calls[0]!, 'x-namespace')).toBe('ns-1');
  });

  it('retrieve posts query and topK to /api/rag/retrieve', async () => {
    const { fetchImpl, calls } = makeFetch([
      jsonResponse({ query: 'q', communities: [], evidence: [], answer: 'a' }),
    ]);
    const client = createRagApiClient({ baseUrl: 'http://localhost:3000', fetch: fetchImpl });

    const result = await client.retrieve({ query: 'q', topK: 3, namespace: 'ns-1' });

    expect(result.answer).toBe('a');
    expect(calls[0]?.url).toBe('http://localhost:3000/api/rag/retrieve');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(headerOf(calls[0]!, 'x-namespace')).toBe('ns-1');
    const body = JSON.parse(String(calls[0]?.init?.body)) as { query: string; topK: number };
    expect(body).toEqual({ query: 'q', topK: 3 });
  });

  it('throws on non-ok responses', async () => {
    const { fetchImpl } = makeFetch([jsonResponse({ error: 'boom' }, 500)]);
    const client = createRagApiClient({ baseUrl: 'http://localhost:3000', fetch: fetchImpl });

    await expect(client.retrieve({ query: 'q', topK: 3, namespace: 'ns-1' })).rejects.toThrow(
      'RAG API 500',
    );
  });
});
