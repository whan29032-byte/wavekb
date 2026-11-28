# 2026-11-26 test baseline verification

## Status

The Windows baseline is repaired and green. Ubuntu CI is pending and was not
run from this Windows worktree. It remains the authority for the omitted
POSIX-only filesystem and deployment suites; this record does not infer a
Linux result.

## Windows evidence

All commands below ran from the repository root on Windows using `pnpm.cmd`,
because local execution policy blocks `pnpm.ps1`.

| Command | Result |
| --- | --- |
| `pnpm.cmd install --frozen-lockfile` | Passed: all 6 workspace projects were already up to date; pnpm 11.19.0; 788 ms. |
| `pnpm.cmd test` | Passed: exit code 0; 163.5 s. The root runner reported 668 tests: 666 passed, 0 failed, 2 skipped. The portable gateway runner reported 514 passed, 0 failed, 0 skipped. The web runner reported 1,673 passed. |
| `pnpm.cmd typecheck` | Passed: all five configured workspace projects completed; 6.4 s. |
| `pnpm.cmd lint` | Passed: `apps/web` ESLint completed; 29.1 s. |

The root test launcher explicitly omitted these POSIX-only suites on Windows:

- `tests/configure-wallet-runtime.test.mjs`
- `tests/deploy-release.test.mjs`
- `tests/diagnose-knowledge-transport.test.mjs`
- `tests/hermes-theory-artifact.test.mjs`
- `tests/integration-config-audit.test.mjs`
- `tests/tron-readiness-probe.test.mjs`

The gateway launcher explicitly omitted these POSIX-only security suites on
Windows:

- `test/private-theory.test.ts`
- `test/research-configure-runtime.test.ts`
- `test/youtube-configure-runtime.test.ts`

`pnpm.cmd --filter elliott-wave-ai-gateway test:posix` rejected Windows with
`--posix-only cannot run on Windows.` and exit status 1. Linux selects every
direct gateway `test/*.test.ts` file, including those three suites.

## Corrected portable diagnostic failure

The initial Windows run exposed four portable failures in
`tests/diagnose-release-state.test.mjs` because `readMetadata` called
`process.getuid()` directly. That API is absent on Windows, and the resulting
`TypeError` was mapped to `read_error` before metadata validation could run.

`diagnoseReleaseState` now accepts an explicit `metadataOwnerUid` dependency.
Production defaults it to `process.getuid()` only when available; a missing or
non-integer UID fails closed as `unsafe_metadata_permissions`. Test fixtures
inject `fs.statSync(metadata).uid`. Existing regular-file, realpath, mode,
identity, size, and projection checks remain in place. The focused diagnostic
suite passed 18/18, including the new missing-UID fail-closed case.

## Other baseline evidence

Task 3 recorded that the 426 tracked binary candidates retained the same
ordered-manifest aggregate SHA-256 before and after LF renormalization:
`b563df6a14b8a8b0cef6dffc31ad58041a564be8300486bfdceeb2075b2abe43`.
No binary-renormalization operation was performed in this verification task.

## Required follow-up

Run `pnpm test`, `pnpm typecheck`, and `pnpm lint` on the authorized Ubuntu
CI runner and record those actual results. No Ubuntu CI run, push, or
publication was performed here.
