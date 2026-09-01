# graphrag-ts 中文说明

> 本仓库作为独立项目维护，不再从上游代码库同步或生成，当前代码与文档均在本仓库中直接开发。

## 1. 项目定位

`graphrag-ts` 是一个以 TypeScript 为核心的 GraphRAG 参考实现，目标是把一批 Markdown 文档转成可检索的知识图谱，并结合向量召回、关键字召回和图谱扩展实现证据式问答。

它的核心能力包括：

- Markdown 文档分块
- LLM 生成切片与摘要
- 实体、关系、声明图谱构建
- Leiden 社区检测与社区总结
- 向量召回 + 关键字召回 + 图谱召回
- 基于证据的问答生成

## 2. 技术栈

- TypeScript
- Bun
- pnpm
- Prisma
- PostgreSQL + pgvector
- LangChain / OpenAI 兼容接口

## 3. 安装方式

在本仓库中，推荐使用 pnpm 安装：

```bash
pnpm install
pnpm run db:generate
```

如果你需要同步数据库结构：

```bash
cp .env.example .env
pnpm run db:push
```

## 4. Node module 注入方式

当这个包作为 Node module 安装到其他项目时，推荐通过统一入口来注入配置，而不是依赖仓库内的 `model.config.json` 文件或隐式加载逻辑。

示例：

```ts
import { injectModelConfigs } from '@ashes_born/graph-rag-ts/model-loader';
import { injectPrismaClient } from '@ashes_born/graph-rag-ts/prisma-client';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
injectPrismaClient(prisma);

await injectModelConfigs([
  {
    type: 'slice',
    baseURL: process.env.RAG_SLICE_BASE_URL!,
    model: process.env.RAG_SLICE_MODEL!,
    apiKey: process.env.RAG_SLICE_API_KEY!,
  },
  {
    type: 'judge',
    baseURL: process.env.RAG_JUDGE_BASE_URL!,
    model: process.env.RAG_JUDGE_MODEL!,
    apiKey: process.env.RAG_JUDGE_API_KEY!,
  },
  {
    type: 'embedding',
    baseURL: process.env.RAG_EMBED_BASE_URL!,
    model: process.env.RAG_EMBED_MODEL!,
    apiKey: process.env.RAG_EMBED_API_KEY!,
  },
]);
```

其中：

- `injectPrismaClient` 用于注入 Prisma 客户端
- `injectModelConfigs` 用于注入模型配置并初始化单例
- 直连执行 Bun 入口仍然保持兼容，可直接使用 `.env` 与 `bun run`

## 5. 必须提供的运行时参数

这类库在发布后安装到其他项目中运行时，不应依赖本地的 `model.config.json` 文件。使用方必须通过环境变量或配置中心提供以下参数：

### 4.1 数据库配置

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/graphrag?schema=public"
```

这是 Prisma 的连接串，`prisma/schema.prisma` 中的 datasource 会读取它。

### 4.2 模型配置

```bash
RAG_SLICE_API_KEY="your-slice-key"
RAG_SLICE_MODEL="deepseek-chat"
RAG_SLICE_BASE_URL="https://api.deepseek.com/"

RAG_JUDGE_API_KEY="your-judge-key"
RAG_JUDGE_MODEL="deepseek-chat"
RAG_JUDGE_BASE_URL="https://api.deepseek.com/"

RAG_EMBED_API_KEY="your-embedding-key"
RAG_EMBED_MODEL="local-embedding-model"
RAG_EMBED_BASE_URL="http://127.0.0.1:1234/v1"

RAG_COMMUNITY_CONTEXT_MAX_TOKENS=4000
```

### 4.3 模型结构配置

与 `src/build/model.config.json` 对应的运行时结构如下：

```json
[
  {
    "baseURL": "https://api.deepseek.com/",
    "model": "deepseek-v4-flash",
    "apiKey": "your-slice-key",
    "type": "slice"
  },
  {
    "baseURL": "https://api.deepseek.com/",
    "model": "deepseek-v4-flash",
    "apiKey": "your-judge-key",
    "type": "judge"
  },
  {
    "baseURL": "http://127.0.0.1:1234/v1",
    "model": "your-embedding-model",
    "apiKey": "your-embedding-key",
    "type": "embedding"
  }
]
```

这意味着发布后的安装包需要依赖消费方提供：

- 数据库连接
- 模型 API Key
- 模型地址
- 模型名称
- 模型类型（slice / judge / embedding）

## 5. 运行方式

### 5.1 单元测试

```bash
bun test
```

### 5.2 示例脚本

```bash
bun run examples/demo.ts
```

### 5.3 benchmark

```bash
bun run benchmark --build --base-url http://localhost:3000
```

## 6. 设计理念

本项目的主要设计目标是：

1. 让 GraphRAG 流程尽量清晰可读
2. 让返回的证据链可审计
3. 在模型不稳定时提供可控的回退逻辑
4. 保持 PostgreSQL 作为核心存储，便于企业环境集成

## 7. 实际业务中的使用方式

这个仓库并不是只运行一次命令的小 demo，它更偏向“后端服务中的 GraphRAG 引擎”。在服务层里，真实用法是这样的：

```ts
import { createAppDeps } from '@novel-enginner/services/api/deps';

const deps = createAppDeps();

const buildId = deps.enqueueBuild(files, 'novel-demo');
const result = await deps.retrieval.retrieve({
  query: 'What does the limited reset actually shut down?',
  topK: 5,
});

console.log(result.answer);
```

这条调用链覆盖了实际服务的关键行为：

- 调用 `createAppDeps()` 创建依赖容器
- 把 `GraphRAGRetrievalService` 挂进应用中
- 通过 `enqueueBuild(...)` 启动异步构建任务
- 通过 `POST /api/rag/retrieve` 查询图谱并获取证据

真正的 HTTP 接口也遵循同一套 GraphRAG 工作流：

```http
POST /api/rag/ingest
{
  "entities": [...],
  "edges": [...],
  "reconcileEvery": 20,
  "rebuild": false
}
```

```http
POST /api/rag/retrieve
{
  "query": "总结这批文档中的关键风险",
  "topK": 5
}
```

从架构上看，这个项目适合应用在：

- 文档知识库
- 企业问答系统
- 证据型检索产品
- 多租户 / 多命名空间的知识图谱服务

## 8. 这个项目的优点与缺点

### 优点

- GraphRAG 流程清晰：构建、检索、证据聚合逻辑都比较直接
- PostgreSQL + pgvector 方案对企业环境友好
- 具备可解释的回退逻辑，模型输出不稳定时仍可保持稳定性
- TypeScript 代码结构清晰，便于二次开发
- 适合与自己的后端服务、API 网关和数据库集成

### 缺点

- 不是完整的端到端 SaaS 产品，缺少 UI 与认证体系
- 需要真实的数据库和模型配置，部署门槛高于纯本地 demo
- 相比更成熟的商业产品或专用图数据库方案，功能面更小、更偏参考实现
- 对大规模数据和高并发场景，需要进一步做资源调优和缓存策略

## 9. 与主流项目的区别

相较于一些更重的开源实现，本项目更偏向：

- 参考实现
- 小而清晰的模块拆分
- 低耦合的 TypeScript 结构
- 适合二次开发和企业接入

典型参考项：

- [pingcap/autoflow](https://github.com/pingcap/autoflow)
- [abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus)
- [talperetz/browsegraph](https://github.com/talperetz/browsegraph)

| 项目 | 适合场景 | 主要取舍 |
| --- | --- | --- |
| `graphrag-ts` | 可扩展的参考型 GraphRAG 引擎 | 不提供完整产品体验 |
| AutoFlow | 面向产品的知识库应用 | 更强的应用假设，参考成本更高 |
| GitNexus | 代码智能、仓库上下文 | 更偏代码场景，不是纯 markdown 图谱 |
| BrowseGraph | 浏览器本地知识图谱 | 更偏个人、本地化场景 |

结论：如果你想理解 GraphRAG 的核心机制，并把它集成进自己的后端服务，`graphrag-ts` 是一个非常合理的选择；如果你需要开箱即用的产品能力，则需要再补充 UI、权限和运营层。

## 10. 贡献方式

欢迎提交：

- 文档修正
- Bug 修复
- 功能增强
- 测试补充

贡献前请阅读：

- [README.md](../README.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)

## 11. 许可证

本项目采用 MIT License。
