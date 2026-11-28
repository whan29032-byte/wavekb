import assert from "node:assert/strict";
import test from "node:test";
import { parseRuntimeArguments, RuntimeConfigurationError } from "../src/research/configure-runtime.ts";

const safeError = (code: string) => (error: unknown): boolean =>
  error instanceof RuntimeConfigurationError && error.code === code && error.message === code;

test("CLI argument contract rejects duplicates, omissions, extra flags and ambiguous booleans", () => {
  const valid = ["--env-file", "/safe/gateway.env", "--backup-file", "/safe/original.env", "--enable-private", "true"];
  assert.deepEqual(parseRuntimeArguments(valid), { envFile: "/safe/gateway.env", backupFile: "/safe/original.env", enablePrivate: true });
  assert.equal(parseRuntimeArguments([...valid.slice(0, -1), "false"]).enablePrivate, false);
  for (const invalid of [[], valid.slice(0, -1), [...valid, "--private-key", "never-print"], [...valid, "--env-file", "/other"], [...valid.slice(0, -1), "1"], [...valid.slice(0, -1), "TRUE"]]) {
    assert.throws(() => parseRuntimeArguments(invalid), safeError("invalid_arguments"));
  }
});

test("managed CLI mode is optional and exact; explicit preserve and combined operations retain old private syntax", () => {
  const base = ["--env-file", "/safe/gateway.env", "--backup-file", "/safe/original.env"];
  assert.deepEqual(parseRuntimeArguments([...base, "--managed-ai", "preserve"]), { envFile: "/safe/gateway.env", backupFile: "/safe/original.env", managedAi: "preserve" });
  assert.deepEqual(parseRuntimeArguments([...base, "--managed-ai", "enable", "--enable-private", "false"]), { envFile: "/safe/gateway.env", backupFile: "/safe/original.env", enablePrivate: false, managedAi: "enable" });
  for (const value of ["true", "ENABLE", "", "enable\n", "enable;secret"]) assert.throws(() => parseRuntimeArguments([...base, "--managed-ai", value]), safeError("invalid_arguments"));
});
