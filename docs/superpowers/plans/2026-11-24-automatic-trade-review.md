# Automatic Trade Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 11-step default workbench flow with a private Binance USD-M automatic review dashboard and one-page per-trade review backed by real fills, fees, funding, equity snapshots, and WaveKB knowledge-grounded AI.

**Architecture:** Extend the existing encrypted Binance gateway with paginated 90-day history ingestion, reconstruct deterministic zero-to-zero trade cycles in TypeScript, and publish each sync atomically through narrow Postgres RPCs. The web app reads private aggregates through RLS-backed repositories, renders a responsive dashboard and three-field review editor, and routes trade-review AI through an independent job contract and worker path.

**Tech Stack:** TypeScript, Node.js 22+, Next.js 16, React 19, Supabase/Postgres RLS and RPC, PGlite migration tests, Vitest/Testing Library, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-24-automatic-trade-review-design.md`

## Global Constraints

- Support Binance USD-M futures only; do not add spot, COIN-M, multi-asset margin, order placement, copy trading, affiliate, subscription, or imported operations-console features.
- Keep API credentials server-only and encrypted with the existing AES-256-GCM mechanism; the browser may receive only masked connection metadata.
- Keep fills, income events, cycles, and reviews private; the public leaderboard remains an independent aggregate contract.
- The default workbench must not expose a new 11-step analysis entry; old `workbench_analyses` remain read-only and `private_entries` remain readable and writable.
- A trade is one `(symbol, position_side)` zero-to-zero cycle, not an individual order or fill.
- Unknown values stay unknown: no fabricated R multiple, historical equity, fee conversion, funding allocation, or wave count.
- Initial history coverage is at most 90 days; incomplete opening history is excluded from cycle metrics until the first known return to zero.
- Database timestamps remain UTC; calendar aggregation uses a validated IANA time zone and falls back to `Asia/Shanghai`.
- Reuse WaveKB design tokens and components; do not copy source code, branding, copy, or visual layout from `lioil.lol`.

## Review Focus

- A backfill that begins mid-position must mark the opening fragment incomplete and exclude it from win rate and per-trade review; Task 1 pins this with a truncated-history fixture.
- Late, duplicated, or out-of-order fills must produce the same stable cycle IDs without duplicating PnL; Tasks 1 and 3 pin reconstruction and atomic-upsert behavior.
- Funding during simultaneous hedge-mode cycles and non-USDT fees must remain unallocated/unconverted instead of being guessed; Tasks 1 and 5 pin both display and metric exclusion.
- A failed sync batch must leave the published cursor, cycles, and dashboard unchanged; Task 3 pins transaction rollback and Task 4 pins retry behavior.
- UTC trades crossing local midnight or DST must appear on the correct calendar day; Tasks 3 and 5 pin the aggregate and rendered date labels.

---

### Task 1: Deterministic Trade-Cycle Reconstruction

**Files:**
- Create: `ai-gateway/src/trading/history-contracts.ts`
- Create: `ai-gateway/src/trading/trade-cycle.ts`
- Test: `ai-gateway/test/trade-cycle.test.ts`

**Interfaces:**
- Consumes: normalized Binance fills and income events ordered or unordered by exchange time.
- Produces: `normalizeFill(raw: unknown): NormalizedFill`, `normalizeIncomeEvent(raw: unknown): NormalizedIncomeEvent`, and `reconstructTradeCycles(input: ReconstructionInput): TradeCycleDraft[]`.
- `TradeCycleDraft.stableKey` is `${connectionId}:${symbol}:${positionSide}:${openingTradeId}`; incomplete opening fragments have `status: "incomplete_opening_history"` and complete cycles have `status: "closed"`.

- [ ] **Step 1: Write failing reconstruction tests**

Add fixtures for one-way add/reduce/close, a reversal through zero, simultaneous `LONG`/`SHORT`, unordered duplicate fills, a truncated opening position, uniquely attributable funding, ambiguous funding, and a BNB fee without a USDT conversion. Assert exact quantities, weighted prices, realized PnL, USDT fees, funding, net PnL, stable keys, status, and `has_unconverted_fees`.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm.cmd --dir ai-gateway exec node --test test/trade-cycle.test.ts`

Expected: FAIL because `history-contracts.ts` and `trade-cycle.ts` do not exist.

- [ ] **Step 3: Implement the normalized contracts**

Define decimal-safe string inputs and finite-number conversion at the calculation boundary. Reject invalid IDs, symbols, sides, timestamps, negative quantities, and unsupported position sides with stable `binance_invalid_*` errors.

- [ ] **Step 4: Implement `reconstructTradeCycles`**

Sort by `(time, tradeId)`, deduplicate by `(symbol, tradeId)`, maintain independent `BOTH|LONG|SHORT` ledgers, split reversals at zero, exclude incomplete prefixes, attribute funding only when exactly one eligible cycle exists, and keep unconvertible assets as original-asset totals outside `netPnlUsdt`.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm.cmd --dir ai-gateway exec node --test test/trade-cycle.test.ts && pnpm.cmd --dir ai-gateway typecheck`

Expected: all trade-cycle tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add ai-gateway/src/trading/history-contracts.ts ai-gateway/src/trading/trade-cycle.ts ai-gateway/test/trade-cycle.test.ts
git commit -m "feat(trading): reconstruct deterministic trade cycles"
```

### Task 2: Binance History Pagination and Incremental Cursor

**Files:**
- Modify: `ai-gateway/src/trading/binance-futures.ts`
- Create: `ai-gateway/src/trading/history-fetcher.ts`
- Test: `ai-gateway/test/binance-history.test.ts`

**Interfaces:**
- Consumes: `BinanceFuturesClient`, `HistoryCursor`, `coverageStartMs`, and `endTimeMs`.
- Produces: `BinanceFuturesClient.userTrades(window: HistoryWindow): Promise<unknown[]>`, `BinanceFuturesClient.incomeHistory(window: HistoryWindow): Promise<unknown[]>`, and `fetchTradingHistory(input: HistoryFetchInput): Promise<HistoryFetchResult>`.
- `HistoryFetchResult` contains normalized fills/events, `coverageStartedAt`, `nextTradeCursor`, `nextIncomeCursor`, and `partialHistory`.

- [ ] **Step 1: Write failing pagination tests**

Assert signed `/fapi/v1/userTrades` and `/fapi/v1/income` requests, maximum seven-day windows, `limit=1000`, continued pages after full responses, overlap-safe cursor resume, deduplication, a hard 90-day start boundary, and propagation of Binance safe error codes.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm.cmd --dir ai-gateway exec node --test test/binance-history.test.ts`

Expected: FAIL because history methods are missing.

- [ ] **Step 3: Add the client methods and history fetcher**

Reuse the existing signed request path and timeout. Keep a one-millisecond inclusive overlap when resuming, then deduplicate by exchange IDs. Return `partialHistory: true` whenever the requested start predates available coverage or the first known cycle fragment is incomplete.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm.cmd --dir ai-gateway exec node --test test/binance-history.test.ts && pnpm.cmd --dir ai-gateway typecheck`

Expected: all Binance-history tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add ai-gateway/src/trading/binance-futures.ts ai-gateway/src/trading/history-fetcher.ts ai-gateway/test/binance-history.test.ts
git commit -m "feat(trading): fetch Binance trade history incrementally"
```

### Task 3: Private Trading Schema and Atomic Publication RPCs

**Files:**
- Create: `supabase/migrations/202611240001_automatic_trade_review.sql`
- Create: `tests/automatic-trade-review-postgres.test.mjs`

**Interfaces:**
- Consumes: `publish_binance_trading_sync(p_owner_id, p_connection_id, p_batch_id, p_captured_at, p_coverage_started_at, p_partial_history, p_trade_cursor, p_income_cursor, p_fills, p_income_events, p_cycles)`.
- Produces: private tables `trading_sync_cursors`, `trading_fills`, `trading_income_events`, `trading_trade_cycles`, and `trading_trade_reviews` plus RPCs `get_trade_review_dashboard`, `get_trade_review_cycle`, and `update_trade_review`.
- Dashboard RPC accepts `p_owner_id`, `p_range_start`, and validated `p_timezone`; review RPC accepts only `reason`, `plan_adherence`, `next_improvement`, `tags`, `planned_stop_price`, and `planned_risk_usdt`.

- [ ] **Step 1: Write the failing PGlite migration tests**

Create a minimal pre-migration schema, apply the migration, and assert composite ownership constraints, RLS/grants, idempotent fill upserts, stable cycle upserts, incomplete-cycle exclusion, private cross-owner denial helpers, narrow review writes, exact dashboard metrics, timezone calendar bucketing, and no new columns in `list_trading_leaderboard`.

- [ ] **Step 2: Add an intentional batch failure assertion**

Pass one invalid cycle in a batch and assert no fills/events/cycles/cursor changes survive; then retry the valid batch and assert one published generation.

- [ ] **Step 3: Run and verify failure**

Run: `node --test tests/automatic-trade-review-postgres.test.mjs`

Expected: FAIL because the migration does not exist.

- [ ] **Step 4: Implement additive tables, RLS, and RPCs**

Use composite `(id, owner_id)` ownership references to `exchange_connections`, service-role-only fact writes, authenticated owner reads, no browser table updates, and a security-definer `update_trade_review` that derives ownership from `auth.uid()`. Publish fills, events, cycles, and cursors in one transaction and mark older overlapping generations superseded without deleting reviewed stable cycle rows.

- [ ] **Step 5: Implement aggregate RPCs**

Return six headline metrics, equity and realized-PnL series, calendar rows, attribution rows, recent cycles, coverage timestamps, partial/unconverted flags, and sync status. Calculate max drawdown/TWR only from equity snapshots and exclude external transfers, incomplete cycles, unallocated funding, and unconverted fees according to the spec.

- [ ] **Step 6: Run migration tests**

Run: `node --test tests/automatic-trade-review-postgres.test.mjs tests/trading-leaderboard-postgres.test.mjs`

Expected: both suites PASS with the public leaderboard shape unchanged.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/202611240001_automatic_trade_review.sql tests/automatic-trade-review-postgres.test.mjs
git commit -m "feat(trading): add private automatic review storage"
```

### Task 4: Gateway Sync Orchestration and Private Review Routes

**Files:**
- Create: `ai-gateway/src/trading/history-service.ts`
- Modify: `ai-gateway/src/trading/leaderboard-service.ts`
- Modify: `ai-gateway/src/routes/gateway-api.ts`
- Modify: `ai-gateway/src/server.ts`
- Modify: `ai-gateway/src/trading-worker.ts`
- Create: `ai-gateway/test/trading-history-service.test.ts`
- Modify: `ai-gateway/test/trading-leaderboard.test.ts`
- Create: `apps/web/src/app/api/trading/[...path]/route.ts`
- Create: `apps/web/src/lib/trading/routes.test.ts`

**Interfaces:**
- Consumes: Tasks 1-3 history fetcher, reconstruction, and publish RPC.
- Produces: `BinanceHistoryService.sync(ownerId, force?)`, `dashboard(ownerId, range, timezone)`, `cycle(ownerId, cycleId)`, and `updateReview(ownerId, cycleId, input)`.
- Exposes authenticated gateway routes `GET /v1/user/trading-review/dashboard`, `GET /v1/user/trading-review/trades/:id`, `POST /v1/user/trading-review/trades/:id/review`, and the same paths through `/api/trading/*`.

- [ ] **Step 1: Write failing service tests**

Assert decrypted credentials never leave the service, concurrent manual/timer syncs respect the lease, successful history sync calls the atomic RPC once, a failed publish does not advance the cursor, retry reuses idempotent IDs, and dashboard/cycle routes always bind the authenticated owner.

- [ ] **Step 2: Write failing route allowlist tests**

Assert only the three exact review endpoints and methods proxy, POST rejects foreign origins and payloads over 16 KiB, and arbitrary cycle paths or query injection return 404/400.

- [ ] **Step 3: Run and verify failure**

Run: `pnpm.cmd --dir ai-gateway exec node --test test/trading-history-service.test.ts && pnpm.cmd --filter @wavekb/web exec vitest run src/lib/trading/routes.test.ts`

Expected: FAIL because the service and route do not exist.

- [ ] **Step 4: Implement orchestration and route bindings**

Reuse existing encrypted credentials and connection status. Fetch snapshot, external flow, fills, and income; reconstruct cycles; call one publish RPC; then return masked connection state. Extend `syncDue` so one timer refreshes both leaderboard equity and private review history without exposing private facts to leaderboard code.

- [ ] **Step 5: Run focused tests and typechecks**

Run: `pnpm.cmd --dir ai-gateway exec node --test test/trade-cycle.test.ts test/binance-history.test.ts test/trading-history-service.test.ts test/trading-leaderboard.test.ts && pnpm.cmd --dir ai-gateway typecheck && pnpm.cmd --filter @wavekb/web exec vitest run src/lib/trading/routes.test.ts`

Expected: all focused gateway/web route tests PASS and typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add ai-gateway/src ai-gateway/test apps/web/src/app/api/trading apps/web/src/lib/trading/routes.test.ts
git commit -m "feat(trading): publish private review history safely"
```

### Task 5: Automatic Workbench Dashboard

**Files:**
- Create: `packages/domain/src/trading-review.ts`
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/src/trading-review.test.ts`
- Create: `apps/web/src/lib/trading/review-server-repository.ts`
- Create: `apps/web/src/lib/trading/review-server-repository.test.ts`
- Create: `apps/web/src/components/trading-review-dashboard.tsx`
- Create: `apps/web/src/components/trading-review-dashboard.test.tsx`
- Modify: `apps/web/src/app/workbench/page.tsx`
- Modify: `apps/web/src/app/workbench/page.test.tsx`

**Interfaces:**
- Consumes: `get_trade_review_dashboard` and existing authenticated actor guard.
- Produces: `TradingReviewDashboard`, `TradingReviewCycleSummary`, `TradingCoverage`, `parseTradingReviewDashboard(value)`, and `getTradingReviewDashboard(ownerId, range, timezone)`.

- [ ] **Step 1: Write failing domain parser and repository tests**

Assert exact shape parsing, decimal strings remain lossless, unknown/missing metrics become `null`, foreign/private fields are discarded, supported ranges are `7d|30d|90d|all`, and invalid time zones fall back to `Asia/Shanghai`.

- [ ] **Step 2: Write failing dashboard component/page tests**

Cover unconnected, syncing, partial history, empty history, normal, and error states. Assert six headline metrics, coverage labels, equity/PnL summaries, calendar day assignment across midnight/DST, attribution, recent trade links, “部分费用未折算”, and absence of “新建分析”/“11 步”.

- [ ] **Step 3: Run and verify failure**

Run: `pnpm.cmd --filter @wavekb/domain test && pnpm.cmd --filter @wavekb/web exec vitest run src/lib/trading/review-server-repository.test.ts src/components/trading-review-dashboard.test.tsx src/app/workbench/page.test.tsx`

Expected: FAIL because the new domain/repository/component do not exist.

- [ ] **Step 4: Implement types, repository, and responsive dashboard**

Use server-side authenticated RPC reads. Render a connection state or real data only, six first-screen metrics, accessible SVG/semantic summaries, 7/30/90/all range links, calendar, attribution, and recent cycles. Keep private entries and historical analyses behind secondary “记录与历史分析” links, with no new legacy analysis CTA.

- [ ] **Step 5: Run tests, typecheck, and lint touched app**

Run: `pnpm.cmd --filter @wavekb/domain test && pnpm.cmd --filter @wavekb/web exec vitest run src/lib/trading/review-server-repository.test.ts src/components/trading-review-dashboard.test.tsx src/app/workbench/page.test.tsx && pnpm.cmd --filter @wavekb/web typecheck && pnpm.cmd --filter @wavekb/web lint`

Expected: focused tests PASS; typecheck and lint exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src apps/web/src/lib/trading apps/web/src/components/trading-review-dashboard* apps/web/src/app/workbench
git commit -m "feat(workbench): show automatic trading review dashboard"
```

### Task 6: One-Page Trade Review Editor

**Files:**
- Create: `apps/web/src/app/workbench/trades/[id]/page.tsx`
- Create: `apps/web/src/app/workbench/trades/[id]/page.test.tsx`
- Create: `apps/web/src/lib/trading/review-client.ts`
- Create: `apps/web/src/lib/trading/review-client.test.ts`
- Create: `apps/web/src/components/trade-review-editor.tsx`
- Create: `apps/web/src/components/trade-review-editor.test.tsx`

**Interfaces:**
- Consumes: Task 4 private route and Task 5 `TradingReviewCycle` type.
- Produces: `createReviewUpdate(input): TradeReviewUpdate`, `saveTradeReview(cycleId, input)`, and `<TradeReviewEditor cycle={cycle} />`.

- [ ] **Step 1: Write failing client validation tests**

Assert only the three subjective fields, tags, stop price, and planned risk are serialized; lengths/counts/numbers are bounded; automatic PnL/fee/funding/R/owner fields are rejected; retry preserves the same intended update.

- [ ] **Step 2: Write failing page/editor tests**

Assert read-only exchange facts, exactly three primary subjective controls, autosave status, plan-risk-derived R only when valid, unknown/estimated labels, mobile layout, owner-only not-found behavior, and no 11-step controls.

- [ ] **Step 3: Run and verify failure**

Run: `pnpm.cmd --filter @wavekb/web exec vitest run src/lib/trading/review-client.test.ts src/components/trade-review-editor.test.tsx 'src/app/workbench/trades/[id]/page.test.tsx'`

Expected: FAIL because the trade page/editor do not exist.

- [ ] **Step 4: Implement the editor and route**

Fetch the cycle server-side, render facts separately from user content, debounce autosave with an explicit pending/saved/error status, and never optimistically overwrite server-derived R or AI output. Use `KnowledgeScopeSelector` as the later AI slot without submitting AI yet.

- [ ] **Step 5: Run tests and app checks**

Run: `pnpm.cmd --filter @wavekb/web exec vitest run src/lib/trading/review-client.test.ts src/components/trade-review-editor.test.tsx 'src/app/workbench/trades/[id]/page.test.tsx' && pnpm.cmd --filter @wavekb/web typecheck && pnpm.cmd --filter @wavekb/web lint`

Expected: focused tests PASS; typecheck and lint exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/workbench/trades apps/web/src/lib/trading/review-client* apps/web/src/components/trade-review-editor*
git commit -m "feat(workbench): add concise per-trade review"
```

### Task 7: Knowledge-Grounded Trade Review AI

**Files:**
- Create: `supabase/migrations/202611240002_trade_review_ai.sql`
- Create: `ai-gateway/src/knowledge/trade-review-contracts.ts`
- Create: `ai-gateway/src/knowledge/trade-review-runtime.ts`
- Modify: `ai-gateway/src/routes/gateway-api.ts`
- Modify: `ai-gateway/src/server.ts`
- Modify: `ai-gateway/src/worker-main.ts`
- Create: `ai-gateway/test/trade-review-ai.test.ts`
- Create: `tests/trade-review-ai-postgres.test.mjs`
- Create: `apps/web/src/lib/trading/review-ai-client.ts`
- Modify: `apps/web/src/components/trade-review-editor.tsx`
- Modify: `apps/web/src/components/trade-review-editor.test.tsx`

**Interfaces:**
- Consumes: a closed owned trade cycle, optional review fields, and `{mode:"all"}|{mode:"single",book_id:PublishedBookId}`.
- Produces: `normalizeTradeReviewRequest`, `TradeReviewRuntime.run`, gateway `POST /v1/user/trading-review/trades/:id/ai-run`, and output `{fact_summary, discipline_observations, structure_hypotheses, knowledge_references, next_checklist, disclaimer}`.
- `ai_jobs` gains `trade_cycle_id`; exactly one of `analysis_id` or `trade_cycle_id` must be non-null.

- [ ] **Step 1: Write failing migration/contract tests**

Assert the XOR subject constraint, composite owner/cycle ownership, idempotent job keys, old `wave_analysis` compatibility, exact request keys, published-book validation, and rejection of open/incomplete/foreign cycles.

- [ ] **Step 2: Write failing runtime/worker tests**

Assert retrieval respects all/single-book scope, facts are deterministic and not model-rewritten, citations resolve to published units, unsupported certainty/trading instructions fail the rule gate, and the worker selects the trade runtime without requiring `analysis_id`.

- [ ] **Step 3: Run and verify failure**

Run: `node --test tests/trade-review-ai-postgres.test.mjs && pnpm.cmd --dir ai-gateway exec node --test test/trade-review-ai.test.ts`

Expected: FAIL because the AI migration/runtime do not exist.

- [ ] **Step 4: Implement the independent trade-review job path**

Add a separate normalizer, authorization query, prompt builder, output schema, knowledge retrieval call, rules gate, and worker branch. Preserve existing `wave_analysis` runtime behavior and membership/BYOK routing; never store raw credentials or unrestricted remote responses.

- [ ] **Step 5: Wire the editor AI controls and tests**

Submit only on explicit click, reuse `KnowledgeScopeSelector`, show queued/running/succeeded/failed states, render citations as links, separate model inference from facts, and leave user text untouched on failure or retry.

- [ ] **Step 6: Run focused and regression tests**

Run: `node --test tests/trade-review-ai-postgres.test.mjs && pnpm.cmd --dir ai-gateway exec node --test test/trade-review-ai.test.ts test/knowledge.test.ts test/worker-main.test.ts test/managed-ai.test.ts test/server-api.test.ts && pnpm.cmd --filter @wavekb/web exec vitest run src/components/trade-review-editor.test.tsx && pnpm.cmd --dir ai-gateway typecheck && pnpm.cmd --filter @wavekb/web typecheck`

Expected: AI gateway, editor, migration, and typechecks PASS; existing wave-analysis tests remain green.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/202611240002_trade_review_ai.sql tests/trade-review-ai-postgres.test.mjs ai-gateway/src ai-gateway/test apps/web/src/lib/trading/review-ai-client.ts apps/web/src/components/trade-review-editor*
git commit -m "feat(ai): add knowledge-grounded trade reviews"
```

### Task 8: Feature Cutover, Regression Verification, and Release Readiness

**Files:**
- Create: `apps/web/src/lib/trading/review-feature.ts`
- Create: `apps/web/src/lib/trading/review-feature.test.ts`
- Modify: `apps/web/src/app/workbench/page.tsx`
- Modify: `apps/web/src/app/workbench/analysis/new/page.tsx`
- Create: `apps/web/e2e/automatic-trade-review.spec.ts`
- Modify: `.env.example`
- Modify: `README.md`
- Create: `docs/reports/2026-11-24-automatic-trade-review-release.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: server-only `automaticTradeReviewEnabled(env): boolean`, production cutover instructions, and a release verification record.

- [ ] **Step 1: Write failing feature/cutover tests**

Assert the flag is server-only and defaults off before migration, enabled workbench uses the new dashboard, disabled mode preserves the current page, and `/workbench/analysis/new` redirects to `/workbench` only when the new feature is enabled while historical analysis pages remain readable.

- [ ] **Step 2: Add desktop/mobile/PWA E2E coverage**

Mock private gateway responses and verify connection, partial history, range switching, trade navigation, three-field autosave, AI scope selection, keyboard access, 390px viewport, and installed-display-mode layout.

- [ ] **Step 3: Implement feature flag and release documentation**

Document the order: additive migrations, dual-compatible gateway, timer/backfill, coverage audit, set `AUTOMATIC_TRADE_REVIEW_ENABLED=true`, web deployment, smoke test, and rollback by flag without deleting data.

- [ ] **Step 4: Run the complete verification matrix**

Run focused portable suites first:

```bash
node --test tests/automatic-trade-review-postgres.test.mjs tests/trade-review-ai-postgres.test.mjs tests/trading-leaderboard-postgres.test.mjs
pnpm.cmd --dir ai-gateway exec node --test test/trade-cycle.test.ts test/binance-history.test.ts test/trading-history-service.test.ts test/trading-leaderboard.test.ts test/trade-review-ai.test.ts test/knowledge.test.ts test/worker-main.test.ts test/managed-ai.test.ts test/server-api.test.ts
pnpm.cmd --filter @wavekb/domain test
pnpm.cmd --filter @wavekb/web test
pnpm.cmd -r typecheck
pnpm.cmd -r --if-present lint
pnpm.cmd --filter @wavekb/web build
pnpm.cmd --filter @wavekb/web test:e2e -- automatic-trade-review.spec.ts
```

Expected: all commands PASS. Also run `pnpm.cmd test`; record any Windows-only pre-existing POSIX/systemd failures separately and do not classify them as feature success.

- [ ] **Step 5: Perform production smoke checks before enabling the flag**

Verify one non-public test connection: credentials remain masked, 90-day backfill reaches a published cursor, dashboard totals reconcile to raw Binance facts, an incomplete first fragment is excluded, review autosave persists, AI cites the selected book, and the public leaderboard response contains no private fields.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/trading/review-feature* apps/web/src/app/workbench apps/web/e2e/automatic-trade-review.spec.ts .env.example README.md docs/reports/2026-11-24-automatic-trade-review-release.md
git commit -m "chore(trading): prepare automatic review release"
```
