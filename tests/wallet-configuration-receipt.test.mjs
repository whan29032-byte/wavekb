import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { projectWalletConfigurationReceipt } from "../scripts/project-wallet-configuration.mjs";

const receipt = operation => ({ ok: true, operation, enabled: operation === "enable", workerRunning: true,
  ethereumReady: true, baseReady: true, tronReady: true, changed: operation === "enable" });
const bytes = value => Buffer.from(JSON.stringify(value));
const script = fileURLToPath(new URL("../scripts/project-wallet-configuration.mjs", import.meta.url));

test("only complete operation-bound worker and chain readiness receipts pass", () => {
  for (const operation of ["enable", "probe"]) assert.deepEqual(projectWalletConfigurationReceipt(bytes(receipt(operation)), operation), receipt(operation));
  assert.doesNotThrow(() => projectWalletConfigurationReceipt(bytes({ ...receipt("enable"), changed: false }), "enable"));
  assert.doesNotThrow(() => projectWalletConfigurationReceipt(bytes({ ...receipt("probe"), enabled: true }), "probe"));
  for (const field of ["ok", "enabled", "workerRunning", "ethereumReady", "baseReady", "tronReady"])
    assert.throws(() => projectWalletConfigurationReceipt(bytes({ ...receipt("enable"), [field]: false }), "enable"));
  assert.throws(() => projectWalletConfigurationReceipt(bytes(receipt("enable")), "probe"));
  assert.throws(() => projectWalletConfigurationReceipt(bytes({ ...receipt("probe"), changed: true }), "probe"));
});

test("empty, ambiguous, extra, oversized and untrusted receipts fail without revealing input", () => {
  for (const value of ["", "private upstream error", "null", "[]", "{}", JSON.stringify(receipt("enable")) + JSON.stringify(receipt("enable")),
    JSON.stringify(receipt("enable")).replace('"ok":true', '"ok":false,"ok":true'),
    JSON.stringify({ ...receipt("enable"), privateKey: "never-output" }), JSON.stringify({ ...receipt("enable"), changed: "true" }),
    JSON.stringify({ ...receipt("enable"), operation: "disable" }), "x".repeat(4097)]) {
    assert.throws(() => projectWalletConfigurationReceipt(Buffer.from(value), "enable"), { message: "wallet_configuration_receipt_invalid" });
  }
  assert.throws(() => projectWalletConfigurationReceipt(Buffer.from([0xff]), "enable"));
  assert.throws(() => projectWalletConfigurationReceipt(bytes(receipt("enable")), "unknown"));
});

test("CLI cannot turn an empty remote success or failed readiness into a configuration success", () => {
  const passed = spawnSync(process.execPath, [script, "--operation", "enable"], { input: bytes(receipt("enable")), encoding: "utf8", timeout: 10000 });
  assert.equal(passed.status, 0); assert.equal(passed.stderr, ""); assert.deepEqual(JSON.parse(passed.stdout), receipt("enable"));
  for (const input of ["", "private upstream error", JSON.stringify({ ...receipt("enable"), workerRunning: false }), "x".repeat(4097)]) {
    const failed = spawnSync(process.execPath, [script, "--operation", "enable"], { input, encoding: "utf8", timeout: 10000 });
    assert.equal(failed.status, 1); assert.equal(failed.stdout, ""); assert.equal(failed.stderr, "wallet_configuration_receipt_invalid\n");
  }
});

test("importing the projector does not consume stdin or emit a completion receipt", () => {
  const program = `await import(${JSON.stringify(new URL("../scripts/project-wallet-configuration.mjs", import.meta.url).href)}); console.log('imported');`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", program], { input: bytes(receipt("enable")), encoding: "utf8", timeout: 10000 });
  assert.equal(result.status, 0); assert.equal(result.stdout, "imported\n"); assert.equal(result.stderr, "");
});
