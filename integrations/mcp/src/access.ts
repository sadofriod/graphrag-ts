import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { workspaceIdSchema } from './workspace.ts';
import type { UsageStore } from './usage.ts';

export const meteredOperations = ['index', 'query', 'global_query'] as const;
export type MeteredOperation = typeof meteredOperations[number];
export type AccessOperation = MeteredOperation | 'read';
export type AccessGuard = (workspaceId: string, operation: AccessOperation) => Promise<void>;

const accountSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/),
  plan: z.string().trim().min(1).max(80),
  api_key_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  workspaces: z.array(workspaceIdSchema.removeDefault()).min(1),
  operations: z.array(z.enum(['index', 'query', 'global_query', 'read'])).min(1),
  monthly_limits: z.object({
    index: z.number().int().min(0).max(1_000_000),
    query: z.number().int().min(0).max(1_000_000),
    global_query: z.number().int().min(0).max(1_000_000),
  }).strict(),
  expires_at: z.string().datetime({ offset: true }),
}).strict();

export type AccessAccount = z.infer<typeof accountSchema>;
export type AccessPolicy = { readonly accounts: readonly AccessAccount[] };

export const PUBLIC_ACCOUNT: AccessAccount = {
  id: 'public',
  plan: 'public',
  api_key_sha256: '0'.repeat(64),
  workspaces: ['default'],
  operations: ['read'],
  monthly_limits: { index: 0, query: 0, global_query: 0 },
  expires_at: '9999-12-31T23:59:59Z',
};

export class AccessError extends Error {
  constructor(readonly code: 'FORBIDDEN' | 'QUOTA_EXCEEDED', message: string) {
    super(message);
  }
}

export const parseAccessPolicy = (value: unknown): AccessPolicy => {
  const policy = z.object({ accounts: z.array(accountSchema).min(1) }).strict().parse(value);
  const accountIds = new Set<string>();
  const keys = new Set<string>();
  const workspaces = new Set<string>();
  for (const account of policy.accounts) {
    if (accountIds.has(account.id) || keys.has(account.api_key_sha256)) {
      throw new Error('Access policy contains duplicate account IDs or keys.');
    }
    accountIds.add(account.id);
    keys.add(account.api_key_sha256);
    for (const workspace of account.workspaces) {
      if (workspaces.has(workspace)) throw new Error('Access policy assigns a workspace more than once.');
      workspaces.add(workspace);
    }
  }
  return policy;
};

export const loadAccessPolicy = async (path: string): Promise<AccessPolicy> =>
  parseAccessPolicy(JSON.parse(await readFile(path, 'utf8')));

export const authenticate = (
  request: Request,
  policy: AccessPolicy,
  now = Date.now(),
): AccessAccount | undefined => {
  const authorization = request.headers.get('authorization');
  if (!authorization || !/^Bearer [A-Za-z0-9_-]{32,256}$/i.test(authorization)) return undefined;
  const digest = createHash('sha256').update(authorization.slice(7)).digest();
  return policy.accounts.find((account) =>
    timingSafeEqual(digest, Buffer.from(account.api_key_sha256, 'hex'))
    && Date.parse(account.expires_at) > now,
  );
};

export const assertWorkspaceAccess = (
  account: AccessAccount,
  workspaceId: string,
  operation: AccessOperation,
): void => {
  if (Date.parse(account.expires_at) <= Date.now()
    || !account.workspaces.includes(workspaceId)
    || !account.operations.includes(operation)) {
    throw new AccessError('FORBIDDEN', 'This credential does not grant access to this operation and workspace.');
  }
};

export const createAccessGuard = (account: AccessAccount, store: UsageStore): AccessGuard =>
  async (workspaceId, operation) => {
    assertWorkspaceAccess(account, workspaceId, operation);
    if (operation === 'read') return;
    const accepted = await store.consumeUsage(account.id, operation, account.monthly_limits[operation]);
    if (!accepted) {
      throw new AccessError('QUOTA_EXCEEDED', `The monthly ${operation} allowance is exhausted.`);
    }
  };
