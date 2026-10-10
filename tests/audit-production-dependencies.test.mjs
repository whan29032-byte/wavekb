import assert from "node:assert/strict";
import test from "node:test";
import { auditProductionDependencies, verifyProductionAudit } from "../scripts/audit-production-dependencies.mjs";

const cleanReport = () => ({ advisories: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } });
const completed = (report = cleanReport(), status = 0) => ({ status, signal: null, stdout: JSON.stringify(report) });

test("production gate requires a completed zero-vulnerability official-registry audit", () => {
  let command;
  const message = auditProductionDependencies((...args) => { command = args; return completed(); });
  assert.match(message, /zero vulnerability/);
  assert.deepEqual(command[0], "pnpm");
  assert.deepEqual(command[1], ["audit", "--prod", "--json", "--registry=https://registry.npmjs.org"]);
  assert.equal(command[2].timeout, 60_000);
});

test("all production severities fail, including low and informational findings", () => {
  for (const severity of ["info", "low", "moderate", "high", "critical"]) {
    const report = cleanReport();
    report.metadata.vulnerabilities[severity] = 1;
    report.advisories.example = { severity };
    for (const status of [0, 1]) assert.throws(() => verifyProductionAudit(completed(report, status)), /must be repaired/);
  }
  const report = cleanReport();
  report.advisories.example = {};
  assert.throws(() => verifyProductionAudit(completed(report)), /advisory records present/);
});

test("registry errors, timeouts, process errors and malformed or partial reports fail closed", () => {
  for (const result of [
    { ...completed(), error: new Error("private transport detail") },
    { ...completed(), signal: "SIGTERM", status: null },
    { ...completed(), status: 2 },
    { ...completed(), status: 1 },
    { ...completed(), stdout: "not JSON" },
    completed({ error: { code: "ECONNRESET", message: "private registry detail" } }),
    completed({ ...cleanReport(), error: { message: "private registry detail" } }),
    completed({ advisories: {}, metadata: {} }),
    completed({ advisories: [], metadata: cleanReport().metadata }),
    completed({ advisories: {}, metadata: { vulnerabilities: { ...cleanReport().metadata.vulnerabilities, high: "0" } } }),
    completed({ advisories: {}, metadata: { vulnerabilities: { ...cleanReport().metadata.vulnerabilities, high: -1 } } }),
  ]) {
    assert.throws(() => verifyProductionAudit(result), (error) => !/private/.test(error.message));
  }
});
