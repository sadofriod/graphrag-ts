import { AsyncLocalStorage } from 'node:async_hooks';

import { resolveNamespace } from './resolveNamespace';

export const namespaceStorage = new AsyncLocalStorage<string>();

export const getCurrentNamespace = (): string =>
  namespaceStorage.getStore() ?? resolveNamespace();

export const withNamespace = <T>(
  namespace: string,
  fn: () => T,
): Promise<Awaited<T>> =>
  namespaceStorage.run(namespace, async () => fn()) as Promise<Awaited<T>>;
