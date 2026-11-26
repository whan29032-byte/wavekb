# Discord Bot Cloud Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the existing Discord community bot as a persistent, auto-restarting service on the WaveKB production host.

**Architecture:** The bot is vendored as an independent Node service inside the WaveKB repository. A GitHub Actions workflow packages Linux dependencies and activates an immutable systemd release, while a small validator renders an allowlisted environment file from stdin-only secrets and seeds the persistent SQLite database once.

**Tech Stack:** Node.js 22, discord.js 14, better-sqlite3, systemd, GitHub Actions, Bash, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-26-discord-bot-cloud-deployment-design.md`

## Global Constraints

- No Discord token, website API secret, `.env`, runtime database, or logs may enter Git.
- Production uses the existing pinned SSH fingerprint and `production` GitHub environment.
- `/var/lib/elliott-wave-discord-bot/profile-bot.db` persists across releases and is seeded only when absent.
- The local bot is stopped only after the cloud service passes acceptance.

## Review Focus

- Missing or malformed secrets must fail before any remote write; covered by Task 2 validator tests.
- A deployment failure must restore code, unit, and environment; covered by Task 3 workflow contract tests.
- A subsequent deployment must never overwrite the live SQLite database; covered by Task 3 workflow contract tests.
- The archive must exclude `.env`, logs, tests, and live data; covered by Task 3 workflow contract tests.
- The service must prove Discord readiness, not merely an active process; covered by Task 3 workflow contract tests.

---

### Task 1: Vendor the reviewed bot runtime

**Files:**
- Create: `services/discord-bot/**`
- Test: `services/discord-bot/tests/*.test.js`

**Interfaces:**
- Consumes: current reviewed bot repository at `C:/Users/root/Documents/discord频道优化机器人`
- Produces: standalone package with `npm test`, `npm run check`, and `npm start`

- [ ] **Step 1: Copy only tracked source, assets, package metadata, and tests; exclude `.env`, `data`, logs, and local docs.**
- [ ] **Step 2: Run `npm ci` in `services/discord-bot`.**
- [ ] **Step 3: Run `npm test` and verify zero failures.**
- [ ] **Step 4: Run `npm run check` and verify exit 0.**
- [ ] **Step 5: Commit the standalone runtime.**

### Task 2: Add bounded production environment rendering

**Files:**
- Create: `scripts/render-discord-bot-env.mjs`
- Create: `tests/discord-bot-runtime-env.test.mjs`

**Interfaces:**
- Consumes: JSON file containing `token`, `websiteApiSecret`, and optional `databaseBase64`
- Produces: `renderDiscordBotEnvironment(payload)` returning `{ environmentText, databaseBuffer }`

- [ ] **Step 1: Write tests for valid output, malformed token/secret/IDs/URLs, extra keys, and bounded database base64.**
- [ ] **Step 2: Run `node --test tests/discord-bot-runtime-env.test.mjs`; expect failure because the renderer is absent.**
- [ ] **Step 3: Implement the minimal allowlisted validator and CLI.**
- [ ] **Step 4: Run the test again; expect all tests to pass.**
- [ ] **Step 5: Commit the renderer and tests.**

### Task 3: Add hardened systemd and immutable deployment workflow

**Files:**
- Create: `deployment/systemd/elliott-wave-discord-bot.service`
- Create: `scripts/deploy-discord-bot-production.sh`
- Create: `.github/workflows/deploy-discord-bot-production.yml`
- Create: `tests/discord-bot-deployment.test.mjs`

**Interfaces:**
- Consumes: bot archive, systemd unit, environment JSON through SSH stdin, existing production SSH secrets
- Produces: active `elliott-wave-discord-bot.service` and durable SQLite state

- [ ] **Step 1: Write contract tests for hardening, stdin-only secrets, archive exclusions, rollback, database seed-once behavior, and Discord-ready journal acceptance.**
- [ ] **Step 2: Run `node --test tests/discord-bot-deployment.test.mjs`; expect failure because deployment files are absent.**
- [ ] **Step 3: Implement the service, transaction script, and workflow with exact rollback and cleanup.**
- [ ] **Step 4: Run deployment/runtime tests and shell syntax checks; expect all to pass.**
- [ ] **Step 5: Commit the deployment path.**

### Task 4: Publish secrets, deploy, and cut over

**Files:**
- No tracked files.

**Interfaces:**
- Consumes: new Discord token, existing website API secret, one-time SQLite snapshot, reviewed main commit
- Produces: successful production workflow run and cloud-hosted bot

- [ ] **Step 1: Create an online SQLite backup and encode it without logging contents.**
- [ ] **Step 2: Set `DISCORD_BOT_TOKEN` and `DISCORD_BOT_DATABASE_BASE64` in the repository production secrets without displaying values.**
- [ ] **Step 3: Push the reviewed commits to `main` and dispatch `deploy-discord-bot-production.yml`.**
- [ ] **Step 4: Verify the workflow, systemd acceptance, and Discord bot availability.**
- [ ] **Step 5: Stop the local Windows bot and verify the Discord bot remains online from the cloud service.**
