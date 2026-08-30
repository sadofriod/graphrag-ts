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

/** .md 扩展名优先，内容含 markdown 标题行兜底。 */
const isMarkdown = (content: string, title?: string): boolean => {
  const byName = title ? /\.md$/i.test(title) : false;
  const byContent = /^#{1,6}\s+\S+/m.test(content);
  return byName || byContent;
};


const getSmartChunk = async (content: string, sliceModel: ChatDeepSeek, contextTitle?: string): Promise<ChunkResult[]> => {
  // 结构切分场景注入当前小节标题，帮助 LLM 聚焦实体/关系抽取。
  const prompt = await assmblyAgent(
    contextTitle ? `【当前小节：${contextTitle}】\n${content}` : content,
    agentRegistry.ragSliceAgent,
  );
  const response = await invokeModelText(sliceModel, prompt);
  const backupSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: MAX_CHUNK_SIZE,
    chunkOverlap: MAX_CHUNK_SIZE / 10, // 10% overlap
  });

  try {
    // JSON mode 下输出可能是数组 [{...}]，也可能是 { "chunks": [...] } 包裹对象，两者都兼容。
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

    // 质量门槛：chunks 为空或全无实体/边（完全空洞）视为不可信，回退确定性切分。
    const hasSignal = llmChunks.some((chunk) => chunk.entities.length > 0 || chunk.edges.length > 0);
    if (llmChunks.length === 0 || !hasSignal) {
      throw new Error('LLM 切片输出空洞（无实体/边）');
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
    logger.warn('LLM 分块输出不可用，回退到确定性切分', error);
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

/** 确定性切分：RecursiveCharacterTextSplitter，无实体/边/断言。 */
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

/** LLM 语义切分：JSON mode 结构化输出，失败/空洞由 getSmartChunk 内部回退确定性。 */
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

/** markdown 超长：按顶层标题切块 → 合并小段 → 每段串行 LLM 语义切分（段落级兜底）。 */
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
    // 标题注入父块 title，供溯源；段内 LLM 失败由 getSmartChunk 独立回退，不影响其他段。
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

    // 显式模式优先：deterministic 强制确定性，llm 强制 LLM（不受短文本阈值影响）。
    if (mode === 'deterministic') {
      return deterministicSplit(content, embeddingModel as OpenAIEmbeddings, namespace, title);
    }

    if (mode === 'llm') {
      return llmSplit(content, sliceModel, embeddingModel as OpenAIEmbeddings, namespace, title);
    }

    // auto：短文本不值得付 LLM 成本，直接确定性切分。
    if (content.length < DETERMINISTIC_THRESHOLD) {
      return deterministicSplit(content, embeddingModel as OpenAIEmbeddings, namespace, title);
    }

    // auto：超长 markdown 先按标题结构切块再逐段 LLM，其余直接 LLM 语义切分。
    if (content.length > MARKDOWN_STRUCTURE_THRESHOLD && isMarkdown(content, title)) {
      return markdownStructureSplit(content, sliceModel, embeddingModel as OpenAIEmbeddings, namespace, title);
    }
    return llmSplit(content, sliceModel, embeddingModel as OpenAIEmbeddings, namespace, title);
  } catch (error) {
    logger.error(error);
    throw error;
  }
};