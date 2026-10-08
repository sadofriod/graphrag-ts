# MCP 工具契约（MVP）

本契约描述产品侧输入输出。具体 MCP SDK schema 与 `graphrag-ts` 参数名需在技术验证后落地；不得暴露上游未支持的查询模式。

## 1. `submit_index_job`

提交一个或多个允许范围内的文件/目录，异步构建新的完整知识库快照。

### 输入

- `path`：输入根目录下的相对文件或目录路径。
- `source`：可选来源标签。

文件与目录输入的确切 schema 需根据上游 `BuildInputFile` 和文件解析能力定稿。路径必须拒绝绝对路径、`..` 越界、根目录外符号链接及不支持的文件类型。目录提交需固定排序后的文件清单，并在入队时保存内容快照。

### 成功输出

- `job_id`：唯一任务 ID。
- `status`：初始为 `queued`。
- `queue_position`：可选；仅在可准确计算时返回。

### 失败

路径越界、目录为空（若规则禁止）、格式不支持、文件读取失败或大小超限时拒绝任务，不返回 job ID。错误说明指出可操作原因，不回显文件内容或宿主机敏感绝对路径。

## 2. `remember_text`

显式提交用户选择的文本，作为后台任务加入知识库。该工具不读取、推断或声称可访问客户端对话历史。

### 输入

- `text`：必填非空文本。
- `source`：可选来源标签。

### 成功输出

- `job_id`。
- `status`：`queued`。

文本按配置上限校验；校验失败时不创建任务。

## 3. `get_index_job`

### 输入

- `job_id`：必填任务 ID。

### 成功输出

- `job_id`、`status`：`queued | running | succeeded | failed`。
- `phase`：可选阶段。
- `created_at`、`started_at`、`finished_at`：可空的 UTC 时间。
- `error`：失败时提供稳定 `code` 和简短 `summary`。
- `published_version`：成功发布时提供版本 ID/namespace 标识。

不存在的 job ID 返回明确 `JOB_NOT_FOUND` 错误。输出不包含任务输入原文。

## 4. `query_graph`

对当前活动版本执行同步检索；不触发索引构建。

### 输入

- `query`：必填非空问题。
- `mode`：可选，仅接受完成上游 API 验证后确定的枚举值。
- `max_results`：可选，必须限制在服务端配置的上下界内。

### 成功输出

- `answer`：上游答案或检索结果文本。
- `sources`：上游提供时返回来源/证据；上游不提供则为空或省略。
- `index_version`：本次查询绑定的活动版本 ID/namespace。
- `truncated`：是否达到配置的最大输出长度。

输出上限由服务端强制执行，客户端传入值不能绕过上限。截断时保留版本标识并明确标记，不允许无限制返回上下文。

### 状态与错误

- 尚无活动版本：返回 `INDEX_NOT_READY`，建议先提交索引任务并查询状态。
- 新版本正在构建但存在活动版本：正常查询旧活动版本，并返回其版本标识。
- 查询超时：返回 `QUERY_TIMEOUT`；不得自动启动构建。
- 上游/模型服务不可用：返回不含凭据或敏感请求体的可诊断错误。
- 上游模式不支持或参数非法：返回输入校验错误。

## 5. 工具通用约定

- 工具名固定为 `submit_index_job`、`remember_text`、`get_index_job`、`query_graph`。
- MVP 工具不提供 `scope_id`、`knowledge_base_id` 或原始 `namespace` 参数：一个 server 部署只有一个逻辑知识库，提交和检索都作用于该库；活动 namespace 由 server 内部解析。
- 所有连接到同一 server 的聊天都能查询该库中已发布的全部来源。用户通过显式提交来决定哪些知识进入该库；工具调用不会按聊天会话隔离。`source` 只是标签，不授予或限制访问。
- 不得把客户端传入的 namespace、source 标签或模型自行选择的知识库名称视为授权。若需要聊天间隔离，应使用独立 MCP server 部署；MVP 不提供运行时切换的全局活动知识范围。
- 所有错误都应有稳定机器可读 code 和简短人类可读说明；按所用 MCP SDK 约定标记工具调用失败。
- 任务提交接口快速返回，不等待 GraphRAG 构建结束；查询接口同步等待，且必须有服务端超时边界。
- 不在工具输出或日志中返回 API key、完整输入文档或不必要的本机绝对路径。

## 6. 待 API 验证项

实现 schema 前需确认：SDK 使用的 tool schema/错误表示方式、上游稳定支持的 retrieval mode、构建输入内容格式、检索结果来源结构、embedding 与生成配置，以及目标 LM Studio 版本可用的 transport。
