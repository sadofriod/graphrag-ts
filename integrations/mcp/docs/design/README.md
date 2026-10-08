# MVP 设计文档

本目录只描述 [产品需求文档](../prd.md) 中的 MVP 范围，不包含阶段 2 功能。PRD 是需求与验收标准的唯一来源；本文档组描述拟采用的实现设计。若设计与 PRD 冲突，以 PRD 为准。

## 文档

- [系统架构](architecture.md)：组件边界、索引/查询流程、版本发布与失败隔离。
- [持久化与任务队列](data-and-jobs.md)：MCP 自有数据模型、任务状态、worker 串行化和重启恢复。
- [MCP 工具契约](mcp-api.md)：MVP 工具输入输出、校验规则和错误语义。
- [部署与验证](deployment-and-validation.md)：Compose、配置、安全边界、运行检查和验收映射。

## MVP 范围

包含单知识库、单活动版本、PostgreSQL + pgvector、持久化索引任务、进程内单 worker、独立 namespace 全量快照、成功后发布、同步检索，以及显式提交文本/挂载文件的 MCP 工具。

不包含自动读取聊天记录、目录监听、增量索引、多个知识库、任务取消/重试、索引管理/删除工具、图谱 UI、云端/多用户服务或额外 worker 容器。

## 知识范围与访问边界

MVP 每个 MCP server/数据库部署只有一个逻辑知识库。用户显式提交到该知识库的所有来源都会进入同一活动索引；连接到该 server 的聊天均可查询这些已发布来源。MCP 不按聊天会话隔离，也不提供用户/知识库 ACL。需要不同聊天使用不同知识范围时，应为每个范围配置独立 MCP server 实例、输入目录和数据库；不能依赖聊天切换 server 进程内的全局活动范围。

`namespace` 是 GraphRAG 的版本隔离键，不是访问凭据。MCP 工具不接受任意 namespace 来授权查询；活动版本由 server 从自己的元数据中解析。

## 需要技术验证或决策

- 目标 LM Studio 版本支持的 MCP transport；优先验证 HTTP，失败则按 PRD 验证 stdio 方案。
- `graphrag-ts` 当前版本的构建、检索 API，namespace 注入方式、支持的查询模式和来源字段。
- OpenAI-compatible 服务的生成/embedding 配置方式及 embedding 维度兼容性。
- 上游 migration 与 Prisma schema 的完整性，尤其是 `GenerationJob` 和 pgvector 扩展。
- 文件格式、单文件/任务总大小限制、查询输出限制，以及重复来源的处理策略。

在这些验证完成前，相关内容在设计文档中作为约束或待决项呈现，不视为已验证的上游能力。
