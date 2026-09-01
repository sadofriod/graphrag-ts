# graphrag-ts 中文说明

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

## 7. 与主流项目的区别

相较于一些更重的开源实现，本项目更偏向：

- 参考实现
- 小而清晰的模块拆分
- 低耦合的 TypeScript 结构
- 适合二次开发和企业接入

典型参考项：

- [pingcap/autoflow](https://github.com/pingcap/autoflow)
- [abhigyanpatwari/GitNexus](https://github.com/abhigyanpatwari/GitNexus)
- [talperetz/browsegraph](https://github.com/talperetz/browsegraph)

## 8. 贡献方式

欢迎提交：

- 文档修正
- Bug 修复
- 功能增强
- 测试补充

贡献前请阅读：

- [README.md](../README.md)
- [CONTRIBUTING.md](../CONTRIBUTING.md)

## 9. 许可证

本项目采用 MIT License。
