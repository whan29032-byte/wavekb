import assert from "node:assert/strict";
import test from "node:test";
import { decryptSecret, encryptSecret } from "../src/secrets/crypto.ts";
import { redactSensitive } from "../src/logging/redact.ts";

test("AES-GCM round trip and tamper rejection", () => {
  const key = Buffer.alloc(32, 9);
  const encrypted = encryptSecret("secret-example-value", key, 1);
  assert.equal(decryptSecret(encrypted, key), "secret-example-value");
  const tampered = {
    ...encrypted,
    auth_tag: `${encrypted.auth_tag.startsWith("A") ? "B" : "A"}${encrypted.auth_tag.slice(1)}`,
  };
  assert.throws(() => decryptSecret(tampered, key));
});

test("redactor removes API keys, bearer values and emails", () => {
  const result = redactSensitive(
    "Authorization: Bearer abcdefghijklmnopqrstuvwxyz account someone@example.com",
  );
  assert.equal(result.includes("abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(result.includes("someone@example.com"), false);
});

test("redactor removes authentication request secrets", () => {
  const result = redactSensitive({
    password: "correct horse battery staple",
    access_token: "access-token-value-abcdefghijklmnopqrstuvwxyz",
    refresh_token: "refresh-token-value-abcdefghijklmnopqrstuvwxyz",
    registration_token: "registration-token-value-abcdefghijklmnopqrstuvwxyz",
    email: "owner@example.com",
  });
  assert.equal(result.includes("correct horse battery staple"), false);
  assert.equal(result.includes("access-token-value"), false);
  assert.equal(result.includes("refresh-token-value"), false);
  assert.equal(result.includes("registration-token-value"), false);
  assert.equal(result.includes("owner@example.com"), false);
});
