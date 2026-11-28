# Public Strategy Snapshot Sharing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user preview and publish an immutable public copy of a private trade chart, choose whether quantity and absolute P&L are disclosed, and let the community comment on individual fill markers safely.

**Architecture:** Build the public chart exclusively from a server-side privacy projection of the private chart. A short-lived preview token binds the exact redacted payload digest to the user's choices; publication stores an immutable semantic snapshot and links it to the existing community post. Existing post comments gain an optional validated marker key, so identity, replies, reporting, moderation, and notifications remain on the current community system.

**Tech Stack:** TypeScript, Node.js, Next.js 16, React 19, Supabase/Postgres RLS/RPC, Vitest, `node:test`, PGlite, Playwright, existing OpenAlgo chart adapter.

**Spec:** [Interactive trade chart sharing design](../specs/2026-11-26-interactive-trade-chart-sharing-design.md), sections 7.5-7.7, 11-18.

## Global Constraints

- Complete the baseline and private-chart plans first.
- Quantity and absolute P&L are independent explicit opt-ins and default to hidden.
- The preview bytes/digest and the persisted public snapshot must match; publish must reject stale, changed, expired, replayed, or cross-user tokens.
- Public data never contains account name/ID, connection ID, balances, equity, leverage, credential identifiers, API material, raw provider payloads, private annotation images, or hidden numeric derivatives.
- Price return is always labeled as price return, not account ROI; it excludes fees, funding, swap, dividends, and leverage.
- Published snapshots are immutable. Edits create a new snapshot/version; they never mutate historical public content silently.
- Public readers cannot request candles beyond the stored timeframe/range or switch to a different timeframe.
- Marker comments reuse current moderation, report, block, reply, and notification behavior.

## Review Focus

- Field-by-field privacy projection and inference resistance for all four visibility combinations.
- Digest/token binding, transaction boundaries, idempotency, replay prevention, and immutable storage.
- RLS: public reads only published snapshots; private source IDs remain service-side.
- Semantic snapshot reproducibility: stored candles, markers, drawings, and computed indicator series do not drift with future market/library changes.
- Comment marker validation and compatibility with ordinary comments/replies.

---

### Task 1: Add immutable public snapshot and preview-token schema

**Files:**
- Create: `supabase/migrations/202611260002_public_strategy_snapshots.sql`
- Create: `tests/public-strategy-snapshots-postgres.test.mjs`

- [ ] Write failing PGlite tests for `trading_chart_share_previews`, `public_strategy_snapshots`, and the private source-link table described by the spec.
- [ ] Require snapshot schema version, author, post, provider/symbol labels, timeframe/range, canonical candles, public marker keys, redacted markers, selected drawings, stored indicator series, coverage metadata, visibility flags, price return, digest, and created timestamp.
- [ ] Keep private cycle/connection/fill IDs out of the public row. Store any source linkage in a service-role-only table with RLS and grants that authenticated/anon cannot select.
- [ ] Add one-time preview token hash, author, projection digest, visibility flags, expiry, consumed timestamp, and idempotency key. Never store the raw bearer token.
- [ ] Enforce immutability with grants/RLS and a trigger that rejects updates to semantic snapshot columns. Allow only documented lifecycle state changes such as unpublish/tombstone.
- [ ] Extend `post_comments` with nullable `marker_key`; constrain format/length and preserve ordinary comments/replies.
- [ ] Add indexes for post lookup, author history, active preview expiry, and `(post_id, marker_key, created_at)` comments.
- [ ] Run the new PGlite test and affected community/trading migration tests.
- [ ] Commit: `feat(db): add immutable public strategy snapshots`

### Task 2: Implement the privacy projector as a pure, exhaustively tested module

**Files:**
- Create: `ai-gateway/src/trading/public-chart-projection.ts`
- Create: `ai-gateway/test/public-chart-projection.test.ts`
- Modify: `ai-gateway/src/trading/chart-contracts.ts`

- [ ] Create fixtures containing every sensitive field class: account/connection IDs, provider native IDs, quantities, fees, funding/swap, realized/net/absolute P&L, annotations, image paths, indicator configs, drawing text, and candle metadata.
- [ ] Add table-driven failing tests for all four combinations of `show_quantity` and `show_absolute_pnl`.
- [ ] Assert hidden quantity removes quantity, notional, size-derived labels, position-size drawing values, and any tooltip/accessibility text that could disclose it.
- [ ] Assert hidden absolute P&L removes realized/net P&L, fees, funding/swap/dividends, currency totals, balance/equity context, and any indicator/drawing metadata derived from account money.
- [ ] Keep only sanitized public note text/tags explicitly selected for sharing; exclude private annotation images by default.
- [ ] Compute and label price return from public entry/exit prices only. Add a warning when exactly one of quantity/absolute P&L is shown because the other may be inferable.
- [ ] Canonicalize JSON deterministically and hash the exact projection bytes. Reject unknown schema versions, non-finite values, oversized payloads, more than 3,000 candles, and drawings/indicators outside the allowlist.
- [ ] Run projection tests and gateway typecheck.
- [ ] Commit: `feat(trading): build privacy-safe public projections`

### Task 3: Create exact preview and transactional publish services

**Files:**
- Create: `ai-gateway/src/trading/chart-sharing-service.ts`
- Create: `ai-gateway/test/chart-sharing-service.test.ts`
- Modify: `ai-gateway/src/trading/workbench-service.ts`

- [ ] Add failing service tests for owner-only source loading, current revision checks, selected indicator/drawing filtering, server-side projection, token hashing, short expiry, and exact preview payload return.
- [ ] Add failing publish tests for valid token, expired token, replay, wrong owner, changed visibility flags, changed cycle revision, changed digest, duplicate idempotency key, post creation failure, and concurrent double-submit.
- [ ] Implement preview generation from server-loaded private state only; never trust client-supplied candles, markers, quantities, P&L, or digest.
- [ ] During publish, lock/consume the preview token and atomically create the immutable snapshot, source link, and community post association through one security-definer RPC. Return the existing post ID on an idempotent retry.
- [ ] Store computed indicator output series in the snapshot, not only configs, so later library upgrades cannot change historical public charts.
- [ ] Add deletion semantics from the spec: deleting/unpublishing the public post removes public access, preserves or tombstones audit/source rows per policy, and does not delete the private review.
- [ ] Run service and Postgres tests.
- [ ] Commit: `feat(trading): create exact share preview and publish flow`

### Task 4: Expose authenticated preview/publish and public read APIs

**Files:**
- Modify: `ai-gateway/src/server.ts`
- Modify: `ai-gateway/test/server-api.test.ts`
- Modify: `apps/web/src/app/api/trading/[...path]/route.ts`
- Modify: `apps/web/src/app/api/trading/[...path]/route.test.ts`
- Modify: `apps/web/src/lib/trading/workbench-repository.ts`
- Modify: `apps/web/src/lib/trading/workbench-repository.test.ts`
- Create: `apps/web/src/app/api/public-strategies/[id]/route.ts`
- Create: `apps/web/src/app/api/public-strategies/[id]/route.test.ts`

- [ ] Add authenticated gateway routes:
  - `POST /v1/user/trading-trades/:id/share-preview`
  - `POST /v1/user/trading-trades/:id/share-publish`
- [ ] Add public read route `GET /v1/public/strategy-snapshots/:id` returning only the public DTO with immutable cache/ETag headers keyed by digest.
- [ ] Extend the Next private proxy method/path allowlist, origin validation, body limit, and no-store behavior. Add a separate public proxy that forwards no user token or cookies and allowlists exactly one GET shape.
- [ ] Add serialized-response tests asserting banned sensitive key names and fixture values never appear recursively.
- [ ] Add typed repository methods and distinct errors for stale preview, expired token, already consumed, privacy validation, and gateway unavailable.
- [ ] Run gateway, proxy, and repository tests plus typechecks.
- [ ] Commit: `feat(api): expose strategy snapshot sharing`

### Task 5: Build the privacy preview and publish UI

**Files:**
- Create: `apps/web/src/components/trading/share-strategy-dialog.tsx`
- Create: `apps/web/src/components/trading/share-strategy-dialog.test.tsx`
- Create: `apps/web/src/components/trading/share-strategy-dialog.stories.tsx`
- Modify: `apps/web/src/components/trading-trade-review.tsx`
- Modify: `apps/web/src/components/trading/openalgo-trade-chart.tsx`

- [ ] Add failing tests that both privacy toggles default off and that changing either toggle requests a fresh server preview rather than mutating the chart only in the browser.
- [ ] Render the returned preview with the same public chart component/DTO used by readers. Show a field summary of exactly what will and will not be published.
- [ ] Show the one-only visibility inference warning and require a final explicit confirmation after the latest preview finishes.
- [ ] Bind publish to the returned one-time token and idempotency key; disable duplicate submits and recover an already-created post after an uncertain network response.
- [ ] Reject publication while private chart state has unsaved changes, source revision changed, preview expired, coverage is invalid, or selected drawings/indicators failed projection.
- [ ] Add Storybook/mobile states for default-private, quantity-only, P&L-only, both-visible, expired, stale, and publish success.
- [ ] Run component tests, Storybook build, and web typecheck.
- [ ] Commit: `feat(web): preview privacy-safe strategy shares`

### Task 6: Render immutable public strategy charts in community posts

**Files:**
- Create: `apps/web/src/components/community/public-strategy-chart.tsx`
- Create: `apps/web/src/components/community/public-strategy-chart.test.tsx`
- Create: `apps/web/src/components/community/public-strategy-chart.stories.tsx`
- Modify: `apps/web/src/app/community/post/[id]/page.tsx`
- Modify: `apps/web/src/app/community/post/[id]/metadata.test.ts`
- Modify: `packages/domain/src/community.ts`
- Modify: `apps/web/src/lib/community/server-repository.ts`
- Modify: `apps/web/src/lib/community/server-repository.test.ts`

- [ ] Add failing tests that strategy posts load only a public snapshot reference, not private cycle/chart state or the legacy TradingView iframe package.
- [ ] Render stored candles, markers, indicator series, drawings, coverage/source timestamp, visibility labels, and price-return disclaimer from the immutable DTO.
- [ ] Allow zoom/pan within the stored range only; disable timeframe changes and fetch-more behavior.
- [ ] Provide an accessible marker list and degraded static summary if canvas/WebGL/chart initialization fails.
- [ ] Add metadata/open-graph tests that expose only author-approved public title/description; do not include hidden quantities or P&L.
- [ ] Run public component/repository/page tests and Storybook.
- [ ] Commit: `feat(community): render immutable strategy charts`

### Task 7: Attach existing community comments to public markers

**Files:**
- Modify: `packages/domain/src/community.ts`
- Modify: `apps/web/src/lib/community/client-repository.ts`
- Modify: `apps/web/src/lib/community/client-repository.test.ts`
- Modify: `apps/web/src/lib/community/server-repository.ts`
- Modify: `apps/web/src/lib/community/server-repository.test.ts`
- Modify: `apps/web/src/components/post-comments.tsx`
- Modify: `apps/web/src/components/post-comments.test.tsx`
- Modify: `apps/web/src/components/community/public-strategy-chart.tsx`

- [ ] Extend `PostComment` with nullable `marker_key` and add failing repository tests for ordinary comments, marker comments, replies, deletion, image comments, and pagination.
- [ ] Validate marker keys server-side against markers in the post's immutable snapshot. Reject unknown keys, marker keys on non-strategy posts, and marker changes on edit/reply.
- [ ] Reuse `addPostComment` and current report/block/moderation paths; do not create a parallel comment identity or notification system.
- [ ] Synchronize chart marker selection with a filtered comment panel while keeping all comments available in chronological mode.
- [ ] Include marker context in notification text/link without exposing hidden fields. A click should open the post and focus the marker/comment.
- [ ] Run domain, repository, component, and existing community tests.
- [ ] Commit: `feat(community): comment on strategy markers`

### Task 8: Add abuse, retention, and privacy regression coverage

**Files:**
- Modify: `tests/public-strategy-snapshots-postgres.test.mjs`
- Modify: `ai-gateway/test/public-chart-projection.test.ts`
- Modify: `ai-gateway/test/chart-sharing-service.test.ts`
- Create: `apps/web/e2e/public-strategy-sharing.spec.ts`

- [ ] Add recursive secret-scanner assertions for API key fragments, PEM material, account/connection IDs, private fill IDs, raw provider fields, storage paths, hidden quantity, hidden P&L, and money-derived labels.
- [ ] Add adversarial tests for client-supplied digest/payload, token replay/race, oversized candles, NaN/Infinity, XSS in notes/drawing text/comments, unknown tools, and cross-owner source IDs.
- [ ] Add lifecycle tests for private edits after publish, later exchange sync, library version change, author unpublish/delete, comment reports, moderator hiding, source account disconnect, and private data deletion request.
- [ ] Confirm an old public snapshot remains byte-stable under all allowed private changes and that prohibited deletion states follow the approved retention rule.
- [ ] Add E2E for all four privacy combinations and compare network responses, DOM text, accessibility tree, tooltips, and exported image labels for leakage.
- [ ] Run targeted suites and commit: `test: harden public strategy privacy`

### Task 9: Stage rollout, observability, and production release

**Files:**
- Modify: `ai-gateway/src/config.ts`
- Modify: `ai-gateway/test/config.test.ts`
- Modify: `apps/web/src/lib/trading/config.ts`
- Modify: `apps/web/src/lib/trading/config.test.ts`
- Modify: `.github/workflows/deploy-next-production.yml`
- Create: `docs/verification/2026-11-26-public-strategy-sharing.md`
- Create: `docs/runbooks/public-strategy-snapshots.md`

- [ ] Add `PUBLIC_STRATEGY_SNAPSHOTS_ENABLED` independently from the private chart flag. Disabled behavior hides share controls and preserves existing community posts.
- [ ] Add structured, secret-free metrics/logs for preview success/failure reason, publish success/idempotent recovery, payload bytes, candle count, render failures, marker-comment rejects, and token cleanup; never log projection bodies or bearer tokens.
- [ ] Add a cleanup job/RPC for expired unconsumed preview tokens and orphaned temporary data. Document schedule, retries, and safe manual invocation.
- [ ] Run the full suite: tests, typecheck, lint, Storybook build, production web build, and targeted Playwright desktop/mobile projects.
- [ ] Deploy migration then gateway then web to staging. Verify exact preview/publish digest, all privacy combinations, public anonymous read, comments/moderation, unpublish, and rollback flag.
- [ ] Enable for internal UIDs, monitor error/leak canaries and payload size, then enable publicly. Record timestamps, commands, evidence, and rollback in the verification note.
- [ ] Commit: `feat: release public strategy snapshots`

## Completion Gate

- Server-generated preview and persisted snapshot have the same canonical digest.
- All four privacy combinations pass network/DOM/accessibility/export leak tests.
- Published content is immutable and independent of future private edits, market data, syncs, and chart-library versions.
- Public readers can inspect only the stored timeframe/range and cannot reach private source tables or IDs.
- Marker comments preserve existing replies, reports, blocks, moderation, pagination, and notifications.
- Full test/type/lint/build/E2E gates pass, staging evidence is recorded, and both feature flags provide a safe rollback.
