import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, test } from 'bun:test';
import type { AppConfig } from './config.ts';
import { InputError, normalizeSourceLabel, pathInputs, textInput } from './input.ts';

const configFor = (inputRoot: string): AppConfig => ({
  DATABASE_URL: 'postgresql://localhost/test',
  INPUT_ROOT: inputRoot,
  MCP_TRANSPORT: 'stdio',
  MCP_HOST: '127.0.0.1',
  MCP_PORT: 3000,
  MAX_HTTP_SESSIONS: 100,
  HTTP_SESSION_IDLE_TIMEOUT_MS: 900_000,
  MAX_FILES_PER_JOB: 3,
  MAX_FILE_BYTES: 8,
  MAX_JOB_BYTES: 12,
  MAX_OUTPUT_CHARS: 256,
  QUERY_TIMEOUT_MS: 1000,
  MAX_ACTIVE_QUERIES: 4,
  MAX_RETAINED_VERSIONS: 3,
  QUEUE_POLL_MS: 100,
  LOG_LEVEL: 'error',
});

describe('input snapshots', () => {
  test('rejects traversal before touching the filesystem', async () => {
    const config = configFor('/does/not/exist');
    await expect(pathInputs('../secret.md', config)).rejects.toMatchObject({ code: 'INVALID_PATH' });
  });

  test('snapshots sorted Markdown files and ignores unsupported files', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'graphrag-input-'));
    try {
      await mkdir(path.join(root, 'notes'));
      await writeFile(path.join(root, 'notes', 'b.md'), 'second');
      await writeFile(path.join(root, 'notes', 'a.md'), 'first');
      await writeFile(path.join(root, 'notes', 'ignored.txt'), 'ignore');
      const inputs = await pathInputs('notes', configFor(root));
      expect(inputs.map((input) => input.sourceLabel)).toEqual(['notes/a.md', 'notes/b.md']);
      expect(inputs[0]?.contentHash).toHaveLength(64);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test('rejects symbolic links and oversized explicit text', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'graphrag-input-'));
    const outside = path.join(os.tmpdir(), `graphrag-outside-${Date.now()}.md`);
    try {
      await writeFile(outside, 'outside');
      await symlink(outside, path.join(root, 'linked.md'));
      await expect(pathInputs('linked.md', configFor(root))).rejects.toMatchObject({
        code: 'SYMLINK_NOT_ALLOWED',
      });
      expect(() => textInput('123456789', undefined, configFor(root))).toThrow(InputError);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { force: true });
    }
  });

  test('shortens long source labels to the database limit with a stable hash suffix', () => {
    const longLabel = `${'source/'.repeat(40)}document.md`;
    const shortened = normalizeSourceLabel(longLabel);
    expect(Array.from(shortened)).toHaveLength(255);
    expect(shortened).toMatch(/-[a-f0-9]{16}$/);
    expect(normalizeSourceLabel(longLabel)).toBe(shortened);
    expect(normalizeSourceLabel(`${longLabel}!`)).not.toBe(shortened);
  });
});