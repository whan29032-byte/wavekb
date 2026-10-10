# 艾略特波浪理论知识库（WaveKB）

这是 WaveKB 的生产 monorepo。当前主站使用 Next.js App Router、React、TypeScript、Tailwind CSS v4、共享 UI 包、Supabase、Storybook、Playwright 与 pnpm；旧静态实现只保留为可恢复回滚资产。

## 包含内容

- `apps/web/`：当前生产 Next.js 应用。
- `packages/domain`、`packages/ui`、`packages/knowledge`：领域规则、共享组件与知识数据。
- `assets/`：第 10/11 版原书关联图示与知识页面资源。
- `community/`、`admin/`、`workbench/`：冻结的旧静态回滚实现，不再新增功能。
- `supabase/`：按顺序执行的数据库迁移与 Edge Functions。
- `ai-gateway/`：UID 登录、管理接口与 AI 模型网关后端。
- `deployment/`：Nginx、systemd 与生产环境变量示例。
- `tests/`：网站前端和后端测试。
- `previews/`：新版好友/聊天等界面预览。

## 本地预览

安装依赖并启动 Next.js：

开发与 CI 使用 Node `^22.22.2 || ^24.15.0 || >=26.0.0`，与当前 jsdom 工具链要求一致；pnpm 固定为 `11.19.0`。部署中的 Node `22.18.0` smoke 只验证独立研报 worker，不代表整个 workspace 可以在 22.18 上开发或测试。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

当前依赖方向和发布门禁见 [docs/architecture/current-stack.md](docs/architecture/current-stack.md)，迁移过程记录见 [docs/architecture/nextjs-migration.md](docs/architecture/nextjs-migration.md)。

## 数据库

全新项目请按文件名顺序执行 `supabase/migrations/` 中的 SQL。已有生产库只执行尚未应用的迁移，禁止重复初始化或删除现有用户表。

Edge Functions 位于 `supabase/functions/`，其密钥必须通过 Supabase Secrets 配置，不得写入仓库。

## 后端

`ai-gateway/` 同时承载 UID 登录解析、管理接口与 AI 网关。复制环境变量示例后在服务器填写真实值：

```bash
cp ai-gateway/.env.example ai-gateway/.env
```

`.env` 已被 Git 忽略。浏览器中只能出现 Supabase 的公开 publishable key，绝不能放入 service-role key。

## 发布边界

- 主站发布：`apps/web/` 的 Next.js standalone 构建。
- 后端发布：`ai-gateway/` 网关与 AI Worker。
- 数据库变更：`supabase/migrations/`，在应用切换前执行。
- 不包含：生产数据库、用户上传内容、用户账户资料、服务器密钥、API Key、历史部署包或缓存。

涉及数据库或 Gateway 的版本必须在同一提交上按 Backend-first 顺序发布：先等待非部署型 Ubuntu
`Verify WaveKB release` 的生产依赖安全审计、测试、类型和构建门槛通过，再手动确认发布 Backend；数据库
marker、Gateway 精确 health SHA 与相关接口验收通过后，才可确认并发布 Next。Next 工作流本身不执行迁移。
本分支最新迁移目标为 `202610100002`：管理/支付安全加固 `202610100001`，随后是会员基础
`202610100002`。这不表示线上数据库已经迁移；Backend 只接受工作流逐项列明的旧 marker，Next 必须与
候选提交的最新 marker 完全一致，未知 marker 关闭发布。Gateway 归档只带代码、`package.json`、
`knowledge/retrieval-index.json` 与 `DEPLOYMENT_VERSION`，不带 PDF 或密钥。

会员基础与 `profiles.role` 分开管理：管理员可按原因手动授予、延长、撤销有到期时间的权益，普通用户只读
自己的权益和记录。该基础不启用价格、收费、订阅或自动续费，也不把既有公开知识、社区与研报改成付费内容。

依赖日常检查使用 `pnpm audit:prod`；该门槛要求官方 registry 返回完整、成功且零漏洞的生产依赖审计结果，
网络或解析错误会阻止发布。开发依赖另用 `pnpm audit` 评估，不将其报告冒充生产暴露证明。

完整的 smoke、审计查询、SHA 核验和 previous-symlink 回滚步骤见
[`ai-gateway/docs/operations.md`](ai-gateway/docs/operations.md)。

详细步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。
