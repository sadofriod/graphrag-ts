# page-anchor-probe（本地验证，非产品代码）

验证一件事：**一份研报 PDF 渲染出的 Markdown chunk，能不能追回到「第几页 + 哪个 bbox」**。
这决定「每条结论都能点回原文页」这个卖点是否可交付。

## 结论（实测）

**能，而且不需要文本相似度匹配 —— 页码和 bbox 在现有 pdfplumber 产物里已经是确定性数据。**

`pdfplumber_probe.py` 输出的 Markdown 里，每个内容块前面带一行 HTML 注释：

```
<!-- page 3 bbox=64.1,375.65,505.3,445.26 ruled-lines -->
```

实测三份财报中，**注释数与 chunk 数严格 1:1**：

| 文档 | chunks | `<!-- page ... bbox=... -->` 注释 | 比例 |
|---|---|---|---|
| moutai-2024-ar | 275 | 275 | 1:1 |
| cmb-2024-ar | 45 | 45 | 1:1 |
| berkshire-2024-ar | 138 | 138 | 1:1 |

所以接入路径是：**chunker 保留这行注释 → 解析出 `{page, bbox}` → 写进 `EvidenceSnippet`**。零模型、零模糊匹配、零额外依赖。

## 模糊匹配这条路的实测（作为对照，不建议上线）

`anchor.mjs` 用字符 bigram Dice 相似度做的反向匹配，用于回答「如果 Markdown 注释丢了会怎样」：

| 文档 | chunks | 锚定成功 | coverage | 中位相似度 |
|---|---|---|---|---|
| moutai-2024-ar | 275 | 239 | 86.9% | 0.447 |
| cmb-2024-ar | 45 | 45 | 100% | — |
| berkshire-2024-ar | 138 | 133 | 96.4% | — |
| huadian-boe-2025-research | 8 | 6 | 75% | — |

**覆盖率看着还行，但置信度不行**：Moutai 239 个成功锚定里，相似度 ≥0.75 的是 **0 个**，中位数 0.447。原因是表格渲染成 Markdown 后与 PDF 里的文本块形态差异很大（行列拼接、单元格合并、跨页），词面相似度天然偏低。

**判断：不要把这个模糊匹配做进产品。** 它是「注释丢失时的兜底」，而注释本来就是我们自己生成的。

## 它证明了什么 / 没证明什么

证明了：
- PDF → Markdown 的渲染层已经保留了页级锚点信息，且与 chunk 一一对应。
- 缺的不是能力，是**没有把这两个字段带进 `EvidenceSnippet`**（当前只有 `doc/chunk` 级引用）。

没证明：
- 扫描件（无文本层）的锚点 —— 需要 OCR，另说。
- 跨页表格的 bbox 合并 —— 目前一个块一个 bbox，跨页会拆成两个 chunk。
- 正文段落的锚点质量 —— 实测样本主要是表格块；散段落未单独记分。
- 还没有接进 `src/` 或 `integrations/mcp/`，只是探针。

## 跑法

```bash
OUT=/opt/data/workspace/graphrag-promo/pdf-pipeline/probe/out
node examples/page-anchor-probe/anchor.mjs \
  --blocks $OUT/moutai-2024-ar.plumber.blocks.json \
  --md     $OUT/moutai-2024-ar.plumber.md \
  --out    $OUT/moutai-2024-ar.anchors.json
# → {"chunks":275,"anchored":239,"ambiguous":232,"coverage":0.869}
```

`anchor.mjs` 兼容两种 dump 形态：`{blocks:[{page,type,items:[{text,bbox}]}]}`（pdfplumber）与 `{blocks:[{id,page,bbbox,text}]}`（pdfjs）。

## 备注

本目录由 Hermes 直接写入，**不是 OpenCode 产出** —— OpenCode 连续两次在 600s/1200s 内超时且未落任何文件（session `ses_ea0bd8149ffe7bWJT3EQAXbQFy`、`ses_ea0a3fc7bffegY0eyBFbVe4liw`，inspect 显示 `idle`、`last_assistant_text` 为空）。按 SOUL.md 的例外条款记录在此。
