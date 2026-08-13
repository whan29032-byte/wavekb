# WaveKB 当前生产架构

生产请求由 Next.js App Router 接管，仓库按“页面组合 → 业务用例 → 领域规则 → 基础设施”单向依赖。旧静态目录只保留作回滚参考，不再承接新功能。

```text
apps/web/app + components
        │
        ▼
apps/web/src/lib（按 auth/community/member/workbench/admin 分域）
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

推送 `main` 后，Actions 按顺序执行测试、类型检查、Lint、数据库迁移与版本校验、Next 构建、网关与 Worker 发布、健康检查和真实发帖生命周期。配置 `SUPABASE_DB_URL` 时 Actions 自动执行迁移；未配置时也必须先通过公开的精确 schema 版本校验，否则禁止发布。任一步失败都会恢复 Next 与网关的上一个软链接版本。生产数据库、用户上传文件和服务器密钥不进入发布包。
