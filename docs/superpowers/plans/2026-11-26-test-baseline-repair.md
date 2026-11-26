# Cross-Platform Test Baseline Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository's default test command trustworthy on Windows and Linux without weakening Linux-only deployment and filesystem-security checks.

**Architecture:** Normalize tracked text to LF at the repository boundary, then route root tests through a small platform-aware launcher. Portable tests run everywhere; tests that prove POSIX ownership, mode, Bash, systemd, or SSH behavior remain required on Linux and are explicitly reported as unsupported on Windows instead of producing false product failures.

**Tech Stack:** Node.js 22+, pnpm, `node:test`, Git attributes, GitHub Actions (Ubuntu), PGlite.

**Spec:** [Interactive trade chart sharing design](../specs/2026-11-26-interactive-trade-chart-sharing-design.md), especially sections 17 and 19.

## Global Constraints

- Do not relax production ownership, permission, symlink, `O_NOFOLLOW`, systemd, SSH, or fail-closed checks to make Windows tests pass.
- Do not skip a test merely because it currently fails. A test is POSIX-only only when its asserted contract depends on POSIX semantics or a Linux executable.
- Linux CI must still execute every root test file, including all POSIX-only suites.
- Repository text is canonical LF. Binary assets must remain byte-for-byte unchanged.
- Preserve the existing root-to-workspace test sequence: root tests first, then package tests.
- Do not mix feature work from the chart plans into this baseline repair.

## Review Focus

- Verify Windows no longer reports the known 85 false failures.
- Verify Linux CI still runs the complete suite and cannot silently omit POSIX security tests.
- Inspect the renormalization diff for changed content rather than line-ending-only noise.
- Confirm patch files, lockfiles, generated JSON, SQL, and tests have stable bytes after a fresh clone.

---

### Task 1: Lock the cross-platform runner contract with failing tests

**Files:**
- Create: `tests/root-test-runner.test.mjs`
- Create: `scripts/lib/root-test-manifest.mjs`

- [ ] Add a failing test that imports `rootTestFiles({ platform, testDirectory })` from `scripts/lib/root-test-manifest.mjs` and proves a portable file such as `tests/braces-security-backport.test.mjs` is returned on both `win32` and `linux`.
- [ ] Add a failing test that proves these suites are excluded only on `win32` and included on `linux`:
  - `tests/configure-wallet-runtime.test.mjs`
  - `tests/deploy-release.test.mjs`
  - `tests/diagnose-knowledge-transport.test.mjs`
  - `tests/hermes-theory-artifact.test.mjs`
  - `tests/integration-config-audit.test.mjs`
  - `tests/tron-readiness-probe.test.mjs`
- [ ] Add a failing assertion that every manifest entry exists and ends in `.test.mjs`; reject stale or duplicate entries.
- [ ] Run `node --test tests/root-test-runner.test.mjs` and confirm it fails because the manifest module does not exist.
- [ ] Implement only the pure manifest/discovery functions. Sort results deterministically and return `{ selected, omitted }` so omission is visible.
- [ ] Re-run `node --test tests/root-test-runner.test.mjs` and confirm it passes.
- [ ] Commit: `test: define portable and posix root suites`

### Task 2: Introduce the platform-aware root test launcher

**Files:**
- Create: `scripts/run-root-tests.mjs`
- Modify: `scripts/lib/root-test-manifest.mjs`
- Modify: `tests/root-test-runner.test.mjs`
- Modify: `package.json`

- [ ] Add tests for a pure `nodeTestArguments()` helper: Linux receives all discovered root tests; Windows receives only portable tests; `--posix-only` receives exactly the POSIX manifest and rejects Windows with a clear non-zero result.
- [ ] Run `node --test tests/root-test-runner.test.mjs`; verify the new assertions fail.
- [ ] Implement `scripts/run-root-tests.mjs` with `spawnSync(process.execPath, ["--test", ...selected])`, inherited stdio, and exact exit-code propagation. Print the omitted suite names on Windows before starting portable tests.
- [ ] Do not invoke a shell and do not build a command string; pass an argument array to prevent quoting bugs and injection.
- [ ] Add package scripts:

  ```json
  {
    "test:root": "node scripts/run-root-tests.mjs",
    "test:posix": "node scripts/run-root-tests.mjs --posix-only",
    "test": "pnpm test:root && pnpm -r --if-present test"
  }
  ```

- [ ] Re-run the runner unit test and `pnpm.cmd test:root` on Windows. The command must finish with portable failures only; at this point LF-sensitive tests are expected to remain red.
- [ ] Commit: `test: route root suites by platform`

### Task 3: Make line endings deterministic without changing binary assets

**Files:**
- Modify: `.gitattributes`
- Modify mechanically: tracked text files selected by `git add --renormalize .`
- Verify: `patches/braces@3.0.3.patch`
- Verify: `pnpm-lock.yaml`
- Verify: `apps/web/public/reading-images/**`

- [ ] Capture binary hashes before renormalization for every tracked `*.png`, `*.jpg`, `*.pdf`, `*.woff`, `*.woff2`, and other binary extension found by `git ls-files`.
- [ ] Extend `.gitattributes` with repository-wide `* text=auto eol=lf`; keep `assets/books/*.pdf binary`, and add explicit binary patterns for tracked image/font/archive formats.
- [ ] Keep `ai-gateway/knowledge/retrieval-index.json text eol=lf` explicit because tests compare it byte-for-byte.
- [ ] Run `git add --renormalize .`.
- [ ] Compare the captured binary hashes and fail the task if any binary byte changed.
- [ ] Inspect `git diff --cached --stat` and representative diffs. No semantic code, SQL, workflow, patch, or lockfile change is allowed in this task.
- [ ] Run:

  ```powershell
  pnpm.cmd install --frozen-lockfile
  node --test tests/braces-security-backport.test.mjs tests/membership-wallet-postgres.test.mjs tests/reading-images.test.mjs tests/deploy-preflight.test.mjs
  ```

  Expected: all four portable regression files pass.
- [ ] Commit: `chore: normalize repository text to lf`

### Task 4: Prove the launcher cannot hide Linux security tests

**Files:**
- Modify: `tests/root-test-runner.test.mjs`
- Modify: `.github/workflows/verify-release.yml`

- [ ] Add a test that parses `.github/workflows/verify-release.yml` and asserts the release job runs on Ubuntu and invokes the default `pnpm test` command.
- [ ] Add a test that every POSIX-only suite is selected when `platform: "linux"` and that no basename is present in both selected and omitted arrays.
- [ ] Run the runner test and confirm it fails if the workflow contract is not explicit enough.
- [ ] In `verify-release.yml`, name the existing step `Full Linux test suite` and keep `pnpm test`; add a separate `pnpm test:posix` step only if the implementation records and de-duplicates already-run files. Prefer one full Linux run over duplicate execution.
- [ ] Add a short comment next to the Windows omission manifest explaining that Ubuntu CI is the authority for filesystem/deployment security semantics.
- [ ] Run `node --test tests/root-test-runner.test.mjs` and verify all assertions pass.
- [ ] Commit: `ci: require full posix suite on linux`

### Task 5: Re-run and record the repaired baseline

**Files:**
- Create: `docs/verification/2026-11-26-test-baseline.md`

- [ ] Run `pnpm.cmd install --frozen-lockfile`.
- [ ] Run `pnpm.cmd test` and record total/pass/fail/skip plus duration in the verification note. Expected on Windows: zero failures; omitted POSIX suite names are printed explicitly.
- [ ] Run `pnpm.cmd typecheck` and record the result.
- [ ] Run `pnpm.cmd lint` and record the result. If unrelated pre-existing lint failures remain, list exact files and messages; do not declare the baseline green.
- [ ] On an Ubuntu CI runner, run `pnpm test`, `pnpm typecheck`, and `pnpm lint`. Expected: every POSIX suite executes, not skips, and the full suite is green.
- [ ] Confirm `git diff --check` is clean and `git status --short` contains only the verification note if it has not yet been committed.
- [ ] Commit: `docs: record repaired test baseline`

## Completion Gate

- Windows: `pnpm test` has zero failures and clearly lists Linux-only suites not executed locally.
- Linux CI: `pnpm test` executes all root and workspace tests with zero failures.
- `pnpm install --frozen-lockfile`, `pnpm typecheck`, and `pnpm lint` succeed.
- No production security check was weakened or platform-branched.
- Binary hashes are unchanged after renormalization.
