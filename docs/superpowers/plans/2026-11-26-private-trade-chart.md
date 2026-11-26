# Private Fill-Level Trade Chart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static trade review view with a private, fill-level interactive candlestick chart that supports all five connected providers, per-fill notes/images, indicators, Fibonacci tools, and manual Elliott Wave drawings.

**Architecture:** Extend the existing trading provider contract with historical candle retrieval, persist an explicit cycle-to-fill allocation relation, and expose one owner-authenticated chart projection through the current Next.js-to-gateway proxy. Render the projection with a pinned `openalgo-charts` client-only adapter while WaveKB owns all persistent DTOs, validation, permissions, and degradation states.

**Tech Stack:** TypeScript, Node.js, Next.js 16, React 19, Supabase/Postgres RLS, Vitest, `node:test`, Playwright, Storybook, `openalgo-charts@2.7.5` (pin exact version after package/export audit).

**Spec:** [Interactive trade chart sharing design](../specs/2026-11-26-interactive-trade-chart-sharing-design.md), sections 5-10, 13-18.

## Global Constraints

- Complete [the baseline repair plan](./2026-11-26-test-baseline-repair.md) first.
- Read-only only: no order placement, modification, cancellation, position closing, copy trading, subscription, referral, or OpenAlgo backend.
- Browser code never calls an exchange directly and never receives exchange credentials or raw upstream responses.
- One visible marker per canonical fill; visual clustering may group markers only if the full fill list remains accessible.
- Preserve reversal allocations: one native fill may contribute a close allocation to one cycle and an open allocation to the next.
- Do not synthesize candles, interpolate gaps, or substitute a different venue silently.
- Persist WaveKB-owned, versioned DTOs; never store opaque internal state from the chart library.
- Elliott Wave tools are manual drawings only. No automatic wave count or investment recommendation.
- Keep the text review and AI review available below the chart.

## Review Focus

- Fill identity and allocation correctness across add/reduce/partial close/reversal cases.
- Provider-specific candle signing, symbol/timeframe mapping, pagination, ordering, and gap metadata.
- RLS and gateway ownership checks for chart state, annotations, and images.
- Dynamic import, teardown, resize, mobile/PWA gestures, keyboard fallback, and accessible fill list.
- Exact dependency/license audit and feature-flag rollback.

---

### Task 1: Audit and pin the chart engine behind a WaveKB adapter

**Files:**
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/src/lib/trading/chart-engine.ts`
- Create: `apps/web/src/lib/trading/chart-engine.test.ts`
- Create: `docs/licenses/openalgo-charts.md`

- [ ] Write a failing adapter test that imports only the WaveKB wrapper and asserts it exposes chart create/destroy, candle update, marker update, indicator, drawing, and viewport methods required by the design.
- [ ] Install exact `openalgo-charts@2.7.5` with pnpm; do not use a caret or range.
- [ ] Audit the installed package metadata, Apache-2.0 license, browser exports, React/Next compatibility, and the five required Elliott drawing identifiers: `elliott-impulse`, `elliott-correction`, `elliott-triangle`, `elliott-double-combo`, `elliott-triple-combo`.
- [ ] Record the audited exports and license notice in `docs/licenses/openalgo-charts.md`. If the installed exports differ, update the wrapper contract without expanding scope; do not import undocumented deep paths.
- [ ] Implement `chart-engine.ts` as the only application import boundary for the library. Keep it browser-only and expose a `destroy()` contract.
- [ ] Run `pnpm.cmd --filter @wavekb/web test -- chart-engine.test.ts` and `pnpm.cmd --filter @wavekb/web typecheck`.
- [ ] Commit: `build(web): pin openalgo chart engine`

### Task 2: Persist canonical cycle-to-fill allocations

**Files:**
- Create: `supabase/migrations/202611260001_trade_chart_private.sql`
- Create: `tests/trade-chart-private-postgres.test.mjs`
- Modify: `ai-gateway/src/trading/cycles.ts`
- Modify: `ai-gateway/test/trading-cycles.test.ts`
- Modify: `ai-gateway/src/trading/sync-service.ts`
- Modify: `ai-gateway/test/trading-sync-service.test.ts`

- [ ] Add failing cycle tests for add, reduce, partial close, full close, and reversal. Assert each reconstructed cycle returns ordered allocations `{ native_fill_id, quantity, role, sort_order }`; the reversal fill must appear in two cycles with complementary quantities and distinct roles.
- [ ] Extend `ReconstructedCycle` with allocations while retaining `fill_ids` for revision compatibility. Use decimal arithmetic already present in `cycles.ts`; never round through JavaScript `number`.
- [ ] Add a failing PGlite migration test for `trading_trade_cycle_fills` with the composite key, fill/cycle foreign keys, owner binding, allocation quantity/role checks, indexes, RLS enabled, and service-role-only writes.
- [ ] In the migration, extend `publish_exchange_sync_generation` so fills, cycles, revisions, and allocation rows are written in the same transaction/generation. Reject allocation rows whose fill owner/connection differs from the cycle.
- [ ] Update sync payload construction and tests to send allocations and to keep revision lineage stable after late fills.
- [ ] Run:

  ```powershell
  node --test tests/trade-chart-private-postgres.test.mjs tests/multi-exchange-trading-postgres.test.mjs
  node --test ai-gateway/test/trading-cycles.test.ts ai-gateway/test/trading-sync-service.test.ts
  ```

- [ ] Commit: `feat(trading): persist fill allocations per cycle`

### Task 3: Add private annotations, images, chart state, and candle cache schema

**Files:**
- Modify: `supabase/migrations/202611260001_trade_chart_private.sql`
- Modify: `tests/trade-chart-private-postgres.test.mjs`

- [ ] Add failing PGlite tests for:
  - `trading_fill_annotations` unique per owner/cycle/fill, body <= 5000, bounded tags, soft deletion, revision/remap status.
  - `trading_fill_annotation_images` owner-bound rows, maximum image count enforced by RPC, stable sort order.
  - `trading_chart_states` one owner/cycle state with `schema_version`, timeframe, viewport, indicators, drawings, and optimistic `updated_at`/version guard.
  - `trading_candle_cache` keyed by provider/native symbol/timeframe/open time, with source timestamps and coverage metadata.
- [ ] Add RLS tests proving owner A cannot select or mutate owner B's annotation, image, or chart state; authenticated clients must not write candle cache or allocation facts.
- [ ] Add RPC tests for upserting annotations/chart state with ownership checked server-side and size/count allowlists enforced.
- [ ] Add the private annotation storage bucket/policies using the repository's existing private-image pattern; allow only audited MIME types, size, owner prefix, and authenticated owner access.
- [ ] Add schema-version assertion coverage so deployment tests recognize `202611260001`.
- [ ] Run the migration test until it passes, then re-run all existing Postgres tests touched by schema-version behavior.
- [ ] Commit: `feat(db): add private trade chart state`

### Task 4: Define and validate candle/chart DTOs

**Files:**
- Modify: `ai-gateway/src/trading/providers/contracts.ts`
- Modify: `ai-gateway/test/trading-provider-contracts.test.ts`
- Create: `ai-gateway/src/trading/chart-contracts.ts`
- Create: `ai-gateway/test/trading-chart-contracts.test.ts`
- Modify: `packages/domain/src/trading-review.ts`
- Modify: `packages/domain/src/trading-review.test.ts`

- [ ] Write failing tests for canonical candles: provider, native symbol, normalized symbol, timeframe, UTC open/close times, OHLC strings, volume string/null, source, fetched time, final/partial status, and gap metadata.
- [ ] Extend `ProviderCapabilities` with explicit candle timeframes, maximum page/range limits, price basis (`trade | bid | ask | both`), and availability reason. Do not infer support from provider name in UI code.
- [ ] Add `fetchCandles(account, request)` to `TradingProviderAdapter` and update registry contract tests so an incomplete adapter cannot register.
- [ ] Define versioned WaveKB DTOs for `TradeChartProjection`, `FillMarker`, `ChartStateV1`, `IndicatorSpecV1`, and `DrawingSpecV1`; use strict allowlists and maximum counts/sizes.
- [ ] Validate timestamps/order/decimals without converting price or quantity through floating-point values at API boundaries.
- [ ] Run gateway and domain contract tests plus typecheck.
- [ ] Commit: `feat(trading): define chart and candle contracts`

### Task 5: Implement historical candles for Binance, OKX, Bybit, and Bitget

**Files:**
- Modify: `ai-gateway/src/trading/providers/binance.ts`
- Modify: `ai-gateway/test/binance-provider.test.ts`
- Modify: `ai-gateway/src/trading/providers/okx.ts`
- Modify: `ai-gateway/test/okx-provider.test.ts`
- Modify: `ai-gateway/src/trading/providers/bybit.ts`
- Modify: `ai-gateway/test/bybit-provider.test.ts`
- Modify: `ai-gateway/src/trading/providers/bitget.ts`
- Modify: `ai-gateway/test/bitget-provider.test.ts`

- [ ] For each provider, add failing fixture tests for timeframe/symbol mapping, exact signed request, pagination boundary, duplicate removal, ascending UTC order, partial current candle, upstream limit, HTTP/auth/rate-limit redaction, and an intentional historical gap.
- [ ] Reuse each adapter's existing authenticated request helper and credential envelope. If a provider offers a public candle endpoint, still call it from the gateway and attach the connection's provider/symbol evidence.
- [ ] Implement one provider at a time and run its test file before moving to the next.
- [ ] Bound all requests by the design's maximum 3,000 candles and abort/timeout rules; cache only canonical responses, never raw credential-bearing payloads.
- [ ] Run all four provider tests and `pnpm.cmd --dir ai-gateway typecheck`.
- [ ] Commit: `feat(trading): load crypto venue candles`

### Task 6: Implement signed Exness candles and coverage states

**Files:**
- Modify: `ai-gateway/src/trading/providers/exness.ts`
- Modify: `ai-gateway/test/exness-provider.test.ts`

- [ ] Add failing tests proving candle requests first resolve/cache the account access point from the configured Gateway Host and then sign the exact `/v1/market-data/accounts/:account_id/candles` path/query with an empty idempotency key.
- [ ] Cover bid/ask/both response normalization, timeframe mapping, dynamic server limits, access-point refresh, 401/403/429/503 mapping, and redaction of API key/private key/host internals.
- [ ] Implement `fetchCandles` with the existing Exness signing and access-point cache; do not guess a Gateway Host or reuse an example hostname.
- [ ] Surface unavailable candle capability as structured coverage metadata so the private review still renders fills/text rather than failing the whole page.
- [ ] Run Exness provider tests and the complete gateway test suite.
- [ ] Commit: `feat(trading): load signed exness candles`

### Task 7: Serve one owner-authenticated chart projection

**Files:**
- Modify: `ai-gateway/src/trading/workbench-service.ts`
- Modify: `ai-gateway/test/trading-workbench-service.test.ts`
- Modify: `ai-gateway/src/server.ts`
- Modify: `ai-gateway/test/server-api.test.ts`
- Modify: `apps/web/src/app/api/trading/[...path]/route.ts`
- Create: `apps/web/src/app/api/trading/[...path]/route.test.ts`
- Modify: `apps/web/src/lib/trading/workbench-repository.ts`
- Create: `apps/web/src/lib/trading/workbench-repository.test.ts`

- [ ] Add failing store/service tests that load the current cycle revision, allocation rows, canonical fills, annotations/images, chart state, and a bounded candle window. Reject stale/non-current cycles and cross-owner IDs.
- [ ] Add authenticated gateway routes:
  - `GET /v1/user/trading-trades/:id/chart?timeframe=&from=&to=`
  - `PUT /v1/user/trading-trades/:id/chart-state`
  - `PUT /v1/user/trading-trades/:id/fills/:fillId/annotation`
- [ ] Return explicit `coverage` and `warnings`; if candles are unavailable, return markers/fill list and a structured degraded state rather than fabricated bars.
- [ ] Extend the existing Next proxy allowlist and keep origin checks, 32 KiB body limit, bearer forwarding, `no-store`, and gateway-unavailable mapping.
- [ ] Add typed repository methods and verify no credential/raw-upstream field is present in serialized DTO fixtures.
- [ ] Run targeted gateway/web tests and both typechecks.
- [ ] Commit: `feat(api): expose private trade chart projection`

### Task 8: Build the fill-level chart and accessible fallback

**Files:**
- Create: `apps/web/src/components/trading/openalgo-trade-chart.tsx`
- Create: `apps/web/src/components/trading/openalgo-trade-chart.test.tsx`
- Create: `apps/web/src/components/trading/openalgo-trade-chart.stories.tsx`
- Create: `apps/web/src/components/trading/fill-list.tsx`
- Create: `apps/web/src/components/trading/fill-list.test.tsx`
- Modify: `apps/web/src/components/trading-trade-review.tsx`
- Modify: `apps/web/src/components/trading-trade-review.test.tsx`

- [ ] Add failing component tests for dynamic client-only creation, one marker per fill, clustered marker expansion, selection synchronization with the fill list, resize, and `destroy()` on unmount/reload.
- [ ] Render distinct open/add/reduce/close/reverse marker semantics and keep exact timestamp, price, allocated quantity, provider ID mask, and role in the accessible list.
- [ ] Use a dynamic import with SSR disabled at the trade page boundary. Show loading, empty, partial coverage, stale cache, rate-limit, and unavailable-provider states.
- [ ] Keep the current text facts, minimal review, reconciliation warning, and AI review below the new chart.
- [ ] Add keyboard navigation and a non-canvas accessible fill list; chart hover cannot be the sole way to inspect a trade.
- [ ] Add Storybook states for dense fills, long/short, reversal, missing candles, mobile width, and dark theme.
- [ ] Run component tests, Storybook build, web typecheck, and lint.
- [ ] Commit: `feat(web): render fill-level trade chart`

### Task 9: Add per-fill annotations, indicators, and drawing persistence

**Files:**
- Create: `apps/web/src/components/trading/fill-annotation-editor.tsx`
- Create: `apps/web/src/components/trading/fill-annotation-editor.test.tsx`
- Create: `apps/web/src/components/trading/chart-tool-panel.tsx`
- Create: `apps/web/src/components/trading/chart-tool-panel.test.tsx`
- Modify: `apps/web/src/components/trading/openalgo-trade-chart.tsx`
- Modify: `apps/web/src/lib/trading/workbench-repository.ts`

- [ ] Add failing annotation tests for autosave/debounce, stale revision conflict, tag limits, image MIME/size/count rejection, upload rollback, remap-needed state, and retry after uncertain network completion.
- [ ] Add failing tool-panel tests for searchable indicators, provider/data capability filtering, duplicate indicator instances, Fibonacci tools, trend/horizontal/rectangle/text/risk-reward tools, and all five Elliott tools.
- [ ] Implement a strict allowlist mapping UI choices to `IndicatorSpecV1`/`DrawingSpecV1`; reject arbitrary functions, executable code, HTML, unknown tools, non-finite coordinates, and oversized state.
- [ ] Persist only WaveKB DTOs through the chart-state endpoint using optimistic version checks. Rehydrate via the adapter and ignore unknown future fields safely.
- [ ] Ensure indicator computation failures disable only that indicator and do not remove candles, markers, notes, or other drawings.
- [ ] Run all new component/repository tests and web typecheck.
- [ ] Commit: `feat(web): persist chart notes and studies`

### Task 10: Verify mobile/PWA behavior and release behind a flag

**Files:**
- Modify: `apps/web/e2e/trading-workbench.spec.ts`
- Create: `apps/web/e2e/trade-chart.spec.ts`
- Modify: `ai-gateway/src/config.ts`
- Modify: `ai-gateway/test/config.test.ts`
- Modify: `apps/web/src/lib/trading/config.ts`
- Modify: `apps/web/src/lib/trading/config.test.ts`
- Modify: `.github/workflows/deploy-next-production.yml`
- Create: `docs/verification/2026-11-26-private-trade-chart.md`

- [ ] Add E2E fixtures for a dense multi-fill cycle, reversal, all five providers, missing candles, annotations/images, indicators, Fibonacci, Elliott drawings, reload persistence, and a non-owner request.
- [ ] Test desktop Chromium plus the repository's mobile/PWA project: pinch/scroll arbitration, bottom-sheet controls, 44px targets, portrait/landscape resize, offline shell/degraded message, and no horizontal page overflow.
- [ ] Add `TRADING_FILL_CHART_ENABLED` to gateway/public config. Disabled behavior must return the existing text review with no schema rollback required.
- [ ] Run `pnpm.cmd test`, `pnpm.cmd typecheck`, `pnpm.cmd lint`, `pnpm.cmd --filter @wavekb/web storybook:build`, `pnpm.cmd --filter @wavekb/web build`, and targeted Playwright specs.
- [ ] Record command outputs, bundle impact, 3,000-candle render timing, API p95 from a staging smoke, and rollback steps in the verification note.
- [ ] Deploy migration/gateway/web to staging, verify all providers using sanitized fixtures or designated test accounts, then enable the flag for internal UIDs before public rollout.
- [ ] Commit: `feat: release private fill-level trade chart`

## Completion Gate

- Every canonical fill is inspectable on the correct provider candle timeline, including reversal allocations.
- Notes, tags, images, indicators, Fibonacci, and five manual Elliott tools survive reload and are private by RLS.
- No browser request reaches an exchange; no API credential or raw upstream response reaches the browser or logs.
- Missing/gapped/rate-limited candles are disclosed and never fabricated.
- Desktop, mobile, and iOS PWA flows pass accessibility and lifecycle tests.
- The full repository suite is green and the feature can be disabled without data loss.
