import { ChatDeepSeek } from '@langchain/deepseek';
import { ChatOpenAI } from '@langchain/openai';
import { createLLMCallLogger } from '../llmCallbacks';
import { LLM_TIMEOUT_MS } from '../constants';
import type { ChatModelAdapter } from './types';

export const deepseekChatAdapter: ChatModelAdapter = ({ config }) =>
  new ChatDeepSeek({
    apiKey: config.apiKey,
    model: config.model,
    callbacks: [createLLMCallLogger()],
    timeout: LLM_TIMEOUT_MS,
    configuration: {
      baseURL: config.baseURL,
    },
    ...(config.options ?? {}),
  });

export const openaiChatAdapter: ChatModelAdapter = ({ config }) =>
  new ChatOpenAI({
    openAIApiKey: config.apiKey,
    modelName: config.model,
    callbacks: [createLLMCallLogger()],
    timeout: LLM_TIMEOUT_MS,
    configuration: {
      baseURL: config.baseURL,
    },
    ...(config.options ?? {}),
  });
