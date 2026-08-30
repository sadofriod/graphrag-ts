import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { BENCHMARK_QUERIES } from './dataset';

const SAMPLE_CORPUS_ROOT = new URL('../../examples/sample-corpus', import.meta.url).pathname;

const readCorpus = (root: string): string => {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name.endsWith('.md')) {
        parts.push(readFileSync(full, 'utf8'));
      }
    }
  };
  walk(root);
  return parts.join('\n');
};

const corpusAvailable = existsSync(SAMPLE_CORPUS_ROOT);
const corpusText = corpusAvailable ? readCorpus(SAMPLE_CORPUS_ROOT) : '';

describe('benchmark dataset', () => {
  it('query ids are unique', () => {
    const ids = BENCHMARK_QUERIES.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every query has non-empty entities and phrases', () => {
    for (const query of BENCHMARK_QUERIES) {
      expect(query.expectation.entities.length).toBeGreaterThan(0);
      expect(query.expectation.phrases.length).toBeGreaterThan(0);
    }
  });

  it('every query has a positive topK and a valid volume', () => {
    for (const query of BENCHMARK_QUERIES) {
      expect(query.topK).toBeGreaterThan(0);
      expect([1, 2, 3]).toContain(query.volume);
    }
  });

  it('ids are grouped per volume', () => {
    for (const volume of [1, 2, 3] as const) {
      const ids = BENCHMARK_QUERIES.filter((query) => query.volume === volume).map(
        ({ id }) => id,
      );
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) {
        expect(id).toMatch(new RegExp(`^v${volume}-`));
      }
    }
  });
});

describe('dataset vs sample corpus', () => {
  it.skipIf(!corpusAvailable)(
    'every expected entity and phrase appears verbatim in the sample corpus',
    () => {
      for (const query of BENCHMARK_QUERIES) {
        for (const entity of query.expectation.entities) {
          expect(corpusText).toContain(entity);
        }
        for (const phrase of query.expectation.phrases) {
          expect(corpusText).toContain(phrase);
        }
      }
    },
  );
});
