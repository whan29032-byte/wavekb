# 部署说明

## GitHub Actions 自动部署

`.github/workflows/deploy-production.yml` 会在拉取请求中运行全部测试，并在
`main` 更新后自动备份、同步静态站点和网关、重启网关，再验证公网健康状态。
生产环境只允许 `main` 部署，仓库需要以下 Actions Secrets：

- `DEPLOY_HOST`
- `DEPLOY_USER`
- `DEPLOY_SSH_KEY`
- `DEPLOY_KNOWN_HOSTS`

服务器备份保存在 `/var/backups/elliott-wave/actions/`，失败时自动回滚，成功
备份保留 14 天。数据库迁移会同步到 `/opt/elliott-wave-migrations/` 供审计，
但不会由网站发布任务自动执行；生产数据库仍须按下一节的增量流程更新。

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
