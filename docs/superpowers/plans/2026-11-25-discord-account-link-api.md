# Discord Account Link API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 WaveKB 增加安全的一次性 Discord 账号绑定、机器人资料查询接口和绑定确认页面。

**Architecture:** Next.js Route Handlers 负责机器人鉴权和最小化 DTO，Supabase service-role 客户端只执行令牌写入与机器人查询；浏览器兑换使用 cookie 范围客户端调用 `security definer` RPC。原始令牌只在机器人和用户浏览器之间传递，数据库仅保存哈希。

**Tech Stack:** Next.js 16 App Router、TypeScript、Vitest、Supabase/PostgreSQL。

**Spec:** `docs/superpowers/specs/2026-11-25-discord-account-link-design.md`

## Global Constraints

- 原始绑定令牌 10 分钟有效、单次使用、数据库只存 SHA-256 哈希。
- 机器人响应不得包含邮箱、内部用户 UUID 或会话数据。
- service-role key 和机器人密钥仅限服务器模块，环境变量不带 `NEXT_PUBLIC_`。
- 仅允许配置的 Discord 服务器，所有响应 `cache-control: no-store`。
- 不修改现有网站积分、社区或认证语义。

## Review Focus

- 错误或缺失的 Bearer 密钥必须在访问 Supabase 前返回 401。
- 无效 snowflake、错误服务器和畸形 JSON 必须稳定返回 400/403。
- 过期、重放、已占用 Discord ID 和封禁账户必须在事务层拒绝。
- 查询 DTO 必须保持字段白名单，空钱包按 0 返回。
- 跨站兑换 POST 和缺失登录态必须不能修改绑定。

---

### Task 1: 数据库绑定事务

**Files:**
- Create: `supabase/migrations/202611250001_discord_account_link.sql`
- Create: `tests/discord-account-link-migration.test.mjs`

**Interfaces:**
- Produces: `profiles.discord_user_id`, `profiles.discord_linked_at`, `discord_link_tokens` 和 `redeem_discord_link_token(p_token_hash text) returns jsonb`。

- [ ] **Step 1: Write the failing test** — 固定唯一索引、RLS/权限、哈希约束、10 分钟令牌字段以及事务函数的匿名、过期、重放、冲突和封禁检查。
- [ ] **Step 2: Run test to verify it fails** — `node --test tests/discord-account-link-migration.test.mjs`，预期因迁移文件不存在而失败。
- [ ] **Step 3: Implement the migration** — 使用行锁和唯一索引实现原子兑换，函数只授权 `authenticated`。
- [ ] **Step 4: Run test to verify it passes** — 同一命令，预期 PASS。
- [ ] **Step 5: Commit** — `git add supabase/migrations/202611250001_discord_account_link.sql tests/discord-account-link-migration.test.mjs && git commit -m "feat: add discord account link migration"`。

### Task 2: 服务器集成服务与机器人 API

**Files:**
- Create: `apps/web/src/lib/discord-integration/security.ts`
- Create: `apps/web/src/lib/discord-integration/security.test.ts`
- Create: `apps/web/src/lib/discord-integration/service.ts`
- Create: `apps/web/src/lib/discord-integration/service.test.ts`
- Create: `apps/web/src/lib/supabase/service.ts`
- Create: `apps/web/src/app/api/integrations/discord/link/route.ts`
- Create: `apps/web/src/app/api/integrations/discord/member/route.ts`
- Modify: `apps/web/.env.example`

**Interfaces:**
- Consumes: Task 1 的表和列。
- Produces: `authorizeDiscordBot(headers)`, `createDiscordLink(input)`, `getDiscordMember(discordUserId)` 以及两个 `/api/integrations/discord/*` Route Handlers。

- [ ] **Step 1: Write the failing tests** — 覆盖定时安全鉴权、snowflake/服务器校验、令牌只存哈希、旧令牌撤销、404/403 和资料字段白名单。
- [ ] **Step 2: Run tests to verify they fail** — `pnpm.cmd --filter @wavekb/web test -- src/lib/discord-integration`，预期模块不存在。
- [ ] **Step 3: Implement server-only config, service client and integration service** — `createDiscordLink` 返回 `{ linkUrl, expiresAt }`；`getDiscordMember` 返回公开 DTO。
- [ ] **Step 4: Implement route handlers** — POST link 与 GET member 只负责鉴权、输入解析、状态码映射和 `no-store`。
- [ ] **Step 5: Run tests and typecheck** — 上述测试及 `pnpm.cmd --filter @wavekb/web typecheck`，预期 PASS。
- [ ] **Step 6: Commit** — 提交集成服务、接口、测试和示例环境变量。

### Task 3: 登录后确认绑定页面

**Files:**
- Create: `apps/web/src/app/account/discord-link/page.tsx`
- Create: `apps/web/src/app/account/discord-link/page.test.tsx`
- Create: `apps/web/src/app/api/integrations/discord/redeem/route.ts`
- Create: `apps/web/src/app/api/integrations/discord/redeem/route.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `redeem_discord_link_token` 与 `requireActiveMember()`。
- Produces: 服务器渲染确认页和同源 `POST /api/integrations/discord/redeem`。

- [ ] **Step 1: Write the failing tests** — 覆盖登录返回地址、令牌格式、同源限制、成功后清除 URL 令牌及稳定错误状态。
- [ ] **Step 2: Run tests to verify they fail** — 运行新增页面/路由测试，预期模块不存在。
- [ ] **Step 3: Implement the confirmation page** — 显示公开 UID、状态文案和无客户端密钥的 HTML 表单。
- [ ] **Step 4: Implement redeem route** — 校验同源与登录态、哈希令牌、调用 RPC，并以 303 重定向到无令牌状态页。
- [ ] **Step 5: Run focused tests, full web tests and typecheck** — `pnpm.cmd --filter @wavekb/web test` 与 typecheck，预期全通过。
- [ ] **Step 6: Commit** — 提交页面、兑换路由和测试。

### Task 4: 文档和整体验证

**Files:**
- Modify: `apps/web/README.md`

**Interfaces:**
- Consumes: Tasks 1–3 的最终契约。
- Produces: 可部署配置说明和验证记录。

- [ ] **Step 1: Document runtime secrets and migration order** — 明确密钥不能公开且数据库迁移必须先于网站发布。
- [ ] **Step 2: Run verification** — Web 全量 Vitest、typecheck、lint 和针对新迁移的 Node 测试。
- [ ] **Step 3: Commit** — `git commit -m "docs: explain discord account integration"`。
