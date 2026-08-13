import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkbenchAnalysis } from "@wavekb/domain";

export type WorkbenchAnalysisDraft = Omit<WorkbenchAnalysis, "id" | "created_at" | "updated_at">;

export async function saveWorkbenchAnalysis(client: SupabaseClient, id: string | null, value: WorkbenchAnalysisDraft) {
  if (id) {
    const result = await client.from("workbench_analyses").update(value).eq("id", id).eq("owner_id", value.owner_id).select("*").single();
    if (result.error) throw result.error;
    return result.data as WorkbenchAnalysis;
  }
  const result = await client.from("workbench_analyses").insert(value).select("*").single();
  if (result.error) throw result.error;
  return result.data as WorkbenchAnalysis;
}

export async function createReviewFromAnalysis(client: SupabaseClient, analysis: WorkbenchAnalysis) {
  const id = crypto.randomUUID();
  const result = await client.from("private_entries").insert({
    id,
    owner_id: analysis.owner_id,
    kind: "review",
    title: `${analysis.instrument || "未命名品种"} ${analysis.primary_timeframe} 交易复盘`.trim(),
    body: "",
    instrument: analysis.instrument,
    market: analysis.market,
    timeframe: analysis.primary_timeframe,
    tags: [],
    knowledge_ids: [],
    workbench_analysis_id: analysis.id,
    review_data: { analysis_snapshot: analysis, final_pattern: "", error_category: "", discipline_notes: "", lessons: "" },
  });
  if (result.error) throw result.error;
  return id;
}
