import { createHash } from 'node:crypto';

export type DatasetBundleInput = {
  datasetId: string;
  datasetVersion: string;
  createdAt: string;
  license: { spdx: string; url: string; text?: string };
  schemaVersion: number;
  entities: readonly { id: string; name: string; description: string }[];
  relationships: readonly {
    id: string;
    sourceEntityId: string;
    targetEntityId: string;
    description: string;
  }[];
  communities: readonly {
    id: string;
    name: string;
    summary: string;
    level: number;
    parentId: string | null;
    members: readonly string[];
  }[];
  sources: readonly { id: string; sourceLabel: string; contentHash: string; origin?: string }[];
  evalQuestions: readonly { id: string; question: string; expectedSourceIds: readonly string[] }[];
};

export type DatasetManifest = {
  bundle_format: 'graphrag-ts-dataset-bundle@1';
  dataset_id: string;
  dataset_version: string;
  created_at: string;
  schema_version: number;
  license: { spdx: string; url: string };
  files: readonly { path: string; bytes: number; sha256: string }[];
  bundle_sha256: string;
};

export type DatasetBundleFile = { path: string; content: string };

const canonicalValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  );
};

const compareStrings = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

export const canonicalJson = (value: unknown): string => JSON.stringify(canonicalValue(value));

const sha256 = (content: string): string => createHash('sha256').update(content, 'utf8').digest('hex');
const withTrailingNewline = (content: string): string => {
  const normalized = content.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
};
const jsonl = (rows: readonly unknown[]): string =>
  withTrailingNewline(rows.map(canonicalJson).join('\n'));

const bundleDigest = (files: readonly { path: string; sha256: string }[]): string =>
  sha256(files.map(({ sha256: digest, path }) => `${digest}  ${path}\n`).join(''));

const schemaFor = (schemaVersion: number) => ({
  bundle_format: 'graphrag-ts-dataset-bundle@1',
  schema_version: schemaVersion,
  entities: { id: 'string', name: 'string', description: 'string' },
  relationships: { id: 'string', sourceEntityId: 'string', targetEntityId: 'string', description: 'string' },
  communities: { id: 'string', name: 'string', summary: 'string', level: 'number', parentId: 'string|null', members: 'string[]' },
  sources: { id: 'string', source_label: 'string', content_hash: 'string', origin: 'string (optional)' },
  eval_questions: { id: 'string', question: 'string', expected_source_ids: 'string[]' },
});

const payloadFilesFor = (input: DatasetBundleInput): DatasetBundleFile[] => [
  { path: 'entities.jsonl', content: jsonl([...input.entities].sort((left, right) => compareStrings(left.id, right.id))) },
  {
    path: 'relationships.jsonl',
    content: jsonl([...input.relationships].sort((left, right) => compareStrings(left.id, right.id))
      .map(({ id, sourceEntityId, targetEntityId, description }) => ({ id, sourceEntityId, targetEntityId, description }))),
  },
  {
    path: 'communities.jsonl',
    content: jsonl([...input.communities].sort((left, right) => left.level - right.level
      || compareStrings(left.name, right.name) || compareStrings(left.id, right.id))
      .map(({ id, name, summary, level, parentId, members }) => ({ id, name, summary, level, parentId, members: [...members].sort(compareStrings) }))),
  },
  {
    path: 'sources.json',
    content: withTrailingNewline(canonicalJson([...input.sources].sort((left, right) => compareStrings(left.id, right.id))
      .map(({ id, sourceLabel, contentHash, ...source }) => ({
        id, source_label: sourceLabel, content_hash: contentHash,
        ...(source.origin === undefined ? {} : { origin: source.origin }),
      })))),
  },
  {
    path: 'eval-questions.json',
    content: withTrailingNewline(canonicalJson([...input.evalQuestions].sort((left, right) => compareStrings(left.id, right.id))
      .map(({ id, question, expectedSourceIds }) => ({ id, question, expected_source_ids: [...expectedSourceIds].sort(compareStrings) })))),
  },
  { path: 'schema.json', content: withTrailingNewline(canonicalJson(schemaFor(input.schemaVersion))) },
  { path: 'LICENSE.txt', content: withTrailingNewline(input.license.text ?? `${input.license.spdx}\n${input.license.url}\n`) },
];

const createManifest = (input: DatasetBundleInput, payloadFiles: readonly DatasetBundleFile[]): DatasetManifest => {
  const files = payloadFiles.map(({ path, content }) => ({ path, bytes: Buffer.byteLength(content, 'utf8'), sha256: sha256(content) }))
    .sort((left, right) => compareStrings(left.path, right.path));
  return {
    bundle_format: 'graphrag-ts-dataset-bundle@1', dataset_id: input.datasetId, dataset_version: input.datasetVersion,
    created_at: input.createdAt, schema_version: input.schemaVersion,
    license: { spdx: input.license.spdx, url: input.license.url }, files, bundle_sha256: bundleDigest(files),
  };
};

export const buildDatasetBundle = (input: DatasetBundleInput): {
  files: readonly DatasetBundleFile[];
  manifest: DatasetManifest;
} => {
  const payloadFiles = payloadFilesFor(input);
  const manifest = createManifest(input, payloadFiles);
  const files = [...payloadFiles, { path: 'manifest.json', content: withTrailingNewline(canonicalJson(manifest)) }]
    .sort((left, right) => compareStrings(left.path, right.path));

  return { files, manifest };
};

export const verifyDatasetBundle = (
  files: readonly DatasetBundleFile[],
): { ok: boolean; mismatches: readonly { path: string; reason: 'missing' | 'hash_mismatch' | 'unexpected' }[] } => {
  const mismatches: { path: string; reason: 'missing' | 'hash_mismatch' | 'unexpected' }[] = [];
  const byPath = new Map(files.map((file) => [file.path, file]));
  const manifestFile = byPath.get('manifest.json');
  if (!manifestFile) return { ok: false, mismatches: [{ path: 'manifest.json', reason: 'missing' }] };
  const manifest = parseManifest(manifestFile.content);
  if (!manifest) return { ok: false, mismatches: [{ path: 'manifest.json', reason: 'hash_mismatch' }] };

  const entries: { path: string; bytes: number; sha256: string }[] = [];
  for (const entry of manifest.files) {
    const validEntry = manifestEntry(entry);
    if (!validEntry) {
      mismatches.push({ path: 'manifest.json', reason: 'hash_mismatch' });
      continue;
    }
    entries.push(validEntry);
    const actual = byPath.get(validEntry.path);
    if (!actual) {
      mismatches.push({ path: validEntry.path, reason: 'missing' });
      continue;
    }
    if (Buffer.byteLength(actual.content, 'utf8') !== validEntry.bytes || sha256(actual.content) !== validEntry.sha256) {
      mismatches.push({ path: validEntry.path, reason: 'hash_mismatch' });
    }
  }

  const listedPaths = new Set(entries.map(({ path }) => path));
  for (const file of files) {
    if (file.path !== 'manifest.json' && !listedPaths.has(file.path)) {
      mismatches.push({ path: file.path, reason: 'unexpected' });
    }
  }
  if (bundleDigest([...entries].sort((left, right) => compareStrings(left.path, right.path))) !== manifest.bundle_sha256) {
    mismatches.push({ path: 'manifest.json', reason: 'hash_mismatch' });
  }
  return { ok: mismatches.length === 0, mismatches };
};

const parseManifest = (content: string): { files: unknown[]; bundle_sha256: string } | undefined => {
  try {
    const value: unknown = JSON.parse(content);
    if (typeof value !== 'object' || value === null || !('files' in value)
      || !Array.isArray(value.files) || !('bundle_sha256' in value) || typeof value.bundle_sha256 !== 'string') return undefined;
    return { files: value.files, bundle_sha256: value.bundle_sha256 };
  } catch {
    return undefined;
  }
};

const manifestEntry = (value: unknown): { path: string; bytes: number; sha256: string } | undefined => {
  if (typeof value !== 'object' || value === null || !('path' in value) || typeof value.path !== 'string'
    || !('bytes' in value) || typeof value.bytes !== 'number'
    || !('sha256' in value) || typeof value.sha256 !== 'string') return undefined;
  return { path: value.path, bytes: value.bytes, sha256: value.sha256 };
};
