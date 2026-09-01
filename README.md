# graphrag-ts

一个以 TypeScript 为核心、面向 Markdown 文档的 GraphRAG 参考实现。
它会把一批 Markdown 内容转成可检索的知识图谱：支持 LLM 分块、确定性回退、Leiden 社区检测、实体/关系/声明构建，以及混合向量 + 关键字 + 图谱召回的证据式问答流程。

> 本仓库是从更大项目中的 rag 模块生成出来的，`src/` 下的代码会由迁移脚本同步更新；`README.md`、`docs/`、`examples/` 等目录属于手维护内容。相关设计与迁移说明见 [docs/architecture.md](docs/architecture.md)、[docs/migration.md](docs/migration.md)、[docs/comparison.md](docs/comparison.md)。

## 1. 项目概览

- 适用场景：知识库、文档图谱、企业文档检索、证据型问答
- 关键能力：Markdown 分块、向量嵌入、实体/边/claim 建模、社区摘要、混合召回、证据聚合
- 技术栈：TypeScript + Prisma + PostgreSQL + pgvector + Bun + pnpm

## 2. 环境要求

- [pnpm](https://pnpm.io/) 10+
- [Bun](https://bun.sh) 1.1+
- PostgreSQL，并启用 [pgvector](https://github.com/pgvector/pgvector)
- 两类模型：
  - 聊天模型（例如 DeepSeek 兼容接口，支持 JSON 输出）
  - 嵌入模型（例如 OpenAI 兼容接口 / LM Studio）

## 3. 作为 Node module 使用时的注入入口

当这个包被发布为 Node module 使用时，调用方不应依赖本地目录中的 `model.config.json` 或隐式环境变量。推荐遵循下面的注入方式：

```ts
import { injectModelConfigs } from 'graphrag-ts/model-loader';
import { injectPrismaClient } from 'graphrag-ts/prisma-client';
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

这样做的意义在于：

- 生产环境的上下文由宿主应用提供
- 运行时无需依赖仓库内的硬编码 JSON
- 仍然保留直接运行方式，便于本地开发与 Bun 脚本使用

同时，项目仍然保留 Bun 可直接执行入口：

```bash
cp .env.example .env
pnpm install
pnpm run db:push
bun test
bun run examples/demo.ts
```

这两种入口是并存的：

- Node module 场景：通过 `inject*` 函数注入配置
- Bun 直接运行场景：通过 `.env` + `bun run ...` 直接使用

## 4. 包安装后必须提供的运行参数

当这个包被发布给其他项目安装并运行时，使用方必须在运行时注入以下配置，否则 GraphRAG 初始化会失败。至少需要提供：

- `DATABASE_URL`：Prisma 数据库连接串
- `RAG_SLICE_*`：切片/总结阶段的模型参数
- `RAG_JUDGE_*`：评判/过滤阶段的模型参数
- `RAG_EMBED_*`：向量嵌入模型参数
- `model.config` 或等价配置数组：每种模型类型都需要一个配置项

示例 `.env`：

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

RAG_COMMUNITY_CONTEXT_MAX_TOKENS=4000
```

与 `src/build/model.config.json` 等价的运行时模型配置示例：

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

> 重要：这些值应由消费方在部署时通过环境变量、配置中心或密钥管理系统注入，不应硬编码进发布包中。

## 4. 快速开始

```bash
# 1. 安装依赖（pnpm，且会执行 Prisma postinstall）
pnpm install

# 2. 生成 Prisma Client
pnpm run db:generate

# 3. 拷贝并填写环境变量
cp .env.example .env
# 其中至少配置：
#   DATABASE_URL
#   RAG_SLICE_API_KEY
#   RAG_JUDGE_API_KEY
#   RAG_EMBED_API_KEY

# 4. 创建数据库表结构
pnpm run db:push

# 5. 运行单元测试（不需要真实数据库或真实 LLM）
bun test

# 6. 运行示例脚本
bun run examples/demo.ts
```

## 5. 运行 benchmark

```bash
bun run benchmark --build --base-url http://localhost:3000
```

该 benchmark 会模拟一组样例文档，对整个 GraphRAG 流程做召回评估，需要真实数据库和已配置好的模型服务。

## 6. 仓库结构

| 路径 | 归属 | 说明 |
| --- | --- | --- |
| `src/build/` | generated | 分块、社群发现、实体/边/claim 构建 |
| `src/retrieval/` | generated | 查询意图、召回、排序、证据、回答 |
| `src/benchmark/` | generated | 评测脚本、数据集和报告 |
| `src/namespace/` | generated | 多租户命名空间隔离 |
| `examples/` | hand-maintained | 示例与样例语料 |
| `docs/` | hand-maintained | 设计说明、对比分析、迁移说明 |
| `_migration/` | script-owned | 迁移缓存与同步脚本 |

## 7. 参考主流开源项目

这里参考了几类 TypeScript/GraphRAG 相关的主流开源实现：

- [pingcap/autoflow](https://github.com/pingcap/autoflow)
- [abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus)
- [talperetz/browsegraph](https://github.com/talperetz/browsegraph)

这些项目分别偏向：应用型知识库、代码智能/代理、浏览器本地知识图谱。与它们相比，本项目更强调：

- 作为参考实现和可学习实现
- 以 PostgreSQL + pgvector 为核心存储
- 结构清晰、模块可拆分、适合二次开发
- 具备明确的 deterministic fallback 机制

## 8. 文档索引

- [docs/architecture.md](docs/architecture.md)：架构设计
- [docs/migration.md](docs/migration.md)：生成/同步机制
- [docs/comparison.md](docs/comparison.md)：与主流项目对比
- [CONTRIBUTING.md](CONTRIBUTING.md)：贡献指南
- [docs/zh-CN.md](docs/zh-CN.md)：中文使用说明

## 9. 贡献指南

欢迎提交 Issue、PR 和文档改进。详细说明请参见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 10. 许可证

MIT
