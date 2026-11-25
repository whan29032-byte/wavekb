# Exness Binding Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Exness read-only account binding use the account-specific Gateway Host and surface safe, actionable authentication failures.

**Architecture:** The web form collects the DNS Widget Gateway Host and sends it with credentials. The Exness adapter performs all key, host and account validation before network access, maps official authentication codes to fixed internal codes, and the API boundary allowlists only those codes.

**Tech Stack:** Next.js 16, React 19, TypeScript, Node.js crypto/fetch, Vitest, Node test runner.

**Spec:** `docs/superpowers/specs/2026-11-25-exness-binding-reliability-design.md`

## Global Constraints

- Exness remains read-only and uses only GET endpoints.
- Gateway and discovered Access Point hosts must be HTTPS under `exness.com` or `exness-api.com`.
- No credential, account ID, signed header or upstream response body may appear in client errors or logs.
- Other providers keep their existing forms and request payloads.

## Review Focus

- A valid-looking 128-hex private key whose public half does not match its seed is rejected before fetch.
- Whitespace around a valid generated private key is normalized without altering its contents.
- Missing or unsafe Gateway Host cannot reach the network.
- Exness errors 1000, 1001 and 1002 remain distinguishable through the API boundary and UI.
- Existing Binance, OKX, Bybit and Bitget credential payloads remain unchanged.

---

### Task 1: Exness adapter validation and error contract

**Files:**
- Modify: `ai-gateway/test/exness-provider.test.ts`
- Modify: `ai-gateway/src/trading/providers/exness.ts`
- Modify: `ai-gateway/test/server-api.test.ts`
- Modify: `ai-gateway/src/server.ts`

**Interfaces:**
- Consumes: `ProviderCredentialInput.credentials.discoveryBaseUrl`.
- Produces: fixed errors `exness_invalid_api_key`, `exness_invalid_signature`, `exness_permission_denied`, `exness_rate_limited`, `exness_unavailable`, and validation errors.

- [ ] **Step 1: Write failing adapter tests** for trimmed valid generated keys, mismatched public halves, and official 1000/1001/1002 mappings.
- [ ] **Step 2: Run `pnpm.cmd --dir ai-gateway exec node --test test/exness-provider.test.ts`** and verify the new assertions fail for the missing behavior.
- [ ] **Step 3: Implement strict key normalization/verification and fixed error mapping** in `exness.ts`.
- [ ] **Step 4: Add a failing server API test** proving Exness fixed errors survive the public allowlist.
- [ ] **Step 5: Implement the allowlist entries** in `server.ts`.
- [ ] **Step 6: Run the adapter and server API tests** and verify they pass.
- [ ] **Step 7: Commit** with `fix(trading): harden Exness credential validation`.

### Task 2: Exness form Gateway Host and user-facing errors

**Files:**
- Modify: `apps/web/src/components/exchange-account-manager.test.tsx`
- Modify: `apps/web/src/components/exchange-account-manager.tsx`

**Interfaces:**
- Consumes: Gateway Host copied from Exness Key Management DNS Widget.
- Produces: `credentials.discoveryBaseUrl` and safe Chinese messages for each fixed Exness error.

- [ ] **Step 1: Write failing component tests** proving the host is required and submitted, official errors are translated, and non-Exness payloads do not contain the field.
- [ ] **Step 2: Run the focused Vitest file** and verify failure for the missing field/messages.
- [ ] **Step 3: Implement the Gateway Host field, copy, payload and messages** without changing other provider forms.
- [ ] **Step 4: Run the focused Vitest file** and verify it passes.
- [ ] **Step 5: Commit** with `fix(web): collect Exness gateway host`.

### Task 3: Regression, review and release

**Files:**
- Modify only if verification exposes a covered defect.

**Interfaces:**
- Consumes: Tasks 1 and 2 behavior.
- Produces: tested production candidate and deployment verification evidence.

- [ ] **Step 1: Run Gateway tests, Web tests, workspace typecheck, lint and production build.**
- [ ] **Step 2: Review the complete diff against the spec and security constraints.**
- [ ] **Step 3: Commit any test-driven review fixes and re-run affected plus full verification.**
- [ ] **Step 4: Push the feature branch and run the existing production deployment workflows.**
- [ ] **Step 5: Verify production health, exact deployed revision, and the Exness form UI.**
