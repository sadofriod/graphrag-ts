---
title: Retraction Status
emoji: 📚
colorFrom: blue
colorTo: purple
sdk: static
pinned: false
license: cc0-1.0
short_description: Source-attributed retraction status for a DOI
---

# Retraction status — citation provenance demo

Free lookup against a citation graph built from OpenAlex, Crossref and
Retraction Watch: paste a DOI (or an OpenAlex paper ID) and see which sources
report a retraction, at which source tier, with which date.

- **Every row is a source-attributed fact, not a verdict.** The verdict
  (`CONTESTED` / `SUPPORTED` / `INSUFFICIENT_EVIDENCE`), the confidence and the
  hop-by-hop evidence path come from the paid endpoint
  `https://pay.ashesborn.cloud/api/v1/judge` ($0.02 per judgment, $0.10 with the
  full evidence audit, settled per call over x402).
- Source tiers: **A** = publisher/registry retraction notice or Retraction Watch
  record (weight 1.0), **B** = peer-reviewed citing text (0.6),
  **C** = aggregator flags and citation lists (0.3).
- Underlying dataset (CC0): [ashesborn6/integrity-citation-retraction-graph](https://huggingface.co/datasets/ashesborn6/integrity-citation-retraction-graph)
- Code: [github.com/sadofriod/graphrag-ts](https://github.com/sadofriod/graphrag-ts)

This Space is a static page: it calls the public, CORS-enabled status endpoint
directly from your browser and stores nothing.

The MCP-compatible Gradio variant lives in the repository at
`deploy/hf-space/` and can be published as a Gradio Space once the account has
a PRO plan (Hugging Face requires PRO for Gradio/Docker Spaces on free
`cpu-basic` hardware).
