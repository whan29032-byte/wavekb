# Reward Lottery Design

## Goal

Add a production-safe lottery to the existing WaveKB reward center. One campaign may be published at a time, each eligible member may draw once per campaign, a draw costs server-configured points, and a draw may return no prize.

## Confirmed product rules

- Campaigns and prizes are independent from `reward_products` and `reward_redemptions`.
- Only one campaign may have `active` status at a time. Draft and closed campaigns remain available to administrators as history.
- A campaign has a title, description, optional HTTPS image, entry cost, start time, end time, and status.
- Each active member with a public UID may draw once per campaign.
- The only client action is a single card flip. There is no multi-draw or repeat purchase.
- Prize probabilities are stored as integer basis points (`1` = `0.01%`). The configured prize total may not exceed `10000`.
- The remaining probability is the base no-prize probability.
- When a prize is out of stock, its probability moves to no-prize. Other prize probabilities never change.
- The user-facing page shows every prize's configured probability and remaining stock, plus the current effective no-prize probability.
- Lottery prizes support two fulfillment types in the first release `points` and `manual`.
  - `points` prizes credit the configured point amount inside the draw transaction and are immediately fulfilled.
  - `manual` prizes create a pending fulfillment record that administrators complete with a note.
- The first version does not collect addresses or other new personal information.

## User experience

The authenticated `/rewards` page gains a compact lottery section between the wallet hero and the existing missions/store content. It shows the current campaign, entry cost, time window, transparent prize table, effective no-prize probability, and a single restrained flip card. The design uses the existing surface, border, primary and muted tokens; it does not use confetti, slot-machine effects, or casino-style flashing.

Before drawing, the button states the exact point cost. It is disabled with a clear reason when the campaign is scheduled, ended, the account is ineligible, the balance is insufficient, or the member already drew. On success, the card flips once and announces one of three persisted outcomes: no prize, automatic points, or a manual prize pending administrator fulfillment. Reloading displays the same stored result.

When no campaign is published, the lottery section is omitted from the member page so the existing reward center remains unchanged.

## Administrator experience

`/admin/rewards` gains a separate lottery management section above the existing store management UI. Administrators can:

1. create or edit a draft campaign;
2. add and edit independent prizes;
3. enter probability as a percentage while the client converts it to basis points;
4. review the calculated base no-prize probability before activation;
5. activate a valid campaign after confirmation;
6. close the active campaign;
7. review draw results and mark manual prizes fulfilled with an audit note.

Campaign configuration becomes immutable after activation. A new campaign is made by creating another draft. Activating a campaign automatically closes an expired active campaign but refuses to replace a currently scheduled or open campaign.

## Data model

### `reward_lottery_campaigns`

- `id uuid primary key`
- `title text`
- `description text`
- `image_url text null`
- `entry_cost_points integer check between 1 and 100000`
- `starts_at timestamptz`
- `ends_at timestamptz`
- `status text check in ('draft','active','closed')`
- `created_by uuid null references profiles(id)`
- `created_at`, `updated_at`, `activated_at`, `closed_at`

A partial unique index on `status = 'active'` enforces the single published campaign rule.

### `reward_lottery_prizes`

- `id uuid primary key`
- `campaign_id uuid references reward_lottery_campaigns(id)`
- `name`, `summary`, `image_url`
- `probability_bps integer check between 1 and 10000`
- `stock_total integer check > 0`
- `stock_remaining integer check between 0 and stock_total`
- `fulfillment_type text check in ('points','manual')`
- `reward_points integer null check between 1 and 100000 when present`
- `sort_order integer`
- `created_at`, `updated_at`

The database constraint requires positive `reward_points` only for `points` prizes and requires it to be null for `manual` prizes.

### `reward_lottery_draws`

- `id uuid primary key`
- `campaign_id`, `user_id`, `prize_id null`
- `request_id uuid`
- `outcome text check in ('won','miss')`
- immutable snapshots of campaign title, prize name, fulfillment type, probability and points spent
- `random_bucket integer check between 0 and 9999`
- `fulfillment_status text check in ('not_required','pending','fulfilled')`
- `fulfillment_note text`
- `balance_after integer`
- `created_at`, `updated_at`, `fulfilled_at`

Unique constraints on `(campaign_id, user_id)` and `(user_id, request_id)` make retries idempotent and enforce one entry per member.

### `reward_lottery_admin_audit`

Append-only rows record campaign creation/editing, prize creation/editing, activation, closure, and fulfillment changes with actor, object identifiers, before/after JSON, and timestamp.

All four tables use RLS. Members receive lottery state only through a read RPC, and all mutations occur through narrowly granted security-definer RPCs. Base-table writes are not granted to browser roles.

## Draw transaction

`draw_reward_lottery(p_campaign uuid, p_request uuid)` performs the entire operation in one database transaction:

1. require `auth.uid()` and an active profile with a public UID;
2. return an existing draw for the campaign/user before doing any new work;
3. lock the selected campaign and require active status plus an open time window;
4. create and lock the member wallet, then re-check for an existing draw after the lock;
5. require sufficient balance;
6. generate an unbiased bucket in `[0, 9999]` from two `gen_random_bytes` bytes through rejection sampling (`uint16 < 60000`, then modulo `10000`) in a private helper;
7. map the bucket to immutable prize ranges ordered by `sort_order, id`, without excluding out-of-stock prizes;
8. atomically decrement the selected prize only when stock remains; otherwise persist a miss;
9. deduct the entry cost and insert a `lottery_entry` ledger row;
10. for a points prize, credit points and insert a `lottery_prize` ledger row;
11. persist the immutable draw result and return the new balance.

Because depleted prizes stay in the bucket map, their probability becomes no-prize and no other prize's odds increase. Locking the wallet serializes concurrent attempts from the same member. The unique draw constraint is the final concurrency guard.

## Read and administration RPCs

- `get_my_reward_lottery()` returns the single active campaign, its prizes, current effective no-prize basis points, eligibility reason, and the caller's stored draw if present.
- `draw_reward_lottery(uuid, uuid)` performs the draw.
- `admin_get_reward_lottery()` returns campaigns, prizes, and recent draws for administrators.
- `admin_upsert_reward_lottery_campaign(...)` creates or edits drafts only.
- `admin_upsert_reward_lottery_prize(...)` creates or edits prizes belonging to drafts only.
- `admin_set_reward_lottery_campaign_status(uuid, text)` activates or closes a campaign after validating timing, prize count, probability total and single-active rules.
- `admin_fulfill_reward_lottery_draw(uuid, text)` fulfills pending manual prizes with a required note.

Every security-definer function uses `set search_path = ''`, schema-qualified references, explicit execute grants, and explicit revocation from `public`.

## Error behavior

Stable error keys are translated in the client:

- `lottery_campaign_unavailable`
- `lottery_not_open`
- `lottery_already_drawn`
- `lottery_balance_insufficient`
- `lottery_account_ineligible`
- `lottery_configuration_invalid`
- `lottery_campaign_immutable`
- `lottery_manual_fulfillment_required`

An already-completed request returns its stored result rather than an error. UI refresh failures after a successful mutation do not erase the authoritative result returned by the draw RPC.

## Release and schema compatibility

The additive migration is `202609090002_reward_lottery.sql` and advances `wavekb_schema_version()` to `202609090002` only after all objects, policies, grants and functions exist. The backend deployment workflow accepts exactly `202609090001`, applies exactly this migration, verifies the private database marker, then verifies the public PostgREST marker before uploading application releases. `202609090002` is an idempotent no-op state; unknown markers fail closed.

The Next production preflight remains read-only and requires the latest repository migration marker, so code cannot activate before the database is compatible.

## Verification

- PGlite integration tests exercise one-entry enforcement, retry idempotency, atomic balance changes, automatic points awards, manual pending fulfillment, stock depletion to no-prize, probability validation, account enforcement, and admin authorization.
- Repository unit tests prove exact RPC names and arguments.
- Component tests cover visible probabilities, button eligibility, one flip, persisted result rendering, and administrator validation.
- Existing reward center, domain, lint, typecheck and production build suites must remain green.
- Production release runs backend migration first and Next deployment second, followed by authenticated reward-page and admin-page acceptance checks that do not perform a real draw.
