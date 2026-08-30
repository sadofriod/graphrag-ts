import { describe, expect, it } from 'bun:test';

import { parseLlmJson } from './parseLlmJson';

describe('parseLlmJson', () => {
  it('parses plain JSON', () => {
    expect(parseLlmJson<{ answer: string }>('{"answer":"ok"}')).toEqual({ answer: 'ok' });
  });

  it('strips a markdown json code fence', () => {
    const raw = '```json\n{"answer":"ok"}\n```';
    expect(parseLlmJson<{ answer: string }>(raw)).toEqual({ answer: 'ok' });
  });

  it('strips a code fence without a language tag', () => {
    const raw = '```\n{"answer":"ok"}\n```';
    expect(parseLlmJson<{ answer: string }>(raw)).toEqual({ answer: 'ok' });
  });

  it('parses a JSON array wrapped in a fence', () => {
    const raw = '```json\n[{"parentContent":"p"}]\n```';
    expect(parseLlmJson<{ parentContent: string }[]>(raw)).toEqual([{ parentContent: 'p' }]);
  });

  it('extracts JSON embedded in surrounding prose', () => {
    const raw = '以下是结果：\n{"answer":"ok"}\n请查收。';
    expect(parseLlmJson<{ answer: string }>(raw)).toEqual({ answer: 'ok' });
  });

  it('throws with a preview of the raw output when no JSON is present', () => {
    expect(() => parseLlmJson('抱歉，我无法理解你的请求。')).toThrow(/不是合法 JSON/);
  });

  it('truncates long raw output in the error preview', () => {
    const raw = 'x'.repeat(300);
    expect(() => parseLlmJson(raw)).toThrow(/x{200}…/);
  });
});
