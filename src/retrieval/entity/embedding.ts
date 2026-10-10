import type { Embeddings } from '@langchain/core/embeddings';

import { CustomModelConfigType } from '../../build/custom.model.conf.type';
import { modelLoaderSingleton } from '../../build/modelLoader';
import { awaitRetrieval } from '../retrievalContext';

export async function embedText(text: string): Promise<number[]> {
  const embeddingModel = modelLoaderSingleton.models?.embedding as Embeddings | undefined;

  if (!embeddingModel) {
    throw new Error(
      `Embedding model is not loaded. Please check the configuration for ${CustomModelConfigType.embedding}.`,
    );
  }

  return awaitRetrieval(() => embeddingModel.embedQuery(text));
}
