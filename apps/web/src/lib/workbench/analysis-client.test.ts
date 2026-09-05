import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkbenchAnalysis } from "@wavekb/domain";
import { createReviewFromAnalysis } from "./analysis-client";

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
