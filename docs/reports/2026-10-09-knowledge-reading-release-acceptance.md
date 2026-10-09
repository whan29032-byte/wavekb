# Knowledge reading release: verified state and remaining gate

## Release identity

- Current production and `origin/main`: `05af67a5d48dd777979797180b5e6d98c5259e6a`.
- Reader recovery change: [PR 24](https://github.com/whan29032-byte/wavekb/pull/24), merged.
- [Production deployment 37936509896](https://github.com/whan29032-byte/wavekb/actions/runs/37936509896), attempt 2: activate and finalize succeeded; rollback was skipped. Attempt 1 failed at research preheat and its failed evidence remains retained.
- Local preview on port 3114 remains available. No Hermes, trading, credentials, risk, notifications, or VPN configuration was changed by this knowledge-reading work.

## Implemented and verified changes

| Before | After | Why |
| --- | --- | --- |
| Knowledge shelf links could speculatively fetch other reading pages | Explicitly disable speculative RSC prefetch while preserving actual SPA navigation | Keep bandwidth available to the current reading page |
| A validated Range body could stall after the other three parts completed | At most one identical-Range replacement after 750 ms without positive progress, with prior ownership released first | Recover a straggler without increasing four-body concurrency or inventing completion |
| Large source PNGs were the only reading delivery format | 420 same-size, pixel-identical lossless derivatives; original PNG/PDF files are unchanged | Reduce delivery bytes while preserving source identity and native dimensions |

The fixed global four-body limit, single-image FIFO, 1.2-second worker fail-open, 12-second absolute operation deadline, full length/SHA validation, original PNG fallback, and existing native-image five-second acceptance gates remain unchanged.

## Proof and limits

- Candidate unit verification: 1,383 passed, one absent-Nginx-fixture skip; type, lint and build passed. The independent Nginx fixture subsequently passed on Ubuntu.
- Candidate local reading/navigation/worker acceptance: 102 passed with two workers and zero retries. Separate held-hydration checks: six passed. These are distinct runs, not a single 108-case result.
- The production deployment completed its browser gates, but this does not replace independent local-network acceptance.
- Independent public cold acceptance on this Mac: **74 passed, 18 failed**, two workers, zero retries. Retained evidence: `apps/web/test-results/knowledge-final-05af-cold/`; full log: `/tmp/wavekb-knowledge-final-05af-cold.log`. This run is **not fully accepted**.
- [Read-only source audit 37946277193](https://github.com/whan29032-byte/wavekb/actions/runs/37946277193): succeeded against the exact production SHA, managed static locations, complete source SHA/bytes/MIME, 200/206, transparent gzip, cache and security policies. Its loopback proof is not a public five-second performance guarantee.

The 18 failed cases comprise eight core43 image completions, two Natural Law image completions, two actual clicked-navigation RSC responses, two no-JavaScript whole-page loads, two real PNG fallbacks, and two complete PDF downloads. Correct headers and paths were received; incomplete response bodies or request startup delay prevented the original gates from passing. Cache tests failed on their first reading, so they do not establish a cache regression. Traces demonstrate that the deployed one-straggler recovery really runs; it does not guarantee timely delivery over every transport path.

## Transport diagnosis boundary

A controlled complete core43 GET with curl returned the actual 404,664-byte body in approximately 10.91 seconds both with no HTTP proxy and with the explicit local HTTP proxy. The temporary browser's corresponding requests exceeded its 12-second diagnostic deadline. These diagnostics are not acceptance reruns.

The Mac's system DNS resolves `wavekb.com` to `198.18.0.140`; the actual route to that address uses `utun6`, whose VPN interface has `198.18.0.1`. Therefore the earlier no-HTTP-proxy test did **not** establish a true VPN-bypassing path. It cannot exclude the shared tunnel or prove a specific source-server fault. No OS route, DNS, proxy, VPN, or Hermes setting was changed.

### Independent transport comparison, 2026-10-09 15:13 UTC

[Read-only diagnostic 37950069507](https://github.com/whan29032-byte/wavekb/actions/runs/37950069507), exact diagnostic commit `0124ccc310b0dabfd1871e664fe29efdb6d03dc1`, compared the same four fixed files inside the origin and from the independent GitHub runner. The exact origin release remained `05af67a5d48dd777979797180b5e6d98c5259e6a-37936509896-2` before and after the body reads. A separate execution of the same fixed public probe on the Mac performed no interception or retry.

| Actual file | Origin loopback full body | Independent public runner full body | Mac full body |
| --- | ---: | ---: | ---: |
| core43 WebP, 404,664 bytes | 0.021 s | 1.445 s | 9.772 s |
| Natural Law p007 original PNG, 307,214 decoded bytes | 0.027 s | 1.246 s | 8.985 s |
| Page 057 original PNG, 224,086 decoded bytes | 0.023 s | 1.253 s | 6.541 s |
| Natural Law PDF, 2,565,992 decoded bytes | 0.120 s | 2.155 s | Incomplete at the 12 s absolute deadline |

Both origin and independent runner verified the complete decoded byte count and original SHA of all four files. The Mac verified the three complete image bodies, but its PDF was incomplete and has no verified SHA. No table entry treats response headers or a partial body as a complete source.

The actual origin projection showed Nginx 1.24.0 with the HTTP/2 module compiled, but both WaveKB listeners and an actual validated ALPN handshake selected HTTP/1.1. The diagnostic did not change this configuration or send HTTP/2 requests. These observations justify separating the local access path from source integrity; they do not prove a particular VPN node, carrier, or HTTP/2 setting is the sole cause.

Diagnostic fixtures and related workflow/state tests: 51 passed locally, zero skips; all 18 transport fixtures also passed on the fresh Ubuntu runner. These are diagnostic-tool proofs, not a replacement for the still-failed 92-case product acceptance. The diagnostic branch is not merged into production and contains no changed frontend or knowledge source files.

Keep the failed acceptance result, source integrity checks and original time budgets intact. Further source-server or VPN/CDN changes require a specific evidence-backed scope; do not claim complete acceptance from deployment success or response headers alone.

## Follow-up candidate, 2026-10-10

The fresh remote baseline remains `05af67a5d48dd777979797180b5e6d98c5259e6a`. A trace-backed client omission was found: `AccountNavigation` used a direct Next Link, so unclicked `/login` RSC prefetch overlapped actual image Range requests. The candidate changes only that component's Link import to the existing `ReadingPriorityLink`. Anonymous login and authenticated personal links now use the reading-priority policy; non-reading routes, authentication, identity, sign-out and visible layout are unchanged.

Six additional account unit cases cover anonymous/authenticated reading and normal non-reading prefetch. The original reading-worker browser observation now checks every same-origin prefetch destination, including `/login`, rather than only `/knowledge` paths. No original image, navigation, native-size, cache or five-second assertion is weakened.

- Complete candidate unit run: **1,424 passed, one existing absent-Nginx-fixture skip**, exit 0. The 18 focused account/reading-link cases are included, not added to this total.
- Workspace typecheck and frontend lint: exit 0.
- Build using the same public Supabase and legacy-origin configuration as the production workflow: exit 0.
- Actual configured local reader/navigation/worker/hydration acceptance: **104 passed**, two workers, zero retries, 39.7 seconds. Evidence: `apps/web/test-results/knowledge-account-link-local-20261010-b/`; log: `/tmp/wavekb-knowledge-account-link-local-20261010-b.log`.
- The earlier local run was interrupted after revealing the preview build lacked the public Supabase configuration, producing a client error page. Its evidence remains in `knowledge-account-link-local-20261010-a`; it is not counted as a passing product run.
- Source assets, PDFs, knowledge corpus and generated reading-image mapping remain identical to `origin/main`.

This candidate is not yet published or fully accepted on the Mac's public access path. Removing unclicked account prefetch reduces irrelevant traffic but does not establish that all previously incomplete response bodies now meet the original gates. The original **74/92** result and all 18 failures above remain valid retained evidence until an independently recorded new run passes.

The user authorized publishing after completion. A reversible `wavekb.com`-only direct rule in the actual Shadowrocket client is prepared, but has not been saved; global VPN, other domains and Hermes remain unchanged. Once the rule is authorized at save time, verify the effective path and the same four full-body/SHA probes, then run the 14 original sparse cases and the unchanged 92-case public acceptance with zero retries and new artifact directories.

The account component change triggers `posting_required=true` in the existing deployment preflight. Production release must retain real posting and authenticated member-shell acceptance and cleanup; do not use the diagnostic-only classification or a read-only override. There are no Gateway, migration or system-service changes.
