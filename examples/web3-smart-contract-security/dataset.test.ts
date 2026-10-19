import { afterEach, expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadConfig } from '../../integrations/mcp/src/config';
import { pathInputs } from '../../integrations/mcp/src/input';
import { renderDelivery, writeDelivery } from './export';
import { sqlLiteral } from './sql';
import { validateDataset } from './validate';

const sample = validateDataset(JSON.parse(readFileSync(new URL('./sample.json', import.meta.url), 'utf8')));
const directories: string[] = [];
const outputPath = (): string => {
  const path = join(import.meta.dir, `.test-output-${randomUUID()}`);
  directories.push(path);
  return path;
};
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

test('exports are canonical, deterministic, complete, and hash-verifiable', () => {
  const first = renderDelivery(sample);
  const reordered = {
    ...sample, sources: [...sample.sources].reverse(), relations: [...sample.relations].reverse(),
    entities: [...sample.entities].reverse().map((row) => ({ ...row, evidenceIds: [...row.evidenceIds].reverse() })),
    questions: [...sample.questions].reverse(),
  };
  expect([...renderDelivery(reordered)]).toEqual([...first]);
  const manifest = JSON.parse(first.get('manifest.json') ?? '');
  expect(manifest).toMatchObject({
    formatVersion: 1, version: '1.0.0', synthetic: true, license: 'MIT',
    counts: { entities: 11, relations: 13, sources: 5, questions: 5 },
  });
  expect(Object.keys(manifest)).not.toContain('timestamp');
  expect(manifest.files).toHaveLength(first.size - 1);
  for (const row of manifest.files) {
    const content = first.get(row.path);
    expect(content).toBeDefined();
    expect(row.bytes).toBe(Buffer.byteLength(content ?? ''));
    expect(row.sha256).toBe(createHash('sha256').update(content ?? '').digest('hex'));
  }
  expect(validateDataset(JSON.parse(first.get('dataset.json') ?? ''))).toEqual(sample);
});

test('JSONL preserves references and SQL includes scoped foreign keys and a transaction', () => {
  const files = renderDelivery(sample);
  const rows = (name: string): readonly unknown[] => (files.get(name) ?? '').trim().split('\n').map((line) => JSON.parse(line));
  expect(rows('entities.jsonl')).toEqual(sample.entities);
  expect(rows('relations.jsonl')).toEqual(sample.relations);
  expect(rows('sources.jsonl')).toEqual(sample.sources);
  expect(rows('questions.jsonl')).toEqual(sample.questions);
  const sql = files.get('dataset.sql') ?? '';
  expect(sql.startsWith('BEGIN;\n')).toBe(true);
  expect(sql.endsWith('COMMIT;\n')).toBe(true);
  expect(sql).toContain('FOREIGN KEY (dataset_id, from_id) REFERENCES web3_security_dataset.entities(dataset_id, id)');
  expect(sql).toContain('FOREIGN KEY (dataset_id, source_id) REFERENCES web3_security_dataset.sources(dataset_id, id)');
  expect(sql).not.toContain('rag_');
  sample.relations.forEach((row) => {
    expect(sql).toContain([sample.id, row.id, row.kind, row.from, row.to].map(sqlLiteral).join(', '));
    row.evidenceIds.forEach((source) =>
      expect(sql).toContain([sample.id, row.id, source].map(sqlLiteral).join(', ')));
  });
});

test('SQL and JSONL preserve quotes, backslashes, Unicode, newlines, and SQL-looking text', () => {
  const payload = "Reviewer O'Brien's \\notes\n雪\t'); DROP TABLE imaginary; --";
  const first = sample.sources[0];
  if (!first) throw new Error('Missing sample source');
  const changed = { ...sample, title: payload, sources: [{ ...first, excerpt: payload }, ...sample.sources.slice(1)] };
  const files = renderDelivery(changed);
  const sql = files.get('dataset.sql') ?? '';
  expect(sqlLiteral(payload)).toBe("E'Reviewer O''Brien''s \\\\notes\n雪\t''); DROP TABLE imaginary; --'");
  expect(sql).toContain(sqlLiteral(payload));
  expect(JSON.parse((files.get('sources.jsonl') ?? '').split('\n')[0] ?? '').excerpt).toBe(payload);
  expect(() => sqlLiteral('\0')).toThrow('Unsupported PostgreSQL text');
  expect(() => sqlLiteral('\ud800')).toThrow('Unsupported PostgreSQL text');
});

test('five relational questions cover existing graph evidence, with no fabricated answers', () => {
  expect(sample.questions).toHaveLength(5);
  const allEvidence = new Set<string>();
  sample.questions.forEach((question) => {
    expect(question.relationIds.length).toBeGreaterThanOrEqual(2);
    expect(question.expectedEvidenceIds.length).toBeGreaterThanOrEqual(2);
    expect(question).not.toHaveProperty('answer');
    const required = new Set(sample.relations.filter((row) => question.relationIds.includes(row.id))
      .flatMap((row) => row.evidenceIds));
    expect(new Set(question.expectedEvidenceIds)).toEqual(required);
    question.expectedEvidenceIds.forEach((id) => {
      const source = sample.sources.find((row) => row.id === id);
      expect(source?.excerpt.length).toBeGreaterThan(0);
      allEvidence.add(id);
    });
  });
  expect(allEvidence.size).toBe(sample.sources.length);
});

const invalidCases: readonly [string, unknown][] = [
  ['extra field', { ...sample, surprise: true }],
  ['empty license', { ...sample, license: '' }],
  ['missing license', { ...sample, license: undefined }],
  ['empty license text', { ...sample, licenseText: ' ' }],
  ['wrong version', { ...sample, version: 'latest' }],
  ['empty sources', { ...sample, sources: [] }],
  ['wrong synthetic flag', { ...sample, synthetic: 'true' }],
  ['misleading synthetic flag', { ...sample, synthetic: false }],
  ['duplicate ID', { ...sample, entities: [...sample.entities, sample.entities[0]] }],
  ['cross-kind duplicate ID', { ...sample, entities: sample.entities.map((row) => ({ ...row, id: 's-dependencies' })) }],
  ['bad ID', { ...sample, id: '../bad' }],
  ['missing provenance', { ...sample, sources: sample.sources.map((row) => ({ ...row, provenance: undefined })) }],
  ['empty rights', { ...sample, sources: sample.sources.map((row) => ({ ...row, provenance: { ...row.provenance, rights: '' } })) }],
  ['empty source license', { ...sample, sources: sample.sources.map((row) => ({ ...row, license: '' })) }],
  ['duplicate path', { ...sample, sources: sample.sources.map((row) => ({ ...row, markdownPath: 'same.md' })) }],
  ['dangling endpoint', { ...sample, relations: sample.relations.map((row) => ({ ...row, from: 'missing' })) }],
  ['wrong endpoint kind', { ...sample, relations: sample.relations.map((row) => ({ ...row, from: 'm-state' })) }],
  ['unknown predicate', { ...sample, relations: sample.relations.map((row) => ({ ...row, kind: 'invented' })) }],
  ['empty evidence', { ...sample, entities: sample.entities.map((row) => ({ ...row, evidenceIds: [] })) }],
  ['duplicate evidence', { ...sample, entities: sample.entities.map((row) => ({ ...row, evidenceIds: ['s-loom', 's-loom'] })) }],
  ['dangling evidence', { ...sample, relations: sample.relations.map((row) => ({ ...row, evidenceIds: ['missing'] })) }],
  ['dangling question relation', { ...sample, questions: sample.questions.map((row) => ({ ...row, relationIds: ['missing'] })) }],
  ['dangling question evidence', { ...sample, questions: sample.questions.map((row) => ({ ...row, expectedEvidenceIds: ['missing'] })) }],
  ['incomplete question coverage', { ...sample, questions: sample.questions.map((row) => ({ ...row, expectedEvidenceIds: ['s-loom'] })) }],
  ['NUL', { ...sample, title: 'bad\0text' }],
  ['unpaired surrogate', { ...sample, title: 'bad\ud800text' }],
  ['control character', { ...sample, title: 'bad\u001btext' }],
];
test.each(invalidCases)('rejects malformed input: %s', (_label, value) => {
  expect(() => validateDataset(value)).toThrow('Invalid dataset');
});

test.each(['../escape.md', '/absolute.md', 'C:\\evil.md', 'nested/file.md', '..\\escape.md', '%2e%2e.md', 'UPPER.md', 'x.md\n', 'x.sql'])(
  'rejects unsafe Markdown path: %s', (markdownPath) => {
    const sources = sample.sources.map((row) => ({ ...row, markdownPath }));
    expect(() => validateDataset({ ...sample, sources })).toThrow('markdownPath');
  },
);

test('seller-owned licensed inputs retain separate license and provenance, without inventing data', () => {
  const input = {
    ...sample, synthetic: false, license: 'LicenseRef-Seller-Agreement',
    licenseText: 'Example placeholder agreement: replace with actual authorized terms.',
    sources: sample.sources.map((row) => ({
      ...row, license: 'LicenseRef-Seller-Agreement',
      provenance: { ...row.provenance, origin: 'seller-owned', rights: 'Seller asserts ownership; independently verify.' },
    })),
  };
  const files = renderDelivery(input);
  expect(JSON.parse(files.get('manifest.json') ?? '').license).toBe('LicenseRef-Seller-Agreement');
  expect(files.get('LICENSE.txt')).toContain('replace with actual authorized terms');
});

test('filesystem writes are exclusive and corpus is accepted by actual MCP path ingestion', async () => {
  const output = outputPath();
  await writeDelivery(sample, output);
  const before = await readFile(join(output, 'manifest.json'), 'utf8');
  await expect(writeDelivery(sample, output)).rejects.toThrow();
  expect(await readFile(join(output, 'manifest.json'), 'utf8')).toBe(before);
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousInputRoot = process.env.INPUT_ROOT;
  let config;
  try {
    process.env.DATABASE_URL = previousDatabaseUrl ?? 'postgresql://unused';
    process.env.INPUT_ROOT = join(output, 'corpus');
    config = loadConfig();
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousInputRoot === undefined) delete process.env.INPUT_ROOT;
    else process.env.INPUT_ROOT = previousInputRoot;
  }
  const inputs = await pathInputs('.', config);
  expect(inputs).toHaveLength(5);
  inputs.forEach((input) => {
    expect(input.content).toContain('SYNTHETIC FICTION');
    expect(input.content).toContain('Evidence ID: s-');
    expect(input.mediaType).toBe('text/markdown');
  });
});

test('existing empty directories and symlinks are not overwritten; invalid data creates nothing', async () => {
  const directory = outputPath();
  await mkdir(directory);
  await expect(writeDelivery(sample, directory)).rejects.toThrow();
  const link = outputPath();
  await symlink(directory, link);
  await expect(writeDelivery(sample, link)).rejects.toThrow();
  const invalidOutput = outputPath();
  await expect(writeDelivery({}, invalidOutput)).rejects.toThrow('Invalid dataset');
  expect(await Bun.file(join(invalidOutput, 'manifest.json')).exists()).toBe(false);
  await expect(readFile(invalidOutput)).rejects.toThrow();
});

test('concurrent delivery attempts cannot overwrite each other', async () => {
  const output = outputPath();
  const results = await Promise.allSettled([writeDelivery(sample, output), writeDelivery(sample, output)]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  expect(await readFile(join(output, 'manifest.json'), 'utf8')).toBe(renderDelivery(sample).get('manifest.json') ?? '');
});

const cli = (args: readonly string[]): ReturnType<typeof Bun.spawnSync> =>
  Bun.spawnSync([process.execPath, join(import.meta.dir, 'cli.ts'), ...args], { stdout: 'pipe', stderr: 'pipe' });

test('CLI creates a bundle, handles --input, refuses overwrite, and validates arguments', async () => {
  const output = outputPath();
  const created = cli(['--out', output, '--input', join(import.meta.dir, 'sample.json')]);
  expect(created.exitCode).toBe(0);
  expect(await Bun.file(join(output, 'manifest.json')).exists()).toBe(true);
  const before = await readFile(join(output, 'manifest.json'), 'utf8');
  expect(cli(['--out', output]).exitCode).toBe(1);
  expect(await readFile(join(output, 'manifest.json'), 'utf8')).toBe(before);
  expect(cli(['--out', outputPath()]).exitCode).toBe(0);
  expect(cli(['--help']).exitCode).toBe(0);
  expect(cli([]).exitCode).toBe(1);
  expect(cli(['--out']).exitCode).toBe(1);
  expect(cli(['--out', outputPath(), '--out', outputPath()]).exitCode).toBe(1);
  expect(cli(['--unknown', 'value']).exitCode).toBe(1);
});

test('CLI rejects malformed JSON and invalid datasets without creating output', async () => {
  const scratch = outputPath();
  await mkdir(scratch);
  const input = join(scratch, 'bad.json');
  const output = join(scratch, 'never-created');
  await writeFile(input, '{broken');
  expect(cli(['--input', input, '--out', output]).exitCode).toBe(1);
  await expect(readFile(output)).rejects.toThrow();
  await writeFile(input, '{}');
  expect(cli(['--input', input, '--out', output]).exitCode).toBe(1);
  await expect(readFile(output)).rejects.toThrow();
});
