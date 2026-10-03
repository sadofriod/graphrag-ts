export interface ChunkEdge {
  source: string;
  target: string;
  relation: string;
  weight?: number;
}

export interface ChunkClaim {
  subject: string;
  object?: string;
  description: string;
  childIndex?: number;
}

export interface ChunkEntity {
  name: string;
  description?: string;
}

export interface ChunkResult {
  parentContent: string;
  childChunks: string[];
  edges: ChunkEdge[];
  claims: ChunkClaim[];
  entities: ChunkEntity[];
}

export interface SplitResult {
  parentId: string;
  childIds: string[];
  edges: ChunkEdge[];
  claims: ChunkClaim[];
  entities: ChunkEntity[];
}

export type TextSplitMode = 'auto' | 'llm' | 'deterministic';

export interface TextSplitInput {
  content: string;
  title?: string;
  namespace: string;
  chunkSize?: number;
  chunkOverlap?: number;
  mode?: TextSplitMode;
}
