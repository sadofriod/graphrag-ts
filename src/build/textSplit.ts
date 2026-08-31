import { CustomModelConfigType } from "./custom.model.conf.type";
import { invokeModelText, modelLoaderSingleton } from "./modelLoader";
import { logger } from "../logger";
import type { ChatDeepSeek } from "@langchain/deepseek";
import type { OpenAIEmbeddings } from "@langchain/openai";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import {
  DETERMINISTIC_THRESHOLD,
  MARKDOWN_STRUCTURE_THRESHOLD,
  MAX_CHUNK_SIZE,
  MERGE_THRESHOLD,
} from "./constants";
import { prismaClient } from "./helper/prismaClient";
import { buildChildInsertSql } from "./helper/buildChildInsertSql";
import { agentRegistry } from "./agents.md/agentRegistry";
import { assmblyAgent } from "./agents.md/assmblyAgent";
import { parseLlmJson } from "../helper/parseLlmJson";
import { mergeSmallSections, splitByTopLevelHeadings } from "./markdownStructureSplit";
export interface ChunkEdge {
  source: string;
  target: string;
  relation: string;
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

interface ChunkResult {
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

export interface TextSplitInput {
  content: string;
  title?: string;
  namespace: string;
}


export type TextSplitMode = 'auto' | 'llm' | 'deterministic';

export interface TextSplitInput {
  content: string;
  title?: string;
  namespace: string;
  mode?: TextSplitMode;
}

/** Prefer the .md extension; fall back to content that contains markdown heading lines. */
const isMarkdown = (content: string, title?: string): boolean => {
  const byName = title ? /\.md$/i.test(title) : false;
  const byContent = /^#{1,6}\s+\S+/m.test(content);
  return byName || byContent;
};


const getSmartChunk = async (content: string, sliceModel: ChatDeepSeek, contextTitle?: string): Promise<ChunkResult[]> => {
  // In structural splitting mode, inject the current section title to help the LLM focus on entity/relation extraction.
  const prompt = await assmblyAgent(
    contextTitle ? `[Current section: ${contextTitle}】\n${content}` : content,
    agentRegistry.ragSliceAgent,
  );
  const response = await invokeModelText(sliceModel, prompt);
  const backupSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: MAX_CHUNK_SIZE,
    chunkOverlap: MAX_CHUNK_SIZE / 10, // 10% overlap
  });

  try {
    // In JSON mode, the output may be an array ([{...}]) or a wrapper object ({ "chunks": [...] }); support both.
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

    // Quality gate: treat the output as untrustworthy and fall back to deterministic splitting when chunks are empty or contain no entities/edges at all.
    const hasSignal = llmChunks.some((chunk) => chunk.entities.length > 0 || chunk.edges.length > 0);
    if (llmChunks.length === 0 || !hasSignal) {
      throw new Error('LLM slice output was empty (no entities/edges)');
    }

    return await Promise.all(llmChunks.map(async (chunk) => {
      if (chunk.parentContent.length > MAX_CHUNK_SIZE) {
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


const saveChunkResults = async (
  results: ChunkResult[],
  embeddingModel: OpenAIEmbeddings,
  namespace: string,
  title?: string,
): Promise<SplitResult[]> => {
  return Promise.all(
    results.map((chunk) =>
      prismaClient.$transaction(async (tx) => {
        const parent = await tx.rAGParent.create({
          data: {
            namespace,
            content: chunk.parentContent,
            ...(title ? { title } : {}),
          },
        });

        const createdChildren = await Promise.all(
          chunk.childChunks.map(async (childContent) => ({
            parentId: parent.id,
            content: childContent,
            embedding: await embeddingModel.embedQuery(childContent),
          }))
        );

        let childIds: string[] = [];
        if (createdChildren.length > 0) {
          const inserted = await tx.$queryRaw<{ id: string }[]>(
            buildChildInsertSql(createdChildren, namespace),
          );
          childIds = inserted.map((row) => row.id);
        }

        return {
          parentId: parent.id,
          childIds,
          edges: chunk.edges,
          claims: chunk.claims,
          entities: chunk.entities,
        };
      })
    )
  );
};

/** Deterministic splitting: RecursiveCharacterTextSplitter, with no entities, edges, or claims. */
const deterministicSplit = async (
  content: string,
  embeddingModel: OpenAIEmbeddings,
  namespace: string,
  title?: string,
): Promise<SplitResult[]> => {
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: MAX_CHUNK_SIZE,
    chunkOverlap: MAX_CHUNK_SIZE / 10,
  });
  const chunks = await splitter.splitText(content);
  return saveChunkResults(
    [{ parentContent: content, childChunks: chunks, edges: [], claims: [], entities: [] }],
    embeddingModel,
    namespace,
    title,
  );
};

/** LLM semantic splitting: structured JSON-mode output; failures or empty results fall back to deterministic splitting inside getSmartChunk. */
const llmSplit = async (
  content: string,
  sliceModel: ChatDeepSeek,
  embeddingModel: OpenAIEmbeddings,
  namespace: string,
  title?: string,
): Promise<SplitResult[]> => {
  const smartChunk = await getSmartChunk(content, sliceModel, title);
  return saveChunkResults(smartChunk, embeddingModel, namespace, title);
};

/** For very long markdown: split by top-level headings -> merge small sections -> run LLM semantic splitting serially for each section (with section-level fallback). */
const markdownStructureSplit = async (
  content: string,
  sliceModel: ChatDeepSeek,
  embeddingModel: OpenAIEmbeddings,
  namespace: string,
  title?: string,
): Promise<SplitResult[]> => {
  const sections = mergeSmallSections(splitByTopLevelHeadings(content), MERGE_THRESHOLD);
  const results: SplitResult[] = [];

  for (const section of sections) {
    // Inject the heading into the parent chunk title for traceability; if the LLM fails inside one section, getSmartChunk falls back independently without affecting other sections.
    const sectionTitle = title ? `${title}#${section.title}` : (section.title || undefined);
    const smartChunk = await getSmartChunk(section.content, sliceModel, section.title);
    results.push(...(await saveChunkResults(smartChunk, embeddingModel, namespace, sectionTitle)));
  }
  return results;
};

export const textSplit = async (input: TextSplitInput): Promise<SplitResult[]> => {
  const { content, title, namespace, mode = 'auto' } = input;

  try {
    if (!modelLoaderSingleton.models?.embedding) {
      throw new Error(`Embedding model is not loaded. Please check the configuration for ${CustomModelConfigType.embedding}.`);
    }
    if (!modelLoaderSingleton.models?.slice) {
      throw new Error(`Slice model is not loaded. Please check the configuration for ${CustomModelConfigType.slice}.`);
    }
    const embeddingModel = modelLoaderSingleton.models.embedding;
    const sliceModel = modelLoaderSingleton.models.slice;

    // Explicit modes take priority: deterministic forces deterministic splitting, and llm forces the LLM path (ignoring the short-text threshold).
    if (mode === 'deterministic') {
      return deterministicSplit(content, embeddingModel as OpenAIEmbeddings, namespace, title);
    }

    if (mode === 'llm') {
      return llmSplit(content, sliceModel, embeddingModel as OpenAIEmbeddings, namespace, title);
    }

    // auto: short text is not worth an LLM call, so split deterministically.
    if (content.length < DETERMINISTIC_THRESHOLD) {
      return deterministicSplit(content, embeddingModel as OpenAIEmbeddings, namespace, title);
    }

    // auto: very long markdown is split by heading structure first and then processed section by section with the LLM; all other content goes directly to LLM semantic splitting.
    if (content.length > MARKDOWN_STRUCTURE_THRESHOLD && isMarkdown(content, title)) {
      return markdownStructureSplit(content, sliceModel, embeddingModel as OpenAIEmbeddings, namespace, title);
    }
    return llmSplit(content, sliceModel, embeddingModel as OpenAIEmbeddings, namespace, title);
  } catch (error) {
    logger.error(error);
    throw error;
  }
};