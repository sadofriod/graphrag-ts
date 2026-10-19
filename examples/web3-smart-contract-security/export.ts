import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renderSql } from './sql';
import type { Dataset, Source } from './types';
import { validateDataset } from './validate';

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
const jsonl = (rows: readonly unknown[]): string => `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;

const renderSource = (data: Dataset, source: Source): string => {
  const label = data.synthetic ? 'SYNTHETIC FICTION — RESEARCH / DEMO' : 'SELLER-SUPPLIED — RIGHTS REQUIRE REVIEW';
  const entities = data.entities.filter((row) => row.evidenceIds.includes(source.id));
  const relations = data.relations.filter((row) => row.evidenceIds.includes(source.id));
  return [
    `# ${source.title}`, '', `**${label}**`, '', data.usageNotice, '',
    `Evidence ID: ${source.id}`, `Dataset: ${data.id} / ${data.version}`,
    `Source license: ${source.license}`, `Creator: ${source.provenance.creator}`,
    `Origin: ${source.provenance.origin}`, `Provenance locator: ${source.provenance.locator}`,
    `Rights statement: ${source.provenance.rights}`, '', '## Source excerpt', '', source.excerpt, '',
    '## Curated entities', '',
    ...entities.map((row) => `- ${row.id} (${row.kind}): ${row.name}. ${row.summary}`),
    '', '## Curated relationships', '',
    ...relations.map((row) => `- ${row.id}: ${row.from} — ${row.kind} → ${row.to}. Evidence: ${source.id}.`), '',
  ].join('\n');
};

export const renderDelivery = (input: unknown): ReadonlyMap<string, string> => {
  const data = validateDataset(input);
  const entries: [string, string][] = [
    ['dataset.json', json(data)],
    ['entities.jsonl', jsonl(data.entities)],
    ['relations.jsonl', jsonl(data.relations)],
    ['sources.jsonl', jsonl(data.sources)],
    ['questions.jsonl', jsonl(data.questions)],
    ['dataset.sql', renderSql(data)],
    ['LICENSE.txt', `${data.licenseText}\n`],
    ['NOTICE.txt', `${data.title}\nSynthetic: ${data.synthetic}\n${data.usageNotice}\n`],
    ...data.sources.map((source): [string, string] => [`corpus/${source.markdownPath}`, renderSource(data, source)]),
  ];
  const files = new Map(entries.sort(([left], [right]) => left < right ? -1 : Number(left > right)));
  const manifest = {
    formatVersion: 1, datasetId: data.id, version: data.version, license: data.license,
    synthetic: data.synthetic, usageNotice: data.usageNotice,
    counts: {
      entities: data.entities.length, relations: data.relations.length,
      sources: data.sources.length, questions: data.questions.length,
    },
    files: [...files].map(([path, content]) => ({
      path, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'),
    })),
  };
  files.set('manifest.json', json(manifest));
  return files;
};

export const writeDelivery = async (input: unknown, outputDirectory: string): Promise<void> => {
  const files = renderDelivery(input);
  // mkdir is the exclusive ownership gate, including against existing symlinks.
  await mkdir(outputDirectory, { recursive: false, mode: 0o700 });
  await mkdir(join(outputDirectory, 'corpus'));
  for (const [path, content] of files) {
    // Manifest is written last: a partial failed delivery has no completion marker.
    await writeFile(join(outputDirectory, path), content, { flag: 'wx', mode: 0o600 });
  }
};
