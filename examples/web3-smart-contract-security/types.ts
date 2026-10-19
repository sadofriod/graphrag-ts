export const entityKinds = ['contract', 'vulnerability', 'incident', 'mitigation', 'dependency'] as const;
export type EntityKind = typeof entityKinds[number];

export const relationKinds = ['depends_on', 'contains', 'involves', 'illustrates', 'mitigates', 'affected_by'] as const;
export type RelationKind = typeof relationKinds[number];

export type Source = {
  readonly id: string;
  readonly title: string;
  readonly markdownPath: string;
  readonly excerpt: string;
  readonly license: string;
  readonly provenance: {
    readonly creator: string;
    readonly origin: 'synthetic-original' | 'seller-owned' | 'licensed';
    readonly locator: string;
    readonly rights: string;
  };
};

export type Entity = {
  readonly id: string;
  readonly kind: EntityKind;
  readonly name: string;
  readonly summary: string;
  readonly evidenceIds: readonly string[];
};

export type Relation = {
  readonly id: string;
  readonly kind: RelationKind;
  readonly from: string;
  readonly to: string;
  readonly evidenceIds: readonly string[];
};

export type Question = {
  readonly id: string;
  readonly question: string;
  readonly relationIds: readonly string[];
  readonly expectedEvidenceIds: readonly string[];
};

export type Dataset = {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly synthetic: boolean;
  readonly license: string;
  readonly licenseText: string;
  readonly usageNotice: string;
  readonly sources: readonly Source[];
  readonly entities: readonly Entity[];
  readonly relations: readonly Relation[];
  readonly questions: readonly Question[];
};
