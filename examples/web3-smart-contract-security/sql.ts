import { schema } from './schema';
import type { Dataset } from './types';

export const sqlLiteral = (value: string): string => {
  if (!value.isWellFormed() || value.includes('\0')) throw new Error('Unsupported PostgreSQL text');
  return `E'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
};

const columns = {
  datasets: 'dataset_id, version, title, synthetic, license, license_text, usage_notice',
  sources: 'dataset_id, id, title, markdown_path, excerpt, license, creator, origin, locator, rights',
  entities: 'dataset_id, id, kind, name, summary',
  relations: 'dataset_id, id, kind, from_id, to_id',
  entity_sources: 'dataset_id, entity_id, source_id',
  relation_sources: 'dataset_id, relation_id, source_id',
  questions: 'dataset_id, id, question',
  question_relations: 'dataset_id, question_id, relation_id',
  question_sources: 'dataset_id, question_id, source_id',
} as const;

const insert = (table: keyof typeof columns, values: readonly (string | boolean)[]): string => {
  const encoded = values.map((value) => typeof value === 'boolean' ? String(value) : sqlLiteral(value));
  return `INSERT INTO web3_security_dataset.${table} (${columns[table]}) VALUES (${encoded.join(', ')});`;
};

export const renderSql = (data: Dataset): string => {
  const dataset = data.id;
  const statements = [
    'BEGIN;', 'SET LOCAL standard_conforming_strings = on;', schema,
    insert('datasets', [dataset, data.version, data.title, data.synthetic, data.license, data.licenseText, data.usageNotice]),
    ...data.sources.map((row) => insert('sources', [
      dataset, row.id, row.title, row.markdownPath, row.excerpt, row.license,
      row.provenance.creator, row.provenance.origin, row.provenance.locator, row.provenance.rights,
    ])),
    ...data.entities.map((row) => insert('entities', [dataset, row.id, row.kind, row.name, row.summary])),
    ...data.relations.map((row) => insert('relations', [dataset, row.id, row.kind, row.from, row.to])),
    ...data.entities.flatMap((row) => row.evidenceIds.map((source) =>
      insert('entity_sources', [dataset, row.id, source]))),
    ...data.relations.flatMap((row) => row.evidenceIds.map((source) =>
      insert('relation_sources', [dataset, row.id, source]))),
    ...data.questions.map((row) => insert('questions', [dataset, row.id, row.question])),
    ...data.questions.flatMap((row) => row.relationIds.map((relation) =>
      insert('question_relations', [dataset, row.id, relation]))),
    ...data.questions.flatMap((row) => row.expectedEvidenceIds.map((source) =>
      insert('question_sources', [dataset, row.id, source]))),
    'COMMIT;', '',
  ];
  return statements.join('\n');
};
