import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { projectYouTubeConfigurationReceipt, YOUTUBE_RECEIPT_MAX_BYTES } from "../scripts/project-youtube-configuration.mjs";

const receipt = operation => ({ ok: true, configured: operation === "disable" ? null : true, enabled: operation === "enable",
  generatedMasterKey: operation === "stage", changed: true, appliedToRunningServices: true, workerActive: true });
const bytes = value => Buffer.from(JSON.stringify(value));
const script = fileURLToPath(new URL("../scripts/project-youtube-configuration.mjs", import.meta.url));

test("configuration receipt projection outputs only the selected operation and fixed readiness", () => {
  for (const operation of ["stage", "enable", "disable"]) {
    const result = projectYouTubeConfigurationReceipt(bytes(receipt(operation)), operation);
    assert.deepEqual(result, { ok: true, operation, enabled: operation === "enable",
      readiness: operation === "stage" ? "staged_not_enabled" : operation === "enable" ? "enabled_services_verified" : "disabled_services_verified" });
    assert.equal(Object.keys(result).length, 4);
  }
  assert.doesNotThrow(() => projectYouTubeConfigurationReceipt(bytes({ ...receipt("stage"), workerActive: false }), "stage"));
  assert.doesNotThrow(() => projectYouTubeConfigurationReceipt(bytes({ ...receipt("disable"), workerActive: false }), "disable"));
});

test("empty, ambiguous, extra and wrong-operation receipts fail closed without exposing input", () => {
  const baseline = receipt("stage");
  for (const text of ["", "not-json private value", "[]", "null", "{}", JSON.stringify(baseline) + JSON.stringify(baseline),
    JSON.stringify(baseline).replace('"ok":true', '"ok":false,"ok":true'), JSON.stringify({ ...baseline, secret: "private-value" }),
    JSON.stringify({ ...baseline, ok: false }), JSON.stringify({ ...baseline, enabled: true }),
    JSON.stringify({ ...baseline, configured: null }), JSON.stringify({ ...baseline, changed: "true" }),
    JSON.stringify({ ...baseline, generatedMasterKey: "private value" }), JSON.stringify({ ...baseline, appliedToRunningServices: false }),
    JSON.stringify({ ...baseline, workerActive: null }), JSON.stringify({ ...baseline, workerActive: "true" })]) {
    assert.throws(() => projectYouTubeConfigurationReceipt(Buffer.from(text), "stage"), { message: "youtube_configuration_receipt_invalid" });
  }
  for (const operation of ["", "preserve", "unknown", null]) assert.throws(() => projectYouTubeConfigurationReceipt(bytes(baseline), operation));
  assert.throws(() => projectYouTubeConfigurationReceipt(bytes({ ...receipt("enable"), workerActive: false }), "enable"));
  assert.throws(() => projectYouTubeConfigurationReceipt(bytes({ ...receipt("enable"), generatedMasterKey: true }), "enable"));
  assert.throws(() => projectYouTubeConfigurationReceipt(bytes({ ...receipt("disable"), configured: true }), "disable"));
  assert.throws(() => projectYouTubeConfigurationReceipt(Buffer.alloc(YOUTUBE_RECEIPT_MAX_BYTES + 1), "stage"));
  assert.throws(() => projectYouTubeConfigurationReceipt(Buffer.from([0xff, 0xfe]), "stage"));
});

test("receipt CLI returns only safe JSON or a static failure and rejects a remote exit-zero no-op", () => {
  const passed = spawnSync(process.execPath, [script, "--operation", "stage"], { input: bytes(receipt("stage")), encoding: "utf8", timeout: 10_000 });
  assert.equal(passed.status, 0); assert.equal(passed.stderr, "");
  assert.deepEqual(JSON.parse(passed.stdout), projectYouTubeConfigurationReceipt(bytes(receipt("stage")), "stage"));
  for (const input of ["", "private raw upstream error", JSON.stringify({ ...receipt("stage"), clientSecret: "never reveal" }), "x".repeat(YOUTUBE_RECEIPT_MAX_BYTES + 1)]) {
    const failed = spawnSync(process.execPath, [script, "--operation", "stage"], { input, encoding: "utf8", timeout: 10_000 });
    assert.equal(failed.status, 1); assert.equal(failed.stdout, ""); assert.equal(failed.stderr, "youtube_configuration_receipt_invalid\n");
  }
  const invalid = spawnSync(process.execPath, [script, "--operation", "stage", "--private-secret", "never reveal"], { input: bytes(receipt("stage")), encoding: "utf8", timeout: 10_000 });
  assert.equal(invalid.status, 1); assert.equal(invalid.stderr, "youtube_configuration_receipt_invalid\n");
});

test("importing the receipt projector does not consume stdin or emit a completion receipt", () => {
  const program = `await import(${JSON.stringify(new URL("../scripts/project-youtube-configuration.mjs", import.meta.url).href)}); console.log('imported');`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], { input: bytes(receipt("stage")), encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0); assert.equal(result.stdout, "imported\n"); assert.equal(result.stderr, "");
});
