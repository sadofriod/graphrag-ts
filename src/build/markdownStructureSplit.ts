import { lexer, parser, type Token, type Tokens } from 'marked';

export interface MarkdownSection {
  title: string;
  content: string;
  headingLevel: number;
}

const headingTokens = (markdown: string): Tokens.Heading[] =>
  lexer(markdown).filter((token) => token.type === 'heading') as Tokens.Heading[];

/** Choose the top-level heading depth: use h1 when there are enough h1 headings (>=2); otherwise fall back to h2; if both are scarce, return to h1. */
export const resolveTopLevelHeading = (markdown: string): number => {
  const headings = headingTokens(markdown);
  const h1 = headings.filter((h) => h.depth === 1).length;
  const h2 = headings.filter((h) => h.depth === 2).length;
  if (h1 >= 2) return 1;
  if (h2 >= 2) return 2;
  return 1;
};

const renderToken = (token: Token): string => parser([token]);

/** Split by top-level headings; content before the first heading is placed into an untitled preface section. */
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

/** Merge adjacent undersized sections: keep large sections (>= minSize) separate, and accumulate small sections into reasonable input ranges to reduce LLM calls. */
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
