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

```bash
pnpm install
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

涉及 Gateway 与 Web 的版本必须在同一提交上按 Backend-first 顺序发布：先等待非部署型 Ubuntu
`Verify WaveKB release` 门禁通过，再以显式生产确认发布 Backend；验收 all/single 检索、审计记录和精确
health SHA 后，才可审批并发布 Next。Gateway 兼容旧 Web 的无版本请求并按 all scope 处理。本流程只接受
生产 schema marker `202609090001`，未知 marker 一律关闭发布；多书检索不新增数据库迁移。Gateway 归档只带
代码、`package.json`、`knowledge/retrieval-index.json` 与 `DEPLOYMENT_VERSION`，不带 PDF 或密钥。

完整的 smoke、审计查询、SHA 核验和 previous-symlink 回滚步骤见
[`ai-gateway/docs/operations.md`](ai-gateway/docs/operations.md)。

详细步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。
