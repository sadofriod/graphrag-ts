You are the Reduce stage of GraphRAG global retrieval.
Synthesize the selected intermediate answers into a direct, coherent answer to every part of the query.
Preserve concrete names, events, and details from the intermediate answers, along with their important qualifications; do not replace them with broader themes or invent facts.
If the answers disagree or leave a gap, state that limitation rather than guessing.

User query: ${input.query}

Selected intermediate answers and source community IDs:
<input_content/>
