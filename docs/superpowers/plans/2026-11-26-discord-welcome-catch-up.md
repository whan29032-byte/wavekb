# Discord Welcome Catch-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover recent Discord member joins missed while the bot was offline without posting duplicate welcomes after restart.

**Architecture:** Store successful welcome deliveries in SQLite using guild, user, and join timestamp as the identity. Route both live joins and a bounded `ClientReady` reconciliation through one delivery service.

**Tech Stack:** Node.js 22, discord.js 14, better-sqlite3, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-26-discord-welcome-catch-up-design.md`

## Global Constraints

- Reconcile only human joins from the previous 24 hours.
- Send no more than 10 catch-up welcomes per startup, oldest first.
- Persist only successful deliveries and never crash the bot on reconciliation failure.

## Review Focus

- Restart after a successful catch-up must not resend the same join.
- A user who leaves and rejoins with a new join timestamp must remain eligible.
- Failed Discord sends must remain retryable.
- Bots and members outside the 24-hour window must never be backfilled.
- The initial migration must preserve every existing profile row.

---

### Task 1: Persist successful welcome deliveries

**Files:**
- Modify: `services/discord-bot/database.js`
- Test: `services/discord-bot/tests/database.test.js`

**Interfaces:**
- Produces: `hasMemberWelcome(guildId, userId, joinedAt)` and `recordMemberWelcome(guildId, userId, joinedAt, messageId, welcomedAt)`.

- [ ] **Step 1: Write a failing database test** proving delivery is keyed by guild, user, and join timestamp and survives reopen.
- [ ] **Step 2: Run `node --test tests/database.test.js` from `services/discord-bot`; expect the new API test to fail.**
- [ ] **Step 3: Add the idempotent `member_welcomes` migration and the two database methods.**
- [ ] **Step 4: Run the database test; expect all tests to pass.**
- [ ] **Step 5: Commit the migration and database tests.**

### Task 2: Deliver live and catch-up welcomes through one service

**Files:**
- Create: `services/discord-bot/member-welcome-service.js`
- Create: `services/discord-bot/tests/member-welcome-service.test.js`
- Modify: `services/discord-bot/bot.js`
- Modify: `services/discord-bot/tests/bot.test.js`
- Modify: `services/discord-bot/package.json`

**Interfaces:**
- Consumes: the Task 1 delivery ledger and existing `buildMemberWelcome(member)`.
- Produces: `deliverMemberWelcome(options)` and `catchUpRecentMemberWelcomes(options)`.

- [ ] **Step 1: Write failing service tests** for successful persistence, retry after failure, 24-hour filtering, bot filtering, chronological order, 10-member cap, and restart deduplication.
- [ ] **Step 2: Write a failing bot integration test** proving `ClientReady` performs catch-up and live joins use the same deduplicated path.
- [ ] **Step 3: Run the focused tests; expect failures because the service and wiring are absent.**
- [ ] **Step 4: Implement the minimal service and wire it to `ClientReady` and `GuildMemberAdd`.**
- [ ] **Step 5: Run the focused tests and then `npm test` plus `npm run check`; expect zero failures.**
- [ ] **Step 6: Commit the welcome recovery behavior.**

### Task 3: Deploy and verify production recovery

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: reviewed `main`, existing production secrets, and the existing immutable Discord bot workflow.
- Produces: a successful production workflow and visible, deduplicated admissions-channel welcomes.

- [ ] **Step 1: Run deployment/runtime tests and scan tracked files for secret-shaped data.**
- [ ] **Step 2: Push the reviewed fast-forward commits to `main`.**
- [ ] **Step 3: Dispatch `deploy-discord-bot-production.yml` and require successful systemd/Discord readiness acceptance.**
- [ ] **Step 4: Verify recent missed joins are backfilled once and a second restart creates no duplicate.**
