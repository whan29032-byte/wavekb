# Production deployment safety implementation plan

**Goal:** Deploy the tested Next.js candidate without schema writes, environment replacement, or deletion of a live release.

**Architecture:** A read-only Node preflight computes acceptance requirements from the actual live SHA. A separately testable Node release transaction owns immutable candidate preparation, backups, activation, rollback and post-acceptance cleanup. The workflow composes these boundaries; gateway changes require a separate approved release.

**Tech stack:** Node.js 22 built-ins, tar, systemd, GitHub Actions, Playwright.

**Spec:** Parent task deployment-safety requirements and local audit sections “工程结构与发布” / P1 production migration ordering.

## Constraints

- Keep `/srv/wavekb-next-preview`, `wavekb-next-preview.service`, and Nginx unchanged.
- Never write or disclose `/etc/wavekb/next-preview.env`; release wrapper supplies only deployment version.
- No production, SSH, database, push, or workflow execution during implementation.
- No commits. Tests use temporary fixtures and injected service/health boundaries.
- Gateway differences stop the Next deployment for a separately reviewed rollout.
- Writable Next cache is isolated at `applicationRoot/runtime/SHA-runid-attempt`; only that directory is owned by the service user. Source/static files, uploads and environment files are not chowned or rewritten.

## 1. Preflight

Files: `scripts/deploy-preflight.mjs`, `tests/deploy-preflight.test.mjs`.

- [x] Write isolated git fixtures: knowledge-only changes skip posting; community repository changes require posting; gateway changes fail; invalid live SHA and old schema fail.
- [x] Run `node --test tests/deploy-preflight.test.mjs` and observe expected missing-behavior failures.
- [x] Implement `planRelease({cwd, baseSha, sha, schemaVersion, requiredSchema})` using `git diff --name-only baseSha sha --` and strict 40-hex SHA / 12-digit schema validation. Never execute SQL.
- [x] Repeat tests to green. CLI reads public health and schema RPC and emits only non-secret outputs for the workflow.

## 2. Release transaction

Files: `scripts/deploy-release.mjs`, `tests/deploy-release.test.mjs`.

- [x] Write fixtures exercising the real filesystem/tar transaction and injected systemd/health: same-SHA attempts stay distinct, occupied release rejects, failed activation restores old link and unit, delayed acceptance failure restores missing old code from backup, cleanup preserves current and previous.
- [x] Run `node --test tests/deploy-release.test.mjs` to observe failures.
- [x] Implement exported `activate`, `rollback`, `finalize` with validated SHA/run/attempt, permanent transaction metadata, full previous release tar, previous unit bytes/state, exact previous health version, and protected cleanup.
- [x] Run tests to green; verify the environment fixture is byte-for-byte unchanged in success and rollback paths.

## 3. Workflow integration

File: `.github/workflows/deploy-next-production.yml`.

- [x] Order install/test/typecheck/lint/build/local browser acceptance/read-only preflight/credential check before the first remote upload.
- [x] Stage and activate only the web archive plus transaction script using a SHA-runid-attempt identity.
- [x] Run read-only production acceptance on every release; run real posting only when the preflight marks relevant changes relative to live base SHA.
- [x] Finalize only after all acceptance succeeds; on failed acceptance call rollback, retaining metadata and backups.
- [x] Run all deployment fixture tests, syntax checks and `git diff --check`; report remaining external assumptions to Root for unified review and deployment.

## Verified handoff boundaries

- Twenty-five deployment tests pass: real temporary git histories, filesystem/tar activation/rollback fixtures, explicit accepted-version recovery and interrupted-restoration resumption, simulated non-root cache ownership with actual cache writes, actual packaging of browser-generated cache fixtures, YAML parsing and shell syntax/order checks.
- Existing service must be healthy, have a readable explicit SHA health marker, and use a current symlink into its managed releases directory. Unknown states stop before activation.
- The schema marker must exactly match the repository's latest migration version; this is conservative compatibility gating, not proof of every production RLS policy.
- Protected backups/rollback metadata and runtime caches are retained. A runner or host loss can still require an operator to execute the retained rollback runner; no automatic code procedure claims to roll back database changes.
- Accepted-version manual recovery is implemented separately from failed-job rollback; see `scripts/deploy-manual-rollback.md` for its explicit previous-SHA confirmation command and interrupted-restoration procedure.
