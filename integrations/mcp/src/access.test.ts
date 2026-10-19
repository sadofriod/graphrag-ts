import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'bun:test';
import { authenticate, createAccessGuard, parseAccessPolicy, type AccessAccount } from './access.ts';

const token = 'test-token-for-account-alpha-1234567890';
const account: AccessAccount = {
  id: 'alpha',
  plan: 'evaluation',
  api_key_sha256: createHash('sha256').update(token).digest('hex'),
  workspaces: ['alpha'],
  operations: ['index', 'query', 'read'],
  monthly_limits: { index: 2, query: 3, global_query: 0 },
  expires_at: '2099-01-01T00:00:00Z',
};

describe('hosted access policy', () => {
  test('ships a parseable least-privilege policy and generates matching credential hashes', async () => {
    const example = parseAccessPolicy(JSON.parse(await readFile(new URL('../access/accounts.example.json', import.meta.url), 'utf8')));
    expect(example.accounts[0]?.operations).not.toContain('global_query');
    const child = Bun.spawn(['bun', new URL('./access-key.ts', import.meta.url).pathname], { stdout: 'pipe', stderr: 'pipe' });
    const output: unknown = JSON.parse(await new Response(child.stdout).text());
    expect(await child.exited).toBe(0);
    if (typeof output !== 'object' || output === null || !('token' in output)
      || typeof output.token !== 'string' || !('api_key_sha256' in output)) {
      throw new Error('Credential generator returned an invalid shape.');
    }
    expect(output.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(output.api_key_sha256).toBe(createHash('sha256').update(output.token).digest('hex'));
  });

  test('requires explicit limits, expiry, hashes and unique tenant ownership', () => {
    expect(parseAccessPolicy({ accounts: [account] }).accounts).toEqual([account]);
    for (const value of [
      { accounts: [] },
      { accounts: [account, account] },
      { accounts: [{ ...account, api_key_sha256: token }] },
      { accounts: [{ ...account, workspaces: [undefined] }] },
      { accounts: [{ ...account, workspaces: ['alpha', 'alpha'] }] },
      { accounts: [{ ...account, operations: ['admin'] }] },
      { accounts: [{ ...account, monthly_limits: { query: 1 } }] },
      { accounts: [{ ...account, monthly_limits: { ...account.monthly_limits, query: -1 } }] },
      { accounts: [{ ...account, expires_at: 'invalid' }] },
      { accounts: [account, { ...account, id: 'beta', api_key_sha256: 'a'.repeat(64) }] },
      { accounts: [{ ...account, typo: true }] },
    ]) {
      expect(() => parseAccessPolicy(value)).toThrow();
    }
  });

  test('rejects missing, malformed, unknown and expired tokens', () => {
    const policy = parseAccessPolicy({ accounts: [account] });
    for (const authorization of ['', 'Basic abc', 'Bearer short', `Bearer ${'x'.repeat(40)}`]) {
      expect(authenticate(new Request('http://localhost', { headers: { authorization } }), policy)).toBeUndefined();
    }
    const request = new Request('http://localhost', { headers: { authorization: `Bearer ${token}` } });
    expect(authenticate(request, policy)?.id).toBe('alpha');
    expect(authenticate(request, policy, Date.parse(account.expires_at))).toBeUndefined();
  });

  test('denied workspaces and operations never consume usage; reads are unmetered', async () => {
    let consumed = 0;
    const guard = createAccessGuard(account, {
      consumeUsage: async () => { consumed++; return true; },
      getUsage: async () => ({ period: '2026-10', usage: [] }),
    });
    await expect(guard('beta', 'query')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(guard('alpha', 'global_query')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await guard('alpha', 'read');
    expect(consumed).toBe(0);
    await guard('alpha', 'query');
    expect(consumed).toBe(1);
  });

  test('quota exhaustion and storage failures fail closed', async () => {
    const store = {
      consumeUsage: async () => false,
      getUsage: async () => ({ period: '2026-10', usage: [] }),
    };
    await expect(createAccessGuard(account, store)('alpha', 'index'))
      .rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    await expect(createAccessGuard(account, {
      ...store,
      consumeUsage: async () => { throw new Error('database offline'); },
    })('alpha', 'query')).rejects.toThrow('database offline');
  });
});
