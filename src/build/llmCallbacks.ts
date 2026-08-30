import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { logger } from '../logger';
import { getCurrentNamespace } from '../namespace/namespaceContext';

interface LLMMessageLike {
  usage_metadata?: { input_tokens?: number; output_tokens?: number };
}

interface LLMResultLike {
  generations?: { message?: LLMMessageLike }[][];
}

/** Correlation context attached to every LLM log line (namespace only in OSS). */
const readCorrelation = (): Record<string, string | number | undefined> => ({
  namespace: getCurrentNamespace(),
});

const runs = new Map<string, { startedAt: number; promptChars: number }>();

const modelNameOf = (llm: unknown): string | undefined =>
  (llm as { modelName?: string }).modelName ?? (llm as { model?: string }).model;

/** One structured log line per LLM call: info metadata (model/length/latency/tokens), error on failure. */
export const createLLMCallLogger = (): BaseCallbackHandler =>
  ({
    name: 'llm-call-logger',
    handleLLMStart: async (llm: unknown, prompts: string[], runId: string) => {
      const promptChars = (prompts ?? []).reduce(
        (sum: number, prompt: string) => sum + (prompt?.length ?? 0),
        0,
      );
      runs.set(runId, { startedAt: Date.now(), promptChars });
      logger.info(
        { ...readCorrelation(), event: 'llm.start', model: modelNameOf(llm), promptChars },
        'llm call started',
      );
    },
    handleLLMEnd: async (output: LLMResultLike, runId: string) => {
      const start = runs.get(runId);
      runs.delete(runId);
      const message = output?.generations?.[0]?.[0]?.message;
      logger.info(
        {
          ...readCorrelation(),
          event: 'llm.end',
          ok: true,
          latencyMs: start ? Date.now() - start.startedAt : undefined,
          tokensIn: message?.usage_metadata?.input_tokens,
          tokensOut: message?.usage_metadata?.output_tokens,
        },
        'llm call completed',
      );
    },
    handleLLMError: async (err: unknown, runId: string) => {
      const start = runs.get(runId);
      runs.delete(runId);
      logger.error(
        {
          ...readCorrelation(),
          event: 'llm.error',
          ok: false,
          latencyMs: start ? Date.now() - start.startedAt : undefined,
          err,
        },
        'llm call failed',
      );
    },
  }) as unknown as BaseCallbackHandler;
