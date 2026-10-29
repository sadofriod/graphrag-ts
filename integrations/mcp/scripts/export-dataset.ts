/**
 * Export the active published snapshot as a deterministic dataset bundle.
 * Pass the same --created-at ISO-8601 value to reproduce identical bytes across runs.
 */
import 'dotenv/config';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { Pool } from 'pg';
import { buildDatasetBundle, type DatasetBundleInput } from '../src/dataset/bundle.ts';
import { findDataset, isJudgmentDataset, loadDatasetRegistry } from '../src/x402/datasets.ts';
import { createStore } from '../src/store.ts';
import { workspaceIdSchema } from '../src/workspace.ts';

type Arguments = {
  dataset: string;
  workspace: string;
  out: string;
  questions?: string;
  datasetFile?: string;
  licenseText?: string;
  createdAt: string;
  dryRun: boolean;
};

const argumentFlags = new Set(['--dataset', '--workspace', '--out', '--questions', '--dataset-file', '--license-text', '--created-at']);

const readArgument = (args: readonly string[], index: number, values: Map<string, string>): number => {
  const flag = args[index];
  if (flag === undefined || !argumentFlags.has(flag)) throw new Error(`Unknown argument: ${flag ?? ''}`);
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`Expected a value after ${flag}.`);
  values.set(flag, value);
  return index + 1;
};

const requiredArgument = (values: Map<string, string>, name: string, usage: string): string => {
  const value = values.get(name);
  if (!value) throw new Error(`Required argument missing: ${usage}.`);
  return value;
};

const parseCreationTime = (value: string | undefined): string => {
  const createdAt = value ?? new Date().toISOString();
  if (!/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(createdAt) || Number.isNaN(Date.parse(createdAt))) {
    throw new Error('--created-at must be an ISO-8601 timestamp with a timezone.');
  }
  return createdAt;
};

const parseArguments = (args: readonly string[]): Arguments => {
  const values = new Map<string, string>();
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--dry-run') {
      dryRun = true;
      continue;
    }
    index = readArgument(args, index, values);
  }
  const dataset = requiredArgument(values, '--dataset', '--dataset <id>');
  const workspace = workspaceIdSchema.parse(requiredArgument(values, '--workspace', '--workspace <id>'));
  const createdAt = parseCreationTime(values.get('--created-at'));
  const questions = values.get('--questions');
  const datasetFile = values.get('--dataset-file');
  const licenseText = values.get('--license-text');
  const out = values.get('--out');
  return {
    dataset,
    workspace,
    out: out ?? './exports',
    ...(questions === undefined ? {} : { questions }),
    ...(datasetFile === undefined ? {} : { datasetFile }),
    ...(licenseText === undefined ? {} : { licenseText }),
    createdAt,
    dryRun,
  };
};

const parseQuestions = async (file: string | undefined): Promise<DatasetBundleInput['evalQuestions']> => {
  if (file === undefined) return [];
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error('--questions must contain a JSON array.');
  return parsed.map((question: unknown, index: number) => {
    if (typeof question !== 'object' || question === null || !('id' in question) || typeof question.id !== 'string'
      || !('question' in question) || typeof question.question !== 'string'
      || !('expected_source_ids' in question) || !Array.isArray(question.expected_source_ids)
      || !question.expected_source_ids.every((id: unknown) => typeof id === 'string')) {
      throw new Error(`Invalid evaluation question at array index ${index}.`);
    }
    return {
      id: question.id,
      question: question.question,
      expectedSourceIds: question.expected_source_ids as string[],
    };
  });
};

const assertPathSegment = (value: string, label: string): void => {
  if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
    throw new Error(`${label} is not a safe output directory name: ${value}`);
  }
};

const requireDatabaseUrl = (): string => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required to export a dataset.');
  return databaseUrl;
};

const loadRegistryDataset = async (args: Arguments) => {
  const registryPath = args.datasetFile ?? process.env.X402_DATASETS_FILE;
  const registry = registryPath === undefined ? undefined : await loadDatasetRegistry(registryPath);
  const registryDataset = registry === undefined ? undefined : findDataset(registry, args.dataset);
  if (registryDataset !== undefined && !isJudgmentDataset(registryDataset) && registryDataset.workspaceId !== args.workspace) {
    throw new Error(`Dataset "${args.dataset}" belongs to workspace "${registryDataset.workspaceId}", not requested workspace "${args.workspace}".`);
  }
  return registryDataset;
};

const loadLicenseText = (args: Arguments): Promise<string | undefined> =>
  args.licenseText === undefined ? Promise.resolve(undefined) : readFile(args.licenseText, 'utf8');

const prepareLicense = (
  dataset: string,
  registryDataset: Awaited<ReturnType<typeof loadDatasetRegistry>>['datasets'][number] | undefined,
  licenseText: string | undefined,
) => {
  if (registryDataset === undefined && licenseText === undefined) {
    throw new Error(`No license is available for dataset "${dataset}"; provide a registry entry or --license-text.`);
  }
  return registryDataset === undefined
    ? { spdx: 'NOASSERTION', url: '', ...(licenseText === undefined ? {} : { text: licenseText }) }
    : { spdx: registryDataset.license.spdx, url: registryDataset.license.url, ...(licenseText === undefined ? {} : { text: licenseText }) };
};

const loadExportSettings = async (args: Arguments) => {
  const databaseUrl = requireDatabaseUrl();
  const registryDataset = await loadRegistryDataset(args);
  const licenseText = await loadLicenseText(args);
  const license = prepareLicense(args.dataset, registryDataset, licenseText);
  return { databaseUrl, registryDataset, license };
};

const writeBundle = async (out: string, dataset: string, version: string, dryRun: boolean, files: ReturnType<typeof buildDatasetBundle>['files']): Promise<string> => {
  assertPathSegment(dataset, 'Dataset ID');
  assertPathSegment(version, 'Dataset version');
  const outputDir = path.resolve(out, dataset, version);
  if (!dryRun) {
    await mkdir(outputDir, { recursive: true });
    for (const file of files) {
      const filePath = path.join(outputDir, file.path);
      await writeFile(filePath, file.content, { encoding: 'utf8', mode: 0o644 });
      await chmod(filePath, 0o644);
    }
  }
  return outputDir;
};

const loadDatasetInput = async (
  pool: Pool,
  args: Arguments,
  license: DatasetBundleInput['license'],
  registryDataset: Awaited<ReturnType<typeof loadDatasetRegistry>>['datasets'][number] | undefined,
  version: { id: string; namespace: string },
): Promise<{ input: DatasetBundleInput; version: string }> => {
  const [entities, relationships, communities, sources, evalQuestions] = await Promise.all([
    pool.query<{ id: string; name: string; description: string | null }>(
      'SELECT id, name, description FROM rag_entities WHERE namespace = $1 ORDER BY id', [version.namespace],
    ),
    pool.query<{ id: string; source_entity_id: string; target_entity_id: string; relationship_desc: string }>(
      `SELECT id, source_entity_id, target_entity_id, relationship_desc
       FROM rag_graph_edges WHERE namespace = $1 ORDER BY id`, [version.namespace],
    ),
    pool.query<{ id: string; community_name: string; summary_content: string; level: number; parent_community_id: string | null; members: string[] }>(
      `SELECT id, community_name, summary_content, level, parent_community_id, members
       FROM rag_community_summaries WHERE namespace = $1 ORDER BY level, community_name, id`, [version.namespace],
    ),
    pool.query<{ id: string; source_label: string; content_hash: string }>(
      `SELECT s.id, s.source_label, s.content_hash
       FROM index_version_sources vs JOIN knowledge_sources s ON s.id = vs.source_id
       WHERE vs.version_id = $1 ORDER BY s.id`, [version.id],
    ),
    parseQuestions(args.questions),
  ]);
  const input: DatasetBundleInput = {
    datasetId: args.dataset, datasetVersion: version.id, createdAt: args.createdAt, license, schemaVersion: 1,
    entities: entities.rows.map(({ id, name, description }) => ({ id, name, description: description ?? '' })),
    relationships: relationships.rows.map(({ id, source_entity_id, target_entity_id, relationship_desc }) => ({
      id, sourceEntityId: source_entity_id, targetEntityId: target_entity_id, description: relationship_desc,
    })),
    communities: communities.rows.map((community) => ({
      id: community.id, name: community.community_name, summary: community.summary_content,
      level: community.level, parentId: community.parent_community_id, members: community.members,
    })),
    sources: sources.rows.map(({ id, source_label, content_hash }) => ({
      id, sourceLabel: source_label, contentHash: content_hash,
      ...(registryDataset === undefined ? {} : { origin: registryDataset.license.url }),
    })),
    evalQuestions,
  };
  return { input, version: version.id };
};

const printExportResult = (dataset: string, version: string, files: ReturnType<typeof buildDatasetBundle>['manifest']['files'], hash: string, outputDir: string): void => {
  console.log(JSON.stringify({ dataset_id: dataset, dataset_version: version, files, bundle_sha256: hash, output_dir: outputDir }));
};

const main = async (): Promise<void> => {
  const args = parseArguments(process.argv.slice(2));
  const { databaseUrl, registryDataset, license } = await loadExportSettings(args);
  const pool = new Pool({ connectionString: databaseUrl });
  const store = createStore(databaseUrl);
  const leaseDurationMs = 30 * 60 * 1000;
  let lease: Awaited<ReturnType<typeof store.acquireActiveVersionLease>> = null;
  let renewal: ReturnType<typeof setInterval> | undefined;
  let renewalInFlight: Promise<void> | undefined;
  let renewalError: unknown;

  try {
    lease = await store.acquireActiveVersionLease(args.workspace, leaseDurationMs);
    if (!lease) throw new Error(`No published snapshot is active for workspace "${args.workspace}".`);
    renewal = setInterval(() => {
      if (renewalInFlight !== undefined) return;
      renewalInFlight = store.renewQueryLease(lease!.leaseId, leaseDurationMs)
        .catch((error: unknown) => { renewalError = error; })
        .finally(() => { renewalInFlight = undefined; });
    }, Math.max(1_000, Math.floor(leaseDurationMs / 3)));
    const { input, version } = await loadDatasetInput(pool, args, license, registryDataset, lease);
    const bundle = buildDatasetBundle(input);
    const outputDir = await writeBundle(args.out, args.dataset, version, args.dryRun, bundle.files);
    await renewalInFlight;
    if (renewalError !== undefined) throw new Error('Could not renew the active snapshot lease during export.', { cause: renewalError });
    printExportResult(args.dataset, version, bundle.manifest.files, bundle.manifest.bundle_sha256, outputDir);
  } finally {
    if (renewal !== undefined) clearInterval(renewal);
    await renewalInFlight;
    try {
      if (lease !== null) await store.releaseQueryLease(lease.leaseId);
    } finally {
      try {
        await pool.end();
      } finally {
        await store.close();
      }
    }
  }
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Dataset export failed.');
    process.exitCode = 1;
  });
}
