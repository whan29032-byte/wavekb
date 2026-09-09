import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkbenchAnalysis } from "@wavekb/domain";
import { createAiRunRequest, createReviewFromAnalysis, submitAiRun } from "./analysis-client";

describe("review generated from analysis", () => {
  it("creates an editable review with real analysis context, canonical lesson field and immutable snapshot", async () => {
    const analysis: WorkbenchAnalysis = { id: "analysis", owner_id: "owner", schema_version: "workbench-v1", input_source: "manual", instrument: "BTCUSDT", market: "crypto", primary_timeframe: "4小时", parent_timeframe: "日线", child_timeframe: "1小时", holding_style: "波段", execution_status: "ready", step_data: { "5": { pattern: "impulse" }, "8": { entry: "100", stop: "95", target: "115" } }, rule_result: {}, score_result: {}, risk_result: {}, drawdown_result: {}, created_at: "2026-01-01", updated_at: "2026-01-02" };
    let inserted: Record<string, unknown> = {};
    const client = { from: (table: string) => { expect(table).toBe("private_entries"); return { insert: async (value: Record<string, unknown>) => { inserted = value; return { error: null }; } }; } } as unknown as SupabaseClient;
    const id = await createReviewFromAnalysis(client, analysis);
    expect(inserted.id).toBe(id); expect(inserted.owner_id).toBe("owner"); expect(inserted.workbench_analysis_id).toBe("analysis");
    expect(inserted.body).toContain("BTCUSDT"); expect(inserted.body).toContain("4小时");
    expect(inserted.review_data).toMatchObject({ editor_mode: "professional", lesson: "", pattern: "impulse", analysis_snapshot: analysis });
  });
});

describe("AI run request", () => {
  it("creates the exact version-2 all-books payload", () => {
    expect(createAiRunRequest(4, "all", "11111111-1111-4111-8111-111111111111")).toEqual({
      request_version: 2,
      client_request_id: "11111111-1111-4111-8111-111111111111",
      task_type: "wave_analysis",
      step: 4,
      analysis_schema_version: "workbench-v1",
      knowledge_scope: { mode: "all" },
    });
  });

  it("sends one UUID for a transport retry of a selected single-book action", async () => {
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new TypeError("network unavailable"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ job: { id: "job", status: "queued" } }), { status: 200 }));
    const randomUUID = vi.spyOn(crypto, "randomUUID").mockReturnValue("11111111-1111-4111-8111-111111111111");

    await submitAiRun("/api/ai/analyses/analysis/ai-run", 6, "chan-theory-complete", fetcher);

    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetcher.mock.calls[0][1].body));
    const second = JSON.parse(String(fetcher.mock.calls[1][1].body));
    expect(first).toEqual({ request_version: 2, client_request_id: "11111111-1111-4111-8111-111111111111", task_type: "wave_analysis", step: 6, analysis_schema_version: "workbench-v1", knowledge_scope: { mode: "single", book_id: "chan-theory-complete" } });
    expect(second).toEqual(first);
    randomUUID.mockRestore();
  });
});
