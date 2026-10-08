# 系统架构（MVP）

## 1. 目标与约束

实现 PRD 定义的闭环：显式提交知识、异步构建、查询任务状态、同步检索已发布索引。新索引构建期间，查询继续读取上一已发布版本；失败不得改变活动版本。

MVP 运行一个 MCP server 进程和一个进程内 worker，不单独部署 indexer。PostgreSQL 同时承载 `graphrag-ts` 数据和 MCP 自有任务/版本元数据；文件只从配置的只读输入目录读取。worker 串行构建独立 namespace，检索只读活动 namespace。

## 2. 逻辑组件

| 组件 | 职责 |
|---|---|
| MCP transport/server | 建立客户端连接、声明并执行工具；诊断日志不得写入 stdio 协议流。 |
| Tool handlers | 校验工具输入，调用任务服务或检索服务，将内部结果映射为 MCP 输出。 |
| Input service | 限定文件访问在允许根目录内，解析提交内容并固定本次任务输入。 |
| Job store | 在 PostgreSQL 保存任务、输入 payload、来源和状态；提交工具仅在事务提交后返回 job ID。 |
| Worker | 单实例串行领取 queued 任务，调用 GraphRAG 构建 API，记录阶段/错误并协调发布。 |
| Version store | 记录 namespace/version 与来源清单；通过单条事务更新活动版本指针。 |
| GraphRAG adapter | 封装上游 `BuildInputFile`、构建和 `GraphRAGRetrievalService` 调用，隔离上游 API 差异。 |
| PostgreSQL + pgvector | 持久化 GraphRAG 图/向量/全文数据以及 MCP 自有元数据。 |
| OpenAI-compatible endpoint | 由独立于 Compose 的 LLM 服务提供生成与 embedding API；URL、模型名和凭据通过环境变量注入。 |

## 3. 索引提交与构建

1. `submit_index_job` 或 `remember_text` 验证参数和大小限制。文件路径必须是输入根目录内的相对路径；提交目录时递归得到固定文件清单，不跟随越界符号链接。
2. 服务读取并固定任务输入，将 payload、来源标签和 queued 状态写入 PostgreSQL。对目录提交，入队后目录变化不能改变该任务的输入内容。
3. worker 按创建顺序串行领取任务并将状态转为 running。MVP 不并行构建；多 server 副本不是支持的部署拓扑。
4. worker 以唯一 namespace 创建新的完整快照。快照输入由当前已发布版本的来源清单与本任务新增来源组成，避免后续任务覆盖已有知识。
5. 构建成功后，在一个 PostgreSQL 事务中登记新版本、关联来源清单、更新活动版本指针并将任务置为 succeeded。
6. 构建失败时记录简短错误摘要并置为 failed，不更新活动版本指针。已发布版本继续可查；未发布 namespace 视为孤儿数据，MVP 暂不自动清理。

构建 namespace 的生成、`graphrag-ts` 的 namespace 传递位置及“完整快照”所需的上游调用序列必须通过技术验证。不得以活动 namespace 直接增量写入代替隔离构建。

## 4. 查询

1. `query_graph` 校验问题、模式和结果上限。
2. 从 PostgreSQL 读取活动版本指针；无指针时返回明确的 `INDEX_NOT_READY` 状态。
3. 将该版本的 namespace 显式传入上游检索服务，同步等待结果；运行中的任务不影响所选 namespace。
4. 将答案、上游可用的来源/证据、版本标识和截断标记映射为 MCP 结果，并执行服务端输出硬限制。

一次查询应绑定开始时读取到的版本标识。查询过程中即使活动指针切换，也继续使用已选中的 namespace；旧 namespace 在 MVP 中保留，避免切换时删除正在查询的数据。

## 5. 一致性与恢复

- 任务入队与输入 payload 原子持久化；未提交事务的任务不得被 worker 看到。
- worker 对队列串行处理。即使部署配置意外启动多个实例，也必须使用数据库互斥机制防止同时构建；MVP 的正式拓扑仍限定单实例。
- 活动版本切换、版本记录和任务成功状态处于同一短事务；耗时构建不放在数据库事务中。
- 启动恢复时，queued 任务保留并继续处理。遗留 running 任务标记 failed，错误码为 `WORKER_RESTARTED`；不自动重试，避免重复执行不确定的上游构建。
- 构建进程崩溃可能留下未发布 namespace，但活动版本保持不变。清理孤儿 namespace 属于后续维护能力，不在 MVP 自动删除。

## 6. 边界与非目标

MCP server 不读取客户端聊天历史；`remember_text` 仅索引用户显式提交的文本。MVP 不监听目录、不抓取 URL、不支持任意宿主机路径，不提供任务取消/重试或多知识库。查询只读已发布数据，不隐式触发构建。

### 知识范围与访问控制

- 每个 MCP server/数据库部署对应一个逻辑知识库；所有成功发布的来源都属于该库，所有连接该 server 的聊天都能查询当前活动版本。
- 知识范围由用户显式提交的文本/文件以及只读输入根目录限定。`source` 标签仅用于来源标识，不是权限边界。
- MCP 工具不接受客户端指定的原始 GraphRAG namespace。server 从活动版本元数据解析 namespace，并在调用 `GraphRAGRetrievalService.retrieve()` 时使用 `withNamespace(namespace, ...)` 绑定上游异步上下文。
- namespace 只隔离 GraphRAG 数据，不提供用户认证或授权。MVP 是单用户本机信任模型，没有按聊天、连接或用户区分的 ACL；localhost 监听也不等于用户级授权。
- 若聊天之间必须使用不同知识范围，MVP 应部署互相隔离的 MCP server 实例、输入根目录和数据库。不得用进程级 `active_scope` 在聊天之间切换，因为 MCP server 不保证能识别 LM Studio 的具体聊天会话。
- 多知识库、身份认证、用户/知识库授权及可信聊天会话绑定均不属于 MVP。未来支持多个知识库时，应由 server 根据可信身份校验逻辑知识库权限，再解析对应活动 namespace，不能把工具参数当作授权凭据。

## 7. 关键验证门槛

在确定实现接口前，先验证上游公开构建/检索 API、namespace 隔离、Prisma/migration 一致性、模型 endpoint 及目标客户端 transport。若独立 namespace 无法实现完整快照，或检索不能显式限定 namespace，应先调整架构，不得退化为边写边查。
