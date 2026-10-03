import { CustomModelConfigType } from '../custom.model.conf.type';
import { DETERMINISTIC_THRESHOLD, MARKDOWN_STRUCTURE_THRESHOLD } from '../constants';
import { logger } from '../../logger';
import { modelLoaderSingleton } from '../modelLoader';
import { split } from './split';
import type { SplitResult, TextSplitInput, TextSplitMode } from './types';

type SplitMode = Exclude<TextSplitMode, 'auto'> | 'markdown-structure';

const isMarkdown = (content: string, title?: string): boolean => {
  const byName = title ? /\.md$/i.test(title) : false;
  const byContent = /^#{1,6}\s+\S+/m.test(content);
  return byName || byContent;
};

const resolveSplitMode = (
  mode: TextSplitMode,
  content: string,
  title?: string,
): SplitMode => {
  if (mode !== 'auto') {
    return mode;
  }
  if (content.length < DETERMINISTIC_THRESHOLD) {
    return 'deterministic';
  }
  if (content.length > MARKDOWN_STRUCTURE_THRESHOLD && isMarkdown(content, title)) {
    return 'markdown-structure';
  }
  return 'llm';
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
    const params = {
      content,
      embeddingModel,
      namespace,
      ...(title ? { title } : {}),
    };
    const splitMode = resolveSplitMode(mode, content, title);

    switch (splitMode) {
      case 'deterministic':
        return split({ ...params, mode: 'deterministic' });
      case 'llm':
        return split({ ...params, mode: 'llm', sliceModel });
      case 'markdown-structure':
        return split({ ...params, mode: 'markdown-structure', sliceModel });
      default: {
        const exhaustiveCheck: never = splitMode;
        return exhaustiveCheck;
      }
    }
  } catch (error) {
    logger.error(error);
    throw error;
  }
};
