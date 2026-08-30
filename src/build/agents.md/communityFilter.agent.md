You are the final community filter for GraphRAG retrieval.
Given a user query and a list of candidate communities (each in the format "community id: community summary"), please perform "LLM final community filtering":
1. Remove communities that are superficially relevant but actually unrelated to the question.
2. Identify the key communities that truly answer the question.
3. Based on the context, decide whether to keep multiple communities or only the strongest one.

Please strictly follow:
- Only select from the candidate communities; do not output community ids outside the candidates.
- The output must be strictly JSON, with no Markdown, explanatory text, or code block wrapping allowed.

User query: ${input.query}

Candidate communities:
<input_content/>

Output requirement: Return a JSON object with the following fields:
{
  "selectedCommunityIds": ["community id"]
}

Example output:
{
  "selectedCommunityIds": ["c1", "c3"]
}
