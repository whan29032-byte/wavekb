import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function planRelease({ cwd, baseSha, sha, schemaVersion, requiredSchema, readOnlyApproved = false }) {
  if (!/^[0-9a-f]{40}$/.test(baseSha)) throw new Error("Live base SHA is missing or invalid; acceptance scope cannot be inferred");
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("Candidate SHA is invalid");
  if (!/^[0-9]{12}$/.test(schemaVersion) || !/^[0-9]{12}$/.test(requiredSchema) || schemaVersion !== requiredSchema) {
    throw new Error("Production schema is not the explicitly supported version; stop for separately approved schema compatibility review");
  }
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try { git("cat-file", "-e", `${baseSha}^{commit}`); git("cat-file", "-e", `${sha}^{commit}`); }
  catch { throw new Error("Live base and candidate commits must both be available locally"); }
  // Two explicit commits, not github.event.before or a merge base: skipped/failed
  // releases must not omit changes since the version actually serving traffic.
  const changed = git("diff", "--no-renames", "--name-only", "-z", baseSha, sha, "--").split("\0").filter(Boolean);
  const gatewayChanged = changed.some((file) => file.startsWith("ai-gateway/") || /^deployment\/systemd\/elliott-wave-/.test(file));
  if (gatewayChanged) throw new Error("Gateway changed: a separate approved gateway deployment is required before this Next.js release");
  const postingPatterns = [
    /^apps\/web\/src\/(app\/(community|member|api\/(community|auth))\/|lib\/(community|auth|supabase|member)\/)/,
    /^apps\/web\/src\/components\/(post-|community-|comment-|research-|identity-|profile-|member-|account-navigation|nameplate|avatar-frame|social-desktop|site-header|mobile-navigation|image-viewer|tradingview)/,
    /^apps\/web\/src\/(app\/(layout\.tsx|globals\.css)|proxy\.ts|middleware\.ts|lib\/(env|pagination)\.ts)/,
    /^apps\/web\/(next\.config\.|package\.json|e2e\/(posting|member-shell)\.acceptance\.spec\.ts)/,
    /^packages\/(domain|ui)\//,
    /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|supabase\/)/,
  ];
  const postingNormallyRequired = changed.some((file) => postingPatterns.some((pattern) => pattern.test(file)));
  return { baseSha, sha, postingRequired: postingNormallyRequired && readOnlyApproved !== true, postingNormallyRequired, readOnlyApproved: readOnlyApproved === true, gatewayChanged };
}

async function readJson(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!response.ok) throw new Error("Read-only release preflight endpoint is unavailable");
  return response.json();
}

async function main() {
  const cwd = process.cwd();
  const health = await readJson("https://wavekb.com/api/health");
  if (health?.ok !== true || health.service !== "wavekb-next") throw new Error("Live application health is invalid");
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !key) throw new Error("Public schema endpoint configuration is missing");
  // This existing RPC is STABLE and returns only the schema marker. No DB URL,
  // SQL client, migration execution, service-role credential or schema writes.
  const schemaVersion = await readJson(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/wavekb_schema_version`, {
    method: "POST", headers: { apikey: key, "content-type": "application/json" }, body: "{}",
  });
  const versions = fs.readdirSync(path.join(cwd, "supabase/migrations")).filter((name) => /^[0-9]{12}_.*\.sql$/.test(name)).map((name) => name.slice(0, 12)).sort();
  const result = planRelease({ cwd, baseSha: health.deployment, sha: process.env.GITHUB_SHA, schemaVersion, requiredSchema: versions.at(-1), readOnlyApproved: process.env.READ_ONLY_ACCEPTANCE_APPROVED === "true" });
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `base_sha=${result.baseSha}\nposting_required=${result.postingRequired}\n`);
  console.log(`Read-only compatibility passed. Posting acceptance required: ${result.postingRequired}. Gateway unchanged.`);
  if (result.readOnlyApproved) console.log(`Operator explicitly approved read-only acceptance for this manual run. Normal posting classification: ${result.postingNormallyRequired}. Schema, gateway and read-only browser gates remain mandatory.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
