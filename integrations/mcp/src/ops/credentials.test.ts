import { describe, expect, test } from 'bun:test';
import { findCredentialLeaks, formatLeaks } from './credentials.ts';

describe('credential leak checks', () => {
  test('detects each configured credential and tracking rule', () => {
    const leaks = findCredentialLeaks([
      { path: 'key.pem', content: '-----BEGIN PRIVATE KEY-----' },
      { path: 'client.ts', content: 'const key = "sk-abcdefghijklmnopqrstuvwxyz123456";' },
      { path: 'auth.ts', content: 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456' },
      { path: 'wallet.ts', content: 'WALLET_PRIVATE_KEY=0x' + 'a'.repeat(64) },
      { path: 'config.env', content: 'POSTGRES_PASSWORD=strong-secret-value' },
      { path: '.env.production', content: '' },
      { path: 'integrations/mcp/access/accounts.json', content: '{}' },
      { path: 'config.json', content: `api_key_sha256: "${'b'.repeat(64)}"` },
    ]);
    expect(leaks.map(({ rule }) => rule)).toEqual([
      'pem_private_key',
      'openai_style_key',
      'bearer_token',
      'wallet_private_key',
      'postgres_literal_password',
      'tracked_env_file',
      'tracked_access_policy',
      'api_key_hash_literal',
    ]);
  });

  test('ignores .example files, placeholders, and ordinary password prose', () => {
    const leaks = findCredentialLeaks([
      { path: 'settings.example.json', content: `api_key_sha256: "${'a'.repeat(64)}"` },
      { path: '.env.example', content: 'POSTGRES_PASSWORD=not-a-secret' },
      { path: 'settings.env', content: 'POSTGRES_PASSWORD=${POSTGRES_PASSWORD}' },
      { path: 'README.md', content: 'The password is private and should not be shared.' },
      { path: 'app.ts', content: 'token = placeholder-secret-value' },
    ]);
    expect(leaks).toEqual([]);
  });

  test('requires wallet key keyword on the same line', () => {
    const privateKey = '0x' + 'c'.repeat(64);
    expect(findCredentialLeaks([{ path: 'key.env', content: `value=${privateKey}\nPRIVATE_KEY=` }])).toEqual([]);
    expect(findCredentialLeaks([{ path: 'key.env', content: `PRIVATE_KEY=${privateKey}` }])).toEqual([
      { path: 'key.env', line: 1, rule: 'wallet_private_key' },
    ]);
  });

  test('formats each leak as path, line, and rule', () => {
    expect(formatLeaks([
      { path: 'config.env', line: 3, rule: 'postgres_literal_password' },
      { path: 'wallet.ts', line: 8, rule: 'wallet_private_key' },
    ])).toBe('config.env:3 postgres_literal_password\nwallet.ts:8 wallet_private_key');
  });
});
