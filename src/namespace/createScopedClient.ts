import { applyNamespaceToWhere } from './applyNamespaceToWhere';
import { getCurrentNamespace } from './namespaceContext';

interface QueryCall {
  args: { where?: object };
  query: (args: unknown) => Promise<unknown>;
}

const scopedRead = (call: QueryCall): Promise<unknown> =>
  call.query(applyNamespaceToWhere(call.args, getCurrentNamespace()));

export const namespaceQueryExtension = {
  query: {
    $allModels: {
      findMany: scopedRead,
      findFirst: scopedRead,
      findFirstOrThrow: scopedRead,
      aggregate: scopedRead,
      count: scopedRead,
    },
  },
} as const;

export interface ExtendableClient {
  $extends: (extension: object) => unknown;
}

export const createScopedClient = <T extends ExtendableClient>(delegate: T): T =>
  delegate.$extends(namespaceQueryExtension) as T;
