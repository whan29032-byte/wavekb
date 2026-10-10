import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

// Reuse ESLint's already-installed YAML parser; no new runtime dependency.
const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
const yaml = createRequire(webRequire.resolve("eslint"))("js-yaml");
const workflow = yaml.load(fs.readFileSync(new URL("../.github/workflows/deploy-next-production.yml", import.meta.url), "utf8"));
const steps = workflow.jobs["build-and-deploy"].steps;
const backendWorkflow = yaml.load(fs.readFileSync(new URL("../.github/workflows/deploy-backend-production.yml", import.meta.url), "utf8"));
const backendSteps = backendWorkflow.jobs["migrate-and-deploy"].steps;
const diagnosticWorkflow = yaml.load(fs.readFileSync(new URL("../.github/workflows/diagnose-next-production.yml", import.meta.url), "utf8"));
const diagnosticSteps = diagnosticWorkflow.jobs.diagnose.steps;
const mailWorkflow = yaml.load(fs.readFileSync(new URL("../.github/workflows/verify-mentor-email-delivery.yml", import.meta.url), "utf8"));
const mailSteps = mailWorkflow.jobs["verify-mail"].steps;
const releaseVerificationWorkflowPath = new URL("../.github/workflows/verify-release.yml", import.meta.url);
const verificationWorkflow = yaml.load(fs.readFileSync(releaseVerificationWorkflowPath, "utf8"));
const publicVerificationWorkflow = yaml.load(fs.readFileSync(new URL("../.github/workflows/deploy-static-production.yml", import.meta.url), "utf8"));
const verificationSteps = verificationWorkflow.jobs.verify.steps;
const publicVerificationSteps = publicVerificationWorkflow.jobs.verify.steps;

test("persistent candidate runs owned standalone SQLite browser and worker gates before upload", () => {
  const upload = steps.findIndex((step) => step.id === "upload");
  const fixture = steps.findIndex((step) => step.env?.TLINE_E2E_FIXTURE === "1");
  assert.ok(fixture >= 0 && fixture < upload);
  assert.equal(steps[fixture].env.TLINE_E2E_STANDALONE, "1");
  assert.equal(steps[fixture].env.PLAYWRIGHT_BASE_URL, undefined);
  assert.match(steps[fixture].run, /e2e\/tline.acceptance.spec.ts/);
  assert.ok(!/--workers=2/.test(steps[fixture].run));
  assert.ok(steps.findIndex((step) => /tline:worker:smoke/.test(step.run ?? "")) < upload);
  const probe = steps.findIndex((step) => /scripts\/probe-tline-runtime.mjs/.test(step.run ?? ""));
  assert.ok(probe >= 0 && probe < upload);
  assert.match(steps[probe].run, /ssh -i/);
  assert.ok(!steps[probe].env.TLINE_API_KEY, "runtime preflight never receives provider secret");
});

test("every emitted workflow shell program parses before a runner can execute it", () => {
  for (const step of [...steps, ...backendSteps, ...diagnosticSteps, ...mailSteps, ...verificationSteps, ...publicVerificationSteps].filter((item) => item.run)) {
    const result = spawnSync("bash", ["-n"], { input: step.run, encoding: "utf8" });
    assert.equal(result.status, 0, `${step.name}: ${result.stderr}`);
  }
});

test("full book and real image completion gates run before upload and before finalizing production without retries", () => {
  const upload = steps.findIndex((step) => step.id === "upload");
  const finalize = steps.findIndex((step) => /Finalize only/.test(step.name));
  const local = steps.findIndex((step) => /Verify local critical browser journeys/.test(step.name));
  const live = steps.findIndex((step) => /Verify production version and read-only browser journeys/.test(step.name));
  assert.ok(local >= 0 && local < upload && live > upload && live < finalize);
  for (const index of [local, live]) {
    for (const file of ["eleventh-edition-reading", "core-book-illustrations", "book-reading-navigation", "knowledge-reading-content", "natural-law-illustrations", "knowledge-image-delivery"]) {
      assert.ok(steps[index].run.includes(`e2e/${file}.spec.ts`), `Missing ${file} completion gate`);
    }
    assert.match(steps[index].run, /--workers=2 --retries=0/);
    assert.match(steps[index].run, /e2e\/reading-image-worker\.spec\.ts/);
  }
  assert.match(steps[live].run, /--grep 'real first-visit reading-worker delivery' --workers=2 --retries=0/);
});

test("candidate owns its actual Node process, validates the exact SHA and retains failed browser evidence", () => {
  const local = steps.find((step) => /Verify local critical browser journeys/.test(step.name));
  assert.match(local.run, /node apps\/web\/\.next\/standalone\/apps\/web\/server\.js[^\n]* &/);
  assert.match(local.run, /kill -0 "\$candidate_pid"/);
  assert.match(local.run, /assert\.equal\(health\.deployment, process\.env\.DEPLOYMENT_VERSION\)/);
  assert.match(local.run, /tail -n 200 \/tmp\/wavekb-candidate-acceptance\.log/);
  assert.match(local.run, /wait "\$candidate_pid"/);
  assert.match(local.run, /e2e\/navigation\.spec\.ts e2e\/book-navigation-hydration\.spec\.ts --workers=2 --retries=0/);
  const evidence = steps.find((step) => /Preserve failed local browser evidence/.test(step.name));
  assert.equal(evidence.if, "failure()");
  assert.equal(evidence.uses, "actions/upload-artifact@v4");
  assert.equal(evidence.with["retention-days"], 3);
  assert.match(evidence.with.path, /apps\/web\/test-results\//);
  assert.match(evidence.with.path, /wavekb-candidate-acceptance\.log/);
  assert.doesNotMatch(JSON.stringify(evidence), /secrets\.|\.env|\.sqlite/);
  const live = steps.find((step) => /Verify production version and read-only browser journeys/.test(step.name));
  assert.doesNotMatch(live.run, /book-navigation-hydration/);
});

test("YouTube worker is optional, secret-free in deployment and covered by rollback", () => {
  const activation = backendSteps.find((step) => /Activate gateway/.test(step.name));
  const contracts = backendSteps.find((step) => /Verify gateway and deployment contracts/.test(step.name));
  assert.match(contracts.run, /youtube-sync-postgres\.test\.mjs/);
  assert.match(activation.run, /units=\([^)]*elliott-wave-youtube-sync\.service/);
  assert.match(activation.run, /try-restart elliott-wave-youtube-sync\.service \|\| true/);
  assert.match(activation.run, /is-active elliott-wave-youtube-sync\.service/);
  const unit = fs.readFileSync(new URL("../deployment/systemd/elliott-wave-youtube-sync.service", import.meta.url), "utf8");
  assert.match(unit, /ExecStart=\/usr\/bin\/node src\/youtube-sync-worker\.ts/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /DynamicUser=yes/);
  assert.doesNotMatch(JSON.stringify(backendSteps), /YOUTUBE_OAUTH_CLIENT_SECRET|YOUTUBE_TOKEN_MASTER_KEY/);
});

test("one email test is opt-in, isolated from real orders and idempotent across reruns", () => {
  const inputs = (mailWorkflow.on ?? mailWorkflow.true).workflow_dispatch.inputs;
  assert.equal(inputs.operation.default, "check-config");
  assert.equal(mailWorkflow.concurrency["cancel-in-progress"], false);
  const validation = mailSteps.find((step) => /Validate the narrow operation/.test(step.name));
  const run = mailSteps.find((step) => /Run the isolated mail verifier/.test(step.name));
  assert.match(validation.run, /SEND_ONE_TEST_EMAIL/);
  assert.match(run.run, /wavekb-email-smoke:/);
  assert.doesNotMatch(run.run, /GITHUB_RUN_ATTEMPT|\bpsql\b|mentor_orders|mentor-notification-worker/);
  assert.doesNotMatch(JSON.stringify(mailSteps), /MENTOR_EMAIL_API_KEY|MENTOR_EMAIL_FROM/);
});

test("disposable mentor account diagnostics require explicit opt-in and do not run on release diagnostics", () => {
  const inputs = (diagnosticWorkflow.on ?? diagnosticWorkflow.true).workflow_dispatch.inputs;
  assert.equal(inputs.operation.default, "release");
  const account = diagnosticSteps.find((step) => /disposable ordinary mentor buyer/.test(step.name));
  const release = diagnosticSteps.find((step) => /Read allow-listed retained release state/.test(step.name));
  assert.equal(account.if, "inputs.operation == 'mentor-account'");
  assert.equal(release.if, "inputs.operation == 'release'");
  assert.match(account.run, /test "\$ACCOUNT_CONFIRMATION" = CREATE_DISPOSABLE_MENTOR_AUDIT_ACCOUNT/);
  assert.match(account.run, /scripts\/mentor-account-audit\.mjs/);
  assert.match(account.run, /gha-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/);
  assert.doesNotMatch(account.run, /gateway\.env|mentor_orders|submit_mentor|\bpsql\b/);
});

test("backend deployment migrates only the exact predecessor schema before upload and rolls gateway code back on activation failure", () => {
  const contractVerification = backendSteps.find((step) => /Verify gateway and deployment contracts/.test(step.name));
  const hostPreflight = backendSteps.findIndex((step) => /Verify gateway host/.test(step.name));
  const schemaGate = backendSteps.findIndex((step) => /schema marker/.test(step.name));
  const upload = backendSteps.findIndex((step) => /Upload gateway archive/.test(step.name));
  const activation = backendSteps.findIndex((step) => /Activate gateway/.test(step.name));
  const publicSchemaCheck = backendSteps.findIndex((step) => /Verify the public schema marker/.test(step.name));
  assert.ok(hostPreflight >= 0 && hostPreflight < schemaGate && schemaGate < publicSchemaCheck && publicSchemaCheck < upload && upload < activation);
  assert.match(contractVerification.run, /trading-leaderboard-postgres\.test\.mjs/);
  for (const filename of ["admin-payment-hardening-postgres", "mentor-payment-webhook", "mentor-checkout-function", "membership-foundation-postgres", "membership-commerce-postgres", "membership-payment-functions", "membership-benefits-postgres", "membership-wallet-postgres", "membership-wallet-functions"]) {
    assert.ok(contractVerification.run.includes(`tests/${filename}.test.mjs`), `${filename} must gate backend migration and upload`);
  }
  assert.match(backendSteps[schemaGate].run, /schema_before=.*wavekb_schema_version/);
  assert.match(backendSteps[schemaGate].run, /202609090002\)[\s\S]*202609100001_reward_lottery_manual_fulfillment\.sql[\s\S]*202610080001_admin_custom_trading_display\.sql/);
  assert.match(backendSteps[schemaGate].run, /202609100001\)[\s\S]*202610080001_admin_custom_trading_display\.sql/);
  assert.match(backendSteps[schemaGate].run, /202610080001\)[\s\S]*202610080002_mentor_checkout_recovery\.sql[\s\S]*202610080003_mentor_payment_notifications\.sql/);
  assert.match(backendSteps[schemaGate].run, /202610080003\)[\s\S]*202610080004_youtube_auto_posts\.sql/);
  assert.match(backendSteps[schemaGate].run, /202610080004\)[\s\S]*202610100001_admin_payment_hardening\.sql[\s\S]*202610100002_membership_foundation\.sql/);
  assert.match(backendSteps[schemaGate].run, /202610100001\)[\s\S]*202610100002_membership_foundation\.sql/);
  assert.match(backendSteps[schemaGate].run, /202610100002\)[\s\S]*202610100003_membership_commerce\.sql[\s\S]*202610100004_membership_benefits\.sql/);
  assert.match(backendSteps[schemaGate].run, /202610100003\)[\s\S]*202610100004_membership_benefits\.sql/);
  assert.match(backendSteps[schemaGate].run, /202610100004\)[\s\S]*already applied/);
  assert.match(backendSteps[schemaGate].run, /Unexpected production schema marker; refusing migration/);
  assert.match(backendSteps[schemaGate].run, /202610100005\)[\s\S]*already applied/);
  for (const table of ["settings", "routes", "orders", "grants", "verifications", "receipts", "events"]) {
    assert.ok(backendSteps[schemaGate].run.includes(`membership_wallet_${table}`));
  }
  assert.match(backendSteps[schemaGate].run, /test "\$wallet_rls_tables" = 7/);
  assert.match(backendSteps[schemaGate].run, /test "\$schema_after" = 202610100005/);
  assert.doesNotMatch(backendSteps[schemaGate].run, /supabase\/migrations\/\*|for migration/);
  assert.equal(backendSteps[schemaGate].env.SUPABASE_DB_URL, "${{ secrets.SUPABASE_DB_URL }}");
  assert.match(backendSteps[publicSchemaCheck].run, /test "\$schema" = 202610100005/);
  assert.ok(publicSchemaCheck < upload, "the public schema cache must agree before the first release upload");
  assert.match(backendSteps[activation].run, /rollback\(\)/);
  assert.match(backendSteps[activation].run, /previous-release/);
  assert.match(backendSteps[activation].run, /legacy_layout/);
  assert.match(backendSteps[activation].run, /sudo mv "\$current_link" "\$previous"/);
  assert.doesNotMatch(backendSteps[activation].run, /gateway\.env.*(?:cat|sed|awk)/);
});

test("every known backend marker selects only its unapplied migration suffix and unknown markers stop", () => {
  const migrationStep = backendSteps.find((step) => /Apply exact production migrations/.test(step.name));
  const selection = migrationStep.run.match(/case "\$schema_before" in[\s\S]*?(?=\n\s*schema_after=)/)?.[0];
  assert.ok(selection);
  const migrations = [
    "202609100001_reward_lottery_manual_fulfillment.sql",
    "202610080001_admin_custom_trading_display.sql",
    "202610080002_mentor_checkout_recovery.sql",
    "202610080003_mentor_payment_notifications.sql",
    "202610080004_youtube_auto_posts.sql",
    "202610100001_admin_payment_hardening.sql",
    "202610100002_membership_foundation.sql",
    "202610100003_membership_commerce.sql",
    "202610100004_membership_benefits.sql",
    "202610100005_membership_wallet_payments.sql",
  ];
  const program = `set -eu
schema_before="$WAVEKB_TEST_SCHEMA"
SUPABASE_DB_URL=fixture
psql() {
  case " $* " in *" ON_ERROR_STOP=1 "*) ;; *) return 9 ;; esac
  while [ "$#" -gt 0 ]; do
    if [ "$1" = -f ]; then printf '%s\\n' "$2"; return 0; fi
    shift
  done
  return 9
}
${selection}`;
  for (const [marker, offset] of [
    ["202609090002", 0], ["202609100001", 1], ["202610080001", 2], ["202610080002", 3],
    ["202610080003", 4], ["202610080004", 5], ["202610100001", 6], ["202610100002", 7],
    ["202610100003", 8], ["202610100004", 9], ["202610100005", 10],
  ]) {
    const result = spawnSync("bash", ["-c", program], { env: { PATH: process.env.PATH, WAVEKB_TEST_SCHEMA: marker }, encoding: "utf8" });
    assert.equal(result.status, 0, `${marker}: ${result.stderr}`);
    const selected = result.stdout.split(/\r?\n/).filter((line) => line.startsWith("supabase/migrations/"));
    assert.deepEqual(selected, migrations.slice(offset).map((name) => `supabase/migrations/${name}`), marker);
  }
  for (const marker of ["", "202609090001", "202610100006", "invalid"]) {
    const result = spawnSync("bash", ["-c", program], { env: { PATH: process.env.PATH, WAVEKB_TEST_SCHEMA: marker }, encoding: "utf8" });
    assert.notEqual(result.status, 0, marker);
    assert.doesNotMatch(result.stdout, /supabase\/migrations\//);
  }
});

test("mentor notification worker is packaged, installed, health-checked and included in rollback", () => {
  const upload = backendSteps.find((step) => /Upload gateway archive/.test(step.name));
  const activation = backendSteps.find((step) => /Activate gateway/.test(step.name));
  const contracts = backendSteps.find((step) => /Verify gateway and deployment contracts/.test(step.name));
  assert.match(contracts.run, /mentor-checkout-postgres\.test\.mjs/);
  assert.match(contracts.run, /mentor-notification-postgres\.test\.mjs/);
  assert.match(upload.run, /for unit in [^;]*elliott-wave-mentor-notifications\.service/);
  assert.match(activation.run, /units=\([^)]*elliott-wave-mentor-notifications\.service/);
  assert.match(activation.run, /sudo systemctl try-restart elliott-wave-mentor-notifications\.service \|\| true/);
  assert.match(activation.run, /sudo systemctl enable --now elliott-wave-mentor-notifications\.service/);
  assert.match(activation.run, /is-active elliott-wave-mentor-notifications\.service/);
  const unit = fs.readFileSync(new URL("../deployment/systemd/elliott-wave-mentor-notifications.service", import.meta.url), "utf8");
  assert.match(unit, /EnvironmentFile=\/etc\/elliott-wave\/gateway\.env/);
  assert.match(unit, /ExecStart=\/usr\/bin\/node src\/mentor-notification-worker\.ts/);
  assert.match(unit, /DynamicUser=yes/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.doesNotMatch(JSON.stringify(backendSteps), /MENTOR_EMAIL_API_KEY|MENTOR_EMAIL_FROM/,
    "deployment must preserve server mail configuration, never copy keys into artifacts");
});

test("backend artifact, gateway, and packaging checks all precede the first upload", () => {
  const upload = backendSteps.findIndex((step) => /Upload gateway archive/.test(step.name));
  assert.ok(upload > 0);
  for (const command of [
    /node scripts\/validate-knowledge\.mjs/,
    /pnpm --dir ai-gateway test/,
    /pnpm --dir ai-gateway typecheck/,
    /node --test tests\/ai-gateway-packaging\.test\.mjs/,
  ]) {
    const index = backendSteps.findIndex((step) => command.test(step.run ?? ""));
    assert.ok(index >= 0 && index < upload, `${command} must gate the first backend upload`);
  }
});

test("release verification runs on Ubuntu for pull requests and pushes without deployment access", () => {
  assert.ok(fs.existsSync(releaseVerificationWorkflowPath), "verify-release.yml must exist");
  const verification = yaml.load(fs.readFileSync(releaseVerificationWorkflowPath, "utf8"));
  const triggers = verification.on ?? verification.true;
  assert.ok(triggers.pull_request !== undefined);
  assert.ok(triggers.push !== undefined);
  assert.ok(triggers.workflow_call !== undefined);
  const jobs = Object.values(verification.jobs);
  assert.ok(jobs.length > 0 && jobs.every((job) => job["runs-on"] === "ubuntu-latest"));
  const serialized = JSON.stringify(verification);
  for (const command of [
    /pnpm test/,
    /pnpm audit:prod/,
    /pnpm --filter @wavekb\/web test/,
    /pnpm --dir ai-gateway test/,
    /pnpm --filter @wavekb\/knowledge test/,
    /node scripts\/validate-knowledge\.mjs/,
  ]) assert.match(serialized, command);
  const installIndex = verification.jobs.verify.steps.findIndex((step) => step.run === "pnpm install --frozen-lockfile");
  const auditIndex = verification.jobs.verify.steps.findIndex((step) => step.run === "pnpm audit:prod");
  assert.ok(installIndex >= 0 && auditIndex > installIndex);
  assert.notEqual(verification.jobs.verify.steps[auditIndex]["continue-on-error"], true);
  assert.doesNotMatch(serialized, /environment|secrets\.|\bssh\b|\bscp\b|workflow_dispatch/);
});

test("release verification requires real isolated PostgreSQL wallet lock races without production access", () => {
  const rootTests = verificationSteps.findIndex((step) => step.run === "pnpm test");
  const postgres = verificationSteps.findIndex((step) => /Verify wallet concurrency/.test(step.name));
  assert.ok(postgres > rootTests);
  const step = verificationSteps[postgres];
  assert.match(step.run, /mktemp -d \/tmp\/wavekb-postgres-concurrency\.XXXXXX/);
  assert.match(step.run, /npm install --prefix "\$task_postgres_dir" --no-audit --no-fund embedded-postgres@18\.4\.0-beta\.17 pg@8\.16\.3/);
  assert.match(step.run, /WAVEKB_ISOLATED_POSTGRES_MODULE_ROOT="\$task_postgres_dir" node --test tests\/membership-wallet-concurrency-postgres\.test\.mjs/);
  assert.notEqual(step["continue-on-error"], true);
  assert.doesNotMatch(JSON.stringify(step), /DATABASE_URL|SUPABASE|secrets\.|--force|\|\| true/);
  const source = fs.readFileSync(new URL("../tests/membership-wallet-concurrency-postgres.test.mjs", import.meta.url), "utf8");
  assert.match(source, /pg_stat_activity/);
  assert.match(source, /assert\.notEqual\(pids\[0\],pids\[1\]\)/);
  assert.match(source, /await pg\.stop\(\)/);
});

test("both non-deployment verification jobs explicitly run the actual disposable Nginx fixture", () => {
  for (const candidate of [verificationWorkflow, publicVerificationWorkflow]) {
    const job = candidate.jobs.verify;
    assert.equal(job.env.KNOWLEDGE_NGINX_TEST_BIN, "/usr/sbin/nginx");
    const install = job.steps.findIndex((step) => /apt-get install[^\n]*nginx/.test(step.run ?? ""));
    const rootTests = job.steps.findIndex((step) => step.run === "pnpm test");
    assert.ok(install >= 0 && rootTests > install);
    assert.match(job.steps[install].run, /set -Eeuo pipefail/);
    assert.match(job.steps[install].run, /test -x "\$KNOWLEDGE_NGINX_TEST_BIN"/);
    assert.notEqual(job.steps[install]["continue-on-error"], true);
    assert.equal(job.environment, undefined);
    assert.equal(candidate.permissions.contents, "read");
  }
});

test("both non-deployment verification jobs execute all mock membership UI with no retries and preserve browser evidence", () => {
  for (const candidate of [verificationWorkflow, publicVerificationWorkflow]) {
    const jobSteps = candidate.jobs.verify.steps;
    const nextBuild = jobSteps.findIndex((step) => /@wavekb\/web build/.test(step.run ?? ""));
    const storyBuild = jobSteps.findIndex((step) => /@wavekb\/web storybook:build/.test(step.run ?? ""));
    const chromium = jobSteps.findIndex((step) => /playwright install --with-deps chromium/.test(step.run ?? ""));
    const uiIndex = jobSteps.findIndex((step) => /playwright test --config=playwright\.ui\.config\.ts/.test(step.run ?? ""));
    assert.ok(nextBuild >= 0 && nextBuild < storyBuild && storyBuild < chromium && chromium < uiIndex);
    assert.equal(jobSteps[uiIndex].env.STORYBOOK_TEST_BASE_URL, "");
    assert.match(jobSteps[uiIndex].run, /--retries=0/);
    assert.match(jobSteps[uiIndex].run, /--reporter=github,html/);
    assert.doesNotMatch(jobSteps[uiIndex].run, /--grep|--project|e2e-ui\//);
    assert.notEqual(jobSteps[uiIndex]["continue-on-error"], true);
    const evidence = jobSteps.find((step) => step.uses === "actions/upload-artifact@v4");
    assert.equal(evidence.if, "always()");
    assert.match(evidence.with.path, /^apps\/web\/test-results\/(?:\n|$)/);
    assert.match(evidence.with.path, /apps\/web\/playwright-report\//);
    assert.equal(evidence.with["retention-days"], 3);
    assert.doesNotMatch(JSON.stringify(jobSteps), /secrets\./);
    assert.doesNotMatch(evidence.with.path, /\.env|\.sqlite/);
  }
  const uiConfig = fs.readFileSync(new URL("../apps/web/playwright.ui.config.ts", import.meta.url), "utf8");
  assert.match(uiConfig, /testDir: "\.\/e2e-ui"/);
  assert.ok(fs.existsSync(new URL("../apps/web/e2e-ui/membership.spec.ts", import.meta.url)));
});

test("non-deployment guest acceptance consumes the owned built standalone with exact SHA and no retries or account writes", () => {
  const build = publicVerificationSteps.find((step) => step.name === "Build the Next.js application");
  const guest = publicVerificationSteps.find((step) => step.name === "Run public route acceptance tests");
  assert.equal(build.env.DEPLOYMENT_VERSION, "${{ github.sha }}");
  assert.equal(guest.env.DEPLOYMENT_VERSION, build.env.DEPLOYMENT_VERSION);
  assert.equal(guest.env.PLAYWRIGHT_BASE_URL, "http://127.0.0.1:3108");
  assert.equal(guest.env.E2E_POSTING_IDENTIFIER, "");
  assert.equal(guest.env.E2E_POSTING_PASSWORD, "");
  assert.equal(guest.env.TLINE_E2E_FIXTURE, "");
  assert.equal(guest.env.TLINE_LIVE_ACCEPTANCE, "");
  for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]) {
    assert.equal(typeof publicVerificationWorkflow.env[key], "string");
    assert.ok(publicVerificationWorkflow.env[key]);
    assert.equal(build.env[key], undefined, `${key} is inherited from the same job for build and runtime`);
    assert.equal(guest.env[key], undefined, `${key} is inherited from the same job for build and runtime`);
  }
  assert.match(publicVerificationWorkflow.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, /^sb_publishable_/);
  assert.match(guest.run, /node apps\/web\/\.next\/standalone\/apps\/web\/server\.js[^\n]* &/);
  assert.match(guest.run, /kill -0 "\$candidate_pid"/);
  assert.match(guest.run, /assert\.equal\(health\.deployment, process\.env\.DEPLOYMENT_VERSION\)/);
  assert.match(guest.run, /trap cleanup_guest_candidate EXIT/);
  assert.match(guest.run, /exit "\$candidate_status"/);
  assert.match(guest.run, /playwright test --retries=0/);
  assert.match(guest.run, /--reporter=github,html/);
  assert.doesNotMatch(guest.run, /--timeout|pnpm dev/);
  assert.notEqual(guest["continue-on-error"], true);
  const evidence = publicVerificationSteps.find((step) => step.uses === "actions/upload-artifact@v4");
  assert.match(evidence.with.path, /\/tmp\/wavekb-guest-candidate\.log/);
});

test("both production workflows require reusable exact-ref verification before deployment", () => {
  const expectedUses = "./.github/workflows/verify-release.yml";
  for (const [candidate, deployJobId] of [
    [backendWorkflow, "migrate-and-deploy"],
    [workflow, "build-and-deploy"],
  ]) {
    const prerequisite = candidate.jobs["verify-release"];
    assert.equal(prerequisite?.uses, expectedUses);
    assert.equal(Object.hasOwn(prerequisite ?? {}, "runs-on"), false, "a reusable workflow caller cannot set runs-on");
    assert.equal(Object.hasOwn(prerequisite ?? {}, "steps"), false, "a reusable workflow caller cannot set steps");
    const needs = candidate.jobs[deployJobId].needs;
    assert.ok(needs === "verify-release" || (Array.isArray(needs) && needs.includes("verify-release")));
  }

  const verification = yaml.load(fs.readFileSync(releaseVerificationWorkflowPath, "utf8"));
  const checkout = verification.jobs.verify.steps.find((step) => step.uses?.startsWith("actions/checkout"));
  assert.equal(checkout?.with?.ref, "${{ github.sha }}");
});

test("backend and Next production releases retain explicit operator approval gates", () => {
  const backendTriggers = backendWorkflow.on ?? backendWorkflow.true;
  const nextTriggers = workflow.on ?? workflow.true;
  assert.ok(backendTriggers.workflow_dispatch.inputs.confirmation.required);
  assert.ok(backendWorkflow.jobs["migrate-and-deploy"].environment);
  assert.match(JSON.stringify(backendSteps), /DEPLOY_WAVEKB_BACKEND/);
  assert.ok(nextTriggers.workflow_dispatch.inputs.gateway_release_approved);
  assert.match(JSON.stringify(steps), /GATEWAY_RELEASE_APPROVED/);
  assert.ok(workflow.jobs["build-and-deploy"].environment);
});

test("build, local browser gates and read-only compatibility precede every remote write", () => {
  const firstWrite = steps.findIndex((step) => /\bscp\b|\bssh -i/.test(step.run ?? ""));
  assert.ok(firstWrite > 0);
  for (const command of [/pnpm test/, /pnpm typecheck/, /@wavekb\/web build/, /playwright test e2e\/navigation/, /playwright\.ui\.config/, /node scripts\/deploy-preflight/]) {
    const index = steps.findIndex((step) => command.test(step.run ?? ""));
    assert.ok(index >= 0 && index < firstWrite, `${command} must gate the first production write`);
  }
  assert.equal(steps.find((step) => step.uses?.startsWith("actions/checkout"))?.with?.["fetch-depth"], 0);
  assert.ok(!steps.some((step) => /\bpsql\b|SUPABASE_DB_URL/.test(JSON.stringify(step))));
});

test("real posting is conditional on live-base preflight and cleanup follows all acceptance", () => {
  const posting = steps.findIndex((step) => /e2e\/posting\.acceptance\.spec/.test(step.run ?? ""));
  assert.equal(steps[posting].if, "steps.preflight.outputs.posting_required == 'true'");
  const finalization = steps.findIndex((step) => /\.mjs finalize /.test(step.run ?? ""));
  assert.ok(finalization > posting);
  const rollback = steps.find((step) => /\.mjs rollback /.test(step.run ?? ""));
  assert.equal(rollback.if, "(failure() || cancelled()) && steps.upload.outcome == 'success'");
});

test("the real workflow package excludes browser-generated cache while preserving code and static files", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "wavekb-package-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const standalone = path.join(directory, "apps/web/.next/standalone/apps/web");
  fs.mkdirSync(path.join(standalone, ".next/cache/images"), { recursive: true });
  fs.mkdirSync(path.join(standalone, ".next/static"));
  fs.writeFileSync(path.join(standalone, "server.js"), "server");
  fs.writeFileSync(path.join(standalone, ".next/cache/images/local.webp"), "local acceptance cache");
  fs.writeFileSync(path.join(standalone, ".next/static/app.js"), "static");
  fs.writeFileSync(path.join(standalone, "research.sqlite"), "private database must not ship");
  fs.writeFileSync(path.join(standalone, "research.sqlite-wal"), "private WAL must not ship");
  const packaging = steps.find((step) => /^tar -C apps\/web\/\.next\/standalone/.test(step.run ?? ""));
  const result = spawnSync("bash", ["-c", packaging.run], { cwd: directory, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const archive = spawnSync("tar", ["-tzf", "wavekb-next-preview.tar.gz"], { cwd: directory, encoding: "utf8" });
  assert.equal(archive.status, 0);
  const entries = archive.stdout.split(/\r?\n/);
  assert.ok(entries.includes("./apps/web/server.js"));
  assert.ok(entries.includes("./apps/web/.next/static/app.js"));
  assert.ok(!entries.some((entry) => entry.startsWith("./apps/web/.next/cache")), "local acceptance cache must not enter immutable release package");
  assert.ok(!entries.some((entry) => entry.includes(".sqlite")), "catalogues and WAL never enter production archives");
  assert.ok(fs.existsSync(path.join(standalone, ".next/cache/images/local.webp")), "packaging does not delete local cache or user files");
});
