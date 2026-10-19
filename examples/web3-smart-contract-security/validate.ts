import { entityKinds, relationKinds } from './types';
import type { Dataset, Entity, EntityKind, Question, Relation, RelationKind, Source } from './types';

const fail = (message: string): never => { throw new Error(`Invalid dataset: ${message}`); };

const record = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('expected object');
  const result = Object.fromEntries(Object.entries(value));
  if (Object.keys(result).length !== keys.length || keys.some((key) => !(key in result))) {
    return fail(`expected exactly fields: ${keys.join(', ')}`);
  }
  return result;
};

const text = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim()) return fail('expected non-empty text');
  const unsupported = Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
  });
  if (!value.isWellFormed() || unsupported) {
    return fail('text contains unsupported control characters or unpaired surrogates');
  }
  return value;
};

const id = (value: unknown): string => {
  const result = text(value);
  if (!/^[a-z][a-z0-9-]{0,79}$/.test(result)) return fail(`invalid identifier: ${result}`);
  return result;
};

const choice = <T extends string>(value: unknown, choices: readonly T[]): T => {
  const result = choices.find((item) => item === value);
  if (!result) return fail(`expected one of: ${choices.join(', ')}`);
  return result;
};

const list = <T>(value: unknown, parse: (item: unknown) => T): T[] => {
  if (!Array.isArray(value) || value.length === 0) return fail('expected non-empty array');
  return value.map(parse);
};

const unique = (values: readonly string[], label: string): void => {
  if (new Set(values).size !== values.length) fail(`duplicate ${label}`);
};

const refs = (value: unknown): string[] => {
  const result = list(value, id);
  unique(result, 'reference');
  return result.sort();
};

const provenance = (value: unknown): Source['provenance'] => {
  const row = record(value, ['creator', 'origin', 'locator', 'rights']);
  return {
    creator: text(row.creator),
    origin: choice(row.origin, ['synthetic-original', 'seller-owned', 'licensed']),
    locator: text(row.locator),
    rights: text(row.rights),
  };
};

const source = (value: unknown): Source => {
  const row = record(value, ['id', 'title', 'markdownPath', 'excerpt', 'license', 'provenance']);
  const markdownPath = text(row.markdownPath);
  if (!/^[a-z0-9][a-z0-9-]{0,79}\.md$/.test(markdownPath)) {
    return fail('markdownPath must be a flat lowercase slug with .md extension');
  }
  return {
    id: id(row.id), title: text(row.title), markdownPath, excerpt: text(row.excerpt),
    license: text(row.license), provenance: provenance(row.provenance),
  };
};

const entity = (value: unknown): Entity => {
  const row = record(value, ['id', 'kind', 'name', 'summary', 'evidenceIds']);
  return {
    id: id(row.id), kind: choice(row.kind, entityKinds), name: text(row.name),
    summary: text(row.summary), evidenceIds: refs(row.evidenceIds),
  };
};

const relation = (value: unknown): Relation => {
  const row = record(value, ['id', 'kind', 'from', 'to', 'evidenceIds']);
  return {
    id: id(row.id), kind: choice(row.kind, relationKinds),
    from: id(row.from), to: id(row.to), evidenceIds: refs(row.evidenceIds),
  };
};

const question = (value: unknown): Question => {
  const row = record(value, ['id', 'question', 'relationIds', 'expectedEvidenceIds']);
  return {
    id: id(row.id), question: text(row.question),
    relationIds: refs(row.relationIds), expectedEvidenceIds: refs(row.expectedEvidenceIds),
  };
};

const sorted = <T extends { readonly id: string }>(values: readonly T[]): T[] =>
  [...values].sort((left, right) => left.id < right.id ? -1 : Number(left.id > right.id));

const requireRefs = (values: readonly string[], allowed: ReadonlySet<string>, label: string): void => {
  values.forEach((value) => {
    if (!allowed.has(value)) fail(`dangling ${label}: ${value}`);
  });
};

const endpoints: Readonly<Record<RelationKind, readonly [EntityKind, EntityKind]>> = {
  depends_on: ['contract', 'dependency'],
  contains: ['contract', 'vulnerability'],
  involves: ['incident', 'contract'],
  illustrates: ['incident', 'vulnerability'],
  mitigates: ['mitigation', 'vulnerability'],
  affected_by: ['dependency', 'vulnerability'],
};

const validateQuestions = (data: Dataset, sourceIds: ReadonlySet<string>): void => {
  const relationIds = new Set(data.relations.map((row) => row.id));
  data.questions.forEach((row) => {
    requireRefs(row.relationIds, relationIds, 'question relation');
    requireRefs(row.expectedEvidenceIds, sourceIds, 'question evidence');
    const required = data.relations.filter((edge) => row.relationIds.includes(edge.id))
      .flatMap((edge) => edge.evidenceIds);
    requireRefs(required, new Set(row.expectedEvidenceIds), 'expected question evidence coverage');
  });
};

const validateLinks = (data: Dataset): void => {
  unique([...data.sources, ...data.entities, ...data.relations, ...data.questions].map((row) => row.id), 'ID');
  unique(data.sources.map((row) => row.markdownPath), 'Markdown path');
  const sourceIds = new Set(data.sources.map((row) => row.id));
  const entityById = new Map(data.entities.map((row) => [row.id, row]));
  [...data.entities, ...data.relations].forEach((row) => requireRefs(row.evidenceIds, sourceIds, 'evidence'));
  data.sources.forEach((row) => {
    if (data.synthetic !== (row.provenance.origin === 'synthetic-original')) {
      fail('synthetic flag and source origin disagree');
    }
  });
  data.relations.forEach((row) => {
    const [fromKind, toKind] = endpoints[row.kind];
    if (entityById.get(row.from)?.kind !== fromKind || entityById.get(row.to)?.kind !== toKind) {
      fail(`dangling or wrong-kind relation endpoints: ${row.id}`);
    }
  });
  validateQuestions(data, sourceIds);
};

export const validateDataset = (value: unknown): Dataset => {
  const row = record(value, [
    'id', 'version', 'title', 'synthetic', 'license', 'licenseText', 'usageNotice',
    'sources', 'entities', 'relations', 'questions',
  ]);
  if (typeof row.synthetic !== 'boolean') return fail('synthetic must be boolean');
  const version = text(row.version);
  if (!/^\d+\.\d+\.\d+$/.test(version)) return fail('version must be major.minor.patch');
  const data: Dataset = {
    id: id(row.id), version, title: text(row.title), synthetic: row.synthetic,
    license: text(row.license), licenseText: text(row.licenseText), usageNotice: text(row.usageNotice),
    sources: sorted(list(row.sources, source)), entities: sorted(list(row.entities, entity)),
    relations: sorted(list(row.relations, relation)), questions: sorted(list(row.questions, question)),
  };
  validateLinks(data);
  return data;
};
