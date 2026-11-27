# Discord Bundled Font Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Discord-generated card render text reliably on the production Linux host by shipping and registering its own Chinese font.

**Architecture:** A focused font module owns the vendored font path, registration, and Canvas family alias. Profile and leaderboard renderers import that alias instead of resolving host fonts.

**Tech Stack:** Node.js 22, `@napi-rs/canvas`, Node test runner, Noto Sans CJK SC.

**Spec:** `docs/superpowers/specs/2026-11-26-discord-bundled-font-design.md`

## Global Constraints

- Preserve all current image layouts, colors, copy, and dimensions.
- Vendor the upstream SIL OFL license with the font.
- Render Chinese and Latin glyphs without system-font dependencies.
- Fail clearly if the asset is missing or invalid.

## Review Focus

- Missing or corrupt font assets must fail before a blank image can be sent.
- Bold CSS requests must still render through the bundled regular face.
- Both profile and leaderboard renderers must use the same family alias.
- The release archive must retain the font and license.
- Font registration must be safe when modules are loaded more than once.

---

### Task 1: Bundle and register the Canvas font

**Files:**
- Create: `services/discord-bot/font-registry.js`
- Create: `services/discord-bot/assets/fonts/NotoSansCJKsc-Regular.otf`
- Create: `services/discord-bot/assets/fonts/OFL.txt`
- Create: `services/discord-bot/tests/font-registry.test.js`
- Modify: `services/discord-bot/canvas.js`
- Modify: `services/discord-bot/leaderboard-canvas.js`
- Modify: `services/discord-bot/package.json`

**Interfaces:**
- Produces: `BUNDLED_FONT_FAMILY` and `registerBundledFont()` from `font-registry.js`.
- Consumes: `GlobalFonts.registerFromPath()` from `@napi-rs/canvas`.

- [ ] **Step 1: Write a failing font test** that imports the new module, registers the font twice, renders `魔法 Lv.2` in normal and bold styles, and asserts a hand-set minimum number of non-background pixels.
- [ ] **Step 2: Run `node --test tests/font-registry.test.js`; expect failure because the module and asset do not exist.**
- [ ] **Step 3: Vendor the official font and license, implement idempotent registration, and switch both renderers to the private family alias.**
- [ ] **Step 4: Add the font module to `npm run check`; run the focused test, full bot suite, and syntax check with zero failures.**
- [ ] **Step 5: Commit the font, license, runtime, renderer, and test changes.**

### Task 2: Deploy and verify production glyphs

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: the reviewed Task 1 commit and existing immutable production workflow.
- Produces: an active cloud bot whose generated PNGs contain visible text.

- [ ] **Step 1: Run deployment/runtime tests and scan tracked files for secrets and unintended database artifacts.**
- [ ] **Step 2: Push the reviewed commit to `main` and dispatch `deploy-discord-bot-production.yml`.**
- [ ] **Step 3: Require successful systemd readiness and verify a production-host render contains Chinese and Latin glyph pixels.**
- [ ] **Step 4: Confirm Discord-visible profile/level imagery is no longer blank.**
