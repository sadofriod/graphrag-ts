import { lexer, parser, type Token, type Tokens } from 'marked';

export interface MarkdownSection {
  title: string;
  content: string;
  headingLevel: number;
}

const headingTokens = (markdown: string): Tokens.Heading[] =>
  lexer(markdown).filter((token) => token.type === 'heading') as Tokens.Heading[];

/** 提取顶层标题层级：h1 数量足够（>=2）用 h1；否则降级 h2 兜底；两者都少时退回 h1。 */
export const resolveTopLevelHeading = (markdown: string): number => {
  const headings = headingTokens(markdown);
  const h1 = headings.filter((h) => h.depth === 1).length;
  const h2 = headings.filter((h) => h.depth === 2).length;
  if (h1 >= 2) return 1;
  if (h2 >= 2) return 2;
  return 1;
};

const renderToken = (token: Token): string => parser([token]);

/** 按顶层标题切块；顶层标题之前的内容归入首个无标题前言块。 */
export const splitByTopLevelHeadings = (markdown: string): MarkdownSection[] => {
  const topLevel = resolveTopLevelHeading(markdown);
  const sections: MarkdownSection[] = [];
  let current: MarkdownSection | null = null;
  let preamble: string[] = [];

  for (const token of lexer(markdown)) {
    if (token.type === 'heading' && token.depth === topLevel) {
      if (current) {
        sections.push(current);
      } else if (preamble.length > 0) {
        sections.push({ title: '', content: preamble.join('\n\n'), headingLevel: topLevel });
        preamble = [];
      }
      current = { title: token.text, content: '', headingLevel: topLevel };
    } else if (current) {
      current.content = current.content ? `${current.content}\n\n${renderToken(token)}` : renderToken(token);
    } else {
      preamble.push(renderToken(token));
    }
  }
  if (current) sections.push(current);
  if (preamble.length > 0) {
    sections.push({ title: '', content: preamble.join('\n\n'), headingLevel: topLevel });
  }
  return sections;
};

/** 合并过小的相邻块：大块（>=minSize）独立保留，小块累积成合理输入区间，减少 LLM 调用次数。 */
export const mergeSmallSections = (
  sections: readonly MarkdownSection[],
  minSize: number,
): MarkdownSection[] => {
  const merged: MarkdownSection[] = [];
  let buffer: MarkdownSection | null = null;

  for (const section of sections) {
    if (section.content.length >= minSize) {
      if (buffer) {
        merged.push(buffer);
        buffer = null;
      }
      merged.push({ ...section });
      continue;
    }

    if (!buffer) {
      buffer = { ...section };
    } else {
      buffer = {
        title: buffer.title ? `${buffer.title} / ${section.title}` : section.title,
        content: `${buffer.content}\n\n${section.content}`,
        headingLevel: buffer.headingLevel,
      };
    }
  }
  if (buffer) merged.push(buffer);
  return merged;
};
