# WaveKB TradeX Live Market Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In WaveKB, show official live Binance USDⓈ-M candles via TradeX, overlay every fill of a selected trade, and offer the existing private note and public snapshot workflows.

**Architecture:** A pinned TradeX fork provides public candles and the Vela chart, on a separate origin. WaveKB owns access, private projections, annotations, and publish/preview. Only an explicit chart-marker contract crosses the iframe boundary; public snapshots remain fixed WaveKB data, not a reference to the live frame.

**Tech Stack:** TradeX Vela and web feed adapter, Binance public REST and WebSocket, Next.js 16, TypeScript/Vitest, Playwright.

**Spec:** [TradeX live market design](../specs/2026-11-28-tradex-live-market-design.md) and [existing sharing spec](../specs/2026-11-26-interactive-trade-chart-sharing-design.md).

## Global Constraints

- First feed: Binance USDⓈ-M trade-price candles. Unsupported providers fall back to the original review entry, never to an approximate symbol.
- Upstream baseline: TradeX `f8532c31af5060ee4dbafcce11fef0ea8f984aeb`. The chart deployment exposes its matching source and required attribution; secrets and customer records are not source artifacts.
- No ordering, brokerage credential inputs, user-supplied scripts, MT5 or off-site account access in the site integration.
- `WORKBENCH_LIVE_MARKET_ORIGIN` is server-side and absent by default. Pilot membership uses the existing authenticated chart-availability policy; deployment does not enable pilot or full access by default. Do not open a user's desktop.
- Read the WaveKB design-system files and relevant local Next.js 16 guidance before UI/route changes. Run lint/typecheck, test and build; record the acceptance status.

## Review Focus

- Public stream has a socket but no valid ticks → show reconnecting or stale, not live (task 1).
- A tick races a historical backfill or belongs to the prior symbol/timeframe → no duplicate bars or stale repaint (task 1).
- Forged frame message, chart source not configured, or frame reload → no leaked markers, credentials or unauthorized side effects (task 2).
- Multiple fills share a time bucket or the chart product differs → keep each fill individually selectable; mismatched overlays are empty (task 3).
- A guest reads the published body or chart endpoint → disabled values absent in the actual response, and later private edits do not rewrite it (task 4).

---

### Task 1: Ship a standalone tested chart preview (not a production release)

**Files (standalone TradeX checkout):** `hub/web/feeds_web.js`, `hub/vela.html`, new `hub/tests/wavekb-live-feed.test.mjs`, `NOTICE`, new `docs/WAVEKB_LIVE_MARKET.md`.

**Interfaces:** Use the upstream Binance `history(ticker, tf, limit, toMs)` and `live(ticker, tf, onBar, onStatus)` feed contract. The chart accepts the upstream symbol convention `BINF_BTCUSDT`; normalized periods and session state are internal to the fork.

- [ ] Add tests `marks the stream live only after a valid candle`, `replaces a forming candle and appends the next`, `backfills without replacing a newer live bar`, `ignores ticks and backfills from a disposed subscription`. Build input fixtures with official frame shape; set the test clock where needed.
- [ ] Run `node --test hub/tests/wavekb-live-feed.test.mjs` and verify the missing/incorrect behavior.
- [ ] Make the smallest changes to the pinned adapter/workspace behavior needed to pass. Keep the market closed/unavailable state explicit; keep standalone HTML and toolbars buildable. Remove account/remote endpoint/script entry points from the WaveKB entry without touching the upstream release data.
- [ ] Run the feed suite again, `python scripts/build_web.py`, and a headless preview that opens a real Binance USDⓈ-M contract, observes two updates to one candle and a rollover, and records a source-license entry. If only an upstream error is observable, mark live preview blocked; do not substitute fixtures for the live acceptance check.
- [ ] Commit the fork as `feat: prepare TradeX WaveKB live market workspace` once the checks pass. Do not publish the fork or preview without the agreed source and deployment setup.

### Task 2: Add the pilot-gated workbench route and chart boundary

**Files (WaveKB):** new `apps/web/src/app/workbench/market/page.tsx`, `apps/web/src/components/trading/tradex-market-frame.tsx`, `apps/web/src/lib/trading/tradex-bridge.ts`; modify `apps/web/src/lib/trading/config.ts`, `apps/web/src/components/trading-workbench-dashboard.tsx`, and the site's CSP if a frame allowlist is present. Tests: new `apps/web/src/lib/trading/tradex-bridge.test.ts`, `apps/web/src/components/trading/tradex-market-frame.test.tsx`.

**Interfaces:** `parseTradeXOrigin(value: string | undefined): URL | null`; strict envelope `{ v: 1, type, session, ... }`. Child sends `ready { epoch }`, then `marker-selected { marker }`; parent sends `initialize { epoch, session, market }`, then `set-markers { markers }`. `market` is `{ provider: "binance", product: "usdt_perpetual", symbol: string, timeframe: TradeChartTimeframe }`; `marker` values are ephemeral. Accept messages only when frame identity, exact origin, schema and established session match. Initial navigation carries no trade identifiers.

- [ ] Test that a non-HTTPS/malformed origin is rejected, a forged `ready` from another window or origin cannot initialize the frame, a prior session message is ignored on reload, and no unauthenticated/non-pilot direct route access creates a frame.
- [ ] Run `pnpm --filter @wavekb/web test src/lib/trading/tradex-bridge.test.ts src/components/trading/tradex-market-frame.test.tsx` and verify failures.
- [ ] Implement the route and frame gated on `requireActiveMember`, the existing verified pilot availability, and valid server config. Use an explicit frame sandbox policy and no referrer; source origin is fixed across messages. Keep dashboard behavior unchanged outside the pilot.
- [ ] Run the focused tests and `pnpm --filter @wavekb/web typecheck`; commit `feat: add gated TradeX market workspace`.

### Task 3: Attach private fills and notes

**Files (WaveKB):** modify `apps/web/src/components/trading-trade-review.tsx` and the new frame integration; new `apps/web/src/lib/trading/tradex-fill-markers.ts` and `.test.ts`. **Files (fork):** new `hub/wavekb_bridge.js`, `hub/tests/wavekb_overlay.test.mjs`, and `hub/vela.html`.

**Interfaces:** new `toTradeXMarkers(market: TradeXMarket, projection: TradeChartProjection): TradeXMarker[]` where `TradeXMarker` contains only `{ marker: string, timestamp: string, price: string, role: string }`. `getTradeChart` and `saveTradeFillAnnotation` remain WaveKB-only. Match provider, product and canonical symbol exactly. Keep ID-to-fill mapping in the parent; session IDs alone confer no data access.

- [ ] Test that no markers appear for a different provider/product/symbol; each same-candle fill gets its own selectable ID and exact price/time; toggling off resets only the overlay. Assert that bridge data cannot carry quantities, amounts, API/account IDs or note bodies.
- [ ] Run the new marker tests and fork overlay tests; verify they fail before implementation.
- [ ] Connect the existing authenticated projection and note editor to the Vela overlay. Trade-to-market navigation opens the same contract in live mode; an old selected trade correctly locates its history without disconnecting the live stream. The marker list provides access on touch devices and for keyboard users.
- [ ] Rerun the marker, frame and review suites plus `node --test hub/tests/wavekb_overlay.test.mjs` in the fork; commit `feat: show private trade fills on the live chart`.

### Task 4: Preserve the WaveKB public snapshot and prove release readiness

**Files (WaveKB):** reuse `apps/web/src/components/trading/share-strategy-dialog.tsx`, `ai-gateway/src/trading/chart-sharing-service.ts` and guest endpoint; extend `apps/web/e2e/trading-workbench.spec.ts` and add a guest privacy case to `apps/web/src/app/api/public-strategies/[id]/route.test.ts` as needed. Record the evidence in `docs/design-system/ACCEPTANCE_REPORT.md`.

**Interfaces:** Existing `previewPublicStrategy` → `publishPublicStrategy` → public post snapshot. Sharing uses an exact trade-cycle ID, timeframe and historical range; it never posts the frame state, unsaved drawing or live feed. Unsupported live-chart studies/drawings are explained before preview; use the existing versioned drawing/indicator preparation only for supported items.

- [ ] Extend the flow test: click share from the real chart context, verify pending preview displays the selected historical window, verify `show_quantity` and `show_absolute_pnl` are false by default, publish a test snapshot, then assert those fields and private notes are absent in the guest response and later saved note edits do not mutate the snapshot. Assert unauthenticated writes fail and non-pilot charts remain unchanged.
- [ ] Run the focused Playwright and public strategy tests, and verify the new live-entry scenario fails without wiring.
- [ ] Connect only the existing snapshot dialog. Do not add a live stream route to the public post.
- [ ] Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` and `pnpm --filter @wavekb/web test:e2e e2e/trading-workbench.spec.ts`. Run a headless staging session with consented Binance test fills, record realtime rollover and forced network reconnection; compare every fill against the authenticated projection. Verify a separate unauthenticated session and iOS/desktop viewport. Block production if any privacy, live-market, source, connectivity or baseline release gate is unresolved.
- [ ] Commit `feat: share a reviewed chart snapshot from the live market workspace`. Pilot acceptance precedes any public feature roll-out.
