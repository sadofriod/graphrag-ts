import type { RagApiClient } from './client';

/**
 * 通过 API 触达大纲文件夹建索引，并轮询构建状态直到成功/失败。
 * 返回 buildId；失败或超时抛错。
 */

export interface BuildAndWaitOptions {
  namespace: string;
  outlinePath: string;
  pollIntervalMs?: number;
  buildTimeoutMs?: number;
}

export const buildAndWait = async (
  client: RagApiClient,
  options: BuildAndWaitOptions,
): Promise<string> => {
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const buildTimeoutMs = options.buildTimeoutMs ?? 10 * 60 * 1000;

  const buildId = await client.buildFolder({
    path: options.outlinePath,
    namespace: options.namespace,
  });

  const deadline = Date.now() + buildTimeoutMs;
  for (;;) {
    const job = await client.getBuild(buildId, options.namespace);
    if (job.status === 'succeeded') {
      return buildId;
    }
    if (job.status === 'failed') {
      throw new Error(`RAG build failed: ${job.error ?? 'unknown error'}`);
    }
    if (job.status !== 'pending' && job.status !== 'running') {
      throw new Error(`RAG build unexpected status: ${job.status}`);
    }
    if (Date.now() > deadline) {
      throw new Error(`RAG build timed out after ${buildTimeoutMs}ms`);
    }
    await Bun.sleep(pollIntervalMs);
  }
};
