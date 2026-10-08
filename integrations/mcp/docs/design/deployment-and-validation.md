# 部署与验证（MVP）

## 1. Compose 拓扑

```text
MCP client
    |
    | verified MCP transport (localhost only)
    v
mcp-server
  - MCP tools
  - durable-job worker (one process / one worker)
  - GraphRAG adapter
    |                    \
    v                     v
PostgreSQL + pgvector    OpenAI-compatible endpoint
  - GraphRAG tables      - generation
  - MCP job/source data  - embeddings
  - active version
```

Compose 运行 `mcp-server` 和 `db`；LLM endpoint 由外部服务提供。MCP 的生成、评审和 embedding URL、模型名及 API key 通过环境变量注入。部署不需要宿主机安装 Node.js 或 Bun，但必须提供容器可访问的 OpenAI-compatible endpoint；embedding 模型输出需为 768 维向量。MVP 不增加 Redis、Neo4j、独立向量数据库或 indexer 容器。

数据库通过健康检查后，server 运行上游和 MCP 自有迁移，迁移成功后才开放工具。PostgreSQL 默认不发布宿主机端口；MCP 端口仅绑定 localhost。输入目录只读挂载到容器，容器只访问该挂载和数据库卷。

MVP 按单用户本机信任模型运行：同一 server 的所有客户端/聊天共享一个知识库，localhost 绑定不提供用户或聊天级授权。需要隔离不同知识范围时，为每个范围使用独立 Compose 项目（独立 MCP server、输入目录和 PostgreSQL 卷）；不要依靠聊天切换 server 内的活动 namespace。

## 2. Transport

PRD 倾向常驻 Compose 服务上的 HTTP transport，但要求先验证目标 LM Studio 版本。确认支持后使用仅本机可访问的端口，并提供客户端连接示例。若不支持，则验证 stdio 启动模式；stdio 下协议数据仅走 stdout，诊断日志走 stderr，并确认 Docker Compose 启动配置能正确透传 stdin/stdout。

在验证完成前，不把任一 transport 写成已兼容事实。通用 MCP Inspector 可用于协议级自测，但不能代替目标 LM Studio 版本的验收。

## 3. 配置项

具体环境变量命名由实现统一定义，至少覆盖：

| 配置 | 用途 |
|---|---|
| PostgreSQL URL | MCP 与 GraphRAG 共用数据库连接。 |
| 输入根目录 | 容器内只读挂载目录；所有文件请求必须限制在此根内。 |
| MCP transport / bind address / port | 传输类型及本机监听配置。 |
| 生成 URL、模型名、凭据 | 通过环境变量配置 GraphRAG 生成与评审调用。 |
| embedding URL、模型名、凭据 | 通过环境变量配置 embedding 调用；输出必须为 768 维。 |
| 最大文件数、单文件大小、任务总大小 | 输入资源边界。 |
| 查询超时、最大输出长度 | 查询取消边界与 MCP 输出硬上限。 |
| 日志级别 | 运行诊断。 |

提供 `.env.example`，只含占位值。真实 `.env` 不提交版本控制；凭据不写入镜像层、日志或工具结果。Compose 中通过环境变量/secret 注入，具体方式与开发部署保持一致。

LM Studio 在 macOS 宿主机运行时，容器可先验证 `host.docker.internal` 到模型服务的连通性；不能假设模型监听地址或 API 兼容性已成立。

## 4. 日志与健康

每条任务日志关联 `job_id`，记录状态转换、阶段、耗时和稳定错误码。禁止记录 API key、完整文档、完整模型请求/响应和不必要的绝对路径。服务健康检查应区分进程存活与数据库/迁移就绪；数据库不可用时不得报告 ready。

## 5. 验证清单

| 验收点 | 验证方式 |
|---|---|
| Compose 干净启动 | 配置可访问的模型 endpoint 后，使用空数据库卷执行 `docker compose up`，确认数据库迁移完成且无需进入容器手工修复。 |
| pgvector 与上游 schema | 检查扩展、上游模型表、`GenerationJob`、Prisma schema 和 migrations 一致。 |
| MCP 连接和工具发现 | 使用目标 LM Studio 版本连接并发现四个 MVP 工具；另以 MCP Inspector 做协议级辅助检查。 |
| 输入校验 | 覆盖合法文件/目录/文本、路径越界、符号链接越界、不支持格式和大小超限。 |
| 后台任务闭环 | 提交后立即取得 job ID；状态按 queued/running/终态变化；成功后查询到提交信息。 |
| 版本隔离 | 构建期间重复查询只命中旧活动版本；成功发布后切换；构建失败不切换。 |
| 持久化和恢复 | 重启 server/db 容器后验证已发布版本、任务状态及输入 payload；遗留 running 任务按策略失败，queued 可继续处理。 |
| 查询边界 | 无索引时返回 `INDEX_NOT_READY`；输出超限时标记截断；查询超时有明确错误。 |
| 敏感信息 | 检查日志、镜像配置、示例配置和工具响应中无明文凭据或完整输入内容。 |

## 6. 验收前置条件

需使用真实目标客户端、PostgreSQL+pgvector 镜像和配置的模型 endpoint 完成端到端验证。仅通过单元测试或 MCP Inspector，不能证明 transport、模型兼容性、迁移完整性或 namespace 隔离成立。
