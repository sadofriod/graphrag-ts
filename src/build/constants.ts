export const MAX_CHUNK_SIZE = 800; // Maximum number of characters in a chunk
export const DETERMINISTIC_THRESHOLD = 1500; // Use deterministic splitting directly for short text (character count); an LLM call is not worth the cost
export const MARKDOWN_STRUCTURE_THRESHOLD = 4000; // Split very long markdown by top-level headings first (character count)
export const MERGE_THRESHOLD = 2000; // Merge threshold for adjacent undersized heading sections (character count), to control LLM calls
export const LLM_TIMEOUT_MS = 300_000; // Timeout for LLM semantic splitting (5 minutes); fall back to deterministic splitting on timeout