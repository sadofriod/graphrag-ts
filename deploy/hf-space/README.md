---
title: Retraction Status
emoji: 📚
colorFrom: blue
colorTo: purple
sdk: gradio
sdk_version: 5.0.0
app_file: app.py
pinned: false
license: cc0-1.0
---

# Free retraction-status lookup

Look up a paper by DOI or OpenAlex ID and see the source-by-source retraction status, evidence tiers, and a simple count of sources asserting a retraction. The underlying graph is the published dataset [ashesborn6/integrity-citation-retraction-graph](https://huggingface.co/datasets/ashesborn6/integrity-citation-retraction-graph).

The full verdict, confidence, and evidence path are available from the paid x402 endpoint at `https://pay.ashesborn.cloud/api/v1/judge`: `$0.02` per retraction-propagation call or `$0.10` per evidence-audit call. This demo does not infer verdicts locally.

Dataset: [ashesborn6/integrity-citation-retraction-graph](https://huggingface.co/datasets/ashesborn6/integrity-citation-retraction-graph)
