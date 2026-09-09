# WaveKB Multi-Book AI Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one honest reading experience for all three WaveKB books and a production AI path that defaults to all books, supports strict single-book retrieval, records retrieval audit data, and returns server-expanded citations.

**Architecture:** Build one deterministic JSON retrieval artifact from canonical Units and extension-book page text. The Web app consumes the existing knowledge package for reading UI, while the standalone Gateway loads the packaged artifact, validates scope twice, filters before ranking, renders isolated prompt data, validates model citations, applies deterministic gates, and writes existing audit tables. No database migration or vector service is introduced.

**Tech Stack:** Next.js 16/React 19/TypeScript, Vitest, Node 22 test runner, Supabase REST/Postgres schema, standalone Node AI Gateway, pnpm 11.19, GitHub Actions production workflows.

**Spec:** `docs/superpowers/specs/2026-09-09-multi-book-ai-retrieval-design.md`

## Global Constraints

- The only selectable scopes are all three books or exactly one published book; default and legacy behavior is all books.
- A single-book request is filtered before ranking and never silently expands to another book.
- The tenth-edition deterministic hard-rule gate always runs, but its prose is not injected or cited when an extension book is selected.
- Extension navigation and citations must say generated/distilled; never invent verified chapters, upstream pages, missing images, rights, or authority.
- Reuse `ai_jobs.input_payload`, `ai_jobs.knowledge_version`, `knowledge_retrievals`, `ai_job_attempts`, and `ai_usage_ledger`; add no database migration.
- No embeddings, vector database, external retrieval service, model fallback to a different user connection, automated trading, or exchange write permission.
- Backend deploys before Next. No production action occurs before exact-SHA Ubuntu CI and the repository's explicit production confirmations pass.
- Every implementation task follows RED → minimal GREEN → focused/full verification → commit → independent review.

---

### Task 1: Deterministic Three-Book Retrieval Artifact

**Files:**

- Create: `scripts/lib/ai-knowledge-artifact.mjs`
- Create: `ai-gateway/knowledge/retrieval-index.json`
- Create: `tests/ai-knowledge-artifact.test.mjs`
- Modify: `scripts/build-knowledge.mjs`
- Modify: `scripts/validate-knowledge.mjs`
- Modify: `knowledge/source/library.json`
- Modify: `packages/knowledge/src/index.ts`
- Modify: `packages/knowledge/src/index.test.ts`
- Modify: `apps/web/src/lib/knowledge/book-catalog.ts`
- Modify: `apps/web/src/lib/knowledge/book-catalog.test.ts`

**Interfaces:**

- Consumes: canonical records from `knowledge/units/all.jsonl`; extension metadata from `knowledge/source/library.json`; page text from each book's `text_path`.
- Produces: `buildAiKnowledgeArtifact({ units, library, pageSources })`, `normalizeSearchText(text)`, and a committed `RetrievalArtifact` with `schemaVersion: "wavekb-ai-knowledge-v1"`, stable `knowledgeVersion`, three `books`, and deterministic `chunks`.
- Produces stable IDs: core `<book-id>::unit::<existing-unit-id>`; extension `<book-id>::page::p0001` or `p0001-c01` only when deterministic paragraph splitting is required.

- [ ] **Step 1: Write failing artifact-contract tests**

Add Node assertions that require exactly the three approved book IDs, 117 core Unit chunks, all 36/25 extension pages represented, unique chunk/source IDs, safe relative hrefs, valid SHA-256 strings, and contextual authority for extension chunks:

```js
assert.deepEqual(artifact.books.map((book) => book.bookId), [
  "elliott-wave-principle-tenth-edition",
  "elliott-wave-natural-law",
  "chan-theory-complete",
]);
assert.equal(chunksFor(CORE_BOOK_ID).filter((chunk) => chunk.kind === "unit").length, 117);
assert.deepEqual(new Set(chunksFor("elliott-wave-natural-law").flatMap((chunk) => chunk.pdfPages)).size, 36);
assert.ok(chunksFor("chan-theory-complete").every((chunk) => chunk.authority === "contextual"));
```

- [ ] **Step 2: Run RED**

Run: `node --test tests/ai-knowledge-artifact.test.mjs`

Expected: FAIL because the builder and retrieval artifact do not exist.

- [ ] **Step 3: Implement the pure builder and truth-source metadata**

Implement deterministic NFKC/lowercase/whitespace normalization plus CJK bigrams. Extend library entries with explicit `rights_status`, `redistribution_allowed`, `source_provenance`, and `derivative_of`; unknown values remain `unknown`/`null`. Synthesize the core manifest from canonical source metadata without adding a downloadable original PDF.

- [ ] **Step 4: Generate and validate the artifact**

Have `scripts/build-knowledge.mjs` write stable pretty JSON with no timestamp or absolute path. Derive `knowledgeVersion` from a SHA-256 of the sorted semantic payload. Extend `validate-knowledge.mjs` to reject duplicate IDs, unsafe hrefs, missing text, invalid pages, invalid authority/content status, and stale generated output.

- [ ] **Step 5: Correct catalog truth labels**

Expose `verifiedUnitCount: 117` separately from `readingViewCount: 146`, use “WaveKB 蒸馏 PDF” for extension artifacts, and retain all existing book slugs.

- [ ] **Step 6: Run GREEN and package checks**

Run:

```powershell
node scripts/build-knowledge.mjs
node scripts/validate-knowledge.mjs
node --test tests/ai-knowledge-artifact.test.mjs
pnpm --filter @wavekb/knowledge test
pnpm --filter @wavekb/knowledge typecheck
pnpm --filter @wavekb/web test -- src/lib/knowledge/book-catalog.test.ts
git diff --check
```

Expected: all exit 0; a second build leaves `git status --short` unchanged.

- [ ] **Step 7: Commit**

```powershell
git add scripts knowledge/source packages/knowledge ai-gateway/knowledge tests/ai-knowledge-artifact.test.mjs apps/web/src/lib/knowledge
git commit -m "feat(knowledge): build a three-book retrieval artifact"
```

---

### Task 2: One Honest Reading and Search Experience

**Files:**

- Create: `apps/web/src/app/knowledge/books/[id]/page.test.tsx`
- Create: `apps/web/src/lib/knowledge/book-reading.ts`
- Modify: `apps/web/src/app/knowledge/books/page.tsx`
- Modify: `apps/web/src/app/knowledge/books/[id]/page.tsx`
- Modify: `apps/web/src/app/knowledge/page.tsx`
- Modify: `apps/web/src/components/book-search.tsx`
- Modify: `apps/web/src/components/book-search.test.tsx`
- Modify: `apps/web/e2e/navigation.spec.ts`

**Interfaces:**

- Consumes: corrected catalog and `KnowledgeData` from Task 1.
- Produces: `buildBookReadingModel(bookId, data)` returning a shared hero, search documents, reading options, navigation entries, content blocks, source artifact label, and boundaries. Option kinds are capability-based, not a false claim that extension pages are curated Units.
- Produces: all-library search documents for core pages plus extension `text_pages` with stable book/page hrefs.

- [ ] **Step 1: Write failing shared-page tests**

Require every book page to render the same semantic regions and truthful differences:

```tsx
expect(screen.getByRole("search", { name: "搜索本书" })).toBeVisible();
expect(screen.getByRole("heading", { name: "阅读方式" })).toBeVisible();
expect(screen.getByRole("navigation", { name: "本书导航" })).toBeVisible();
expect(screen.getByRole("link", { name: "查看 WaveKB 蒸馏 PDF" })).toHaveAttribute("href", expect.stringContaining("-distilled.pdf"));
expect(screen.queryByText("已核验章节")).not.toBeInTheDocument();
```

Add a core assertion for verified Units/curated routes and extension assertions for generated navigation/boundaries.

- [ ] **Step 2: Write failing search tests**

Assert that a term found only in the Chan page text appears in global search, current-book search does not leak results from another book, page anchors are stable, whitespace is normalized, and the result limit remains bounded.

- [ ] **Step 3: Run RED**

Run:

```powershell
pnpm --filter @wavekb/web exec vitest run src/app/knowledge/books/[id]/page.test.tsx src/components/book-search.test.tsx src/lib/knowledge/book-catalog.test.ts
```

Expected: FAIL on missing shared model, extension-body global search, and truthful PDF labels.

- [ ] **Step 4: Implement the shared reading model and pages**

Replace the core/extension layout fork with one shared shell. Preserve curated core routes. For extension books render reading guide, topic tags, generated page navigation, web text, and boundaries; label generated navigation visibly.

- [ ] **Step 5: Add extension body documents to global search**

Use stable IDs `<book-id>::page::pNNNN`, include `bookId`, `bookTitle`, page number, normalized text, and `/knowledge/books/<book-id>#page-<n>` href. Do not classify these results as rules.

- [ ] **Step 6: Run GREEN and browser-contract tests**

Run focused Vitest plus:

```powershell
pnpm --filter @wavekb/web test
pnpm --filter @wavekb/web lint
pnpm --filter @wavekb/web typecheck
pnpm --filter @wavekb/web exec playwright test e2e/navigation.spec.ts
git diff --check
```

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/app/knowledge apps/web/src/components/book-search* apps/web/src/lib/knowledge apps/web/e2e/navigation.spec.ts
git commit -m "feat(web): unify the three-book reading experience"
```

---

### Task 3: Gateway Scope Contract and Deterministic Retrieval

**Files:**

- Create: `ai-gateway/src/knowledge/contracts.ts`
- Create: `ai-gateway/src/knowledge/query.ts`
- Modify: `ai-gateway/src/knowledge/index.ts`
- Modify: `ai-gateway/src/knowledge/retrieve.ts`
- Modify: `ai-gateway/src/routes/gateway-api.ts`
- Modify: `ai-gateway/test/knowledge.test.ts`
- Modify: `ai-gateway/test/server-api.test.ts`
- Modify: `ai-gateway/test/security.test.ts`

**Interfaces:**

- Consumes: `ai-gateway/knowledge/retrieval-index.json` from Task 1.
- Produces:

```ts
type KnowledgeScope = { mode: "all" } | { mode: "single"; book_id: PublishedBookId };
type NormalizedAiRunRequest = {
  request_version: 2;
  client_request_id: string;
  task_type: "wave_analysis";
  step: number;
  analysis_schema_version: "workbench-v1";
  knowledge_scope: KnowledgeScope;
};
function normalizeAiRunRequest(input: Record<string, unknown>, catalog: BookCatalog): NormalizedAiRunRequest;
function buildKnowledgeQuery(analysis: Record<string, unknown>, request: NormalizedAiRunRequest): string;
function retrieveKnowledge(index: KnowledgeIndex, request: { scope: KnowledgeScope; query: string; characterBudget: number }): KnowledgeContext;
```

- [ ] **Step 1: Write scope-contract RED tests**

Test `all`, all three valid singles, legacy missing-version → all, and rejection of unknown version/mode/book, `book_ids`, single without `book_id`, all with `book_id`, invalid UUID, invalid step/task/schema, arrays, and oversize strings.

- [ ] **Step 2: Write retrieval RED tests**

Require strict pre-ranking filter, zero cross-book leakage, per-book maximum four in all mode, maximum twelve total, maximum eight in single mode, deterministic tie ordering, character budget, CJK bigram match, duplicate suppression, and explicit no-match context.

- [ ] **Step 3: Run RED**

Run: `pnpm --dir ai-gateway test -- test/knowledge.test.ts test/server-api.test.ts test/security.test.ts`

Expected: FAIL because version-2 scope and three-book retrieval are absent.

- [ ] **Step 4: Implement artifact loading, request normalization, and query construction**

Load/validate the artifact through an injectable path, defaulting to `ai-gateway/knowledge/retrieval-index.json`. Build query only from server-selected analysis fields, step and bounded notes. Never accept client weight/path/query controls.

- [ ] **Step 5: Implement filter-first retrieval**

Score title/heading above topics above body. Preserve same-book authority/type weights. In all mode rank within each book before a stable merge; irrelevant books contribute zero chunks rather than forced matches.

- [ ] **Step 6: Enforce normalized enqueue and idempotency**

Gateway uses `ownerId:analysisId:client_request_id` for the existing unique idempotency key, stores only normalized payload, and writes the current artifact `knowledgeVersion`. A duplicate key returns the existing owner job instead of surfacing a raw unique violation.

- [ ] **Step 7: Run GREEN**

Run focused Gateway tests, then:

```powershell
pnpm --dir ai-gateway test
pnpm --dir ai-gateway typecheck
git diff --check
```

- [ ] **Step 8: Commit**

```powershell
git add ai-gateway/src/knowledge ai-gateway/src/routes/gateway-api.ts ai-gateway/test
git commit -m "feat(gateway): validate scoped multi-book retrieval"
```

---

### Task 4: Worker Retrieval, Citation, Audit, and Rule-Gate Pipeline

**Files:**

- Create: `ai-gateway/src/knowledge/runtime.ts`
- Create: `ai-gateway/test/worker-main.test.ts`
- Modify: `ai-gateway/src/worker-main.ts`
- Modify: `ai-gateway/src/prompts/render.ts`
- Modify: `ai-gateway/src/schemas/analysis-result.ts`
- Modify: `ai-gateway/src/pipeline/validate-result.ts`
- Modify: `ai-gateway/src/pipeline/rule-gate.ts`
- Modify: `ai-gateway/test/prompts.test.ts`
- Modify: `ai-gateway/test/pipeline.test.ts`

**Interfaces:**

- Consumes: normalized job payload and `KnowledgeContext` from Task 3.
- Produces `KnowledgeRuntime.run({ job, analysis, connection })`, which returns either structured insufficient evidence without invoking a provider or a validated output containing server-expanded citations.
- Produces output metadata:

```ts
type KnowledgeCitation = {
  knowledge_id: string;
  book_id: string;
  book_title: string;
  title: string;
  source_id: string;
  pages: number[];
  href: string;
  snippet: string;
};
```

- [ ] **Step 1: Refactor the worker behind injectable dependencies without changing behavior**

Add optional constructor dependencies for the database, connection resolver, clock and knowledge runtime. Keep production defaults identical. Run existing Gateway tests and commit no behavior change only if the refactor is independently reviewable; otherwise retain it in this task's final commit.

- [ ] **Step 2: Write worker RED tests for retrieval and audit ordering**

Use fakes that record calls. Require `knowledge_retrievals` POST before provider invocation, no provider call if audit fails, normalized query/scope/version persisted, no-match success without provider, and knowledge corruption → `knowledge_unavailable`.

- [ ] **Step 3: Write prompt/citation RED tests**

Assert knowledge and user text remain inside separate untrusted tags, injected “ignore system” text remains data, model citations must be a subset of retrieved chunk IDs, and server—not model—fills title/pages/href/snippet.

- [ ] **Step 4: Write rule/validation RED tests**

Require actual calls to result schema validation, deterministic risk finalization, and tenth-edition rule gate. Invalid JSON, forged citation and hard-rule-invalid scenarios cannot be written as successful raw model output.

- [ ] **Step 5: Run RED**

Run: `pnpm --dir ai-gateway test -- test/worker-main.test.ts test/prompts.test.ts test/pipeline.test.ts`

Expected: FAIL because worker currently bypasses every retrieval/pipeline module.

- [ ] **Step 6: Implement runtime and wire the worker**

Load the artifact once, validate each job again, retrieve within the provider context limit, write audit first, call `renderPromptBundle`, invoke only the chosen BYOK provider, validate citation IDs, apply deterministic finalization/rule gate, expand citations from index records, and write attempt/usage/job fields.

- [ ] **Step 7: Implement bounded failure behavior**

Auth failures end immediately; timeout/429/5xx retain current bounded retry; invalid model output gets at most one same-provider format-repair call; no-match is a successful evidence-insufficient result; none of these paths delete or overwrite the analysis draft.

- [ ] **Step 8: Run GREEN**

Run focused tests, then full Gateway test/typecheck and `git diff --check`.

- [ ] **Step 9: Commit**

```powershell
git add ai-gateway/src ai-gateway/test
git commit -m "feat(gateway): run audited knowledge-grounded analysis"
```

---

### Task 5: Workbench Scope Selector and Citation Presentation

**Files:**

- Create: `apps/web/src/components/knowledge-scope-selector.tsx`
- Create: `apps/web/src/components/knowledge-citations.tsx`
- Create: `apps/web/src/components/knowledge-scope-selector.test.tsx`
- Create: `apps/web/src/components/knowledge-citations.test.tsx`
- Modify: `apps/web/src/components/workbench-analysis-editor.tsx`
- Modify: `apps/web/src/components/workbench-analysis-editor.test.tsx`
- Modify: `apps/web/src/lib/workbench/analysis-client.ts`
- Modify: `apps/web/src/lib/workbench/analysis-client.test.ts`

**Interfaces:**

- Consumes: published book catalog and version-2 Gateway contract.
- Produces `KnowledgeScopeSelector({ value, onChange, disabled })` with four radio values: all plus three exact singles.
- Produces `KnowledgeCitations({ citations })` that renders only server-expanded metadata and safe same-origin hrefs.
- Sends one `client_request_id` per user action and reuses it for any transport retry of that action.

- [ ] **Step 1: Write selector RED tests**

Assert default all, exact three single options, keyboard-accessible fieldset/legend, disabled state while submitting, selection persistence during one editor mount, and exact version-2 payload.

- [ ] **Step 2: Write citation RED tests**

Assert book/title/page/snippet/link rendering, empty/legacy job compatibility, invalid external href refusal, and extension wording “蒸馏 PDF 第 N 页”.

- [ ] **Step 3: Write editor integration RED tests**

Mock the AI endpoint and require all/default plus one strict single payload. Complete two job responses: one with citations and one legacy output without citations. Assert neither path regresses saved analysis or manual refresh.

- [ ] **Step 4: Run RED**

Run:

```powershell
pnpm --filter @wavekb/web exec vitest run src/components/knowledge-scope-selector.test.tsx src/components/knowledge-citations.test.tsx src/components/workbench-analysis-editor.test.tsx src/lib/workbench/analysis-client.test.ts
```

- [ ] **Step 5: Implement the accessible selector and request builder**

Use catalog-derived labels but exact fixed IDs. Build `request_version: 2`, `analysis_schema_version: "workbench-v1"`, current step and selected scope. Generate `crypto.randomUUID()` once at click start.

- [ ] **Step 6: Implement citation presentation**

Replace raw-only result presentation with structured summary plus “本次知识依据”; retain a collapsible raw JSON view for diagnostics. Never display model-provided citation metadata that the server did not expand.

- [ ] **Step 7: Run GREEN and Web verification**

Run focused tests, full Web tests, lint, typecheck, build, and `git diff --check`.

- [ ] **Step 8: Commit**

```powershell
git add apps/web/src/components apps/web/src/lib/workbench
git commit -m "feat(workbench): choose AI knowledge scope and show citations"
```

---

### Task 6: Backend Packaging and Production Release Gates

**Files:**

- Modify: `.github/workflows/deploy-backend-production.yml`
- Modify: `.github/workflows/deploy-next-production.yml`
- Create: `.github/workflows/verify-release.yml`
- Modify: `tests/deploy-workflow.test.mjs`
- Create: `tests/ai-gateway-packaging.test.mjs`
- Modify: `ai-gateway/docs/operations.md`
- Modify: `README.md`

**Interfaces:**

- Consumes: committed Gateway artifact and code from Tasks 1, 3 and 4.
- Produces a backend archive containing `package.json`, `src`, `knowledge/retrieval-index.json`, and `DEPLOYMENT_VERSION` that starts outside the source checkout.
- Produces a pull-request/push-safe verification workflow plus deployment gates that accept repository schema marker `202609090001`, reject any unknown marker, run artifact freshness/Gateway tests before upload, and retain explicit backend/Next approvals.

- [ ] **Step 1: Write packaging/workflow RED tests**

Require the backend tar command to include `knowledge`, a temp extracted Gateway to load all three books, workflow marker logic to accept exactly `202609090001`, and the new non-deploying Ubuntu verification workflow to run root/Web/Gateway knowledge tests on pull requests before any production workflow is eligible.

- [ ] **Step 2: Run RED**

Run:

```powershell
node --test tests/deploy-workflow.test.mjs tests/ai-gateway-packaging.test.mjs
```

Expected: FAIL because the archive omits knowledge and the workflow only accepts the older marker.

- [ ] **Step 3: Fix archive and schema gates**

Include the generated artifact without source PDFs or secrets. Make the current marker explicit and fail closed on older/newer unknown production markers. Do not apply a database migration because this feature uses existing columns/tables.

- [ ] **Step 4: Add pre-upload tests and update operations**

Run artifact validation, Gateway test/typecheck and packaging smoke before SSH/SCP. Document backend-first deployment, legacy Web compatibility, all/single smoke jobs, retrieval audit query, exact health SHA check, and previous-symlink rollback.

- [ ] **Step 5: Run GREEN and complete local verification**

Run:

```powershell
node --test tests/deploy-workflow.test.mjs tests/ai-gateway-packaging.test.mjs
pnpm --dir ai-gateway test
pnpm --dir ai-gateway typecheck
pnpm --filter @wavekb/knowledge test
pnpm --filter @wavekb/web test
pnpm --filter @wavekb/web lint
pnpm --filter @wavekb/web typecheck
pnpm --filter @wavekb/web build
node scripts/validate-knowledge.mjs
git diff --check
```

- [ ] **Step 6: Commit**

```powershell
git add .github/workflows tests/ai-gateway-packaging.test.mjs tests/deploy-workflow.test.mjs ai-gateway/docs/operations.md README.md
git commit -m "ci: package and gate multi-book AI releases"
```

---

## Controller Final Review and Release

After all six task reviews are clean:

1. Generate a whole-plan diff from the spec commit to final implementation HEAD and dispatch one independent final reviewer.
2. Fix all Critical/Important findings in one final fix round, then run one scoped re-review.
3. Run fresh local focused suites plus Web/Gateway/knowledge/build checks. Record the known Windows-only deployment fixture limitations without claiming a green root suite if they persist.
4. Push `codex/ui-knowledge-upgrade`; create a PR against `main`; wait for exact-SHA Ubuntu `Verify WaveKB release` success.
5. Merge only after CI success and fetch the resulting main SHA.
6. Confirm the automatic Next production run failed closed before remote writes because Gateway changes were not pre-approved.
7. Dispatch `deploy-backend-production.yml` with its exact confirmation input. Wait for success; verify Gateway health SHA, worker status, one `all` AI job, one strict `single` AI job, zero cross-book citations, and matching `knowledge_retrievals` rows.
8. Dispatch `deploy-next-production.yml` for the same main SHA with `gateway_release_approved=true` and the required acceptance inputs.
9. Verify `https://wavekb.com/api/health`, three book pages, the workbench selector, all/single results, server-expanded citations, sitemap and deployed SHA. Report the exact run URLs and rollback point.

No production success is claimed until both workflows complete and the public health/version checks match the deployed main SHA.
