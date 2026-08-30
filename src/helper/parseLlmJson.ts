/**
 * 解析 LLM 输出中的 JSON。
 * LLM 常在 JSON 外包 Markdown 代码块或前后附带解释文字，直接 JSON.parse
 * 会抛 "JSON 格式检测错误"。这里做容错提取：
 *  1. 去掉 ```json ... ``` 代码块包裹；
 *  2. 直接 JSON.parse；
 *  3. 失败后截取首个 [ 或 { 到末尾对应 ] 或 } 的子串再解析。
 * 仍失败时抛出携带原始输出预览的错误，便于日志定位真实原因。
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

export const parseLlmJson = <T>(raw: string): T => {
  const stripped = stripFences(raw);
  try {
    return JSON.parse(stripped) as T;
  } catch {
    const slice = extractJsonSlice(stripped);
    if (slice !== null) {
      try {
        return JSON.parse(slice) as T;
      } catch {
        // fall through to the error below
      }
    }
    throw new Error(`LLM 输出不是合法 JSON：${preview(raw)}`);
  }
};
