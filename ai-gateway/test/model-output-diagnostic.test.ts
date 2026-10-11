import assert from "node:assert/strict";
import test from "node:test";
import { modelOutputDiagnostic } from "../src/knowledge/runtime.ts";

test("model output diagnostics use only fixed categories and never return source details", () => {
  for (const [error, expected] of [
    [{ diagnostic: "json" }, "json"],
    [{ message: "analysis result schema: result fields are invalid" }, "schema_fields"],
    [{ message: "analysis result schema: scenario values are invalid" }, "schema_values"],
    [{ message: "invalid knowledge citation: private-source-id" }, "citation_ids"],
    [{ code: "invalid_chart_input", message: "private-chart-details" }, "chart_contract"],
    [{ code: "private_source_disclosure", message: "private-source-path" }, "privacy_disclosure"],
    [{ message: "invalid_public_analysis" }, "publication_contract"],
    [{ diagnostic: "private-source-path", message: "secret-provider-response" }, "unknown"],
    [{ diagnostic: "constructor" }, "unknown"],
    [null, "unknown"],
    ["private-model-text", "unknown"],
  ] as const) {
    assert.equal(modelOutputDiagnostic(error), expected);
  }
});
