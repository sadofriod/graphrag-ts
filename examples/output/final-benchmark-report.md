# GraphRAG MCP Benchmark 报告

日期：2026-10-11\
运行方式：Docker Compose 启动 PostgreSQL/pgvector 与 MCP HTTP 服务，通过 MCP `query_graph` 工具执行检索。
模型配置：DeepSeek API `deepseek-v4-flash`（slice / judge）；LM Studio `text-embedding-nomic-embed-text-v1.5`（768 维 embedding）。

## 语料范围

本次挂载的语料只包含：

- Alice's Adventures in Wonderland：Chapter I、Chapter VII
- Frankenstein：Chapter 5、Chapter 12、Chapter 13

## In-Corpus Recall

对语料建立索引后，运行 12 条仅涉及上述章节的问题，全部经 Docker MCP `query_graph` 执行。索引耗时约 12 分 19 秒。

| 指标 | 结果 |
|---|---:|
| 问题数 | 12 |
| Strict hits | 10 / 12 (83.3%) |
| Average entity recall | 95.8% |
| Average phrase recall | 95.8% |
| Average combined recall | 95.8% |
| Average query latency | 22,513 ms |

| Source | Queries | Hits | Hit rate | Entity recall | Phrase recall |
|---|:---:|:---:|:---:|:---:|:---:|
| Alice's Adventures in Wonderland | 7 | 7 | 100.0% | 100.0% | 100.0% |
| Frankenstein | 5 | 3 | 60.0% | 90.0% | 90.0% |

| id | Source | Focus | Hit | Entity recall | Phrase recall | Missing entities | Missing phrases |
|---|---|---|:---:|:---:|:---:|---|---|
| corpus-alice-rabbit-watch | Alice's Adventures in Wonderland | chapter I rabbit watch | yes | 100% | 100% | - | - |
| corpus-alice-marmalade-jar | Alice's Adventures in Wonderland | chapter I falling jar | yes | 100% | 100% | - | - |
| corpus-alice-rabbit-eyes | Alice's Adventures in Wonderland | chapter I rabbit appearance | yes | 100% | 100% | - | - |
| corpus-alice-tea-party-guests | Alice's Adventures in Wonderland | chapter VII tea party guests | yes | 100% | 100% | - | - |
| corpus-alice-no-wine | Alice's Adventures in Wonderland | chapter VII tea offer | yes | 100% | 100% | - | - |
| corpus-alice-hatter-riddle | Alice's Adventures in Wonderland | chapter VII raven riddle | yes | 100% | 100% | - | - |
| corpus-alice-dormouse-story | Alice's Adventures in Wonderland | chapter VII Dormouse story | yes | 100% | 100% | - | - |
| corpus-frankenstein-creation-eye | Frankenstein | chapter 5 creature awakens | yes | 100% | 100% | - | - |
| corpus-frankenstein-victor-reaction | Frankenstein | chapter 5 Victor flees | no | 50% | 100% | Elizabeth | - |
| corpus-frankenstein-clerval-arrival | Frankenstein | chapter 5 Clerval arrives | yes | 100% | 100% | - | - |
| corpus-frankenstein-cottage-words | Frankenstein | chapter 12 creature learns words | yes | 100% | 100% | - | - |
| corpus-frankenstein-safie-arrives | Frankenstein | chapter 13 Safie arrives | no | 100% | 50% | - | on horseback |

## Per-Section Graph Counts

各已索引章节的持久化数据计数如下。Child chunks 包含图抽取结果及原文分块；claims/edges 按 parent 归属统计。

| Indexed section | Child chunks | Claims | Edges |
|---|---:|---:|---:|
| Alice Chapter I | 83 | 45 | 36 |
| Alice Chapter VII | 83 | 45 | 35 |
| Frankenstein Chapter 5 | 87 | 58 | 21 |
| Frankenstein Chapter 12 | 90 | 57 | 33 |
| Frankenstein Chapter 13 | 88 | 56 | 41 |

章节间 edge 数量不同；数量描述图结构规模，不单独代表图质量或检索质量。评估图质量还需结合实体/关系准确率、证据覆盖和人工核验。

## 五分钟内启动 Benchmark

五分钟目标指：Docker 已安装，模型与连接配置已就绪的前提下，从执行命令到 Compose 服务 ready、MCP 开始处理 benchmark 索引任务；**不表示整个索引与查询会在五分钟内完成**。模型下载/加载及机器和网络差异不计入此目标。

从仓库根目录复制 `.env.example` 为 `.env`，设置 `POSTGRES_PASSWORD` 及其 URL 编码值，配置容器可访问的 slice、judge 和 embedding endpoint，然后运行：

```bash
pnpm benchmark:docker:quick
```

runner 在 MCP 容器内执行，不要求宿主机安装 Bun workspace 依赖。quick corpus 会触发 LLM 图抽取；该路径用于启动服务、提交索引任务并开始 benchmark，不替代完整 12 题 recall 评测。

## 结论与限制

- 12 题 strict hit 为 83.3%，combined recall 为 95.8%。
- 平均查询延迟为 22.5 秒；完整索引耗时约 12 分 19 秒。五分钟目标仅针对服务启动和索引任务开始，不涵盖索引和查询完成时间。
- 评估器根据实体和有序短语匹配计算 recall，不等同于人工语义判分；两条未严格命中的问题应结合逐题期望与原文证据解释。
- 图计数描述数据规模，不能单独作为图质量或召回质量结论；跨数据集/配置比较需固定语料、模型、参数及评估规则。
