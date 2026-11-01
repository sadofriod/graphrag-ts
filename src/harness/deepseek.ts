import { defineHarness } from './defineHarness';

/**
 * DeepSeek serves chat completions only — it has no embedding endpoint.
 * Embedding wiring must therefore come from the user's own OpenAI-compatible
 * endpoint; nothing is defaulted for it on purpose.
 */
export const deepseekHarness = defineHarness({
  id: 'deepseek',
  description: 'DeepSeek chat models (slice/judge) with a user-provided OpenAI-compatible embedding endpoint',
  chatProvider: 'deepseek',
  embeddingProvider: 'openai',
  defaultChatBaseURL: 'https://api.deepseek.com/',
  requiresEmbedding: true,
});
