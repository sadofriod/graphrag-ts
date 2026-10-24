export type CredentialLeak = { path: string; line: number; rule: string };

const PEM_PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const OPENAI_STYLE_KEY = /\bsk-[A-Za-z0-9_-]{20,}/;
const BEARER_TOKEN = /\bBearer [A-Za-z0-9._-]{24,}/;
const WALLET_PRIVATE_KEY = /\b(?:0x)?[0-9a-fA-F]{64}\b/;
const PLACEHOLDER_LINE = /(?:\$\{[^}]+\}|\b(?:changeme|replace[_ -]?me|placeholder|your[_ -]?(?:key|token|password|secret)|example[_ -]?(?:key|token|password|secret))\b)/i;

const hasExampleName = (filePath: string): boolean => filePath.split('/').some((part) => part.includes('.example'));

const isTrackedEnv = (filePath: string): boolean => {
  const basename = filePath.split('/').at(-1) ?? '';
  return (basename === '.env' || basename.startsWith('.env.')) && !basename.endsWith('.example');
};

const hasTrackedAccessPolicy = (filePath: string): boolean =>
  filePath.startsWith('integrations/mcp/access/')
  && (filePath.split('/').at(-1) ?? '') !== 'accounts.example.json';

const apiKeyHash = /\bapi_key_sha256\b\s*["']?\s*[:=]\s*["']?([0-9a-fA-F]{64})\b/i;

type CredentialRule = { name: string; test: (line: string, path: string) => boolean };

const credentialRules: readonly CredentialRule[] = [
  { name: 'pem_private_key', test: (line) => PEM_PRIVATE_KEY.test(line) },
  { name: 'openai_style_key', test: (line) => OPENAI_STYLE_KEY.test(line) },
  { name: 'bearer_token', test: (line) => BEARER_TOKEN.test(line) },
  { name: 'wallet_private_key', test: (line) => /(?:PRIVATE_KEY|PRIVATEKEY|SECRET_KEY)/i.test(line) && WALLET_PRIVATE_KEY.test(line) },
  {
    name: 'postgres_literal_password',
    test: (line) => {
      const password = /^\s*POSTGRES_PASSWORD\s*=\s*(.*?)\s*$/i.exec(line)?.[1];
      return password !== undefined && password !== '' && !/^\$\{[^}]+\}$/.test(password)
        && !/^(?:changeme|password|REPLACE_ME)$/i.test(password);
    },
  },
  {
    name: 'api_key_hash_literal',
    test: (line, path) => apiKeyHash.test(line)
      && !path.split('/').at(-1)?.endsWith('.example.json')
      && !path.split('/').at(-1)?.endsWith('.test.ts'),
  },
];

export const findCredentialLeaks = (input: readonly { path: string; content: string }[]): CredentialLeak[] => {
  const leaks: CredentialLeak[] = [];
  for (const file of input) {
    if (hasExampleName(file.path)) continue;

    if (isTrackedEnv(file.path)) leaks.push({ path: file.path, line: 1, rule: 'tracked_env_file' });
    if (hasTrackedAccessPolicy(file.path)) leaks.push({ path: file.path, line: 1, rule: 'tracked_access_policy' });

    const lines = file.content.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (PLACEHOLDER_LINE.test(line)) return;
      const lineNumber = index + 1;
      for (const rule of credentialRules) {
        if (rule.test(line, file.path)) leaks.push({ path: file.path, line: lineNumber, rule: rule.name });
      }
    });
  }
  return leaks;
};

export const formatLeaks = (leaks: readonly CredentialLeak[]): string =>
  leaks.map(({ path, line, rule }) => `${path}:${line} ${rule}`).join('\n');
