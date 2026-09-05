# Tline Production Release Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline execution; the user explicitly requested deployment in the current checkout.

**Goal:** Publish the already tested in-site Tline reader through the existing production transaction without changing user data.

**Architecture:** Keep the production symlink, Nginx and existing environment file. Pass the GitHub environment secret over SSH stdin; systemd reads a root-only, per-release supplemental environment file in the protected backup directory. Rolling back the exact previous unit also restores its previous environment-file selection.

**Tech Stack:** Node.js, systemd, GitHub Actions, pnpm, Playwright.

**Spec:** `docs/tline-research.md`; user requested “上线” and explicitly selected read-only acceptance for this release.

## Global Constraints

- No database migration, user uploads replacement or writes to `/etc/wavekb/next-preview.env`.
- No secret in source, build archive, shell arguments or logs. `TLINE_API_KEY` is a GitHub environment secret and runtime-only variable.
- Production remains `/srv/wavekb-next-preview/current`, `wavekb-next-preview.service`, port 3100.
- Read-only override defaults off and is exposed only for manual workflow dispatch. All schema/gateway/build/browser/rollback gates remain mandatory.

## Task 1: Runtime secret and rollback

- [ ] Add fixture tests in `tests/deploy-release.test.mjs`: activation with a fixture key must create a 0600 `tline.env` outside the code tree; preserve old environment bytes; reference only its pathname from systemd; rollback restores the old unit. Invalid multiline input must fail before writes.
- [ ] Run `node --test tests/deploy-release.test.mjs` and observe failures.
- [ ] In `scripts/deploy-release.mjs`, validate optional `tlineApiKey` with `/^tli_[A-Za-z0-9_-]{20,200}$/`, write `TLINE_API_KEY=<value>\n` using `flag: "wx", mode: 0o600` inside the protected release backup, and append its `EnvironmentFile` to the generated unit. CLI activation requires the key read from stdin. No value enters rollback metadata.
- [ ] Run fixture suite to green. Ensure later release rotation and rollback preserve the earlier secret file.

## Task 2: Explicit read-only acceptance and workflow wiring

- [ ] Test `planRelease` with `readOnlyApproved: true`: posting is skipped but schema mismatch and gateway edits still abort; default behavior remains unchanged.
- [ ] Implement the explicit boolean option in `scripts/deploy-preflight.mjs`, with an audit log that distinguishes approved override from normal change classification.
- [ ] Add `workflow_dispatch.inputs.read_only_acceptance` (boolean, false default). Pass approval only when event is workflow_dispatch. Require runtime Tline secret before upload, pipe it over SSH stdin on activation, add production Tline browser acceptance before finalize and a read-only Nginx/current-service check before upload. No key at build time.
- [ ] Run deployment fixtures, complete tests, typecheck, lint and diff checks.

## Task 3: Publish and verify

- [ ] Back up current tracked code with `git archive`. Store the user-provided key through no-echo stdin into the GitHub `next-preview` environment secret.
- [ ] Commit this candidate with `[skip ci]`, push main, then manually dispatch this exact main commit with `read_only_acceptance=true`; this avoids an automatic mutating acceptance run. Full build and all read-only gates still execute in the manual run.
- [ ] Monitor the run, verify the production SHA and actual research rendering, and retain a report with exact backup and rollback paths. Do not claim deployment on HTTP 200 alone.
