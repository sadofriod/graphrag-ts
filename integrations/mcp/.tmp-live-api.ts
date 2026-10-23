import { readFileSync } from 'node:fs';
import { createPaidQueryRoute } from './src/x402/gateway.ts';
import { createQueryLimiter } from './src/mcp/tools.ts';
import { createCdpFacilitatorClient } from './src/x402/cdp.ts';
import { loadConfig } from './src/config.ts';
import { createLogger } from './src/log.ts';
import { loadDatasetRegistry } from './src/x402/datasets.ts';

const env = Object.fromEntries(readFileSync('/workspace/ops/x402/cdp.env', 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const config = loadConfig({ DATABASE_URL: 'postgresql://unused/unused', QUERY_TIMEOUT_MS: '20000' });
const logger = createLogger('info');
const registry = await loadDatasetRegistry('datasets.example.json');
const payments = {
  beginPayment: async (input: Record<string, string>) => ({ kind: 'new' as const, record: {
    id: input.id!, requestId: input.requestId!, requestHash: input.requestHash!, nonce: input.nonce!,
    datasetId: input.datasetId!, mode: 'local' as const, scheme: 'exact' as const, network: input.network!,
    asset: input.asset!, amountAuthorized: input.amountAuthorized!, amountSettled: null, payer: null,
    status: 'pending' as const, transaction: null, errorReason: null, responseBody: null, datasetVersion: null,
    latencyMs: null, createdAt: new Date(), updatedAt: new Date(), settledAt: null } }),
  completePayment: async (id: string, input: Record<string, unknown>) => ({ id, ...input }),
  failPayment: async (id: string, input: Record<string, unknown>) => { console.log('ledger.fail', id, JSON.stringify(input)); },
  getPaymentById: async () => undefined,
  metrics: async () => ({ settledCount: 0, failedCount: 0, pendingCount: 0, settledAmount: '0' }),
};
const store = {
  acquireActiveVersionLease: async () => ({ id: 'version-live-smoke', workspaceId: 'web3-security', namespace: 'snapshot', leaseId: 'lease-live' }),
  renewQueryLease: async () => undefined,
  releaseQueryLease: async () => undefined,
  appendActivityLog: async () => undefined,
};
const route = createPaidQueryRoute({
  store: store as never, config, logger, registry, payments: payments as never,
  facilitator: createCdpFacilitatorClient({
    apiKeyId: env.CDP_API_KEY_ID!, apiKeySecret: env.CDP_API_KEY_SECRET!,
  }),
  limiter: createQueryLimiter(2),
  settings: {
    provider: 'self', facilitatorUrl: 'https://api.cdp.coinbase.com/platform/v2/x402',
    network: 'eip155:84532', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    assetName: 'USDC', assetVersion: '2', payTo: '0x5d44b04Fb8D32122637EE805BC96C781eA2B8e29',
    maxTimeoutSeconds: 120, publicBaseUrl: 'http://127.0.0.1:4021',
    uptoFacilitatorAddress: '0x68EFaFE862d89cE66dd3D7B07d5A3747A0871164',
  },
  runQuery: (async () => ({
    result: { answer: 'Session storage moved to PostgreSQL so revocation commits in the account transaction.', evidence: [{ text: 'ADR-007: Harbor moved browser sessions from Redis to PostgreSQL.', sourceDocumentId: 'adr-session-storage.md' }] },
    version: { id: 'version-live-smoke', workspaceId: 'web3-security' }, durationMs: 42, leaseId: 'lease-live',
  })) as never,
});
const server = Bun.serve({ port: 4021, hostname: '127.0.0.1', fetch: async (r) => (await route(r)) ?? new Response('nf', { status: 404 }) });
console.log('live paid api on', server.url.href, 'payTo 0x5d44…8e29, network eip155:84532');
