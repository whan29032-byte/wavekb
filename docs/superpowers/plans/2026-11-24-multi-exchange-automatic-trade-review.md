# Multi-Exchange Automatic Trade Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 WaveKB 交易工作台升级为 Binance、OKX、Bybit、Bitget、Exness 五平台、多账户、只读、自动同步并可统一复盘的生产系统。

**Architecture:** 各供应商仅在服务端适配层处理鉴权、分页、能力发现和原生语义，随后写入统一快照、成交、资金事件与稳定交易周期模型。同步批次以 connection 为隔离边界原子发布；统计、页面、排行榜和 AI 只读取统一模型，不读取密钥或供应商原始响应。

**Tech Stack:** TypeScript 5.9、Node.js 22+、Next.js 16 / React 19、Supabase PostgreSQL + RLS/RPC、PGlite、Vitest、Node test runner、Playwright。

**Spec:** `docs/superpowers/specs/2026-11-24-multi-exchange-automatic-trade-review-design.md`

## Global Constraints

- 只支持 Binance USD-M、OKX USDT SWAP/FUTURES、Bybit USDT linear、Bitget USDT-FUTURES、Exness API CFD；首版不做现货。
- 适配器接口只能读取，严禁下单、改单、撤单、平仓、跟单、EA 控制、返佣、订阅和合作伙伴功能。
- 一个用户可绑定多个平台和账户；同一 provider + 外部账户只能属于一个 WaveKB 用户。
- 成交产品回补上限为 90 天；Exness 还必须服从运行时 `getDealsHistory` limits。
- 权益、历史估值、TWR、累计盈利曲线和最大回撤只能从 WaveKB 开始跟踪后计算。
- 15 分钟 UTC 网格上的快照超过 35 分钟即形成缺口，不插值、不伪造完整指标。
- 所有跨币种金额必须保存原币值、汇率、路径、来源和时间；估值不可用时排除并明确计数。
- 旧 11 步分析和私人记录不得删除；新工作台默认不展示“新建 11 步分析”。
- 所有私有表启用 RLS；事实写入只允许 service role；浏览器永远不能取得凭据、全局账户哈希或完整原始响应。
- 排行榜 API 保持现有公开聚合字段边界，公开表现只从 WaveKB 权益跟踪起点计算。
- 现有 Binance connection ID、密文、权益快照、公开同意和收益基线必须原位迁移，不能要求重新授权。
- 每个供应商由独立 feature flag 控制；总工作台 flag 关闭时旧页面仍可工作，回滚不得删除已迁移数据。

## Review Focus

- 同一外部账户重复绑定：本用户重连必须复用 connection；其他用户只能得到 `account_unavailable`，不能获知绑定者。
- 迟到成交导致周期拆分或合并：稳定 UUID、alias/lineage、已有复盘和 AI revision 必须按规格保留或标记待协调。
- 快照超 35 分钟、汇率缺失或内部转账无法配对：组合指标必须显示不完整，不能继续给出看似精确的总额。
- Exness 同一品种多个 `position_id`：必须保持独立周期，部分平仓、swap、commission、dividend 不能串单。
- 未知关键枚举或不安全权限：验证和同步必须 fail closed；不得用任何写交易请求试探权限。

---

## File and Interface Map

- `packages/domain/src/trading-review.ts`：浏览器、网关和测试共用的供应商、连接、筛选、指标、周期和复盘 DTO。
- `ai-gateway/src/trading/providers/contracts.ts`：只读 adapter 接口、规范化事实类型和运行时断言。
- `ai-gateway/src/trading/providers/registry.ts`：五个 adapter 的唯一注册表与 feature flag 过滤。
- `ai-gateway/src/trading/providers/<provider>.ts`：每个平台的签名、分页、能力发现、错误投影和归一化。
- `ai-gateway/src/trading/cycles.ts`：零仓周期、position ID 周期、revision 和 lineage 的确定性算法。
- `ai-gateway/src/trading/accounting.ts`：估值、外部资金流、内部转账、TWR、回撤和交易统计。
- `ai-gateway/src/trading/connection-service.ts`：凭据集、重复绑定、重连、轮换、断开和删除语义。
- `ai-gateway/src/trading/sync-service.ts`：租约、游标、历史窗口、批次发布和单连接失败隔离。
- `ai-gateway/src/trading/workbench-service.ts`：筛选后的合并视图和单周期私有视图。
- `supabase/migrations/202611240001_multi_exchange_trade_review.sql`：additive schema、RLS、旧 Binance 迁移和原子 RPC。
- `apps/web/src/components/exchange-account-manager.tsx`：五平台、多凭据、多账户连接管理。
- `apps/web/src/components/trading-workbench-dashboard.tsx`：合并指标、覆盖提示、筛选和周期列表。
- `apps/web/src/components/trading-trade-review.tsx`：单笔事实、三个主观字段、自动保存和 AI 状态。

### Task 1: Canonical Domain and Read-Only Provider Contract

**Files:**
- Create: `packages/domain/src/trading-review.ts`
- Modify: `packages/domain/src/index.ts`
- Create: `ai-gateway/src/trading/providers/contracts.ts`
- Create: `ai-gateway/src/trading/providers/registry.ts`
- Test: `packages/domain/src/trading-review.test.ts`
- Test: `ai-gateway/test/trading-provider-contracts.test.ts`

**Interfaces:**
- Produces: `TradingProvider`, `TradingProduct`, `ExchangeConnectionView`, `TradingWorkbenchFilter`, `TradingMetricSummary`, `TradeCycleView`, `TradeReviewInput`.
- Produces: `TradingProviderAdapter` with exactly `validateCredentials`, `discoverCapabilities`, `fetchAccountSnapshot`, `fetchHistory`, and `normalizeHistory` read methods.
- Produces: `assertCanonicalHistoryBatch(value: unknown): CanonicalHistoryBatch` and `createTradingProviderRegistry(adapters, enabledProviders)`.

- [ ] **Step 1: Write failing domain and provider contract tests**

  Assert all five provider literals round-trip, unknown critical cash/fill enums are rejected, duplicate adapter registration fails, disabled adapters are absent, and the public adapter surface contains no order/mutation method.

- [ ] **Step 2: Verify the tests fail**

  Run: `pnpm.cmd --filter @wavekb/domain test -- trading-review.test.ts && pnpm.cmd --dir ai-gateway exec node --test test/trading-provider-contracts.test.ts`

  Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Implement the canonical DTOs, runtime assertions, and registry**

  Keep provider-native payloads out of exported common DTOs. Model numeric money as decimal strings at storage/API boundaries and include `valuation_status`, quote source/path/time, coverage, and revision fields fixed by the spec.

- [ ] **Step 4: Run focused tests and typechecks**

  Run: `pnpm.cmd --filter @wavekb/domain test -- trading-review.test.ts && pnpm.cmd --dir ai-gateway exec node --test test/trading-provider-contracts.test.ts && pnpm.cmd --filter @wavekb/domain typecheck && pnpm.cmd --dir ai-gateway typecheck`

  Expected: PASS.

- [ ] **Step 5: Commit**

  `git add packages/domain/src/trading-review.ts packages/domain/src/trading-review.test.ts packages/domain/src/index.ts ai-gateway/src/trading/providers/contracts.ts ai-gateway/src/trading/providers/registry.ts ai-gateway/test/trading-provider-contracts.test.ts && git commit -m "feat(trading): define canonical provider contracts"`

### Task 2: Additive Private Trading Schema and Legacy Binance Migration

**Files:**
- Create: `supabase/migrations/202611240001_multi_exchange_trade_review.sql`
- Create: `tests/multi-exchange-trading-postgres.test.mjs`
- Modify: `tests/trading-leaderboard-postgres.test.mjs`

**Interfaces:**
- Consumes: canonical names from Task 1.
- Produces tables: `exchange_credential_sets`, `exchange_credential_secrets`, extended `exchange_connections`, `trading_account_snapshots`, `trading_fills`, `trading_cash_events`, `trading_trade_cycles`, `trading_trade_cycle_revisions`, `trading_trade_cycle_lineage`, `trading_trade_reviews`, `trading_sync_cursors`, `trading_sync_batches`, `trading_delete_queue`, `trading_deletion_audit`.
- Produces RPCs: `upsert_exchange_connection_v3`, `claim_exchange_sync_connection`, `publish_exchange_sync_generation`, `save_trading_trade_review`, `disconnect_exchange_connection_v3`, `request_trading_data_deletion`, `purge_due_trading_data`.

- [ ] **Step 1: Write failing PGlite migration tests**

  Assert provider + non-null `external_account_id_hash` uniqueness, credential sharing/ref-count behavior, owner-composite foreign keys, RLS denial, generation compare-and-swap, duplicate fact idempotency, 30-day maximum delete queue, 90-day audit expiry, unchanged `list_trading_leaderboard` output columns, and one aggregated leaderboard row per user across multiple opted-in connections.

- [ ] **Step 2: Verify migration tests fail**

  Run: `node --test tests/multi-exchange-trading-postgres.test.mjs tests/trading-leaderboard-postgres.test.mjs`

  Expected: FAIL on missing schema/RPCs.

- [ ] **Step 3: Implement the additive migration**

  Backfill each existing Binance connection into one credential set without changing connection IDs, encrypted envelope, snapshots, `started_at`, public consent, or return summary. Leave the external account hash null until the first successful Task 11 verification can compute a server HMAC from the real account ID; enforce uniqueness for every non-null provider + hash and never expose it through grants or RPC results.

- [ ] **Step 4: Run migration and leaderboard compatibility tests**

  Run: `node --test tests/multi-exchange-trading-postgres.test.mjs tests/trading-leaderboard-postgres.test.mjs`

  Expected: PASS with all private tables inaccessible to anon/other users and the existing leaderboard contract unchanged.

- [ ] **Step 5: Commit**

  `git add supabase/migrations/202611240001_multi_exchange_trade_review.sql tests/multi-exchange-trading-postgres.test.mjs tests/trading-leaderboard-postgres.test.mjs && git commit -m "feat(trading): add private multi-exchange schema"`

### Task 3: Deterministic Cycle Reconstruction and Lineage

**Files:**
- Create: `ai-gateway/src/trading/cycles.ts`
- Create: `ai-gateway/test/trading-cycles.test.ts`

**Interfaces:**
- Consumes: `CanonicalFill`, `CanonicalCashEvent`, `ProviderCapabilities`.
- Produces: `reconstructNetZeroCycles(input): ReconstructedCycle[]`, `reconstructPositionIdCycles(input): ReconstructedCycle[]`, `reconcileCycleLineage(previous, next): CycleReconciliation`.

- [ ] **Step 1: Write failing numerical fixtures**

  Cover one-way, hedge, add, reduce, partial close, reversal through zero, truncated opening history, duplicate/out-of-order fills, Exness position IDs, and unassigned funding/swap. Add review-focus cases where a late fill extends, splits, and merges cycles with two existing reviews.

- [ ] **Step 2: Verify cycle tests fail**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/trading-cycles.test.ts`

  Expected: FAIL on missing functions.

- [ ] **Step 3: Implement deterministic reconstruction**

  Sort by provider time plus native ID, deduplicate before arithmetic, split reversals at zero, mark pre-first-zero history incomplete, retain anchor UUID on extension/split, choose oldest UUID on merge, and return alias plus `needs_reconciliation` instructions without editing review text.

- [ ] **Step 4: Run tests and typecheck**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/trading-cycles.test.ts && pnpm.cmd --dir ai-gateway typecheck`

  Expected: PASS with stable digests and UUID decisions across retry orderings.

- [ ] **Step 5: Commit**

  `git add ai-gateway/src/trading/cycles.ts ai-gateway/test/trading-cycles.test.ts && git commit -m "feat(trading): reconstruct stable trade cycles"`

### Task 4: Valuation and Portfolio Accounting

**Files:**
- Create: `ai-gateway/src/trading/accounting.ts`
- Create: `ai-gateway/test/trading-accounting.test.ts`

**Interfaces:**
- Produces: `valueAmount(input, quotes): ValuedAmount`, `matchInternalTransfers(events): TransferMatchResult`, `buildPortfolioSeries(snapshots, events, filter): PortfolioSeries`, `calculateTradingMetrics(cycles, series): TradingMetricSummary`.

- [ ] **Step 1: Write failing accounting fixtures**

  Pin USD=1, labeled USDT approximation, direct/inverse and one-hop quotes, stale/ambiguous quote rejection, paired and unpaired transfers, 15-minute UTC buckets, 35-minute stale gaps, TWR, cumulative profit, max drawdown, realized net PnL, win rate, average-win/loss ratio and Profit Factor. Include UTC-midnight and DST grouping.

- [ ] **Step 2: Verify accounting tests fail**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/trading-accounting.test.ts`

  Expected: FAIL on missing module.

- [ ] **Step 3: Implement the accounting functions**

  Exclude unknown/unvalued values rather than coercing to zero. Return `included_connection_count`, `excluded_connection_count`, coverage intervals, `is_complete`, and reason codes with every aggregate.

- [ ] **Step 4: Run tests and typecheck**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/trading-accounting.test.ts && pnpm.cmd --dir ai-gateway typecheck`

  Expected: PASS with no interpolation across gaps.

- [ ] **Step 5: Commit**

  `git add ai-gateway/src/trading/accounting.ts ai-gateway/test/trading-accounting.test.ts && git commit -m "feat(trading): calculate multi-account performance"`

### Task 5: Binance USD-M Adapter and Legacy Continuity

**Files:**
- Modify: `ai-gateway/src/trading/binance-futures.ts`
- Create: `ai-gateway/src/trading/providers/binance.ts`
- Modify: `ai-gateway/test/binance-futures.test.ts`
- Create: `ai-gateway/test/binance-provider.test.ts`

**Interfaces:**
- Produces: `BinanceTradingProviderAdapter implements TradingProviderAdapter` for account snapshot, trades, income, account mode, pagination and safe errors.

- [ ] **Step 1: Add failing signature, pagination, normalization and migration-compatibility tests**

  Cover `BOTH/LONG/SHORT`, overlapping pages, transfer/funding/commission classification, non-USDT product rejection, unsafe permission metadata when available, and reuse of the migrated encrypted secret.

- [ ] **Step 2: Verify focused tests fail**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/binance-futures.test.ts test/binance-provider.test.ts`

  Expected: FAIL on missing adapter/history methods.

- [ ] **Step 3: Implement the Binance adapter**

  Preserve current safe error codes and snapshot behavior, add only read endpoints, and expose native IDs/cursors required by common idempotency.

- [ ] **Step 4: Run focused tests and typecheck**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/binance-futures.test.ts test/binance-provider.test.ts && pnpm.cmd --dir ai-gateway typecheck`

  Expected: PASS.

- [ ] **Step 5: Commit**

  `git add ai-gateway/src/trading/binance-futures.ts ai-gateway/src/trading/providers/binance.ts ai-gateway/test/binance-futures.test.ts ai-gateway/test/binance-provider.test.ts && git commit -m "feat(trading): adapt Binance USD-M history"`

### Task 6: OKX USDT Derivatives Adapter

**Files:**
- Create: `ai-gateway/src/trading/providers/okx.ts`
- Create: `ai-gateway/test/okx-provider.test.ts`

**Interfaces:**
- Produces: `OkxTradingProviderAdapter implements TradingProviderAdapter` using API key, secret and passphrase.

- [ ] **Step 1: Write failing OKX golden tests**

  Assert signature headers, `SWAP/FUTURES` USDT filtering, fills/bills pagination, `net/long/short` normalization, fee/funding signs, timestamp order, rate-limit projection, and fail-closed unknown position modes.

- [ ] **Step 2: Verify tests fail**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/okx-provider.test.ts`

  Expected: FAIL on missing adapter.

- [ ] **Step 3: Implement the OKX adapter with fixed official host/path allowlists**

- [ ] **Step 4: Run test and typecheck**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/okx-provider.test.ts && pnpm.cmd --dir ai-gateway typecheck`

  Expected: PASS.

- [ ] **Step 5: Commit**

  `git add ai-gateway/src/trading/providers/okx.ts ai-gateway/test/okx-provider.test.ts && git commit -m "feat(trading): add OKX derivatives adapter"`

### Task 7: Bybit USDT Linear Adapter

**Files:**
- Create: `ai-gateway/src/trading/providers/bybit.ts`
- Create: `ai-gateway/test/bybit-provider.test.ts`

**Interfaces:**
- Produces: `BybitTradingProviderAdapter implements TradingProviderAdapter` using V5 execution, transaction-log and wallet endpoints.

- [ ] **Step 1: Write failing Bybit golden tests**

  Assert V5 signature input, opaque cursor preservation, 90-day product cap, `linear` USDT filtering, one-way/hedge normalization, transaction-log cash classification, permission/rate-limit errors, and unknown enum rejection.

- [ ] **Step 2: Verify tests fail**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/bybit-provider.test.ts`

  Expected: FAIL on missing adapter.

- [ ] **Step 3: Implement the Bybit adapter with read-only allowlists**

- [ ] **Step 4: Run test and typecheck**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/bybit-provider.test.ts && pnpm.cmd --dir ai-gateway typecheck`

  Expected: PASS.

- [ ] **Step 5: Commit**

  `git add ai-gateway/src/trading/providers/bybit.ts ai-gateway/test/bybit-provider.test.ts && git commit -m "feat(trading): add Bybit linear adapter"`

### Task 8: Bitget USDT Futures Adapter

**Files:**
- Create: `ai-gateway/src/trading/providers/bitget.ts`
- Create: `ai-gateway/test/bitget-provider.test.ts`

**Interfaces:**
- Produces: `BitgetTradingProviderAdapter implements TradingProviderAdapter` using API key, secret and passphrase.

- [ ] **Step 1: Write failing Bitget golden tests**

  Assert signature/prehash, `USDT-FUTURES` filtering, fills/bills pagination, one-way/hedge semantics, fee/funding signs, 90-day cap, safe rate-limit errors, and unknown mode rejection.

- [ ] **Step 2: Verify tests fail**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/bitget-provider.test.ts`

  Expected: FAIL on missing adapter.

- [ ] **Step 3: Implement the Bitget adapter with fixed official host/path allowlists**

- [ ] **Step 4: Run test and typecheck**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/bitget-provider.test.ts && pnpm.cmd --dir ai-gateway typecheck`

  Expected: PASS.

- [ ] **Step 5: Commit**

  `git add ai-gateway/src/trading/providers/bitget.ts ai-gateway/test/bitget-provider.test.ts && git commit -m "feat(trading): add Bitget futures adapter"`

### Task 9: Exness Read-Only Multi-Account Adapter

**Files:**
- Create: `ai-gateway/src/trading/providers/exness.ts`
- Create: `ai-gateway/test/exness-provider.test.ts`

**Interfaces:**
- Produces: `ExnessTradingProviderAdapter implements TradingProviderAdapter` with Ed25519 `EXN-*` GET signing, official access-point discovery, 1–10 account selection, limits and deal history.

- [ ] **Step 1: Write failing Exness golden tests**

  Assert signing bytes, discovery-host validation, read-only scope enforcement, dynamic `history_age_days`/`history_range_days` windows, multi-account selection, decimal account currencies, and same-symbol distinct `position_id` cycles with partial close, commission, swap, balance and dividend.

- [ ] **Step 2: Verify tests fail**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/exness-provider.test.ts`

  Expected: FAIL on missing adapter.

- [ ] **Step 3: Implement the Exness adapter**

  Permit only official discovery results that pass protocol/hostname validation, require Trading Read-only scopes, never request Partnership/Transfers/Trading Full access, and keep account IDs server-side.

- [ ] **Step 4: Run test and typecheck**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/exness-provider.test.ts && pnpm.cmd --dir ai-gateway typecheck`

  Expected: PASS.

- [ ] **Step 5: Commit**

  `git add ai-gateway/src/trading/providers/exness.ts ai-gateway/test/exness-provider.test.ts && git commit -m "feat(trading): add Exness read-only adapter"`

### Task 10: Multi-Account Connection Service, API, and UI

**Files:**
- Create: `ai-gateway/src/trading/connection-service.ts`
- Modify: `ai-gateway/src/server.ts`
- Modify: `ai-gateway/src/config.ts`
- Create: `ai-gateway/test/trading-connections.test.ts`
- Modify: `apps/web/src/app/api/exchange/[...path]/route.ts`
- Create: `apps/web/src/components/exchange-account-manager.tsx`
- Create: `apps/web/src/components/exchange-account-manager.test.tsx`
- Modify: `apps/web/src/components/exchange-connection.tsx`

**Interfaces:**
- Produces routes: `GET /v1/user/exchange-connections`, `POST /validate`, `POST /connect`, `POST /:id/sync`, `POST /:id/reverify`, `POST /:id/public`, `POST /:id/disconnect`, `DELETE /:id/data`.
- Produces service methods: `list`, `validate`, `connect`, `rotateCredentials`, `setPublic`, `disconnect`, `requestDeletion`.

- [ ] **Step 1: Write failing service and component tests**

  Cover per-provider forms, Exness discovered-account selection, masked metadata only, simultaneous connections, reusing own disconnected connection, credential rotation across references, cross-user duplicate returning only `account_unavailable`, read-only acknowledgement, and public opt-in per connection.

- [ ] **Step 2: Verify tests fail**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/trading-connections.test.ts && pnpm.cmd --dir apps/web test -- src/components/exchange-account-manager.test.tsx`

  Expected: FAIL on missing service/UI.

- [ ] **Step 3: Implement connection routes and account manager**

  Keep old single-Binance routes as compatibility aliases until Task 14. Encrypt one provider-specific credential envelope per credential set and return only labels, masks, capability status and coverage.

- [ ] **Step 4: Run focused tests, security tests and typechecks**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/trading-connections.test.ts test/security.test.ts && pnpm.cmd --dir apps/web test -- src/components/exchange-account-manager.test.tsx && pnpm.cmd --dir ai-gateway typecheck && pnpm.cmd --filter @wavekb/web typecheck`

  Expected: PASS with no secret value in response/log snapshots.

- [ ] **Step 5: Commit**

  `git add ai-gateway/src/trading/connection-service.ts ai-gateway/src/server.ts ai-gateway/src/config.ts ai-gateway/test/trading-connections.test.ts apps/web/src/app/api/exchange apps/web/src/components/exchange-account-manager.tsx apps/web/src/components/exchange-account-manager.test.tsx apps/web/src/components/exchange-connection.tsx && git commit -m "feat(trading): manage multiple exchange accounts"`

### Task 11: Leased Sync Orchestration and Atomic Publication

**Files:**
- Create: `ai-gateway/src/trading/sync-service.ts`
- Modify: `ai-gateway/src/trading-worker.ts`
- Modify: `ai-gateway/src/worker-main.ts`
- Create: `ai-gateway/test/trading-sync-service.test.ts`
- Modify: `ai-gateway/test/worker-main.test.ts`

**Interfaces:**
- Produces: `syncConnection(connectionId, options): SyncResult`, `syncDueConnections(limit): SyncBatchResult`, `publishGeneration(batch): PublishedGeneration`.
- Consumes: provider registry, cycle reconstruction, atomic database RPC, per-connection cursor/lease/generation.

- [ ] **Step 1: Write failing sync tests**

  Cover first 90-day backfill, Exness dynamic windows, overlap dedupe, opaque cursor preservation, concurrent lease rejection, stale generation rejection, retry after mid-batch failure, late fill rebuild, single-connection failure isolation, manual throttle, and server metrics without response bodies.

- [ ] **Step 2: Verify tests fail**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/trading-sync-service.test.ts test/worker-main.test.ts`

  Expected: FAIL on missing orchestrator.

- [ ] **Step 3: Implement fetch-normalize-reconstruct-publish orchestration**

  Advance cursors only inside a successful `publish_exchange_sync_generation`; snapshot every 15 minutes; mark partial history and valuation gaps explicitly; allow every provider flag to disable new work without deleting state.

- [ ] **Step 4: Run focused tests and typecheck**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/trading-sync-service.test.ts test/worker-main.test.ts && pnpm.cmd --dir ai-gateway typecheck`

  Expected: PASS.

- [ ] **Step 5: Commit**

  `git add ai-gateway/src/trading/sync-service.ts ai-gateway/src/trading-worker.ts ai-gateway/src/worker-main.ts ai-gateway/test/trading-sync-service.test.ts ai-gateway/test/worker-main.test.ts && git commit -m "feat(trading): synchronize provider history atomically"`

### Task 12: Combined Workbench and One-Page Trade Review

**Files:**
- Create: `ai-gateway/src/trading/workbench-service.ts`
- Create: `ai-gateway/test/trading-workbench-service.test.ts`
- Modify: `ai-gateway/src/server.ts`
- Create: `apps/web/src/lib/trading/workbench-repository.ts`
- Create: `apps/web/src/components/trading-workbench-dashboard.tsx`
- Create: `apps/web/src/components/trading-workbench-dashboard.test.tsx`
- Create: `apps/web/src/components/trading-trade-review.tsx`
- Create: `apps/web/src/components/trading-trade-review.test.tsx`
- Modify: `apps/web/src/app/workbench/page.tsx`
- Create: `apps/web/src/app/workbench/trades/[id]/page.tsx`
- Modify: `apps/web/src/app/workbench/page.test.tsx`

**Interfaces:**
- Produces routes: `GET /v1/user/trading-workbench`, `GET /v1/user/trading-trades/:id`, `PUT /v1/user/trading-trades/:id/review`.
- Consumes filter: range `7d|30d|90d|all`, provider IDs, connection IDs and IANA timezone.

- [ ] **Step 1: Write failing service and UI tests**

  Cover no/single/multiple connections, all/provider/account filtering across every metric and list, partial coverage/valuation messaging, six fixed headline metrics, provider-specific Exness/crypto facts, three subjective fields, autosave, revision stale/reconciliation states, keyboard navigation and 390px layout. Assert the default page omits “新建分析/11 步” while legacy/private links remain reachable.

- [ ] **Step 2: Verify tests fail**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/trading-workbench-service.test.ts && pnpm.cmd --dir apps/web test -- src/components/trading-workbench-dashboard.test.tsx src/components/trading-trade-review.test.tsx src/app/workbench/page.test.tsx`

  Expected: FAIL on missing views/routes.

- [ ] **Step 3: Implement the combined dashboard and narrow review update**

  Query facts by owner and published generation only. Convert UTC to the requested valid IANA timezone at query time; use browser timezone and fall back to `Asia/Shanghai`; never rewrite stored timestamps.

- [ ] **Step 4: Run focused tests, typechecks and production build**

  Run: `pnpm.cmd --dir ai-gateway exec node --test test/trading-workbench-service.test.ts && pnpm.cmd --dir apps/web test -- src/components/trading-workbench-dashboard.test.tsx src/components/trading-trade-review.test.tsx src/app/workbench/page.test.tsx && pnpm.cmd --dir ai-gateway typecheck && pnpm.cmd --filter @wavekb/web typecheck && pnpm.cmd build`

  Expected: PASS and Next production build completes.

- [ ] **Step 5: Commit**

  `git add ai-gateway/src/trading/workbench-service.ts ai-gateway/test/trading-workbench-service.test.ts ai-gateway/src/server.ts apps/web/src/lib/trading/workbench-repository.ts apps/web/src/components/trading-workbench-dashboard.tsx apps/web/src/components/trading-workbench-dashboard.test.tsx apps/web/src/components/trading-trade-review.tsx apps/web/src/components/trading-trade-review.test.tsx apps/web/src/app/workbench && git commit -m "feat(workbench): launch automatic trade review UI"`

### Task 13: Knowledge-Grounded Trade Review AI

**Files:**
- Create: `supabase/migrations/202611240002_trade_review_ai.sql`
- Modify: `tests/multi-exchange-trading-postgres.test.mjs`
- Modify: `ai-gateway/src/knowledge/contracts.ts`
- Modify: `ai-gateway/src/routes/gateway-api.ts`
- Modify: `ai-gateway/src/jobs/router.ts`
- Create: `ai-gateway/src/trading/ai-review.ts`
- Create: `ai-gateway/test/trading-ai-review.test.ts`
- Modify: `apps/web/src/components/trading-trade-review.tsx`
- Modify: `apps/web/src/components/trading-trade-review.test.tsx`

**Interfaces:**
- Produces AI task type `trade_review` keyed by `trade_cycle_id` + `cycle_revision`, with `knowledge_scope: "all" | { book_ids: string[] }`.
- Produces structured sections: fact summary, discipline observations, wave/structure hypothesis, cited knowledge units, next checklist.

- [ ] **Step 1: Write failing schema, request and stale-revision tests**

  Assert owner isolation, all-book/single-book retrieval, citation validation, no secret/raw-provider/ranking fields in prompts, unknown-evidence wording, no buy/sell instruction or return promise, idempotency, and stale marking when the cycle revision changes.

- [ ] **Step 2: Verify tests fail**

  Run: `node --test tests/multi-exchange-trading-postgres.test.mjs && pnpm.cmd --dir ai-gateway exec node --test test/trading-ai-review.test.ts && pnpm.cmd --dir apps/web test -- src/components/trading-trade-review.test.tsx`

  Expected: FAIL because `trade_review` is not accepted.

- [ ] **Step 3: Implement the separate trade-review AI path**

  Reuse existing provider selection, knowledge retrieval, structure validation and rule gate; do not overload `analysis_id` or overwrite user review fields.

- [ ] **Step 4: Run focused AI, knowledge and UI tests**

  Run: `node --test tests/multi-exchange-trading-postgres.test.mjs && pnpm.cmd --dir ai-gateway exec node --test test/trading-ai-review.test.ts test/knowledge.test.ts test/pipeline.test.ts && pnpm.cmd --dir apps/web test -- src/components/trading-trade-review.test.tsx && pnpm.cmd --dir ai-gateway typecheck`

  Expected: PASS.

- [ ] **Step 5: Commit**

  `git add supabase/migrations/202611240002_trade_review_ai.sql tests/multi-exchange-trading-postgres.test.mjs ai-gateway/src/knowledge/contracts.ts ai-gateway/src/routes/gateway-api.ts ai-gateway/src/jobs/router.ts ai-gateway/src/trading/ai-review.ts ai-gateway/test/trading-ai-review.test.ts apps/web/src/components/trading-trade-review.tsx apps/web/src/components/trading-trade-review.test.tsx && git commit -m "feat(trading): add knowledge-grounded trade review AI"`

### Task 14: Feature-Flagged Cutover, Retention Worker, and Production Release

**Files:**
- Modify: `ai-gateway/src/config.ts`
- Modify: `ai-gateway/src/trading-worker.ts`
- Modify: `apps/web/src/app/workbench/page.tsx`
- Modify: `deployment/env/elliott-wave-gateway.env.example`
- Modify: `deployment/systemd/elliott-wave-trading-sync.service`
- Create: `apps/web/src/lib/trading/config.ts`
- Modify: `.github/workflows/deploy-next-production.yml`
- Create: `apps/web/e2e/trading-workbench.spec.ts`
- Create: `scripts/trading-release-preflight.mjs`
- Create: `tests/trading-release-preflight.test.mjs`
- Create: `docs/releases/2026-11-24-multi-exchange-trade-review.md`

**Interfaces:**
- Produces flags: `TRADING_WORKBENCH_V2_ENABLED`, `TRADING_PROVIDER_BINANCE_ENABLED`, `TRADING_PROVIDER_OKX_ENABLED`, `TRADING_PROVIDER_BYBIT_ENABLED`, `TRADING_PROVIDER_BITGET_ENABLED`, `TRADING_PROVIDER_EXNESS_ENABLED`.
- Produces release preflight that validates schema version, flags, provider hosts, migration ordering, old-route compatibility, worker health and rollback target without printing secrets.

- [ ] **Step 1: Write failing release and browser acceptance tests**

  Cover authenticated desktop/390px/PWA flows, five provider entries, combined filters, private trade access, legacy link access, public leaderboard response shape, due hard-delete/90-day audit cleanup, partial provider disable, old UI fallback, and no trading mutation route/method in the build.

- [ ] **Step 2: Verify focused release tests fail**

  Run: `node --test tests/trading-release-preflight.test.mjs && pnpm.cmd --filter @wavekb/web test:e2e -- trading-workbench.spec.ts`

  Expected: FAIL before flags/preflight/e2e fixtures exist.

- [ ] **Step 3: Implement flags, deletion maintenance, preflight and reversible cutover**

  Enable in order: schema, common contracts, Binance parity, OKX, Bybit, Bitget, Exness, then the workbench total flag. Do not enable a provider unless its contract suite and production read-only smoke check pass. Deployment workflow must retain the prior release and turn flags off on acceptance failure.

- [ ] **Step 4: Run the proportional release gate**

  Run: `node --test tests/ai-knowledge-artifact.test.mjs tests/multi-exchange-trading-postgres.test.mjs tests/trading-leaderboard-postgres.test.mjs tests/trading-release-preflight.test.mjs && pnpm.cmd --dir ai-gateway exec node --test test/trading-provider-contracts.test.ts test/trading-cycles.test.ts test/trading-accounting.test.ts test/binance-provider.test.ts test/okx-provider.test.ts test/bybit-provider.test.ts test/bitget-provider.test.ts test/exness-provider.test.ts test/trading-connections.test.ts test/trading-sync-service.test.ts test/trading-workbench-service.test.ts test/trading-ai-review.test.ts test/security.test.ts && pnpm.cmd --dir ai-gateway typecheck && pnpm.cmd --filter @wavekb/domain test && pnpm.cmd --filter @wavekb/web test && pnpm.cmd typecheck && pnpm.cmd lint && pnpm.cmd build`

  Expected: all listed gates PASS. Record separately any known unrelated full-suite Windows failures; do not waive a trading, security, type, lint or build failure.

- [ ] **Step 5: Commit the verified release candidate**

  `git add ai-gateway/src/config.ts ai-gateway/src/trading-worker.ts apps/web/src/app/workbench/page.tsx apps/web/src/lib/trading/config.ts deployment .github/workflows/deploy-next-production.yml apps/web/e2e/trading-workbench.spec.ts scripts/trading-release-preflight.mjs tests/trading-release-preflight.test.mjs && git commit -m "chore(trading): prepare reversible production cutover"`

- [ ] **Step 6: Deploy and verify production**

  Apply migrations before code, deploy the gateway/worker/web candidate using `.github/workflows/deploy-next-production.yml`, verify `/api/health`, worker generation progress, one authorized read-only smoke connection per enabled provider, private cross-user denial, leaderboard response, and `https://wavekb.com/workbench` desktop/mobile behavior. Roll back by disabling provider/total flags and restoring the retained release; never roll back by dropping new tables.

- [ ] **Step 7: Record and commit release evidence**

  Write the deployed commit SHA, migration versions, enabled flags, smoke-check timestamps, production acceptance result and rollback target to `docs/releases/2026-11-24-multi-exchange-trade-review.md`, then run `git add docs/releases/2026-11-24-multi-exchange-trade-review.md && git commit -m "docs(trading): record production release evidence"`.
