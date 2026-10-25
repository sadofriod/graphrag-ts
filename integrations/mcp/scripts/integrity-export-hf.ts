import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';

type JsonRecord = Record<string, unknown>;
type ExportFile = { path: string; rows: number; bytes: number; sha256: string };
type Arguments = { snapshot: string; out: string };

const usage = 'Usage: bun scripts/integrity-export-hf.ts --snapshot <snapshotDir> --out <dir>';
const dataset = 'integrity-citation-retraction-graph';
const forbiddenText = ['Falsification', 'Concern', 'Investigation'];

const parseArguments = (argv: readonly string[]): Arguments => {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== '--snapshot' && flag !== '--out') throw new Error(usage);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(usage);
    values.set(flag, value);
    index += 1;
  }
  const snapshot = values.get('--snapshot');
  const out = values.get('--out');
  if (!snapshot || !out) throw new Error(usage);
  return { snapshot, out };
};

const asRecord = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected a JSON object.`);
  }
  return value as JsonRecord;
};

const readJsonl = async (path: string): Promise<JsonRecord[]> => {
  const text = await readFile(path, 'utf8');
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      return [asRecord(JSON.parse(line) as unknown, `${path} line ${index + 1}`)];
    } catch (error) {
      throw new Error(`Could not parse ${path} line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
};

const value = (row: JsonRecord, key: string): unknown => row[key] ?? null;

const stableCompare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

const sortedObject = (row: JsonRecord): JsonRecord => Object.fromEntries(
  Object.entries(row).sort(([left], [right]) => stableCompare(left, right)),
);

const jsonl = (rows: readonly JsonRecord[]): Buffer => Buffer.from(
  rows.map((row) => JSON.stringify(sortedObject(row))).join('\n') + (rows.length > 0 ? '\n' : ''),
  'utf8',
);

const digest = (content: Buffer): string => createHash('sha256').update(content).digest('hex');

const metadataFile = (path: string, content: Buffer, rows: number): ExportFile => ({
  path, rows, bytes: content.byteLength, sha256: digest(content),
});

const scanForRetractionWatchText = (payloads: readonly { path: string; content: Buffer }[]): void => {
  for (const payload of payloads) {
    const lines = gunzipSync(payload.content).toString('utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line) continue;
      const row = JSON.parse(line) as JsonRecord;
      for (const [key, entry] of Object.entries(row)) {
        if (key === 'doi' || key === 'title' || typeof entry !== 'string') continue;
        const match = forbiddenText.find((phrase) => entry.includes(phrase));
        if (match) {
          throw new Error(`Retraction Watch free-text self-check failed: found "${match}" in ${payload.path} row ${index + 1}, field "${key}".`);
        }
      }
    }
  }
};

const sizeCategory = (rows: number): string => {
  if (rows < 1_000) return '<1K';
  if (rows < 10_000) return '1K<n<10K';
  if (rows < 100_000) return '10K<n<100K';
  if (rows < 1_000_000) return '100K<n<1M';
  if (rows < 10_000_000) return '1M<n<10M';
  if (rows < 100_000_000) return '10M<n<100M';
  if (rows < 1_000_000_000) return '100M<n<1B';
  return '>1B';
};

const buildReadme = (paperCount: number, snapshotId: string, papersSha256: string): string => `---
license: cc0-1.0
language:
  - en
pretty_name: Integrity Citation and Retraction Graph
task_categories:
  - text-retrieval
tags:
  - scholarly-graph
  - citations
  - retractions
  - research-integrity
size_categories:
  - ${sizeCategory(paperCount)}
source_datasets:
  - openalex
  - crossref
  - retraction-watch
configs:
  - config_name: default
    data_files:
      - split: papers
        path: data/papers.jsonl.gz
      - split: cites
        path: data/cites.jsonl.gz
      - split: retraction_status
        path: data/retraction_status.jsonl.gz
---

# Integrity Citation and Retraction Graph

## What it is

This dataset is a citation/retraction propagation graph over scholarly works. It pairs paper metadata and citation links with compact retraction-status facts to support analysis of how retraction information can propagate through citation neighbourhoods.

Not a compliance or legal determination; the dataset reports source-attributed facts, and the accompanying judgment API is what turns them into a verdict.

## How it was built

The snapshot was assembled from the OpenAlex entity API, Crossref <code>update-to</code> metadata, and Retraction Watch status facts only. Retraction Watch free-text reasons and nature descriptions are excluded from this export.

## Files and fields

- <code>data/papers.jsonl.gz</code>: one row per paper, with <code>paper_id</code>, <code>doi</code>, <code>title</code>, <code>publication_year</code>, <code>cited_by_count</code>, and <code>openalex_is_retracted</code>.
- <code>data/cites.jsonl.gz</code>: one row per citation edge, with <code>citing_id</code>, <code>cited_id</code>, <code>cited_doi</code>, <code>source_tier</code>, and <code>source_uri</code>.
- <code>data/retraction_status.jsonl.gz</code>: one row per source-specific status fact, with <code>paper_id</code>, <code>doi</code>, <code>source</code>, <code>source_tier</code>, <code>is_retracted</code>, and <code>retraction_date</code>.

Rows are JSON Lines with deterministic key order. The status file deliberately contains facts only; it does not redistribute Retraction Watch narrative text.

## Provenance

- <code>data/papers.jsonl.gz</code>: OpenAlex contributes <code>paper_id</code>, <code>doi</code>, <code>title</code>, <code>publication_year</code>, <code>cited_by_count</code>, and <code>openalex_is_retracted</code>.
- <code>data/cites.jsonl.gz</code>: OpenAlex/OpenCitations citation records contribute <code>citing_id</code>, <code>cited_id</code>, and <code>source_uri</code>; the cited work's OpenAlex record contributes <code>cited_doi</code>; <code>source_tier</code> records the source classification.
- <code>data/retraction_status.jsonl.gz</code>: OpenAlex supplies <code>paper_id</code>, <code>doi</code>, and <code>is_retracted</code> in OpenAlex status rows; Crossref supplies <code>is_retracted</code> and <code>retraction_date</code> in Crossref status rows; Retraction Watch supplies <code>is_retracted</code> and <code>retraction_date</code> in Retraction Watch status rows. <code>source</code> and <code>source_tier</code> label each source-attributed row.

## Known biases

This is a neighbourhood sample of 12 retracted seeds and up to 60 citing works per seed, not a full scholarly corpus. Coverage varies by paper and by the availability of source metadata. Semantic Scholar citation contexts are intentionally absent.

## How to reproduce

Run the exporter from <code>integrations/mcp</code> against a harvested snapshot:

    bun scripts/integrity-export-hf.ts --snapshot <snapshotDir> --out <dir>

The output directory contains the three compressed JSONL files, this dataset card, attribution, and a manifest with hashes, byte sizes, and row counts.

## How to verify a claim

For a claim-specific comparison, consult the judgment API at https://pay.ashesborn.cloud and compare the cited work identifiers and status facts with the corresponding source records. A graph edge or status fact is evidence to inspect, not by itself a conclusion about the merits of a claim. To check one row by hand, open the DOI at <code>https://doi.org/&lt;doi&gt;</code>, compare <code>retraction_date</code> against the publisher notice, and compare <code>source</code>/<code>source_tier</code> across the three status rows for that paper.

## Citation

    @misc{integrity_citation_retraction_graph,
      title = {Integrity Citation and Retraction Graph},
      year = {2026},
      howpublished = {Hugging Face dataset},
      note = {Snapshot ${snapshotId}; data/papers.jsonl.gz sha256 ${papersSha256}}
    }

## 中文摘要

本数据集提供学术论文元数据、引用关系及撤稿状态事实，用于研究撤稿信息在引用网络中的传播。数据仅覆盖有限的撤稿论文邻域，并且不包含 Retraction Watch 的原因或性质文本。
`;

const attribution = `# Attribution

- **OpenAlex:** OpenAlex data is released under CC0.
- **Crossref:** Crossref metadata is freely available for reuse.
- **Retraction Watch:** Data is used only for retraction status and date facts; Retraction Watch text is not redistributed.

The derived graph structure and this exported dataset are released under CC0.
`;

const main = async (args: Arguments): Promise<void> => {
  const snapshotDir = resolve(args.snapshot);
  const outputDir = resolve(args.out);
  const snapshotManifest = asRecord(JSON.parse(await readFile(join(snapshotDir, 'manifest.json'), 'utf8')) as unknown, 'snapshot manifest');
  const snapshotId = snapshotManifest.snapshot_id;
  const builtAt = snapshotManifest.built_at;
  if (typeof snapshotId !== 'string' || !snapshotId || typeof builtAt !== 'string' || !builtAt) {
    throw new Error('Snapshot manifest must include string snapshot_id and built_at fields.');
  }

  const [paperRows, citeRows, retractionRows] = await Promise.all([
    readJsonl(join(snapshotDir, 'papers.jsonl')),
    readJsonl(join(snapshotDir, 'cites.jsonl')),
    readJsonl(join(snapshotDir, 'retractions.jsonl')),
  ]);

  const papers = paperRows.map((row) => ({
    paper_id: value(row, 'paper_id'), doi: value(row, 'doi'), title: value(row, 'title'),
    publication_year: value(row, 'publication_year'), cited_by_count: value(row, 'cited_by_count'),
    openalex_is_retracted: value(row, 'openalex_is_retracted'),
  })).sort((left, right) => stableCompare(String(left.paper_id ?? ''), String(right.paper_id ?? '')));
  const cites = citeRows.map((row) => ({
    citing_id: value(row, 'citing_id'), cited_id: value(row, 'cited_id'), cited_doi: value(row, 'cited_doi'),
    source_tier: value(row, 'source_tier'), source_uri: value(row, 'source_uri'),
  })).sort((left, right) => stableCompare(String(left.citing_id ?? ''), String(right.citing_id ?? ''))
    || stableCompare(String(left.cited_id ?? ''), String(right.cited_id ?? '')));
  const retractionStatus = retractionRows.map((row) => ({
    paper_id: value(row, 'paper_id'), doi: value(row, 'doi'), source: value(row, 'source'),
    source_tier: value(row, 'source_tier'), is_retracted: value(row, 'is_retracted'),
    retraction_date: value(row, 'retraction_date'),
  })).sort((left, right) => stableCompare(String(left.paper_id ?? ''), String(right.paper_id ?? ''))
    || stableCompare(String(left.source ?? ''), String(right.source ?? '')));

  const data = [
    { path: 'data/papers.jsonl.gz', rows: papers.length, content: gzipSync(jsonl(papers), { level: 9 }) },
    { path: 'data/cites.jsonl.gz', rows: cites.length, content: gzipSync(jsonl(cites), { level: 9 }) },
    { path: 'data/retraction_status.jsonl.gz', rows: retractionStatus.length, content: gzipSync(jsonl(retractionStatus), { level: 9 }) },
  ];

  await mkdir(join(outputDir, 'data'), { recursive: true });
  for (const file of data) await writeFile(join(outputDir, file.path), file.content);
  scanForRetractionWatchText(data);

  const papersFile = data.find((file) => file.path === 'data/papers.jsonl.gz');
  if (!papersFile) throw new Error('Could not find generated papers payload for dataset-card citation.');
  const docs = [
    { path: 'README.md', content: Buffer.from(buildReadme(papers.length, snapshotId, digest(papersFile.content)), 'utf8') },
    { path: 'ATTRIBUTION.md', content: Buffer.from(attribution, 'utf8') },
  ];
  for (const file of docs) await writeFile(join(outputDir, file.path), file.content);
  const files = [
    ...data.map((file) => metadataFile(file.path, file.content, file.rows)),
    ...docs.map((file) => metadataFile(file.path, file.content, 0)),
  ];
  const manifest = {
    dataset, snapshot_id: snapshotId, built_at: builtAt,
    counts: { papers: papers.length, cites: cites.length, retraction_status: retractionStatus.length },
    files,
    caveats: [
      'Neighbourhood sample of 12 retracted seeds and up to 60 citing works per seed; not a full corpus.',
      'Coverage varies by paper and source availability.',
      'Semantic Scholar citation contexts are intentionally absent.',
      'Retraction Watch reason and nature free text are excluded.',
    ],
  };
  await writeFile(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ dataset, snapshot_id: snapshotId, output_dir: outputDir, files: [...files.map((file) => file.path), 'manifest.json'] }));
};

if (import.meta.main) {
  try {
    await main(parseArguments(Bun.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
