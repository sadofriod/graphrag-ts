import type { BuildJob } from '../build/buildRegistry';
import type { RetrievalResult } from '../retrieval/types/retrieval';

/**
 * RAG HTTP API 客户端。仅依赖基准所需的三个端点：
 * - POST /api/rag/folders （构建索引）
 * - GET  /api/rag/builds/:buildId （查询构建状态）
 * - POST /api/rag/retrieve （检索）
 *
 * `fetch` 可注入以便测试。
 */

export interface BuildFolderInput {
  path: string;
  namespace: string;
  exclude?: readonly string[];
}

export interface RetrieveInput {
  query: string;
  topK: number;
  namespace: string;
}

export interface RagApiClient {
  buildFolder(input: BuildFolderInput): Promise<string>;
  getBuild(buildId: string, namespace: string): Promise<BuildJob>;
  retrieve(input: RetrieveInput): Promise<RetrievalResult>;
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface RagApiClientOptions {
  baseUrl: string;
  fetch?: FetchLike;
}

const withNamespaceHeader = (namespace: string, init?: RequestInit): RequestInit => {
  const headers = new Headers(init?.headers);
  headers.set('x-namespace', namespace);
  return { ...init, headers };
};

const readJson = async (response: Response): Promise<unknown> => {
  const body = (await response.json()) as unknown;
  if (!response.ok) {
    throw new Error(`RAG API ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
};

const readBuildId = (body: unknown): string => {
  const buildId = (body as { buildId?: unknown })?.buildId;
  if (typeof buildId !== 'string' || buildId.length === 0) {
    throw new Error('RAG API buildFolder: missing buildId in response');
  }
  return buildId;
};

export const createRagApiClient = (options: RagApiClientOptions): RagApiClient => {
  const { baseUrl } = options;
  const fetchImpl = options.fetch ?? fetch;
  const apiRoot = baseUrl.replace(/\/+$/, '');

  const buildFolder = async (input: BuildFolderInput): Promise<string> => {
    const response = await fetchImpl(
      `${apiRoot}/api/rag/folders`,
      withNamespaceHeader(input.namespace, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          path: input.path,
          namespace: input.namespace,
          ...(input.exclude && input.exclude.length > 0 ? { exclude: [...input.exclude] } : {}),
        }),
      }),
    );
    return readBuildId(await readJson(response));
  };

  const getBuild = async (buildId: string, namespace: string): Promise<BuildJob> => {
    const response = await fetchImpl(
      `${apiRoot}/api/rag/builds/${encodeURIComponent(buildId)}`,
      withNamespaceHeader(namespace),
    );
    return (await readJson(response)) as BuildJob;
  };

  const retrieve = async (input: RetrieveInput): Promise<RetrievalResult> => {
    const response = await fetchImpl(
      `${apiRoot}/api/rag/retrieve`,
      withNamespaceHeader(input.namespace, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: input.query, topK: input.topK }),
      }),
    );
    return (await readJson(response)) as RetrievalResult;
  };

  return { buildFolder, getBuild, retrieve };
};
