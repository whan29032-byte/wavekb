import assert from "node:assert/strict";
import test from "node:test";
import { ReviewWorkflow } from "../src/reviews/workflow.ts";

test("AI-reviewed experience is not searchable until human approval and publication", () => {
  const searchable = new Set<string>();
  const workflow = new ReviewWorkflow((id) => searchable.add(id));
  const review = workflow.propose("run-1", { lesson: "等待确认" }, "owner-1");
  workflow.markAiReviewed(review.id, "worker-1");
  assert.equal(searchable.has(review.id), false);
  workflow.approve(review.id, "admin-1", "结构与结果已核对");
  assert.equal(searchable.has(review.id), false);
  workflow.publish(review.id, "admin-1");
  assert.equal(searchable.has(review.id), true);
});

test("review state machine refuses to skip human approval", () => {
  const workflow = new ReviewWorkflow(() => undefined);
  const review = workflow.propose("run-2", {}, "owner-1");
  assert.throws(() => workflow.publish(review.id, "admin-1"), /transition/);
});
