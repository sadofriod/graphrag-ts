import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { logger } from '../logger';
import { createLLMCallLogger } from './llmCallbacks';

type Entry = { event?: string; ok?: boolean; latencyMs?: number; tokensIn?: number; tokensOut?: number };
type CallbackHandler = {
  handleLLMStart: (llm: unknown, prompts: string[], runId: string) => Promise<void>;
  handleLLMEnd: (output: unknown, runId: string) => Promise<void>;
  handleLLMError: (error: unknown, runId: string) => Promise<void>;
};

const handler = createLLMCallLogger() as unknown as CallbackHandler;
const captured: Entry[] = [];
const originalInfo = logger.info;
const originalError = logger.error;

logger.info = ((entry: Entry) => { captured.push(entry); }) as typeof logger.info;
logger.error = ((entry: Entry) => { captured.push(entry); }) as typeof logger.error;

const output = (): unknown => ({
  generations: [[{ message: { usage_metadata: { input_tokens: 3, output_tokens: 4 } } }]],
});

describe('llm call logging', () => {
  beforeEach(() => { captured.length = 0; });

  afterAll(() => {
    logger.info = originalInfo;
    logger.error = originalError;
  });

  test('reports a non-negative latency and the token counts for a completed run', async () => {
    await handler.handleLLMStart({ modelName: 'test-model' }, ['prompt'], 'run-1');
    await handler.handleLLMEnd(output(), 'run-1');
    const end = captured.find((entry) => entry.event === 'llm.end');
    expect(end?.ok).toBe(true);
    expect(end?.tokensIn).toBe(3);
    expect(end?.latencyMs ?? -1).toBeGreaterThanOrEqual(0);
  });

  test('never reports a negative duration when a run id is reused', async () => {
    // Two starts share one id: the second overwrites the first start time, which is
    // what produced the -16274ms entry in production.
    await handler.handleLLMStart({ modelName: 'test-model' }, ['first'], 'run-reused');
    await handler.handleLLMStart({ modelName: 'test-model' }, ['second'], 'run-reused');
    await handler.handleLLMEnd(output(), 'run-reused');
    const end = captured.find((entry) => entry.event === 'llm.end');
    expect(end?.latencyMs ?? -1).toBeGreaterThanOrEqual(0);
  });

  test('records a failure with ok=false and a non-negative latency', async () => {
    await handler.handleLLMStart({ modelName: 'test-model' }, ['prompt'], 'run-2');
    await handler.handleLLMError(new Error('boom'), 'run-2');
    const failure = captured.find((entry) => entry.event === 'llm.error');
    expect(failure?.ok).toBe(false);
    expect(failure?.latencyMs ?? -1).toBeGreaterThanOrEqual(0);
  });
});
