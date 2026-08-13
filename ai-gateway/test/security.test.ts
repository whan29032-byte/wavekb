import assert from "node:assert/strict";
import test from "node:test";
import { FixedWindowQuota } from "../src/security/rate-limit.ts";
import { validateProviderUrl, validateUserProviderUrl } from "../src/security/provider-url.ts";

test("custom provider rejects insecure public address and loopback unless allowlisted", () => {
  assert.throws(() => validateProviderUrl("http://example.com/v1", [], []));
  assert.throws(() => validateProviderUrl("http://127.0.0.1:11434/v1", [], []));
  assert.doesNotThrow(() => validateProviderUrl(
    "http://127.0.0.1:11434/v1",
    [],
    ["127.0.0.1:11434"],
  ));
});

test("provider host must be explicitly allowed and embedded credentials are rejected", () => {
  assert.throws(() => validateProviderUrl("https://evil.example/v1", ["api.example.com"], []));
  assert.throws(() => validateProviderUrl("https://user:pass@api.example.com/v1", ["api.example.com"], []));
  assert.equal(
    validateProviderUrl("https://api.example.com/v1", ["api.example.com"], []).hostname,
    "api.example.com",
  );
});

test("user-owned providers allow arbitrary public HTTPS but block private networks", () => {
  assert.equal(
    validateUserProviderUrl("https://api.user-chosen-model.example/v1", []).hostname,
    "api.user-chosen-model.example",
  );
  assert.throws(() => validateUserProviderUrl("http://api.example.com/v1", []));
  assert.throws(() => validateUserProviderUrl("https://192.168.1.8/v1", []));
  assert.throws(() => validateUserProviderUrl("http://127.0.0.1:11434/v1", []));
  assert.equal(
    validateUserProviderUrl("http://127.0.0.1:11434/v1", ["127.0.0.1:11434"]).port,
    "11434",
  );
});

test("quota refuses calls after the fixed daily limit", () => {
  const quota = new FixedWindowQuota(2);
  assert.equal(quota.consume("user-1").allowed, true);
  assert.equal(quota.consume("user-1").remaining, 0);
  assert.equal(quota.consume("user-1").allowed, false);
});
