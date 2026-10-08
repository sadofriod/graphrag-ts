# 持久化与任务队列（MVP）

## 1. 存储原则

所有 MCP 自有的队列、来源清单和活动版本元数据存入与 GraphRAG 共用的 PostgreSQL 实例，但使用独立表/Prisma model。GraphRAG 表结构和 migration 由上游维护；MCP 自有 schema 使用独立迁移，不手工修改上游表。

任务输入必须与 queued 记录一起持久化。对文件/目录提交，在入队时读取并保存内容快照，而不只保存宿主机路径；这样 worker 重启或输入目录变化都不会改变已接受任务的语义。输入大小限制应在读取和写库之前执行。

## 2. 建议数据模型

字段类型为逻辑设计，最终类型、索引和 Prisma 表名按仓库技术栈确定。

### `IndexJob`

- `id`：唯一 job ID。
- `status`：`queued | running | succeeded | failed`。
- `phase`：可选阶段标识，例如 `preparing | building | publishing`。
- `createdAt`、`startedAt`、`finishedAt`：UTC 时间。
- `errorCode`、`errorSummary`：失败时保存；不保存文档全文或密钥。
- `publishedVersionId`：成功时关联发布版本。

### `JobInput`

- `jobId`：所属任务。
- `ordinal`：任务内稳定顺序。
- `sourceLabel`：可选展示标签/相对路径。
- `content`：入队时固定的文本内容。
- `contentHash`：用于完整性校验和诊断；是否据此去重仍待决。
- `mediaType`：MVP 支持的输入类型标识。

输入 payload 可采用独立行存储，避免任务状态行承载大字段。具体单文件、单任务字节上限需要通过实现和端到端测试确定。

### `KnowledgeSource`

- `id`：不可变来源记录 ID。
- `createdByJobId`：产生该来源的任务。
- `sourceLabel`、`content`、`contentHash`：来源标签、文本和哈希。
- `createdAt`：创建时间。

采用不可变来源记录，确保已发布版本引用的数据不会被后续提交原地覆盖。相同路径或相同内容再次提交时是新增来源还是替换/去重，目前 PRD 尚未决策；首版实现前必须确定规则并编写验收用例。

### `IndexVersion`

- `id`：稳定版本 ID。
- `namespace`：唯一 GraphRAG namespace。
- `status`：`building | published | failed`（是否持久化构建态可按实现简化）。
- `createdByJobId`、`createdAt`、`publishedAt`。

### `IndexVersionSource`

- `versionId`、`sourceId`：某版本的固定来源清单。全量构建的新版本应引用上一已发布版本的来源，加上本次任务来源。

### `ActiveIndex`

单例记录，保存当前活动 `versionId` 和更新时间。可用固定主键约束保证单知识库仅有一个活动指针。

## 3. 事务边界

### 入队

单个数据库事务写入 `IndexJob(status=queued)` 与全部 `JobInput`。事务成功提交后才向 MCP 客户端返回 `job_id`。如果文件读取或大小校验失败，不创建可见任务。

### 领取任务

worker 在短事务内选取最早 queued 任务、将其改为 running 并记录 `startedAt`，随后提交事务再执行耗时构建。正式部署为单 MCP 实例和单 worker；可用 PostgreSQL advisory lock 或等价互斥手段防止误启动多个 worker。

### 发布

GraphRAG 构建在事务外完成。成功后用短事务写入版本与来源关联、更新 `ActiveIndex`、将任务标记 succeeded 并记录 `finishedAt`。任何发布事务失败都不得暴露新活动指针；需重试该数据库事务或将任务标记失败，不能报告发布成功。

### 失败

构建异常时保存稳定错误码和经过长度限制的摘要，将任务置为 failed。错误内容不得包含 API key、完整文档内容或不必要的请求体。活动指针保持原值。

## 4. 状态流转与恢复

```text
queued -> running -> succeeded
                   -> failed
```

服务启动时执行恢复：queued 任务保持 queued；上次运行遗留的 running 任务置为 failed，使用 `WORKER_RESTARTED` 摘要，不自动重试。随后启动单 worker。若进程在构建后、发布前退出，活动版本仍是旧版本；可能残留未发布 GraphRAG 数据，不在 MVP 自动清理。

恢复逻辑必须具备幂等性：多次启动恢复不会重复创建终态结果，也不会把 succeeded/failed 重新排队。状态更新应以当前状态为条件，避免 worker 与恢复过程竞态。

## 5. Namespace 与版本规则

- 每个构建任务分配不可复用的 namespace，构建期间不查询该 namespace。
- 新版本来源清单在开始构建时固定；任务构建期间后续入队内容不会混入当前快照。
- 新版本发布前，查询只使用 `ActiveIndex` 指向的版本。
- 发布通过数据库事务更新指针；版本数据与元数据位于同一 PostgreSQL 实例。
- 旧版本暂时保留。保留数量、清理入口和并发查询安全清理尚未纳入 MVP。

## 6. 迁移与上游兼容

启动前验证 `pgvector` 扩展、上游 Prisma schema 与 SQL migrations 一致，并确认所有 GraphRAG model（尤其 `GenerationJob`）均已创建。容器启动流程先等待数据库健康，再执行上游迁移和 MCP 独立迁移，最后开放 MCP 工具。

MCP 任务表不依赖上游 `GenerationJob` 的进程内 registry 来恢复队列；上游 job 可用于诊断或构建内部状态，但 durable payload 和 MCP job 状态以 MCP 自有表为准。
