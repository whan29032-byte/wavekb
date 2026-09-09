# Reward Lottery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-entry-per-member, points-funded, transparent card-flip lottery with independent prizes and administrator management to the WaveKB reward center.

**Architecture:** An additive Supabase migration owns all authoritative campaign, prize, draw, inventory and ledger mutations. Small member/admin repositories expose the RPCs to isolated client components, while existing reward store code remains unchanged. The release workflow migrates schema `202609090001` to `202609090002` before deploying the compatible Next release.

**Tech Stack:** PostgreSQL/Supabase RPC and RLS, Next.js 16 App Router, React 19, TypeScript, Vitest/Testing Library, Node test runner, PGlite.

**Spec:** `docs/superpowers/specs/2026-09-09-reward-lottery-design.md`

## Global Constraints

- Only one campaign may have `active` status at a time.
- Each active member with a public UID may draw once per campaign.
- Prize odds are integer basis points and the configured sum must be at most `10000`.
- Depleted prize probability becomes no-prize; other prize odds do not change.
- Draw, inventory update, point debit, optional point award and immutable result persist in one transaction.
- Browser roles receive no direct table-write grants.
- Every new security-definer function uses `set search_path = ''` and schema-qualified references.
- The first release supports only `points` and `manual` prize fulfillment and collects no new personal data.
- UI uses existing design tokens, a restrained card flip and reduced-motion support; no casino-style effects.

---

### Task 1: Authoritative lottery schema and draw transaction

**Files:**
- Create: `supabase/migrations/202609090002_reward_lottery.sql`
- Create: `tests/reward-lottery-postgres.test.mjs`
- Modify: `.github/workflows/deploy-backend-production.yml`
- Modify: `tests/deploy-workflow.test.mjs`

**Interfaces:**
- Produces: `get_my_reward_lottery() -> jsonb`
- Produces: `draw_reward_lottery(p_campaign uuid, p_request uuid) -> jsonb`
- Produces: `admin_get_reward_lottery() -> jsonb`
- Produces: `admin_upsert_reward_lottery_campaign(...) -> uuid`
- Produces: `admin_upsert_reward_lottery_prize(...) -> uuid`
- Produces: `admin_set_reward_lottery_campaign_status(p_campaign uuid, p_status text) -> void`
- Produces: `admin_fulfill_reward_lottery_draw(p_draw uuid, p_note text) -> void`
- Produces: `wavekb_schema_version() -> '202609090002'`

- [ ] **Step 1: Write failing PostgreSQL behavior tests**

Create a PGlite bootstrap with minimal `auth.uid()`, `profiles`, reward wallet/ledger and `mentor_is_admin()` objects. Apply the migration and assert literal outcomes for:

```js
assert.equal(await marker(database), "202609090002");
assert.equal(first.outcome, "won");
assert.equal(first.prize.fulfillment_type, "points");
assert.equal(first.balance, 950); // 1000 - 100 entry + 50 prize
assert.deepEqual(await ledgerPoints(database, userId), [-100, 50]);
assert.equal(retry.draw_id, first.draw_id);
assert.equal(await drawCount(database, campaignId, userId), 1);
assert.equal(await walletBalance(database, userId), 950);
```

Replace the private bucket helper in the test database with a deterministic value. Add separate cases proving a depleted selected prize persists a miss without reallocating odds, a manual prize is pending, a banned/no-UID member is rejected, insufficient balance rolls back, probability totals above `10000` cannot activate, and a non-admin cannot mutate configuration.

- [ ] **Step 2: Run the PostgreSQL tests and verify RED**

Run: `node --test tests/reward-lottery-postgres.test.mjs`

Expected: FAIL because `202609090002_reward_lottery.sql` and its RPCs do not exist.

- [ ] **Step 3: Implement the additive migration**

Create the four tables, checks, indexes, RLS policies, append-only audit, private unbiased bucket helper, read RPC, draw RPC and admin RPCs described in the spec. Use fixed cumulative prize ranges ordered by `sort_order, id` and keep depleted prizes in that mapping. Revoke all function access from `public`, grant member RPCs only to `authenticated`, grant no direct table writes, create the schema marker last, then `notify pgrst, 'reload schema'`.

- [ ] **Step 4: Run the PostgreSQL tests and verify GREEN**

Run: `node --test tests/reward-lottery-postgres.test.mjs`

Expected: all lottery database tests PASS with no skipped cases.

- [ ] **Step 5: Write failing exact migration workflow assertions**

Update the workflow test to require:

```js
assert.match(schemaStep.run, /202609090001\)[\s\S]*202609090002_reward_lottery\.sql/);
assert.match(schemaStep.run, /202609090002\)[\s\S]*already applied/);
assert.match(schemaStep.run, /test "\$schema_after" = 202609090002/);
assert.match(publicStep.run, /test "\$schema" = 202609090002/);
```

- [ ] **Step 6: Run workflow tests and verify RED**

Run: `node --test tests/deploy-workflow.test.mjs`

Expected: FAIL because the workflow still targets `202609090001`.

- [ ] **Step 7: Update the backend workflow exact state machine**

Allow exactly `202609090001 -> apply 202609090002_reward_lottery.sql`, treat `202609090002` as an idempotent no-op, and fail closed for any other marker. Verify both the direct database marker and public PostgREST marker are `202609090002` before release upload.

- [ ] **Step 8: Run database and workflow tests**

Run: `node --test tests/reward-lottery-postgres.test.mjs tests/deploy-workflow.test.mjs`

Expected: all tests PASS.

- [ ] **Step 9: Commit Task 1**

```bash
git add supabase/migrations/202609090002_reward_lottery.sql tests/reward-lottery-postgres.test.mjs .github/workflows/deploy-backend-production.yml tests/deploy-workflow.test.mjs
git commit -m "feat(db): add atomic reward lottery"
```

---

### Task 2: Domain contracts and member repositories

**Files:**
- Modify: `packages/domain/src/community.ts`
- Modify: `packages/domain/src/community.test.ts`
- Create: `apps/web/src/lib/rewards/lottery-server-repository.ts`
- Create: `apps/web/src/lib/rewards/lottery-client-repository.ts`
- Create: `apps/web/src/lib/rewards/lottery-client-repository.test.ts`

**Interfaces:**
- Produces: `RewardLotteryState`, `RewardLotteryCampaign`, `RewardLotteryPrize`, `RewardLotteryDraw`
- Produces: `formatLotteryProbability(bps: number): string`
- Produces: `getMyRewardLottery(): Promise<RewardLotteryState>`
- Produces: `loadRewardLottery(client): Promise<RewardLotteryState>`
- Produces: `rewardLotteryMutations(client, gateway?).draw(campaignId, requestId)`

- [ ] **Step 1: Write failing domain and repository tests**

Add literal formatting cases:

```ts
expect(formatLotteryProbability(1)).toBe("0.01%");
expect(formatLotteryProbability(250)).toBe("2.50%");
expect(formatLotteryProbability(10000)).toBe("100.00%");
```

Add an injected gateway test that expects `draw("campaign-id", "request-id")` exactly once and a real Supabase-client boundary test that expects RPC `draw_reward_lottery` with `{ p_campaign: "campaign-id", p_request: "request-id" }`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @wavekb/domain test -- community.test.ts && pnpm --filter @wavekb/web test -- src/lib/rewards/lottery-client-repository.test.ts`

Expected: FAIL because the types, formatter and repository do not exist.

- [ ] **Step 3: Implement the contracts and repositories**

Normalize all numeric RPC fields with `Number`, all arrays with `Array.isArray`, and nullable campaign/draw objects explicitly. Keep server access in a `server-only` file and client mutations in a client-safe file.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same domain and web commands from Step 2.

Expected: all focused tests PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/domain/src/community.ts packages/domain/src/community.test.ts apps/web/src/lib/rewards/lottery-server-repository.ts apps/web/src/lib/rewards/lottery-client-repository.ts apps/web/src/lib/rewards/lottery-client-repository.test.ts
git commit -m "feat(web): add lottery data contracts"
```

---

### Task 3: Member card-flip lottery

**Files:**
- Create: `apps/web/src/components/reward-lottery.tsx`
- Create: `apps/web/src/components/reward-lottery.module.css`
- Create: `apps/web/src/components/reward-lottery.test.tsx`
- Create: `apps/web/src/components/reward-lottery.stories.tsx`
- Modify: `apps/web/src/app/rewards/page.tsx`
- Modify: `apps/web/src/components/reward-center.tsx`

**Interfaces:**
- Consumes: `RewardLotteryState`
- Consumes: `rewardLotteryMutations(...).draw(campaignId, requestId)`
- Produces: `<RewardLottery actorId initialState />`
- Extends: `<RewardCenter ... lottery={state} />`

- [ ] **Step 1: Write failing member behavior tests**

Render the real component with hand-written state fixtures and assert:

```ts
expect(screen.getByText("2.50%")).toBeTruthy();
expect(screen.getByText("未中奖概率 87.50%")).toBeTruthy();
expect(screen.getByRole("button", { name: "使用 100 积分翻牌" })).toBeEnabled();
```

Add cases for insufficient balance, scheduled/ended campaign, persisted prior result, sold-out prize display, successful manual prize result, automatic points result, miss result, double-click prevention, refresh failure after authoritative draw result, and no lottery markup when the server returns no campaign.

- [ ] **Step 2: Run component tests and verify RED**

Run: `pnpm --filter @wavekb/web test -- src/components/reward-lottery.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the member component and integration**

Build a small client component with one authenticated mutation, `crypto.randomUUID()` request id, an authoritative local result, an `aria-live` announcement and a CSS card flip. Use `@media (prefers-reduced-motion: reduce)` to remove the transform animation. Fetch the initial lottery in the server page alongside the existing center and leaderboard, then render it between the wallet hero and missions through `RewardCenter`.

- [ ] **Step 4: Run member tests and verify GREEN**

Run: `pnpm --filter @wavekb/web test -- src/components/reward-lottery.test.tsx src/components/reward-reliability.test.tsx src/lib/rewards/lottery-client-repository.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add apps/web/src/components/reward-lottery.tsx apps/web/src/components/reward-lottery.module.css apps/web/src/components/reward-lottery.test.tsx apps/web/src/components/reward-lottery.stories.tsx apps/web/src/app/rewards/page.tsx apps/web/src/components/reward-center.tsx
git commit -m "feat(web): add card flip lottery"
```

---

### Task 4: Administrator campaign, prize and fulfillment controls

**Files:**
- Create: `apps/web/src/lib/admin/reward-lottery-types.ts`
- Create: `apps/web/src/lib/admin/reward-lottery-server-repository.ts`
- Create: `apps/web/src/lib/admin/reward-lottery-client-repository.ts`
- Create: `apps/web/src/lib/admin/reward-lottery-client-repository.test.ts`
- Create: `apps/web/src/components/admin-reward-lottery.tsx`
- Create: `apps/web/src/components/admin-reward-lottery.test.tsx`
- Create: `apps/web/src/components/admin-reward-lottery.stories.tsx`
- Modify: `apps/web/src/app/admin/rewards/page.tsx`

**Interfaces:**
- Produces: `AdminRewardLotteryStore`, `RewardLotteryCampaignInput`, `RewardLotteryPrizeInput`
- Produces: `getAdminRewardLottery()` and `loadAdminRewardLottery(client)`
- Produces: `adminRewardLotteryMutations(...).upsertCampaign`, `.upsertPrize`, `.setStatus`, `.fulfillDraw`
- Produces: `<AdminRewardLottery actorId initialStore />`

- [ ] **Step 1: Write failing repository and administrator component tests**

Assert exact RPC payloads, including percent-to-basis-point conversion at the component boundary. UI cases must reject invalid dates, non-integer stock, zero points rewards, probabilities outside `0.01%` to `100.00%`, and prize totals above `100.00%`. Assert activation confirmation, immutable active controls, effective no-prize preview, close confirmation, and fulfillment requiring a two-character note.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @wavekb/web test -- src/lib/admin/reward-lottery-client-repository.test.ts src/components/admin-reward-lottery.test.tsx`

Expected: FAIL because the administrator lottery modules do not exist.

- [ ] **Step 3: Implement administrator repositories and UI**

Keep lottery code out of the existing `admin-rewards.tsx`. Fetch the lottery store separately in the server page and render the new section before `<AdminRewards>`. Refresh from the authoritative admin read RPC after each successful mutation; preserve mutation success when the refresh fails and call `router.refresh()` as a retry.

- [ ] **Step 4: Run administrator tests and verify GREEN**

Run: `pnpm --filter @wavekb/web test -- src/lib/admin/reward-lottery-client-repository.test.ts src/components/admin-reward-lottery.test.tsx src/lib/admin/rewards-client-repository.test.ts`

Expected: all focused tests PASS.

- [ ] **Step 5: Commit Task 4**

```bash
git add apps/web/src/lib/admin/reward-lottery-types.ts apps/web/src/lib/admin/reward-lottery-server-repository.ts apps/web/src/lib/admin/reward-lottery-client-repository.ts apps/web/src/lib/admin/reward-lottery-client-repository.test.ts apps/web/src/components/admin-reward-lottery.tsx apps/web/src/components/admin-reward-lottery.test.tsx apps/web/src/components/admin-reward-lottery.stories.tsx apps/web/src/app/admin/rewards/page.tsx
git commit -m "feat(admin): manage reward lottery"
```

---

### Task 5: Release contracts and full verification

**Files:**
- Create: `tests/reward-lottery-release.test.mjs`
- Modify: `apps/web/e2e-ui/reliability.spec.ts`

**Interfaces:**
- Consumes: migration/RPC/component/repository contracts from Tasks 1-4
- Produces: release guard that prevents lottery UI from shipping without schema and RPC compatibility

- [ ] **Step 1: Write failing release contract tests**

The release test reads the migration, member page, admin page and workflow and asserts that the repository latest marker, public schema marker checks, member read RPC, member draw RPC, admin read RPC, RLS enablement and explicit grants all travel together. Extend read-only authenticated UI acceptance to require the lottery heading only when a campaign fixture exists; never perform a production draw.

- [ ] **Step 2: Run release tests and verify RED if any contract is missing**

Run: `node --test tests/reward-lottery-release.test.mjs tests/deploy-workflow.test.mjs`

Expected: PASS only after every release contract is present; otherwise fail on the exact missing contract.

- [ ] **Step 3: Complete any missing wiring with the smallest change**

Do not add new product behavior. Only connect contracts required by the design and the failing release assertion.

- [ ] **Step 4: Run complete verification**

Run:

```bash
node --test tests/*.test.mjs
pnpm -r --if-present test
pnpm -r typecheck
pnpm -r --if-present lint
pnpm --filter @wavekb/web build
git diff --check origin/main...HEAD
```

Expected: zero test failures, zero type errors, zero lint errors, successful production build and clean diff check.

- [ ] **Step 5: Commit release contracts**

```bash
git add tests/reward-lottery-release.test.mjs apps/web/e2e-ui/reliability.spec.ts
git commit -m "test: gate reward lottery release"
```

- [ ] **Step 6: Review and release**

Review `origin/main...HEAD` for Critical/Important security, concurrency, probability, accessibility and deployment issues. Push `codex/reward-lottery`, create a PR, require exact-SHA CI success, merge to `main`, run the backend production workflow first, then the Next production workflow, and verify `/api/health` reports the merged SHA. Confirm `/rewards` and `/admin/rewards` load in read-only acceptance without executing a real draw.
