# 艾略特波浪理论知识库（WaveKB）

这是 2026-08-13 整合后的项目源码。它以当前本地完整网站为基础，并纳入尚未上线的新版好友与聊天窗口代码。

## 包含内容

- `index.html`、`elliott-wave-preview.html`：网站入口与知识库应用。
- `assets/`：第 10/11 版原书关联图示与知识页面资源。
- `community/`：账号、会员空间、发帖、好友、聊天、导师、积分商城、主题与 AI 前端。
- `admin/`：独立后台管理页面。
- `workbench/`：波浪分析、评分、规则与最大回撤工具。
- `supabase/`：按顺序执行的数据库迁移与 Edge Functions。
- `ai-gateway/`：UID 登录、管理接口与 AI 模型网关后端。
- `deployment/`：Nginx、systemd 与生产环境变量示例。
- `tests/`：网站前端和后端测试。
- `previews/`：新版好友/聊天等界面预览。

## 好友系统版本

本仓库的好友与聊天功能采用当前本地最新版本，核心文件为：

- `community/member-ui.js`
- `community/messenger-desktop.css`
- `community/member-repository.js`
- `community/image-attachments.js`
- `supabase/migrations/202607310001_social_graph.sql`
- `supabase/migrations/202607310003_social_graph_hardening.sql`

该版本包含悬浮好友面板、独立聊天窗口、位置持久化、图片粘贴/拖放、表情与通知等实现。它可能领先于当前线上 `wavekb.com` 版本。

## 本地预览

在仓库根目录启动任意静态文件服务器，然后打开 `index.html`。例如使用 Python：

```bash
python3 -m http.server 8877
```

打开 `http://127.0.0.1:8877/index.html`。

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

- 静态站点发布：根目录 HTML、`assets/`、`community/`、`admin/`、`workbench/`。
- 后端单独发布：`ai-gateway/`。
- 数据库变更：`supabase/migrations/`。
- 不包含：生产数据库、用户上传内容、用户账户资料、服务器密钥、API Key、历史部署包或缓存。

详细步骤见 [DEPLOYMENT.md](DEPLOYMENT.md)。

