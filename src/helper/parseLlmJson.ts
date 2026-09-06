/**
 * Parse JSON from LLM output.
 * LLMs often wrap JSON in markdown code fences or add explanatory text before/after it, so a direct JSON.parse
 * can fail with a JSON parsing error. This helper extracts JSON more defensively:
 *  1. Remove any ```json ... ``` code fences;
 *  2. Try JSON.parse directly;
 *  3. If that fails, extract the substring from the first [ or { to the matching closing ] or } and parse that instead.
 * If parsing still fails, throw an error with a preview of the raw output so logs can reveal the real cause.
 */

const FENCE_PATTERN = /```(?:json)?\s*([\s\S]*?)```/i;

const stripFences = (raw: string): string => {
  const fenced = raw.match(FENCE_PATTERN);
  return fenced?.[1] ?? raw;
};

const extractJsonSlice = (text: string): string | null => {
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start]!;
  const close = open === '[' ? ']' : '}';
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  return text.slice(start, end + 1);
};

const preview = (raw: string): string => (raw.length > 200 ? `${raw.slice(0, 200)}…` : raw);

const tryParseJson = <T>(text: string): T | null => {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

export const parseLlmJson = <T>(raw: string): T => {
  const stripped = stripFences(raw);
  const direct = tryParseJson<T>(stripped);
  if (direct !== null) {
    return direct;
  }

  const slice = extractJsonSlice(stripped);
  if (slice !== null) {
    const sliced = tryParseJson<T>(slice);
    if (sliced !== null) {
      return sliced;
    }
  }

  throw new Error(`LLM output is not valid JSON: ${preview(raw)}`);
};
