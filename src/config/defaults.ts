export interface RetrievalDefaults {
  topK?: number;
  vectorChildTopK?: number;
  keywordSearchLimit?: number;
  evidenceChildLimit?: number;
  rrfK?: number;
}

export interface BuildDefaults {
  maxChunkSize?: number;
  chunkOverlapRatio?: number; // fraction, e.g. 0.1 for 10%
}

const defaults: { retrieval: RetrievalDefaults; build: BuildDefaults } = {
  retrieval: {
    topK: 8,
    vectorChildTopK: 12,
    keywordSearchLimit: 24,
    evidenceChildLimit: 40,
    rrfK: 80,
  },
  build: {
    maxChunkSize: 800,
    chunkOverlapRatio: 0.1,
  },
};

export const configureDefaults = (partial?: {
  retrieval?: Partial<RetrievalDefaults>;
  build?: Partial<BuildDefaults>;
}): void => {
  if (!partial) return;
  if (partial.retrieval) {
    defaults.retrieval = { ...defaults.retrieval, ...partial.retrieval };
  }
  if (partial.build) {
    defaults.build = { ...defaults.build, ...partial.build };
  }
};

export const getRetrievalDefaults = (): RetrievalDefaults => ({ ...defaults.retrieval });
export const getBuildDefaults = (): BuildDefaults => ({ ...defaults.build });

export default defaults;
