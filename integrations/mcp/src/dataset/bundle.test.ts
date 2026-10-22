import { describe, expect, test } from 'bun:test';
import { buildDatasetBundle, verifyDatasetBundle, type DatasetBundleInput } from './bundle.ts';

const input: DatasetBundleInput = {
  datasetId: 'sample',
  datasetVersion: 'version-1',
  createdAt: '2026-01-02T03:04:05.000Z',
  license: { spdx: 'MIT', url: 'https://example.test/license', text: 'Sample license\n' },
  schemaVersion: 1,
  entities: [
    { id: 'entity-b', name: 'Beta', description: 'second' },
    { id: 'entity-a', name: 'Alpha', description: 'first' },
  ],
  relationships: [
    { id: 'edge-b', sourceEntityId: 'entity-b', targetEntityId: 'entity-a', description: 'relates' },
    { id: 'edge-a', sourceEntityId: 'entity-a', targetEntityId: 'entity-b', description: 'connects' },
  ],
  communities: [
    { id: 'community-b', name: 'Beta', summary: 'second', level: 2, parentId: null, members: ['Beta', 'Alpha'] },
    { id: 'community-a', name: 'Alpha', summary: 'first', level: 1, parentId: 'community-b', members: ['Gamma', 'Delta'] },
  ],
  sources: [
    { id: 'source-b', sourceLabel: 'b.md', contentHash: 'hash-b', origin: 'https://example.test/license' },
    { id: 'source-a', sourceLabel: 'a.md', contentHash: 'hash-a' },
  ],
  evalQuestions: [
    { id: 'question-b', question: 'Question B?', expectedSourceIds: ['source-b', 'source-a'] },
    { id: 'question-a', question: 'Question A?', expectedSourceIds: ['source-a'] },
  ],
};

const fileMap = (value: DatasetBundleInput): Map<string, string> =>
  new Map(buildDatasetBundle(value).files.map(({ path, content }) => [path, content]));

describe('dataset bundle', () => {
  test('builds byte-identical files and hash from the same input', () => {
    const first = buildDatasetBundle(input);
    const second = buildDatasetBundle(input);
    expect(first.files).toEqual(second.files);
    expect(first.manifest.bundle_sha256).toBe(second.manifest.bundle_sha256);
  });

  test('is independent of row, member, and expected-source order', () => {
    const shuffled: DatasetBundleInput = {
      ...input,
      entities: [...input.entities].reverse(),
      relationships: [...input.relationships].reverse(),
      communities: [...input.communities].reverse().map((community) => ({
        ...community,
        members: [...community.members].reverse(),
      })),
      evalQuestions: [...input.evalQuestions].reverse().map((question) => ({
        ...question,
        expectedSourceIds: [...question.expectedSourceIds].reverse(),
      })),
    };
    const first = buildDatasetBundle(input);
    const second = buildDatasetBundle(shuffled);
    expect(second.files).toEqual(first.files);
    expect(second.manifest.bundle_sha256).toBe(first.manifest.bundle_sha256);
  });

  test('is independent of object key order', () => {
    const reordered = JSON.parse(JSON.stringify(input, (_key, value: unknown) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
      return Object.fromEntries(Object.entries(value).reverse());
    })) as DatasetBundleInput;
    expect(fileMap(reordered)).toEqual(fileMap(input));
  });

  test('detects content tampering, missing and unexpected files, and manifest hash tampering', () => {
    const bundle = buildDatasetBundle(input);
    const entityTampered = bundle.files.map((file) => file.path === 'entities.jsonl'
      ? { ...file, content: `${file.content.replace('Alpha', 'Alphb')}` }
      : file);
    expect(verifyDatasetBundle(entityTampered)).toEqual({
      ok: false,
      mismatches: [{ path: 'entities.jsonl', reason: 'hash_mismatch' }],
    });

    const missing = bundle.files.filter((file) => file.path !== 'sources.json');
    expect(verifyDatasetBundle(missing).mismatches).toContainEqual({ path: 'sources.json', reason: 'missing' });

    const unexpected = [...bundle.files, { path: 'extra.txt', content: 'extra\n' }];
    expect(verifyDatasetBundle(unexpected).mismatches).toContainEqual({ path: 'extra.txt', reason: 'unexpected' });

    const manifestTampered = bundle.files.map((file) => file.path === 'manifest.json'
      ? {
        ...file,
        content: file.content.replace(bundle.manifest.bundle_sha256, '0'.repeat(64)),
      }
      : file);
    expect(verifyDatasetBundle(manifestTampered).mismatches).toContainEqual({
      path: 'manifest.json', reason: 'hash_mismatch',
    });
  });

  test('does not include manifest in its own files list and prefers supplied license text', () => {
    const bundle = buildDatasetBundle(input);
    expect(bundle.manifest.files.some(({ path }) => path === 'manifest.json')).toBe(false);
    expect(bundle.files.find(({ path }) => path === 'LICENSE.txt')?.content).toBe('Sample license\n');
    expect(buildDatasetBundle({ ...input, license: { spdx: 'NOASSERTION', url: '' } })
      .manifest.license.spdx).toBe('NOASSERTION');
  });
});
