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

Keep the failed acceptance result, source integrity checks and original time budgets intact. Further source-server or VPN/CDN changes require a specific evidence-backed scope; do not claim complete acceptance from deployment success or response headers alone.
