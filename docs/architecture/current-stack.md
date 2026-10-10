# WaveKB 当前生产架构

生产请求由 Next.js App Router 接管，仓库按“页面组合 → 业务用例 → 领域规则 → 基础设施”单向依赖。旧静态目录只保留作回滚参考，不再承接新功能。

```text
apps/web/src/app + components
        │
        ▼
apps/web/src/lib（按 auth/community/member/membership/workbench/admin 分域）
        │
        ├── packages/domain（纯类型、校验和领域规则）
        ├── packages/ui（shadcn/ui 风格的共享组件）
        ├── packages/knowledge（构建期知识数据）
        └── Supabase 客户端 / ai-gateway 内网接口

ai-gateway ── Supabase service-role / BYOK 模型供应商
AI worker  ── ai_jobs 队列 / BYOK 模型供应商
Supabase   ── Auth、Postgres、RLS、Storage、Edge Functions
```

## 边界

- `app/` 只负责路由、服务端装配和页面级权限，不放数据库细节。
- `components/` 负责交互状态，不直接保存 service-role 密钥，不复制数据库权限规则。
- `lib/<domain>/server-repository.ts` 只在服务器读取；`client-repository.ts` 只使用 publishable key、用户 JWT 与受限 RPC。
- `packages/domain` 不依赖 React、Next.js、Supabase 或浏览器 API。
- 需要跨多表一致性的写入必须落在数据库 RPC/事务中；Storage 上传失败由调用方补偿清理。
- `ai-gateway` 是 UID、后台高权限接口和模型连接的唯一 service-role 边界；后台 Worker 只消费数据库队列。

## 旧实现治理

`community/`、`admin/`、`workbench/` 根目录下的静态实现进入冻结状态：只允许修复仍被回滚页使用的严重安全问题，不接受新功能。确认生产回滚窗口结束后，整目录移动到独立归档仓库；在此之前不做大规模删除，以免失去可恢复发布物。

## 发布门禁

仓库 Web 锁定 Next `16.3.8`、React `19.2.8`、Tailwind `4.3.3`、sharp `0.35.5`；pnpm 固定 `11.19.0`。开发/CI Node 范围为 `^22.22.2 || ^24.15.0 || >=26.0.0`，独立研报 worker 的 22.18 最低 runtime smoke 不证明完整 workspace 兼容。线上准确版本以 health SHA 和正式验收为准。

所有候选先跑无部署权限的 Ubuntu `verify-release.yml`：生产依赖零漏洞审计、知识一致性、根/工作区测试、类型检查、lint 和构建。`deploy-static-production.yml` 的历史文件名目前仅承担额外验证，不执行静态发布。

涉及数据库/Gateway 时，先以手动生产确认运行 Backend 的明确迁移链，验证数据库与公开 RPC marker、Gateway health SHA，再审批同一提交的 Next 发布。最新候选 marker 为 `202610100002`，先执行管理/支付安全加固 `202610100001`，随后会员基础 `202610100002`；未知 marker 关闭发布。这是本分支目标，不是线上已迁移证明。

Next preflight 按实际 live SHA 判定变化并动态比较候选最新 schema。它不读取数据库 URL，也不自动迁移。相关账号/会员/发帖/依赖变更需真实专用账号验收；缺凭据时停止需要写入验收的发布。手动只读审批不绕过 schema、Gateway、构建或只读浏览器验证。外部验收通过后才 finalize，失败按准确旧发布回滚代码与服务；数据库迁移不会自动回滚。生产数据库、用户上传和服务器密钥不进入发布包。

## 会员基础

会员计划、授权期限、权益查询和审计事件是独立领域，不复用 `profiles.role` 表示付费身份。计划默认关闭；管理员操作需原因、请求幂等性和预期 revision，用户只读自己记录。服务端/数据库以有效期、撤销状态和启用计划决定权益，前端显示不替代授权。

本分支不配置价格、收费、订阅或自动续费，不限制既有公开知识/社区/研报内容，也不把导师支付事件转换成会员授权。收费与具体付费权益需要另行明确产品规则后再实现和验收。
