import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeProviderDestination, validateProviderUrl, validateUserProviderUrl } from "../src/security/provider-url.ts";

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
  assert.throws(() => validateUserProviderUrl("https://[::1]/v1", []));
  assert.throws(() => validateUserProviderUrl("https://[fc00::1]/v1", []));
  assert.throws(() => validateUserProviderUrl("http://127.0.0.1:11434/v1", []));
  assert.equal(
    validateUserProviderUrl("http://127.0.0.1:11434/v1", ["127.0.0.1:11434"]).port,
    "11434",
  );
});

test("provider destination rejects DNS answers that reach private networks", async () => {
  await assert.rejects(() => assertSafeProviderDestination(
    new URL("https://model.example/v1"),
    [],
    async () => [{ address: "10.0.0.4", family: 4 }],
  ));
  await assert.doesNotReject(() => assertSafeProviderDestination(
    new URL("https://model.example/v1"),
    [],
    async () => [{ address: "8.8.8.8", family: 4 }],
  ));
});
