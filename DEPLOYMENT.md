# 部署说明

当前主站使用 `.github/workflows/deploy-next-production.yml` 发布 Next.js standalone。
`/srv/wavekb-next-preview/current`、`wavekb-next-preview.service` 和 GitHub 的 `next-preview`
环境名保留历史名称，已用于正式主站；它们不是允许降低验收标准的预览环境。

`deploy-static-production.yml` 现在只执行测试、类型检查、Next/Storybook 构建和公开路由验收，
不备份或同步静态生产目录。根 HTML 与 `community/`、`admin/`、`workbench/` 进入冻结回滚状态。
旧静态 Nginx 示例与 `cutover-next-production.yml` 属于历史路由切换工具，不能作为日常发布流程。

## 候选验证与运行环境

开发和 CI 采用 Node `^22.22.2 || ^24.15.0 || >=26.0.0`，pnpm 固定 `11.19.0`。CI 的 Node 22
选择器应解析为符合该范围的维护补丁。生产研报 worker 的 Node `22.18.0` 最低运行时 smoke
只验证独立 worker/SQLite 能力，不验证完整 Web 测试工具链；生产主机的准确版本仍需独立预检。

Backend 与 Next 均先调用无部署权限的 `verify-release.yml`：冻结锁安装、`pnpm audit:prod`、
知识生成校验、根/工作区测试、Gateway/Web 类型检查、lint 和构建。生产依赖审计的网络、解析、
命令错误或任意已知漏洞都会阻止发布，没有通用白名单或吞错。

正式发布包不包含生产数据库、用户上传内容、用户账户资料、服务器环境文件、密钥或 SQLite/WAL。
SSH 使用固定 ED25519 指纹；不得把真实部署凭据、数据库 URL 或 service-role 值放入仓库或日志。

## 数据库与 Gateway：手动 Backend-first

涉及 `supabase/`、Gateway 或其 systemd 单元的发布，先确保同一候选提交验证通过，再手动运行
`deploy-backend-production.yml`，选择 `main` 并输入 `DEPLOY_WAVEKB_BACKEND`。

本分支数据库目标 marker 是 `202610100002`。工作流逐项接受已知的
`202609090002`、`202609100001`、`202610080001`、`202610080002`、`202610080003`、
`202610080004`、`202610100001` 与 `202610100002`，按当前 marker 仅执行尚未应用的迁移后缀。
旧迁移链完成后，依次执行：

1. `202610100001_admin_payment_hardening.sql`
2. `202610100002_membership_foundation.sql`

未知 marker 停止，不自动初始化或遍历重跑全库。迁移使用 `ON_ERROR_STOP`；最终数据库查询与
公开 `wavekb_schema_version()` RPC 必须都返回 `202610100002`，之后才允许上传 Gateway 发布包。
全新数据库另按所有迁移文件名顺序初始化，不把已有生产库当新项目。这里描述的是候选发布目标，
不证明线上数据库已经应用这些迁移。

Gateway 使用不可变发布目录、准确提交版本和原子 `current` 切换，保留旧代码/systemd 单元以便回滚。
数据库迁移保持前向兼容，不因 Gateway 代码回滚自动撤销。邮件、YouTube、交易排行同步等现有服务
按原工作流管理；此流程不更改 Hermes 或交易执行。

Supabase Edge Functions 需要单独发布受影响函数与服务端配置；Backend 工作流不会自动部署这些函数。
支付配置只能使用已审查的服务端 Secrets。不得把新会员基础接到导师支付回调或新增收费任务。

## Next：验证、审批、验收与回滚

Backend 的数据库 marker、Gateway 精确 health SHA 和相关接口验证完成后，手动运行同一提交的
`deploy-next-production.yml`，确认 `gateway_release_approved`。只有纯 Web/知识变更且线上 schema
兼容时，现有 `main` 推送触发的 Next 发布才能继续；推送本身不批准迁移或 Gateway 更新。

Next 的只读 preflight 根据实际 live SHA 计算差异，动态要求候选提交 `supabase/migrations/`
里的最新 marker，与线上公开 RPC 完全相等。缺失/未知 SHA、marker 不同或未确认的 Gateway
变更都会停止；Next 工作流没有数据库凭据或迁移写入后备路径。

在第一笔生产上传前完成 standalone 构建、独立 worker/SQLite、候选本地浏览器和 Storybook 验收。
阅读与真实图像专项零重试；配置同时包含桌面 Chromium 与移动 Chromium 模拟，不能冒充真实 iOS/Safari
验证。代码切换后检查公网 health 的精确 SHA、公开路由、阅读图像和真实研报读取。

发帖、账号壳层、会员权益、共享依赖等相关变化必须用专用验收账号完成真实登录/发帖生命周期。
`E2E_POSTING_IDENTIFIER`、`E2E_POSTING_PASSWORD` 缺失时停止需要它的发布。手动工作流只有在明确
批准本次只读验收后才可跳过写入测试，schema/Gateway/构建/只读浏览器门槛不变。

全部外部验收通过才 finalize；失败或取消按保留状态恢复准确的旧 Next 代码、服务与研报同步配置。
前一次发布物、持久目录、备份与回滚元数据必须保留，不能用清缓存代替回滚或用新发布覆盖用户数据。

研报 worker/timer 与准确回滚见 [研报运维说明](docs/tline-research.md)，Gateway 检索、审计和
previous-symlink 回滚见 [Gateway 运维说明](ai-gateway/docs/operations.md)。

## 会员基础的发布边界

会员计划、到期权益与审计记录独立于 `profiles.role`。本分支提供管理员手动授予、延长、撤销和用户
读取自己记录的基础；计划默认关闭。它不启用价格、收费、订阅或自动续费，不把既有公开知识、社区、
研报及资料页设为付费内容，也不改变现有导师订单/积分/交易功能的业务边界。

候选验收应覆盖普通用户只能读取自身记录、管理员操作留有原因与审计、重复请求不重复授予、并发版本冲突、
到期/撤销/关闭计划的权益失效。测试通过、代码合入、数据库迁移、服务发布和线上验收是不同状态，逐项记录。
