import { AsyncLocalStorage } from 'node:async_hooks';

const retrievalSignalStorage = new AsyncLocalStorage<AbortSignal | undefined>();

export const withRetrievalSignal = <Result>(
  signal: AbortSignal | undefined,
  operation: () => Result,
): Promise<Awaited<Result>> =>
  retrievalSignalStorage.run(signal, async () => operation()) as Promise<Awaited<Result>>;

export const getRetrievalSignal = (): AbortSignal | undefined => retrievalSignalStorage.getStore();

export const throwIfRetrievalAborted = (): void => {
  const signal = getRetrievalSignal();
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException('The retrieval was aborted.', 'AbortError');
  }
};

export const awaitRetrieval = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
  throwIfRetrievalAborted();
  try {
    const result = await operation();
    throwIfRetrievalAborted();
    return result;
  } catch (error) {
    throwIfRetrievalAborted();
    throw error;
  }
};