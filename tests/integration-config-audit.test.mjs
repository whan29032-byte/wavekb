import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { integrationConfigPresence } from "../scripts/integration-config-audit.mjs";

test("integration audit projects booleans only and ignores unrelated credentials", () => {
  const result = integrationConfigPresence('MENTOR_EMAIL_API_KEY="private-mail-key"\nMENTOR_EMAIL_FROM=mail@example.com\nYOUTUBE_OAUTH_CLIENT_SECRET=private-google-secret\nSUPABASE_SERVICE_ROLE_KEY=private-db-key\nBITGET_SECRET=never-read\nMENTOR_EMAIL_ENABLED=');
  assert.equal(result.configuration_presence.MENTOR_EMAIL_API_KEY, true);
  assert.equal(result.configuration_presence.MENTOR_EMAIL_ENABLED, false);
  assert.equal(result.configuration_presence.YOUTUBE_OAUTH_CLIENT_SECRET, true);
  for (const text of ["private-mail-key", "private-google-secret", "private-db-key", "BITGET", "mail@example.com"]) assert.equal(JSON.stringify(result).includes(text), false);
});
test("probe fails closed for ambiguous duplicates and has no network or write operations", () => {
  assert.throws(() => integrationConfigPresence("MENTOR_EMAIL_FROM=a\nMENTOR_EMAIL_FROM=b"), /duplicate_integration_setting/);
  const source = readFileSync(new URL("../scripts/integration-config-audit.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\(|writeFile|unlink|exec|spawn/);
  assert.match(source, /readFileSync\("\/etc\/elliott-wave\/gateway\.env"/);
});
