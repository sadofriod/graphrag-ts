import { readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import type { BuildInputFile } from '../../src/build/buildRag';

interface PublicTextSource {
  readonly title: string;
  readonly fileName: string;
  readonly url: string;
  readonly includeSections?: RegExp;
}

const PUBLIC_TEXTS: readonly PublicTextSource[] = [
  {
    title: "Alice's Adventures in Wonderland",
    fileName: 'alice-adventures-in-wonderland.md',
    url: 'https://www.gutenberg.org/cache/epub/11/pg11.txt',
    includeSections: /^## CHAPTER (I|VII)\./,
  },
  {
    title: 'Frankenstein',
    fileName: 'frankenstein.md',
    url: 'https://www.gutenberg.org/cache/epub/84/pg84.txt',
    includeSections: /^## Chapter (5|12|13)\b/,
  },
  {
    title: 'The Adventures of Sherlock Holmes',
    fileName: 'adventures-of-sherlock-holmes.md',
    url: 'https://www.gutenberg.org/cache/epub/1661/pg1661.txt',
    includeSections: /^## (I\. A SCANDAL IN BOHEMIA|II\. THE RED-HEADED LEAGUE)$/,
  },
];

export const DEFAULT_LONG_CORPUS_DIR = new URL('../generated/long-markdown-corpus', import.meta.url)
  .pathname;

const stripProjectGutenbergMatter = (text: string): string => {
  const startMatch = /\*\*\* START OF (?:THE )?PROJECT GUTENBERG EBOOK[^\n]*\*\*\*/i.exec(text);
  const endMatch = /\*\*\* END OF (?:THE )?PROJECT GUTENBERG EBOOK/i.exec(text);
  const start = startMatch ? startMatch.index + startMatch[0].length : 0;
  const end = endMatch ? endMatch.index : text.length;
  return text.slice(start, end).trim();
};

const markdownizeChapterHeadings = (text: string): string =>
  text
    .replace(/^((?:CHAPTER|Chapter)\s+[IVXLCDM0-9]+\.?[^\n]*)$/gm, '## $1')
    .replace(/^((?:LETTER|Letter)\s+[IVXLCDM0-9]+\.?[^\n]*)$/gm, '## $1')
    .replace(/^((?:ADVENTURE|Adventure)\s+[IVXLCDM0-9]+\.?[^\n]*)$/gm, '## $1')
    .replace(/^([IVXLCDM]+\.\s+[A-Z][A-Z\s’'-]+)$/gm, '## $1');

const selectSections = (body: string, includeSections: RegExp | undefined): string => {
  if (!includeSections) {
    return body;
  }

  const sections = body.split(/(?=^##\s+)/m);
  return sections
    .filter((section) => includeSections.test(section.split('\n')[0] ?? ''))
    .join('\n\n')
    .trim();
};

const toMarkdown = (source: PublicTextSource, text: string): string => {
  const body = selectSections(
    markdownizeChapterHeadings(stripProjectGutenbergMatter(text)),
    source.includeSections,
  );
  return [`# ${source.title}`, '', `Source: ${source.url}`, '', body, ''].join('\n');
};

const fetchText = async (source: PublicTextSource): Promise<string> => {
  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`Failed to download ${source.title}: HTTP ${response.status}`);
  }
  return response.text();
};

export const prepareLongMarkdownCorpus = async (dir = DEFAULT_LONG_CORPUS_DIR): Promise<string> => {
  await mkdir(dir, { recursive: true });
  for (const source of PUBLIC_TEXTS) {
    const path = join(dir, source.fileName);
    await writeFile(path, toMarkdown(source, await fetchText(source)), 'utf8');
  }
  return dir;
};

export const readMarkdownFiles = (dir: string): BuildInputFile[] => {
  const files: BuildInputFile[] = [];

  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.md')) {
        files.push({ title: basename(full), content: readFileSync(full, 'utf8') });
      }
    }
  };

  walk(dir);
  return files;
};

export const describeCorpus = async (dir: string): Promise<string> => {
  const files = readMarkdownFiles(dir);
  const chars = files.reduce((sum, file) => sum + file.content.length, 0);
  const headings = files.reduce((sum, file) => sum + (file.content.match(/^##\s+/gm)?.length ?? 0), 0);
  const [firstSource] = PUBLIC_TEXTS;
  if (!firstSource) {
    throw new Error('No public text sources configured');
  }
  const marker = await readFile(join(dir, firstSource.fileName), 'utf8');
  return `${files.length} markdown files, ${chars.toLocaleString()} chars, ${headings} chapter headings, sample=${marker.slice(0, 32).replace(/\s+/g, ' ')}`;
};