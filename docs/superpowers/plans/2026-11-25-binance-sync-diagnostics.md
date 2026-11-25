# Binance Sync Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Binance synchronization failures safe, specific, retryable, and consistent across the gateway, account card, and workbench dashboard.

**Architecture:** Add one fixed server-side registry for public Binance error codes and use it from both route sanitizers. Add a client-side error translator, then make the account manager reload persisted connection state after every manual synchronization attempt and render synchronization health separately from connectivity.

**Tech Stack:** Node.js 22+, TypeScript, Next.js 16, React 19, Vitest, Testing Library, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-25-binance-sync-diagnostics-design.md`

## Global Constraints

- Never return or render Binance response bodies, API keys, secrets, credential envelopes, IP addresses, or raw error causes.
- Preserve existing HTTP statuses, exchange connection APIs, database schema, workbench calculations, and leaderboard rules.
- Reuse existing semantic tokens and UI components; add no dependency, random color, radius, or spacing value.
- An unhealthy account remains manually retryable and continues to show the last complete dataset.
- Unknown errors retain the generic failure behavior.

## Review Focus

- A known Binance error must survive route sanitization, while an unknown or raw error must not.
- A failed sync followed by a failed connection refresh must retain the original actionable error.
- A persisted `last_error_code` on an otherwise `active` row must still render `同步异常`.
- An `error` connection must allow manual retry but must not allow joining the public leaderboard.
- A connection that has never synchronized must say `尚未成功同步` rather than invent a time or zero value.

---

### Task 1: Preserve safe Binance synchronization errors

**Files:**
- Create: `ai-gateway/src/trading/provider-error-codes.ts`
- Modify: `ai-gateway/src/server.ts`
- Test: `ai-gateway/test/server-api.test.ts`

**Interfaces:**
- Produces: `isPublicTradingProviderError(code: string): boolean`
- Consumes: fixed error messages emitted by `binance-futures.ts` and `providers/binance.ts`

- [ ] **Step 1: Write the failing route sanitization test**

Add a table-driven test named `manual sync preserves fixed Binance errors without exposing raw causes`. Cover `binance_rate_limited`, `binance_trading_permission_not_allowed`, and `binance_invalid_history_payload`, assert their HTTP statuses and `{ error: code }`, and assert a private cause string is absent.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --dir ai-gateway exec node --test --test-name-pattern="manual sync preserves fixed Binance errors" test/server-api.test.ts`

Expected: FAIL because at least one code is returned as `request_failed`.

- [ ] **Step 3: Implement the fixed public provider-code registry**

Create `isPublicTradingProviderError(code: string): boolean` with the complete current Binance fixed-code set. Import it in `server.ts` and accept it in both `authFailure` and `routeFailure` without changing unknown-error fallbacks.

- [ ] **Step 4: Verify GREEN and gateway suite**

Run: `pnpm --dir ai-gateway exec node --test --test-name-pattern="manual sync preserves fixed Binance errors" test/server-api.test.ts`

Expected: PASS.

Run: `pnpm --dir ai-gateway test`

Expected: all gateway tests PASS.

- [ ] **Step 5: Commit**

```bash
git add ai-gateway/src/trading/provider-error-codes.ts ai-gateway/src/server.ts ai-gateway/test/server-api.test.ts
git commit -m "fix(trading): preserve safe Binance sync errors"
```

### Task 2: Render and recover persisted synchronization health

**Files:**
- Create: `apps/web/src/lib/trading/exchange-errors.ts`
- Create: `apps/web/src/lib/trading/exchange-errors.test.ts`
- Modify: `apps/web/src/components/exchange-account-manager.tsx`
- Modify: `apps/web/src/components/exchange-account-manager.test.tsx`

**Interfaces:**
- Consumes: safe error strings returned by Task 1 and persisted `Connection.last_error_code`
- Produces: `exchangeErrorMessage(code: string): string`

- [ ] **Step 1: Write failing translator tests**

Add table-driven tests for Binance clock skew, signature, permission, rate-limit, unsupported account mode, and provider-data failures. Assert the generic fallback for an unknown error does not echo the unknown input.

- [ ] **Step 2: Write failing component tests**

Add tests proving: an `active` connection with `last_error_code` renders `同步异常`, last successful time, stale-data explanation, and an enabled `立即同步`; a manual sync failure reloads `/api/exchange/connections`, replaces stale card state, and keeps the actionable sync error visible.

- [ ] **Step 3: Run the focused tests and verify RED**

Run: `pnpm --filter @wavekb/web test -- src/lib/trading/exchange-errors.test.ts src/components/exchange-account-manager.test.tsx`

Expected: FAIL because the translator and persisted error-state UI do not exist.

- [ ] **Step 4: Implement the minimal client behavior**

Create `exchangeErrorMessage`, reuse it from the account manager, add a reusable connection fetch function, refresh after manual sync success/failure, render semantic warning state and last-success copy, and allow retry for `active` or `error` connections.

- [ ] **Step 5: Verify GREEN and web suite**

Run: `pnpm --filter @wavekb/web test -- src/lib/trading/exchange-errors.test.ts src/components/exchange-account-manager.test.tsx`

Expected: PASS.

Run: `pnpm --filter @wavekb/web test`

Expected: all web tests PASS, with any pre-existing environment failure reported by name.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/trading/exchange-errors.ts apps/web/src/lib/trading/exchange-errors.test.ts apps/web/src/components/exchange-account-manager.tsx apps/web/src/components/exchange-account-manager.test.tsx
git commit -m "fix(web): explain and refresh exchange sync failures"
```

### Task 3: Verify, document, and prepare production release

**Files:**
- Modify: `docs/design-system/ACCEPTANCE_REPORT.md`

**Interfaces:**
- Consumes: Task 1 gateway contract and Task 2 rendered state
- Produces: reproducible acceptance evidence and deployable commits

- [ ] **Step 1: Run complete static and build verification**

Run: `pnpm typecheck`

Run: `pnpm lint`

Run: `pnpm test`

Run: `pnpm build`

Expected: each command exits 0; any unrelated pre-existing failure is reported before release.

- [ ] **Step 2: Update the acceptance report**

Append a dated Binance synchronization diagnostics section recording automated results, the account-card states covered, and any browser/authenticated-production checks that remain BLOCKED or NOT TESTED.

- [ ] **Step 3: Commit documentation**

```bash
git add docs/design-system/ACCEPTANCE_REPORT.md docs/superpowers/specs/2026-11-25-binance-sync-diagnostics-design.md docs/superpowers/plans/2026-11-25-binance-sync-diagnostics.md
git commit -m "docs: record Binance sync diagnostics acceptance"
```

- [ ] **Step 4: Release in dependency order**

Push the feature branch, fast-forward `main` only if it has not diverged, deploy the backend first, deploy the frontend second, and verify both deployment runs plus `https://wavekb.com/api/health` against the released commit.
