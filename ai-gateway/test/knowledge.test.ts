import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildKnowledgeIndex } from "../src/knowledge/index.ts";
import { retrieveKnowledge } from "../src/knowledge/retrieve.ts";

const unitsPath = fileURLToPath(
  new URL("../../knowledge/units/all.jsonl", import.meta.url),
);

test("hard rules from the tenth edition precede guides and experience", () => {
  const index = buildKnowledgeIndex(unitsPath);
  const context = retrieveKnowledge(index, "wave_hypothesis", "推动浪 浪4 重叠", 3000);
  assert.ok(context.items.length > 0);
  assert.equal(context.items[0]?.sourceId, "ewp-10-zh-2016");
  assert.equal(context.items[0]?.type, "rule");
  assert.ok(context.items.every((item) => item.knowledgeId));
});

test("retrieval is deduplicated and honors a character budget", () => {
  const index = buildKnowledgeIndex(unitsPath);
  const context = retrieveKnowledge(index, "wave_hypothesis", "三角形 位置", 700);
  assert.equal(new Set(context.items.map((item) => item.knowledgeId)).size, context.items.length);
  assert.ok(context.totalCharacters <= 700);
});
