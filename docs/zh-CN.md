# graphrag-ts 中文说明

> TypeScript GraphRAG for Markdown corpora. 构建知识图谱、检测社区，并用证据驱动的检索回答问题。

## 这个项目解决什么问题

传统向量 RAG 擅长相似度搜索，但在跨文档结构、实体关系和全局语义理解方面往往不足。这个仓库用 TypeScript 实现了一套 GraphRAG 工作流，让你可以对 Markdown 语料建立知识图谱，并从图谱中进行证据式问答，而不需要依赖 Python 运行时或定制化产品框架。

这个实现面向实际后端场景：

- 读取 Markdown 文件并进行分块
- 抽取实体、边和声明
- 通过 Prisma 持久化到 PostgreSQL
- 检测社区并生成社区摘要
- 结合向量、关键字和拓扑召回进行混合检索
- 通过证据聚合生成答案，而不是直接输出原始模型文本

## 它提供的价值

- 一个可读、可扩展的 TypeScript GraphRAG 参考实现
- 对实体、声明、边和社区进行数据库化持久化
- 支持命名空间级别的构建，适合多租户或多语料场景
- 混合检索能力，融合语义搜索、关键词搜索和图谱信号
- 模型分块失败时的确定性回退逻辑
- 轻量、服务化的公共 API，便于嵌入业务应用

## 核心流程

```mermaid
flowchart LR
    MD[Markdown 文件] --> SPLIT[分块与切片]
    SPLIT --> GRAPH[实体 + 边 + 声明图]
    GRAPH --> COMM[社区检测]
    COMM --> SUMMARY[社区摘要]
    Q[用户查询] --> INTENT[意图解析]
    INTENT --> HYBRID[混合召回: 向量 + 关键字 + 社区]
    HYBRID --> EVIDENCE[证据聚合]
    EVIDENCE --> ANSWER[基于证据的回答]
```

代码中的实际实现对应如下：

- `src/build/` 负责切片、图构建和社区检测
- `src/retrieval/` 负责查询解析、排序、证据选择和回答生成
- `prisma/schema.prisma` 定义持久化的 GraphRAG 表
- `src/index.ts` 暴露主要的公共 API 和运行时注入入口

## 快速开始

```bash
# 安装依赖
pnpm install

# 生成 Prisma 客户端
pnpm run db:generate

# 复制环境变量模板
cp .env.example .env

# 应用数据库结构
pnpm run db:push

# 运行测试
bun test

# 运行示例
bun run examples/demo.ts
```

## 运行要求

在本地运行前，确认已具备：

- [pnpm](https://pnpm.io/) 10+
- [Bun](https://bun.sh) 1.1+
- PostgreSQL，并启用 [pgvector](https://github.com/pgvector/pgvector)
- 用于切片和评判的聊天模型
- 兼容 OpenAI 风格 API 的 embedding 模型

## 运行时配置

这个仓库要求调用方提供环境变量，模型加载器会在 `src/build/modelLoader.ts` 中读取这些变量。

```bash
DATABASE_URL="postgresql://user:pass@localhost:5432/graphrag?schema=public"

RAG_SLICE_API_KEY="your-slice-key"
RAG_SLICE_MODEL="deepseek-chat"
RAG_SLICE_BASE_URL="https://api.deepseek.com/"

RAG_JUDGE_API_KEY="your-judge-key"
RAG_JUDGE_MODEL="deepseek-chat"
RAG_JUDGE_BASE_URL="https://api.deepseek.com/"

RAG_EMBED_API_KEY="your-embedding-key"
RAG_EMBED_MODEL="local-embedding-model"
RAG_EMBED_BASE_URL="http://127.0.0.1:1234/v1"
```

典型运行时注入方式：

```ts
import { PrismaClient } from '@prisma/client';
import {
  injectGraphRAG,
  GraphRAGRetrievalService,
  startBuild,
  createBuildRegistry,
} from '@ashes_born/graph-rag-ts';

await injectGraphRAG({
  database: {
    client: new PrismaClient({ datasourceUrl: process.env.DATABASE_URL }),
  },
  models: [
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
  ],
});

const registry = createBuildRegistry();
const buildId = startBuild(
  [{ title: 'sample.md', content: 'Alice works with Bob at Acme Corp.' }],
  registry,
  'demo-namespace',
);

const service = new GraphRAGRetrievalService();
const result = await service.retrieve({
  query: 'Who works with Alice?',
  topK: 5,
});

console.log(result.answer);
```

## 公共 API

这个仓库暴露了一个和实现一致的精简 API：

- `startBuild(...)`：启动异步构建任务并返回 build ID
- `createBuildRegistry()`：跟踪构建生命周期状态
- `GraphRAGRetrievalService`：执行混合检索和证据驱动回答
- `injectGraphRAG(...)`：注入 Prisma、模型配置和可选默认参数
- `injectModelConfigs(...)`：根据配置对象初始化模型适配器
- `injectPrismaClient(...)`：安装共享的 Prisma 客户端

仓库结构：

- `src/build/`：分块、图构建、社区检测、注册器
- `src/retrieval/`：查询解析、召回、排序、证据选择和回答生成
- `src/namespace/`：命名空间隔离
- `src/config/`：检索/构建默认值
- `examples/`：演示和 benchmark 脚本
- `docs/`：架构和对比说明

## 调参与默认值

项目支持通过 `injectGraphRAG(...)` 设置全局默认值，并通过 `retrieve(...)` 在单次请求中覆盖配置。真正的默认值位于 `src/config/defaults.ts`。

```ts
await injectGraphRAG({
  retrievalDefaults: {
    topK: 8,
    vectorChildTopK: 12,
    keywordSearchLimit: 24,
    evidenceChildLimit: 40,
    rrfK: 80,
  },
  buildDefaults: {
    maxChunkSize: 800,
    chunkOverlapRatio: 0.1,
  },
});
```

按请求覆盖示例：

```ts
const result = await service.retrieve({
  query: 'Who is Irene Adler?',
  topK: 6,
  options: {
    vectorChildTopK: 20,
    keywordSearchLimit: 30,
    evidenceChildLimit: 50,
    rrfK: 80,
  },
});
```

这些参数控制检索窗口和排序行为：

- `topK`：语义层面候选社区数量
- `vectorChildTopK`：向量搜索返回的 child chunk 数量
- `keywordSearchLimit`：关键词匹配的 child chunk 上限
- `evidenceChildLimit`：证据合并上限
- `rrfK`：倒序秩融合的敏感度
- `maxChunkSize` 和 `chunkOverlapRatio`：确定性分块回退参数

## 示例与 benchmark

```bash
# 运行构建 + 检索示例
bun run examples/demo.ts

# 运行召回 benchmark
bun run demo:benchmark
```

benchmark 脚本会对生成的 Markdown 语料执行真实检索评估，并输出持久化 GraphRAG namespace 的召回指标。它用于验证真实构建和检索链路，而不是只验证 mock 行为。

## 文档索引

- [docs/architecture.md](docs/architecture.md)：架构和数据流
- [docs/en-US.md](docs/en-US.md)：英文说明
- [docs/zh-CN.md](docs/zh-CN.md)：中文说明
- [docs/comparison.md](docs/comparison.md)：比较说明
- [CONTRIBUTING.md](CONTRIBUTING.md)：贡献指南

## 贡献

欢迎通过 issue 和 pull request 参与贡献。这个项目的代码组织比较模块化，最有价值的改动通常集中在：

- 图构建质量
- 检索质量和排序
- 命名空间隔离
- 模型加载稳定性
- 文档与示例

## 许可证

MIT
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
