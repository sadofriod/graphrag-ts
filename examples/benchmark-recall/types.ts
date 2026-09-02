import type { RetrievalResult } from '../../src/retrieval/types/retrieval';

export interface RecallExpectation {
  entities: string[];
  phrases: string[];
}

export interface RecallQuery {
  id: string;
  source: string;
  focus: string;
  query: string;
  topK: number;
  expectation: RecallExpectation;
}

export interface QueryEvaluation {
  foundEntities: string[];
  missingEntities: string[];
  foundPhrases: string[];
  missingPhrases: string[];
  entityRecall: number;
  phraseRecall: number;
  combinedRecall: number;
  hit: boolean;
}

export interface PerQueryResult {
  query: RecallQuery;
  evaluation: QueryEvaluation;
}

export interface SourceSummary {
  total: number;
  hits: number;
  avgEntityRecall: number;
  avgPhraseRecall: number;
  avgCombinedRecall: number;
}

export interface RecallReport {
  total: number;
  hits: number;
  strictHitRate: number;
  avgEntityRecall: number;
  avgPhraseRecall: number;
  avgCombinedRecall: number;
  bySource: Record<string, SourceSummary>;
}

export interface RetrievedContextOptions {
  includeAnswer?: boolean;
}

export type Retrieve = (input: {
  query: string;
  topK: number;
}) => Promise<RetrievalResult>;