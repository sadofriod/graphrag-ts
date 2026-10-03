import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { Embeddings } from '@langchain/core/embeddings';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getBuildDefaults } from '../../config/defaults';
import { mergeSmallSections, splitByTopLevelHeadings } from '../markdownStructureSplit';
import { MAX_CHUNK_SIZE, MERGE_THRESHOLD } from '../constants';
import { getSmartChunk } from './getSmartChunk';
import { saveChunkResults } from './saveChunkResults';
import type { SplitResult } from './types';

type SplitBaseParams = {
  content: string;
  embeddingModel: Embeddings;
  namespace: string;
  title?: string;
};

type SplitParams =
  | (SplitBaseParams & { mode: 'deterministic' })
  | (SplitBaseParams & { mode: 'llm'; sliceModel: BaseChatModel })
  | (SplitBaseParams & { mode: 'markdown-structure'; sliceModel: BaseChatModel });

export const split = async (params: SplitParams): Promise<SplitResult[]> => {
  switch (params.mode) {
    case 'deterministic': {
      const buildDefaults = getBuildDefaults();
      const chunkSize = buildDefaults.maxChunkSize ?? MAX_CHUNK_SIZE;
      const overlapRatio = buildDefaults.chunkOverlapRatio ?? 0.1;
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize,
        chunkOverlap: Math.floor(chunkSize * overlapRatio),
      });
      const chunks = await splitter.splitText(params.content);
      return saveChunkResults(
        [{
          parentContent: params.content,
          childChunks: chunks,
          edges: [],
          claims: [],
          entities: [],
        }],
        params.embeddingModel,
        params.namespace,
        params.title,
      );
    }
    case 'llm': {
      const smartChunk = await getSmartChunk(params.content, params.sliceModel, params.title);
      return saveChunkResults(
        smartChunk,
        params.embeddingModel,
        params.namespace,
        params.title,
      );
    }
    case 'markdown-structure': {
      const sections = mergeSmallSections(
        splitByTopLevelHeadings(params.content),
        MERGE_THRESHOLD,
      );
      const results: SplitResult[] = [];

      for (const section of sections) {
        const sectionTitle = params.title
          ? `${params.title}#${section.title}`
          : (section.title || undefined);
        const smartChunk = await getSmartChunk(
          section.content,
          params.sliceModel,
          section.title,
        );
        results.push(...(await saveChunkResults(
          smartChunk,
          params.embeddingModel,
          params.namespace,
          sectionTitle,
        )));
      }
      return results;
    }
    default: {
      const exhaustiveCheck: never = params;
      return exhaustiveCheck;
    }
  }
};
