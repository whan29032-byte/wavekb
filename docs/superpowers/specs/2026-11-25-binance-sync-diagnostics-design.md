# Binance Sync Diagnostics Design

## Context

WaveKB currently records a sanitized `last_error_code` when an exchange synchronization fails. The workbench account manager does not refresh the connection after a failed manual synchronization, does not translate most Binance codes, and renders the card status from stale pre-request state. This allows the account card to say `连接正常` while the dashboard already reports a failed synchronization.

Some fixed Binance provider error codes are also absent from the gateway route allowlist. Those codes are converted to `request_failed`, which prevents the web client from giving an actionable explanation even though the provider has already removed upstream messages and credential material.

## Goals

- Preserve every fixed, sanitized Binance failure code that a supported adapter can emit while continuing to suppress raw upstream errors.
- After a manual synchronization attempt, reload the affected owner's connection list so the account card reflects persisted status.
- Distinguish connection availability from synchronization health. A failed synchronization must be labeled `同步异常`, not `连接正常`.
- Tell the account owner what happened, what data remains visible, and the next recovery action.
- Allow an `error` connection to retry manual synchronization without forcing credential replacement first.
- Keep the existing workbench, exchange connection, ranking, credential storage, and database contracts unchanged.

## Non-goals

- Do not expose Binance response bodies, API keys, secrets, IP addresses, or credential envelopes.
- Do not change Binance permissions, create new credentials, or automatically rotate credentials.
- Do not change synchronization history windows, accounting calculations, leaderboard rules, or database migrations.
- Do not add a new visual system or runtime dependency.

## Backend contract

The gateway will maintain one fixed registry of public Binance error codes. Both authenticated and general route failure sanitizers may return a code only when it is in that registry or in their existing fixed allowlist. Unknown errors still collapse to the existing generic failure code.

The registry covers authentication/signature failures, clock skew, rate limiting, availability, read-only enforcement, unsupported account modes/products, bounded-history failures, and fixed schema validation failures emitted by the current Binance client and adapter.

The manual sync route keeps its existing HTTP status behavior. It returns only `{ error: <safe-code> }` on failure; raw causes and provider messages never cross the boundary.

## Frontend behavior

The account manager will use a shared exchange error translator. Known Binance codes receive concise Chinese guidance. Fixed provider-shape failures share a safe fallback that includes a diagnostic code but not an upstream message.

After a manual sync succeeds or fails, the manager reloads `/api/exchange/connections`. This makes `status`, `last_error_code`, and `last_synced_at` authoritative rather than guessing locally. If the refresh itself fails, the original sync error remains visible.

An account with `status === "error"` or a non-empty `last_error_code` renders:

- status text `同步异常` with a warning icon and semantic warning styling;
- a card-level explanation derived from `last_error_code`;
- `当前保留上次完整数据`;
- the last successful synchronization time, or `尚未成功同步`;
- an enabled `立即同步` action for retry.

Disabled/deleting connections retain their existing behavior. Public ranking controls remain unavailable while synchronization is unhealthy.

## Accessibility and visual rules

- Reuse existing Button, FieldMessage, warning/destructive semantic tokens, spacing, and radius rules.
- Status is communicated with icon and text, not color alone.
- Error detail is ordinary readable text and remains available without hover.
- Existing keyboard-accessible buttons and focus styles remain unchanged.
- No fixed height is added, so long Chinese guidance can wrap at narrow widths.

## Testing

- Gateway route tests prove representative Binance codes survive sanitization and a raw cause does not.
- Error translator tests cover permission, signature, clock, rate-limit, unsupported-mode, and provider-data categories.
- Component tests prove an existing failed connection renders `同步异常`, displays the last successful time, and permits retry.
- Component tests prove a failed manual sync triggers a connection reload and replaces stale `连接正常` state.
- Run targeted tests first, then gateway/web typecheck, lint, complete test suites, and production builds.

## Deployment and rollback

Deploy backend first so the frontend can receive the expanded safe-code set, then deploy the frontend. Rollback is the inverse application release; there is no schema change or data migration.
