export const MAX_CHUNK_SIZE = 800; // Maximum number of characters in a chunk
export const DETERMINISTIC_THRESHOLD = 1500; // 短文本直接用确定性切分（字符数），不值得付 LLM 成本
export const MARKDOWN_STRUCTURE_THRESHOLD = 4000; // 超长 markdown 先按顶层标题结构切分（字符数）
export const MERGE_THRESHOLD = 2000; // 相邻过小的标题块合并阈值（字符数），控制 LLM 调用次数
export const LLM_TIMEOUT_MS = 300_000; // LLM 语义切分超时（5 分钟），超时回退确定性切分