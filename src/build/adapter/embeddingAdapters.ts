import { OpenAIEmbeddings } from '@langchain/openai';
import { getRetrievalSignal } from '../../retrieval/retrievalContext';
import type { EmbeddingModelAdapter } from './types';

export const openaiEmbeddingAdapter: EmbeddingModelAdapter = ({ config }) => {
  const signalAwareFetch = Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const retrievalSignal = getRetrievalSignal();
      const signals = [init?.signal, retrievalSignal].filter((signal): signal is AbortSignal => Boolean(signal));
      return fetch(input, {
        ...init,
        ...(signals.length > 0 ? { signal: AbortSignal.any(signals) } : {}),
      });
    },
    { preconnect: fetch.preconnect },
  );

  return new OpenAIEmbeddings({
    openAIApiKey: config.apiKey,
    modelName: config.model,
    encodingFormat: 'float',
    configuration: {
      baseURL: config.baseURL,
      fetch: signalAwareFetch,
    },
    ...(config.options ?? {}),
  });
};
