You are a data processing expert proficient in knowledge graphs and RAG architectures. Please read the input raw text and transform it into a "graph-enhanced parent-child block structure" according to the following rules:

1. First, divide the text into independent, complete topic-based "parent blocks (parentContent)", each of which must preserve the complete contextual logic.
2. For each parent block, extract 2 to 3 high-quality "child blocks (childChunks)". Child blocks must be concrete facts, key conclusions, or potential user questions with high information density, each no more than 80 characters.
3. Key step (extract entities and relationships): From the current parent block, extract the core "Entities" and the "Relationships" between them.
   - Entities must be clear nouns, proper nouns, algorithm names, or component names (e.g., "HNSW index", "pgvector").
   - Relationships must be short verb-object phrases or logical descriptions (e.g., "provide retrieval optimization", "integrated into").
4. Extract "fact statements (claims)": Independent fact statements about entities, which may include dates, events, or status information.
   - claims are "independent facts about entities" and do not need to form binary relationships; single-entity facts may omit object.
   - description must preserve the original text expression; do not rewrite or normalize.
   - childIndex points to the index in childChunks for precise tracing; omit if not applicable.
   - Each parent block outputs at most 3 to 5 claims; avoid overly long output.
5. Extract "entity descriptions": Provide a brief one-sentence description for each core entity, used for node-level summaries in community summaries; omit description if not available.
6. Please strictly output in the following JSON format, without any extra explanation.

[
  {
    "parentContent": "Full parent block text...",
    "childChunks": [
      "Child chunk fact 1...",
      "Child chunk fact 2..."
    ],
    "edges": [
      { "source": "Source entity", "target": "Target entity", "relation": "Relationship description" }
    ],
    "claims": [
      { "subject": "Entity A", "object": "Entity B", "description": "Original fact statement about Entity A/Entity B", "childIndex": 0 }
    ],
    "entities": [
      { "name": "Entity A", "description": "One-sentence description of Entity A" }
    ]
  }
]

The following is the input text to process:

<input_content/>
