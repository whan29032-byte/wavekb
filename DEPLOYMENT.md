# 部署说明

## GitHub Actions 自动部署

仓库包含 `deploy-static-production.yml`：拉取请求运行网站测试；`main` 更新后自动备份并同步静态站点，失败自动回滚，再检查公网首页和好友模块。

Actions 只长期保留 `DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_PATH` 和 `DEPLOY_SSH_KEY`。服务器的 ED25519 指纹固定在工作流中，避免连接到冒充服务器。工作流只更新根目录三个 HTML 文件以及 `assets/`、`community/`、`admin/`、`workbench/`，不会执行数据库迁移、覆盖后端环境变量或读取用户数据库。

迁移分支还包含 `deploy-next-preview.yml`。该工作流在 `agent/nextjs-full-migration` 更新后构建独立的 Next.js standalone 发布包，部署到 `/srv/wavekb-next-preview/releases/<commit>`，原子切换 `current` 链接，并在 `127.0.0.1:3100` 完成健康检查。部署失败会恢复上一个链接和进程。预览服务只监听服务器回环地址，不修改生产 Nginx，也不替换 `wavekb.com` 静态站点。

如需让 Actions 完成真实发帖全生命周期验收，在 GitHub `next-preview` 环境增加专用测试账号 Secrets：`E2E_POSTING_IDENTIFIER` 和 `E2E_POSTING_PASSWORD`。测试通过 SSH 隧道访问回环预览服务，依次验证登录、发帖、图片上传、外链、详情刷新、作者主页、编辑、删图、删除帖子和退出；缺少凭据时只跳过这一步，不会使用普通用户账号。预览环境与只允许 `main` 部署的 `production` 环境相互独立。

## 1. 上线前备份

先备份服务器当前静态目录、Nginx 配置和数据库。不要用本仓库覆盖生产数据库；迁移必须增量执行。

## 2. 静态站点

将以下内容同步到服务器现有站点目录：

- 根目录三个 HTML 文件
- `assets/`
- `community/`
- `admin/`
- `workbench/`

`previews/` 和 `tests/` 不必发布到公网。

## 3. 数据库迁移顺序

迁移文件已经统一放在 `supabase/migrations/`，按文件名升序执行。生产库先查询迁移记录，跳过已经应用的文件。

## 4. 后端与认证

安装 Node.js 22 或更新版本，在 `ai-gateway/` 安装依赖并配置服务器专用环境变量。Nginx 需要把 `/api/auth` 与 `/api/ai` 代理到网关进程。

参考：

- `deployment/nginx-elliott-wave.conf`
- `deployment/nginx/uid-auth-location.conf`
- `deployment/systemd/elliott-wave-gateway.service`
- `ai-gateway/docs/operations.md`

## 5. Supabase Functions

部署 `supabase/functions/` 下的函数，并在服务端设置 `SUPABASE_SERVICE_ROLE_KEY`、支付接口密钥和 `SITE_ORIGIN`。不要把这些值提交到 GitHub。

## 6. 验收

至少检查：

1. 注册、邮箱验证、邮箱/UID 登录和密码重置。
2. 个人资料、发帖、评论和多图上传。
3. 好友搜索、请求、好友数量、最近会话与消息通知。
4. 好友面板跨页面保持，聊天窗口可拖动、最小化和恢复。
5. 聊天文本、表情、图片粘贴/拖放与提示音。
6. 私人复盘、交易日记、工作台保存与读取。
7. 积分签到、排行榜、商品兑换与铭牌佩戴。
8. 导师套餐、USDT 收款方式、订单通知和导师权限隔离。
9. 管理后台用户、积分、商品、导师、推荐链接和操作日志。

确认以上功能后再清理旧缓存，并保留可回滚的服务器备份。
