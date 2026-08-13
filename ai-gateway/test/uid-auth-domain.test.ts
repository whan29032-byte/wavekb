import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyIdentifier,
  normalizeEmail,
  validateUid,
} from "../src/auth/uid.ts";

test("identifier accepts a normalized email or 5-6 digit UID", () => {
  assert.deepEqual(classifyIdentifier(" 583104 "), {
    kind: "uid",
    value: "583104",
  });
  assert.deepEqual(classifyIdentifier("User@Example.COM"), {
    kind: "email",
    value: "user@example.com",
  });
  assert.throws(() => classifyIdentifier("1234"), /invalid_identifier/);
  assert.throws(() => classifyIdentifier("12A45"), /invalid_identifier/);
});

test("UID validator enforces the complete numeric range", () => {
  assert.equal(validateUid(10000), 10000);
  assert.equal(validateUid("999999"), 999999);
  assert.throws(() => validateUid(9999), /invalid_uid/);
  assert.throws(() => validateUid(1000000), /invalid_uid/);
  assert.throws(() => validateUid("012345"), /invalid_uid/);
});

test("email normalization rejects malformed or excessively long values", () => {
  assert.equal(normalizeEmail(" User+Wave@Example.COM "), "user+wave@example.com");
  assert.throws(() => normalizeEmail("missing-at.example.com"), /invalid_identifier/);
  assert.throws(() => normalizeEmail(`${"a".repeat(250)}@example.com`), /invalid_identifier/);
});
