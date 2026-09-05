# Tline Persistent Research Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make every reader request local-only while a separate ten-minute worker synchronizes research into durable SQLite.
**Architecture:** One persistent SQLite catalogue, one background writer, read-only Next.js readers. A transactional deployment owns worker/timer state and never destroys the catalogue.
**Tech Stack:** Next.js 16.3, TypeScript, Node.js >=22.18 builtin SQLite, Vitest/Playwright, systemd, pnpm.
**Spec:** `docs/superpowers/specs/2026-09-05-tline-persistent-research-design.md` (user approved).

## Global Constraints

- Production SQLite path `/srv/wavekb-next-preview/data/tline/research.sqlite`; environment `TLINE_RESEARCH_DB_PATH`.
- Next.js readers must never initialize/write the database or call upstream, even on missing records or stale data.
- Initial synchronization: last 7 days; incremental: durable successful start watermark minus 10 minutes; limit=200 with nextCursor, max 50 pages / 10,000 records per cycle.
- Background schedule every 10 minutes; one writer; no public sync endpoint; 429 honors Retry-After, 401/403 does not retry.
- UI page size 30, fixed since/until, keyword and institution filters, last success and delayed-data indication after 20 minutes.
- No changes to Supabase/user DB/auth/uploads. Do not delete research history. No production credentials in source/artifacts/logs.
- Node>=22.18 capability verified, never upgraded implicitly. Production release only after local tests and backup; readonly acceptance, no real posting.
- Work directly in current directory/main per user's explicit prior instruction; commits use `[skip ci]`, no push/deploy by implementers. Controller handles authorized release.

### Task 1: Durable store and bounded incremental worker

**Files:** create `apps/web/src/lib/tline/store.ts`, `store.test.ts`, `sync.ts`, `sync.test.ts`, `scripts/tline-sync.mjs`; modify `.gitignore`, `apps/web/tsconfig.json` only if `.ts` import support required. Existing `client.ts` may change solely for bounded cancellation/retry support with regression tests.

**Interfaces produced:**
```ts
type SyncState = { lastSuccess: string|null; watermark: string|null; lastAttempt: string|null; errorCode: string|null; retryAt: string|null };
type StoreQuery = { since: string; until: string; q: string; institution: string; page: number };
class ResearchStore {
  constructor(file: string, options?: {readOnly?: boolean});
  status(): SyncState;
  publish(institutions: TlineRecord[], reports: TlineRecord[], startedAt: string, finishedAt: string): void;
  failure(at: string, code: string, retryAt: string|null): void;
  query(query: StoreQuery): {data:TlineRecord[];institutions:TlineRecord[];total:number;available:number;page:number;pages:number;institutionOptions:{slug:string;name:string}[]};
  detail(id:string): TlineRecord|null;
  institutions(): TlineRecord[];
  backupTo(file:string): void;
  close(): void;
}
async function syncResearch(options:{path:string;client?:Pick<TlineClient,"institutions"|"researchPage">;now?:()=>number}): Promise<{status:"synced"|"locked"|"deferred";count:number;lastSuccess:string|null}>;
```
Additional internal lease helpers allowed: lease columns in sync_state, random owner, atomic compare/update, expiry 15 minutes, total sync deadline 8 minutes; release only by matching owner. No network awaited within a SQLite transaction. Production client must observe deadline through fetch and sleeps, not only between pages. If a custom injected client ignores deadline, never publish after deadline.

- [ ] Write real-file tests first: persistence after close/reopen; readonly cannot create/write; atomic publish retains old values if validation/write fails; parameterized literal `%`, `_`, quotes; Chinese normalization; duplicate IDs update; fixed window excludes later locally first-seen records (even old upstream dates); stable id ordering; counts/pagination same transaction; backup consistency; reject symlink/nonabsolute/missing-parent/corrupt/unknown-schema paths. Example:
```ts
const store = new ResearchStore(dbFile);
store.publish([{slug:"bank",name:"机构"}], [{id:"r1",title:{zh:"黄金"},ingestedAt:"2026-09-01T00:00:00Z",institution:{slug:"bank"}}], "2026-09-05T00:00:00Z", "2026-09-05T00:01:00Z");
store.close();
const reader = new ResearchStore(dbFile,{readOnly:true});
expect(reader.detail("r1")?.title).toEqual({zh:"黄金"});
expect(reader.status().watermark).toBe("2026-09-05T00:00:00Z");
```
- [ ] Run `pnpm --filter @wavekb/web test src/lib/tline/store.test.ts src/lib/tline/sync.test.ts`; record expected missing-function failures before implementation.
- [ ] Implement schema-versioned store: raw records, institution/date/index/search fields, local first-seen timestamp; WAL, parameter binding, realpath constraints; readers readonly; no automatic purge. Validate report IDs and ingestedAt instead of inventing timestamp. Use raw data response compatible with current presentation.
- [ ] Implement sync: institutions before pages; collect+validate complete cycle then atomic publish; lastSuccess=finished time, watermark=start time; safe failure status and Retry-After; all early exits release lease; reuse same cycle from CLI. CLI accepts `sync` (default), `status`, `backup <absolute-output>`; reads DB path from env, outputs only safe counts/status, no raw API error. It is explicitly a writer/ops tool, not part of web requests.
- [ ] Add tests for successful fixed cursors and overlap, empty middle page, 401/403/429 and delayed retry, no partial mutation, recurring unique cursor cap, record cap, deadline including long sleep, concurrent separate store/process leases, lease crash recovery and owner-safe release. Run targeted and full web suite; self-review; commit `[skip ci]`; report exact APIs/TDD evidence.

### Task 2: Local-only Next.js reading and UI regression

**Files:** modify `apps/web/src/lib/tline/server.ts`, corresponding tests, `presentation.ts` window parser/tests, `app/research/page.tsx` tests, `app/research/[id]/page.tsx`, error UI, `e2e/tline.acceptance.spec.ts`; existing directory helpers may be reused for normalization but must not reload all historical records per query. Add deterministic readonly E2E fixture helper outside production modules as necessary.

**Consumes:** Task 1 ResearchStore API. **Produces:** `readResearchDirectory(params)` returns local paginated rows+institutions+counts+window+SyncState; `readResearch(id)` local detail+institutions with local-not-found error. No TlineClient instantiated by page readers.

- [ ] RED tests: seed real SQLite; unset TLINE_API_KEY and stub global fetch to throw; repeatedly call directory/search/detail and assert real content plus zero requests. Missing DB must not create a file; absent detail returns404 without fetch. Example:
```ts
vi.stubEnv("TLINE_RESEARCH_DB_PATH", seededFile);
vi.stubEnv("TLINE_API_KEY", "");
const network=vi.fn(()=>{throw new Error("network prohibited");});
vi.stubGlobal("fetch",network);
expect((await readResearch("r1")).data.id).toBe("r1");
expect(network).not.toHaveBeenCalled();
```
- [ ] Implement local reader opening and closing readOnly connections with safe errors. Validate query before DB work; reject array/overlong/malformed windows. Default until=min(now,lastSuccess), since=until-7days. On explicit since legacy links accept valid bounded duration but derive until once; preserve since/until in pagination/filter/clear navigation. Explicit Refresh starts a new local snapshot, retaining filters and resetting bounds/page, including when already at the default URL. Permit last-good stale window with warning. Existing missing DB path should render preparation state rather than break global navigation.
- [ ] Update page to DB counts/rows and status: refresh button `刷新列表`; last successful sync, 10-minute schedule, >20-minute/error warning; keep 30 items and compact existing themes. Do not imply full PDF availability. Unknown detail stays local404. Clear-filter controls remount on query change.
- [ ] Adapt tests with real-file fixtures and fake clock. Verify uppercase/Chinese/asset search across page boundaries, SQL literals, stable pagination under new sync, expired/invalid window recovery, empty initialized vs uninitialized vs stale catalogue.
- [ ] Browser acceptance with seeded runtime store and NO web process Tline key; desktop/mobile navigation, filters, prev/next, detail and refresh. Paid upstream calls are proven absent by server integration tests, not only absence of browser requests. Live acceptance uses locally synchronized real data and tolerates legitimate empty feeds.
- [ ] Run affected suites, full web tests, typecheck/lint; self-review; commit `[skip ci]` and report.

### Task 3: Worker packaging and transactional production lifecycle

**Files:** modify `apps/web/scripts/prepare-standalone.mjs`, root package scripts/docs, `.github/workflows/deploy-next-production.yml`, `scripts/deploy-release.mjs`, `tests/deploy-release.test.mjs`, workflow tests; create narrowly scoped `scripts/deploy-tline.mjs` and tests if needed to keep deploy-release focused.

**Consumes:** Task1 CLI and TS modules; Task2 readonly page. **Produces:** standalone `apps/web/tline-worker/` with CLI and portable .ts dependency files, persistent data directory, service+timer, exact rollback metadata.

- [ ] Write failing deployment-fixture tests before modifying runner: backup-before-sync, capability rejection before production mutation, stable db across two releases, atomic SQLite backup with WAL, warmup failure preserving old release, prior service/timer enabled/active restoration at each fault phase, no removal of data on rollback/finalize.
- [ ] Package portable worker using copied source modules with relative `.ts` imports (Node22.18 type stripping), not dev-only dependencies. CLI entry keeps consistent imports in source and standalone via an explicit generated launcher. Validate candidate worker exists and runs `status` against a temporary catalogue in CI; never bundle actual DB.
- [ ] Add pre-upload Node>=22.18+SQLite probe through existing pinned SSH. Extend transaction metadata to capture exact prior sync unit/timer contents/modes/existence/active/enabled state before changing either. Stop old timer/service before backup/preheat. Initial absence must not be mistaken for a failure; unexpected systemctl errors fail closed.
- [ ] Prepare `/srv/wavekb-next-preview/data/tline` safely, ownership existing deploy user; SQLite creation by worker as service user, not root. Snapshot existing catalogue via SQLite `VACUUM INTO` or supported backup API, not raw file copy. Preserve exact previous code/static backup too.
- [ ] Use isolated candidate oneshot warmup with key supplied via existing protected EnvironmentFile; DB env set explicitly; total timeout bounded; candidate run must succeed before activate. No secrets in argv or logs. Existing previous EnvironmentFile unchanged. Persist preheat-complete metadata.
- [ ] Install `wavekb-tline-sync.service` oneshot referencing current worker and supplemental protected env; `.timer` with 10-minute calendar schedule and Persistent=true. No public sync API. Enable/start timer only after ready catalogue and web switch; check next schedule and worker success. Writer filesystem access limited to catalogue directory; web read uses same DB path without remote dependence.
- [ ] Rollback restores web plus previous sync state; first install rollback disables/removes only newly created managed unit files, retains catalogue and backup. Cleanup never visits data directory. If previous writer active, restore a safe scheduled invocation without double concurrency.
- [ ] Preproduction browser tests run against deterministic initialized temp SQLite, not fake production rows; production preheat uses real key. Production acceptance checks SHA, 30-page/search/local detail, sync state, timer; no posting. Update docs accurately for rollback to old network-reading version and key references.
- [ ] Run Node deployment fixtures, full pnpm test/typecheck/lint/build and worker smoke; self-review; commit `[skip ci]`; report commands and full evidence.

### Task 4: Final review and authorized release (controller)

- [ ] Broad independent review from preimplementation `6f76b53` to final candidate; resolve load-bearing findings with regression tests.
- [ ] Verify final full suites/build and local real initial sync using no-echo credential stdin. Start Next with only DB path/public config, no Tline key; verify readonly browser flow from real persisted data and screenshots. Stop local processes afterwards.
- [ ] Archive previous/candidate source outside repo; check clean git and secrets scan. Push `[skip ci]` commits, manually dispatch `read_only_acceptance=true` exactly once. No automatic duplicate deploy.
- [ ] Wait for successful Actions transaction including rollback guards. Verify exact production health SHA and local research functionality. Observe first periodic job separately from initial warmup, or clearly state only configuration/warmup verified. Report real test counts, backup location, deferred calendar/monitoring, rollback method and any limitations.
