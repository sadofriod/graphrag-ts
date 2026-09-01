# 贡献指南

感谢你对 `graphrag-ts` 的关注与贡献。本仓库目前是一个独立维护的项目，代码和文档都在当前仓库中直接修改。提 PR 前，请先阅读本指南，并确认你的变更落在当前仓库的正确边界中。

## 1. 先阅读这些文档

- [README.md](README.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/migration.md](docs/migration.md)
- [docs/comparison.md](docs/comparison.md)

如果你在调整实现、架构或文档，请优先遵循当前仓库中的实际结构，而不是依赖任何历史迁移流程。

## 2. 代码归属边界

### 直接维护

以下路径可以直接在当前仓库中修改：

- `src/`
- `README.md`
- `docs/`
- `examples/`
- `CHANGELOG.md`
- `.github/`
- `.gitignore`
- `CONTRIBUTING.md`
- `package.json`
- `tsconfig.json`
- `.env.example`
- `LICENSE`
- `prisma/`

### 历史遗留目录

以下目录保留为历史说明与兼容信息，通常不应作为日常开发的主要入口：

- `_migration/`

请不要在常规开发中依赖 `_migration/cache.json` 作为当前仓库的真实同步状态；它仅用于历史迁移背景的保留与参考。

## 3. 本地开发工作流

1. 安装依赖：

```bash
pnpm install
pnpm run db:generate
```

2. 设置环境变量：

```bash
cp .env.example .env
```

3. 运行针对性的校验：

```bash
bun run lint
bun run typecheck
bun test
```

4. 对于纯文档改动，请在 PR 中说明“文档变更”并明确不涉及运行时逻辑修改。

## 4. 提交规范

- 一个 PR 尽量只解决一个明确问题
- 变更范围应尽可能小，不要顺手清理无关代码
- 如果修改了运行时行为，请补充或更新测试
- 提交信息建议遵循简洁、清晰的说明风格

## 5. 评审清单

PR 描述中建议包含：

- 问题摘要
- 改动内容
- 影响范围
- 验证方式（例如 `pnpm install`、`bun test`、`bun run typecheck`）
- 任何已知限制或后续事项

## 6. 提 issue / 提 PR

- 如果你发现 bug、缺少特性或文档不清晰，可以先提出 issue
- 如果是大改动，请说明它涉及哪些模块，以及是否影响现有使用方式
- 对复杂特性，最好先讨论设计，再提交实现代码

## 7. 行为准则

请保持：

- 尊重
- 具体
- 建设性
- 以问题与代码为中心，而不是个人攻击

## 8. 代码贡献愿景

这个仓库的目标是：

- 让 GraphRAG 参考实现更容易学习和二次开发
- 保持结构清晰、模块明确、测试友好
- 让文档与代码配置说明保持一致

感谢你的参与。
