# GraphRAG MCP Benchmark 报告

基线运行日期：2026-10-11\
基线运行方式：Docker Compose 启动 PostgreSQL/pgvector 与 MCP HTTP 服务，通过 MCP `query_graph` 工具执行检索。\
基线模型：DeepSeek API `deepseek-v4-flash`（slice / judge）；LM Studio `text-embedding-nomic-embed-text-v1.5`（768 维 embedding）。

## 核心结果

| 场景 | 覆盖范围 | 结果 |
|---|---|---|
| In-corpus 检索 | 5 个章节，12 个问题 | Strict hit 10/12（83.3%）；combined recall 95.8%；平均查询延迟 22.5 秒；索引耗时约 12 分 19 秒 |
| Global Map Reduce（修复后） | 2 个跨社区问题 | Map 两题 entity/phrase recall 均为 100%；Reduce 最终 combined recall 分别为 80% 和 100% |
| 增量更新 | 更新 1 篇 Alice 文档并查询新增事实 | combined recall 从 50% 升至 100%；增量构建耗时约 5 分 11 秒 |

**如何解读：** 12 题检索基线与 10 月 12 日工作流复测使用不同模型和运行环境，不构成模型横评。Recall 是基于实体与有序短语的词面评估，不是人工语义评分。Global Map Reduce 的修复前后结果及仍存在的跨批次冲突见下文。

## 语料与基线

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

## Global Map Reduce 与增量更新复测

日期：2026-10-12。该复测使用 benchmark 数据库副本和隔离 namespace 执行，没有修改已有活动索引。语料使用当前 benchmark 索引中的 Alice 与 Frankenstein 文档；slice/judge 模型为 LM Studio `google/gemma-4-12b`，embedding 模型为 `text-embedding-nomic-embed-text-v1.5`。此结果与上方 2026-10-11 的 DeepSeek/MCP 基线使用不同模型和执行环境，应分开比较。

### Global Map Reduce

以下为修复前的历史基线：默认只读取 level 0 社区摘要，Map 输入不含叶社区关联的 claim/chunk；其中 `wretchedness and despair` 不在本次索引语料内。

| id | Status | Map answers | Failed batches | Entity recall | Phrase recall | Missing entities | Missing phrases |
|---|---|:---:|:---:|:---:|:---:|---|---|
| global-alice-creature-learning | completed | 1 | 0 | 67% | 0% | De Lacey | three little sisters, articulate sounds |
| global-victor-creation-cost | completed | 1 | 0 | 100% | 0% | - | dull yellow eye, wretchedness and despair |

两条 Global Map Reduce 查询均成功完成 Map/Reduce 流程；实体召回分别为 67% 和 100%，期望短语均未命中。Map 成功仅表示工作流完成，不代表答案达到了预期召回。

#### 叶社区与事实证据修复后

复测使用默认叶社区选择，并将叶社区关联的 claims 和原始 source chunks 一并提供给 Map；MCP `query_graph_global` 支持 `community_level: "leaf"`，也仍支持非负整数精确选择某一层。Global benchmark 期望已移除不在索引内的短语，并分别计算 Map 中间答案与 Reduce 最终答案的词面 recall。

| id | Status | Map answers | Failed batches | Map entity recall | Map phrase recall | Final entity recall | Final phrase recall | Missing final entities | Missing final phrases |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|---|---|
| global-alice-creature-learning | completed | 5 | 0 | 100% | 100% | 100% | 50% | - | articulate sounds |
| global-victor-creation-cost | completed | 3 | 0 | 100% | 100% | 100% | 100% | - | - |

叶社区证据让 Map 两题都达到 100% recall；Reduce 后 Victor 题保持 100%，Alice/Creature 题降至 80% combined recall。该题的 Map 答案对 Dormouse 是否讲述“三姐妹”存在冲突，Reduce 将冲突内容都写入最终答案；最终答案保留了 `three little sisters`，但没有 `articulate sounds`。这是当前跨批次综合仍需改进之处。以上结果是词面评估，不等同于语义判分。

### 增量更新

对 `alice-adventures-in-wonderland.md` 追加一条新事实：“Alice keeps a silver compass in the west observatory as part of the new archive.” 然后使用增量构建更新索引，并查询 `What does Alice keep in the west observatory?`。

| 阶段 | Entity recall | Phrase recall | Combined recall | Strict hit | Missing entities | Missing phrases |
|---|---:|---:|---:|:---:|---|---|
| 更新前 | 50% | 50% | 50% | no | silver compass | new archive |
| 增量更新后 | 100% | 100% | 100% | yes | - | - |

| 指标 | 结果 |
|---|---:|
| Build mode | incremental |
| Updated file | alice-adventures-in-wonderland.md |
| Incremental build duration | 310,667 ms (5m 10.7s) |

更新前已能检索到 Alice 和 `west observatory`，因此基线为 50%；更新后新加入的 `silver compass` 与 `new archive` 均可检索。此处验证的是指定文档更新后的新事实召回，不代表完整 corpus 的增量吞吐性能。

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
