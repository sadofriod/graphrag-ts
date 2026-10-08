# GraphRAG MCP Server MVP 产品需求文档

## 1. 文档信息

- 状态：Draft
- 版本：0.1
- 日期：2026-09-29
- 产品：基于 `graphrag-ts` 的本地 GraphRAG MCP Server
- 部署目标：Docker Compose

## 2. 产品概述

把 `graphrag-ts` 封装为可由 LM Studio 等 MCP 客户端调用的本地知识服务。按上游当前实现，GraphRAG 数据保存在 PostgreSQL（需 pgvector 扩展）中，而不是文件索引目录。用户显式提交文档或文本后，系统在后台构建 GraphRAG namespace；用户提问时，MCP 工具同步查询当前活动 namespace，并返回受控长度的答案与来源。

MVP 的核心不是“每轮对话自动学习”，而是验证这条端到端路径：

> 提交知识 → 后台索引 → 检查任务状态 → MCP 同步检索 → 客户端使用结果

## 3. 背景与问题

GraphRAG 的索引构建可能包含多次模型调用，耗时和资源消耗不适合直接阻塞聊天请求。上游提供 `startBuild`/`startIncrementalBuild`，会在当前进程内异步执行构建，并以 PostgreSQL 中的 `GenerationJob` 记录状态；图谱、向量和全文检索数据也存于 PostgreSQL。现有 job registry 的状态镜像在进程内，数据库记录没有完整输入 payload，也不是可恢复队列，因此 MCP 层仍需实现可持久化的任务输入与恢复策略。

若 worker 在活动 namespace 上增量构建，查询期间可能观察到尚未完成的更新。MVP 使用独立 namespace 构建完整知识库快照，成功后再更新活动 namespace 指针；旧 namespace 暂时保留，避免构建失败或切换期间破坏可查询数据。

本产品在 MCP 服务进程中运行一个受 PostgreSQL 持久化队列驱动的后台构建 worker；检索只读取已完成并发布的索引版本。MVP 不额外拆分 worker 容器，文件输入通过只读挂载提供，GraphRAG 和任务数据统一保存在 PostgreSQL。

## 4. 目标与非目标

### 4.1 MVP 目标

1. 用户可通过 MCP 工具显式提交文本或已挂载目录中的文件，触发异步索引任务。
2. 用户可查询任务状态及错误摘要，不需要等待完整构建结束才继续使用聊天客户端。
3. 查询工具同步读取最新已成功发布的 namespace；正在构建的新 namespace 不影响当前可查询版本。
4. 使用 Docker Compose 启动 MCP 服务和 PostgreSQL（启用 pgvector）；重启后保留任务、GraphRAG 数据和活动 namespace 元数据。
5. 使用可配置的 OpenAI-compatible 模型服务完成 GraphRAG 所需的生成/向量调用；具体能力以 `graphrag-ts` 实际接口验证为准。

### 4.2 非目标

- 自动读取或监听 LM Studio 的完整聊天记录。MCP server 不会天然收到每轮对话内容；对话记忆需由客户端显式调用工具提交。
- 在线索引构建期间保证新提交内容立即可检索。索引具有最终一致性，新内容在任务成功发布前不可见。
- 多用户、云端托管、团队权限、计费、企业级审计或高可用集群。
- 自研 GraphRAG 算法、替换上游 PostgreSQL/Prisma 存储层或提供通用图谱可视化界面。
- 承诺索引/查询耗时、准确率或“优于向量检索”；这些需要基准测试后再确定。

## 5. 用户与使用场景

### 主要用户

- 在本机使用 LM Studio 或其他 MCP 客户端的开发者、研究者和知识工作者。
- 希望对个人文档集合提出跨文档、实体关系或全局性问题的用户。

### 核心场景

1. 用户把文档放入配置的输入目录，通过 `submit_index_job` 提交文件或目录。
2. 用户继续对话；后台 worker 构建新索引，用户可通过 `get_index_job` 查看状态。
3. 任务成功后，新索引版本被发布；用户调用 `query_graph`，工具等待查询完成并返回结果。
4. 用户通过 `remember_text` 显式提交当前对话中希望长期保留的事实。工具仅接受被显式传入的文本，不读取客户端对话上下文。

## 6. 产品原则与关键决策

- **构建异步，查询同步**：提交任务快速返回 job ID；查询返回当前可用索引上的完整结果或明确的错误/空索引状态。
- **已发布版本只读**：后台构建到独立 PostgreSQL namespace；成功后更新活动 namespace 指针。查询只读取活动 namespace。MVP 不在同一个 namespace 上边写边查。
- **不猜测客户端上下文**：只有用户明确通过工具提交的文本/文件才会进入知识库。
- **MVP 单知识库**：单实例、单活动知识库、单构建任务；新快照串行构建，查询可继续读取上一活动 namespace。
- **优先复用上游**：使用 `graphrag-ts` 的 `BuildInputFile`、`startBuild`/`buildRAG`、`GraphRAGRetrievalService`、Prisma schema 和 namespace 隔离；数据库采用 PostgreSQL+pgvector，不另建图数据库或向量数据库。
- **传输层先验证再定案**：首选适合 Compose 常驻服务的 MCP HTTP transport；实现前必须验证目标 LM Studio 版本支持该 transport。若不支持，MVP 改用 stdio 启动方式，并由 Compose 管理 worker 与持久化卷。

## 7. 功能需求

| ID | 需求 | 优先级 | 验收标准 |
|---|---|---|---|
| FR-01 | MCP 服务可启动并向客户端声明工具 | P0 | 客户端可连接并发现 MVP 中定义的工具；启动错误写入 stderr/容器日志，不污染 stdio 协议输出 |
| FR-02 | 提交索引任务 | P0 | `submit_index_job` 接收允许范围内的文件/目录或文本，校验输入后返回唯一 `job_id`；任务进入持久化队列 |
| FR-03 | 显式提交对话事实 | P0 | `remember_text` 接收文本并提交后台任务；不声称自动获取对话历史 |
| FR-04 | 查看索引任务状态 | P0 | `get_index_job(job_id)` 返回 `queued/running/succeeded/failed`、创建/结束时间和简短错误信息 |
| FR-05 | 后台构建索引 | P0 | 服务端从持久化队列串行处理任务，调用上游构建 API；新构建写入独立 namespace |
| FR-06 | 安全发布索引版本 | P0 | 构建失败不切换活动 namespace；成功后更新 PostgreSQL 中的活动 namespace 元数据，查询随后使用新 namespace |
| FR-07 | 同步查询 | P0 | `query_graph` 接受问题和查询模式（仅限上游支持的模式），对最新成功发布版本执行查询并返回结果 |
| FR-08 | 限制返回内容 | P0 | 工具返回答案、来源/证据（若上游提供）及版本标识；配置最大输出长度，超限时截断并注明 |
| FR-09 | 空索引与索引构建中反馈 | P0 | 没有可用索引时返回明确可操作提示；新版本构建中时仍可查旧版本，并返回当前活动版本/可选状态信息 |
| FR-10 | Compose 部署和持久化 | P0 | `docker compose up -d` 启动 MCP 服务和 PostgreSQL+pgvector；容器重建后 GraphRAG 数据及任务/活动版本元数据仍在数据库卷中 |
| FR-11 | 健康检查与日志 | P1 | 服务提供健康状态；日志包含 job ID、阶段、耗时和错误，不记录密钥或完整敏感文档内容 |
| FR-12 | 删除/重建知识库 | P1 | 有明确的管理操作可清理数据并重建索引；删除行为需确认且在文档中说明不可恢复性 |

## 8. MCP 工具契约（MVP）

实际 JSON Schema 应在实现阶段与 MCP SDK、上游 API 一并定稿。

### `submit_index_job`

- 输入：挂载输入目录内的相对路径，或用户显式传入的文本；可选来源标签。
- 输出：`job_id`、接受状态、排队位置（若可计算）。
- 约束：拒绝越出允许根目录的路径；设置输入大小上限；相同内容是否去重由技术验证后决定。

### `remember_text`

- 输入：`text`、可选 `source`。
- 输出：后台任务 `job_id`。
- 用途：让客户端/用户显式把当前对话中的选定内容提交给知识库。

### `get_index_job`

- 输入：`job_id`。
- 输出：状态、阶段（若可获得）、时间戳、错误摘要和已发布索引版本（成功时）。

### `query_graph`

- 输入：`query`、可选的上游支持的查询模式、可选的结果上限。
- 输出：答案/检索上下文、来源（若可获得）、活动索引版本、是否发生截断。
- 行为：同步等待查询完成；不隐式触发索引构建。

## 9. 用户流程与任务状态

### 索引流程

1. 用户提交文件或文本。
2. 服务验证路径、类型和大小，并持久化任务。
3. 服务返回 `job_id`，worker 后台执行解析与 GraphRAG 索引。
4. worker 将结果写入独立版本目录。
5. 成功后原子更新活动版本元数据；失败时保留旧活动版本并记录错误。

状态流转：`queued → running → succeeded | failed`。MVP 任务记录和构建输入必须持久化在 PostgreSQL，以便 MCP 服务重启后恢复 queued 任务；崩溃时遗留的 running 任务应在启动恢复阶段标记失败或重新排队，具体策略须防止同一 namespace 并发构建。现有上游 `GenerationJob` 可用于构建状态记录，但因不保存完整输入且 registry 的 `get` 依赖进程内镜像，不能单独充当持久化任务队列。

### 查询流程

1. MCP server 从 PostgreSQL 读取活动 namespace 元数据。
2. 若无已发布版本，返回 `INDEX_NOT_READY` 类明确状态。
3. 若存在 namespace，调用上游 `GraphRAGRetrievalService.retrieve`，通过 namespace 上下文执行查询。
4. 对结果施加最大输出限制后返回，并附 namespace/version 标识和可用来源。

## 10. 部署与运行要求

### Compose 服务

- `mcp-server`：MCP 协议入口，并运行一个受持久化任务队列驱动的单构建 worker。复用上游进程内异步构建 API；MVP 不额外部署 `indexer` 容器，避免在没有队列/租约机制时跨进程争抢任务。
- `db`：`pgvector/pgvector:pg16`（或经验证兼容的 PostgreSQL+pgvector 镜像），提供上游 Prisma schema 所需的 PostgreSQL、`vector(768)`、`tsvector` 和 HNSW 向量索引能力。
- 数据库通过健康检查就绪后，MCP 服务执行数据库 schema 初始化/迁移，再开放工具。
- MVP 不部署 Redis、Neo4j 或独立向量数据库；GraphRAG 表和 MCP 自有任务/活动版本元数据共用 PostgreSQL 实例，使用独立表/Prisma model 区分。

### 持久化与配置

- PostgreSQL 命名卷持久化 GraphRAG 表（parents、chunks、entities、edges、claims、community summaries）及任务、来源清单、namespace/version 元数据。
- Compose 首次初始化需启用 `vector` 扩展，并确保上游 Prisma models、upstream SQL migrations 和 MCP 自有 schema 全部落库。启动前须验证上游 baseline migrations 是否覆盖当前 schema（尤其是 `GenerationJob`）；MCP 自有 schema 通过独立迁移管理，不依赖手工进入容器操作。
- 文档输入目录以只读 bind mount 暴露给容器；任务表持久化相对路径/文本 payload 和构建参数。若为目录重建，worker 应在入队时固定本次输入清单，避免任务执行中目录变化导致输入不确定。
- 环境变量/`.env` 配置 PostgreSQL 连接、模型服务地址、模型名、必要凭据、输入目录、监听地址、namespace、输出限制和日志级别。
- `.env` 不提交版本控制；敏感值不得写入镜像或日志。
- PostgreSQL 默认不对宿主机或公网暴露端口；MCP 服务仅绑定本机可访问端口，不默认暴露到局域网或公网。

### 模型调用

- 支持 OpenAI-compatible endpoint 配置；兼容性、生成模型与 embedding 模型是否需要分别配置，需依据 `graphrag-ts` 代码验证。
- LM Studio 在宿主机运行时，Compose 容器通过宿主机可访问地址连接；macOS Docker Desktop 可优先验证 `host.docker.internal`。
- 不要求 MVP 自带模型，也不把 LM Studio 与 MCP server 合并为同一个容器。

### 客户端连接

- HTTP transport 若被目标 LM Studio 版本支持，使用仅本机可访问的 Compose 端口。
- 若 LM Studio 只接受 stdio，提供以 Docker Compose 启动 MCP 进程的配置示例；必须保证 stdin/stdout 透传，诊断日志写 stderr。
- 具体 transport 和配置片段属于 P0 技术验证，不在文档阶段假定已兼容。

## 11. 非功能需求

- **数据隔离**：容器只能读取显式挂载的输入目录和数据卷。
- **一致性**：每次全量快照写入新 namespace；成功后单次更新 PostgreSQL 活动 namespace 元数据。构建失败时仍可查询上一个 namespace。
- **可靠性**：Compose 重启不丢失已完成索引、任务 payload、来源清单和活动 namespace；服务重启会对遗留任务执行明确恢复策略。
- **可观测性**：每个任务可由 job ID 串联日志；日志不输出 API key 和文档原文。
- **资源边界**：支持通过 Compose 配置 CPU/内存限制或 worker 并发配置；默认单 worker，避免与本地推理资源无约束竞争。
- **输出可控**：查询结果有硬性字符/token 预算配置；具体 token 计数算法取决于可用 tokenizer。
- **安全边界**：仅允许访问配置的文档根目录；MVP 不支持任意路径、任意 URL 抓取或远程文件系统。

## 12. MVP 成功指标

以下指标用于验证产品路径，不预设未测量的性能承诺：

- 首次部署：按 README 从干净环境启动 Compose 并完成 MCP 连接，无需手工进入容器修改文件。
- 持久化：重建容器后，PostgreSQL 中之前发布的 namespace 仍可查询，任务状态和输入 payload 仍可读取。
- 隔离：索引任务运行/失败期间，旧活动索引可持续查询；失败任务不会发布半成品。
- 闭环：可通过客户端完成“提交 → 查状态 → 检索”的完整流程。
- 可诊断：连接失败、模型调用失败、索引失败和空索引均有可辨别的提示。

性能目标（如索引可见延迟、查询 P95、最大文档规模）在完成基准测试后制定，不作为未经测量的首版承诺。

## 13. MVP 验收测试

1. 启动 Compose 后，目标 LM Studio 版本能连接并发现所有 P0 工具。
2. 提交有效文档返回 job ID；任务状态按预期变化，完成后能查询到相关信息。
3. 提交非法路径、超限输入或不支持文件时被拒绝，并返回可理解的错误。
4. 新 namespace 构建期间重复查询，结果只来自上一活动 namespace；新版本发布后查询切换到新 namespace。
5. 模型服务不可用或索引构建失败时，任务变为 `failed`，旧版本仍可查询。
6. 重启 MCP 服务和 PostgreSQL 容器后，已发布 namespace、任务状态及输入 payload 仍存在；处理中任务按既定恢复策略处理。
7. 查询超出输出限制时返回截断标记和版本信息，不返回无限量上下文。
8. 从容器日志、镜像配置和示例配置中均无法看到明文密钥。

## 14. 主要风险与前置验证

| 风险/未知项 | 影响 | MVP 处理方式 / 验证门槛 |
|---|---|---|
| GraphRAG 上游的数据库依赖 | Compose 镜像需包含匹配的 PostgreSQL 与 pgvector | 已确认：Prisma schema 使用 PostgreSQL，vector 字段固定为 `vector(768)`，baseline migration 创建 `vector` 扩展并建立 HNSW 索引；P0 验证目标 pgvector 镜像与迁移兼容 |
| 上游数据库初始化完整性 | `schema.prisma` 与 SQL migrations 必须保持一致，否则运行时会缺表/列 | P0：Compose 启动验证 migration 状态；确认所有 Prisma model（包括 `GenerationJob`）和 vector extension 均已创建 |
| 上游异步构建是否提供跨重启队列 | 现有 `startBuild` 在进程内启动异步执行；DB registry 只持久化状态，job 输入不在 `GenerationJob` | 已确认需要 MCP 层补 durable job payload/queue；服务重启时恢复 queued 并处理遗留 running 任务 |
| namespace 快照发布与保留 | 决定查询是否能在构建期间读旧数据 | P0：用独立 namespace 构建完整输入快照，验证检索能按 namespace 隔离；成功后切换活动指针，旧版本先保留 |
| LM Studio 支持的 MCP transport 和 Compose 连接方式 | 决定部署体验 | P0：选定目标版本做端到端连接测试；失败则采用 stdio 的 Compose 启动方式 |
| LLM 与 embedding endpoint 配置方式 | 影响本地模型可用性和索引流程 | P0：验证模型调用接口、embedding 要求、模型名/维度约束和错误行为 |
| GraphRAG 的增量索引能力与代价 | 重复构建可能慢或昂贵 | MVP 先按任务串行处理；确认上游能力后再决定增量或全量重建策略 |
| 同一 namespace 的并发读写 | 上游增量构建会修改 PostgreSQL 图谱表，不能假设读写快照隔离 | MVP 构建写新 namespace，检索读活动 namespace；构建串行化，避免同一 namespace 并发写 |
| 长时间任务及客户端超时 | 工具调用等待可能超时 | 索引只异步提交；查询同步并设置超时/取消边界，索引耗时不占用 MCP 请求 |

## 15. 建议交付阶段

### 阶段 0：技术验证

- 检查上游公开 API、许可证、Prisma schema/migrations、任务状态 API 和检索 namespace 参数。
- 运行最小索引/查询样例，验证 PostgreSQL+pgvector 初始化、模型 endpoint 配置和 namespace 隔离。
- 在目标 LM Studio 版本验证 MCP transport 与 Docker Compose 连接。
- 验证完整快照写入新 namespace、成功切换活动 namespace，以及数据库迁移/重启恢复流程。

阶段 0 任一关键项无法成立时，应调整架构或缩小产品范围后再进入开发。

### 阶段 1：MVP

- 实现 MCP 工具、PostgreSQL 持久化任务队列、进程内单 worker、namespace 版本发布与同步查询。
- 提供含 PostgreSQL+pgvector 的 Compose 配置、`.env.example`、LM Studio 配置示例及端到端验收流程。

### 阶段 2：验证后再考虑

- 自动监控目录与增量索引、多个知识库、任务取消/重试、索引管理工具、图谱可视化、更多客户端/transport、企业连接器。

## 16. 待决问题

1. MVP 文档输入应限定为上游当前支持的 Markdown 文件；目录快照的最大文件数/大小需通过测试确定。
2. 查询模式采用上游当前稳定支持的哪几种模式？需经 API 审计后收敛。
3. LM Studio 是否是唯一验收客户端，还是同时要求通用 MCP Inspector/其他 MCP 客户端？
4. 旧 namespace 保留多少个版本、何时允许清理？清理旧 namespace 应作为独立维护操作，避免查询过程中删除正在使用的数据。
5. 目标模型服务是仅限 LM Studio 本地 endpoint，还是也支持任意 OpenAI-compatible 服务？本 PRD 建议配置化支持两者。
