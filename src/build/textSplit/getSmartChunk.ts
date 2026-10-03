import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { logger } from '../../logger';
import { parseLlmJson } from '../../helper/parseLlmJson';
import { getBuildDefaults } from '../../config/defaults';
import { MAX_CHUNK_SIZE } from '../constants';
import { assmblyAgent } from '../agents.md/assmblyAgent';
import { agentRegistry } from '../agents.md/agentRegistry';
import { invokeModelText } from '../modelLoader';
import type { ChunkResult } from './types';

export const getSmartChunk = async (
  content: string,
  sliceModel: BaseChatModel,
  contextTitle?: string,
): Promise<ChunkResult[]> => {
  const prompt = await assmblyAgent(
    contextTitle ? `[Current section: ${contextTitle}】\n${content}` : content,
    agentRegistry.ragSliceAgent,
  );
  const response = await invokeModelText(sliceModel, prompt);
  const buildDefaults = getBuildDefaults();
  const defaultChunkSize = buildDefaults.maxChunkSize ?? MAX_CHUNK_SIZE;
  const defaultOverlapRatio = buildDefaults.chunkOverlapRatio ?? 0.1;
  const backupSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: defaultChunkSize,
    chunkOverlap: Math.floor(defaultChunkSize * defaultOverlapRatio),
  });

  try {
    const parsed = parseLlmJson<Partial<ChunkResult>[] | { chunks?: Partial<ChunkResult>[] }>(response);
    const rawChunks = Array.isArray(parsed) ? parsed : (parsed?.chunks ?? []);
    const llmChunks = rawChunks.map((chunk) => ({
      ...chunk,
      parentContent: chunk.parentContent ?? '',
      childChunks: chunk.childChunks ?? [],
      edges: chunk.edges ?? [],
      claims: chunk.claims ?? [],
      entities: chunk.entities ?? [],
    }));

    const hasSignal = llmChunks.some((chunk) => chunk.entities.length > 0 || chunk.edges.length > 0);
    if (llmChunks.length === 0 || !hasSignal) {
      throw new Error('LLM slice output was empty (no entities/edges)');
    }

    return await Promise.all(llmChunks.map(async (chunk) => {
      if (chunk.parentContent.length > defaultChunkSize) {
        const backupChunks = await backupSplitter.splitText(chunk.parentContent);
        return {
          ...chunk,
          childChunks: backupChunks,
        };
      }
      return chunk;
    }));
  } catch (error) {
    logger.warn('LLM chunk output is unusable; falling back to deterministic splitting', error);
    const fallbackChunks = await backupSplitter.splitText(content);
    return [{
      parentContent: content,
      childChunks: fallbackChunks,
      edges: [],
      claims: [],
      entities: [],
    }];
  }
};
