import type { SupabaseClient } from "@supabase/supabase-js";
import type { WorkbenchAnalysis } from "@wavekb/domain";

export type WorkbenchAnalysisDraft = Omit<WorkbenchAnalysis, "id" | "created_at" | "updated_at">;

export type KnowledgeScopeValue = "all" | "elliott-wave-principle-tenth-edition" | "elliott-wave-natural-law" | "chan-theory-complete";

export function createAiRunRequest(step: number, scope: KnowledgeScopeValue, clientRequestId: string) {
  return {
    request_version: 2 as const,
    client_request_id: clientRequestId,
    task_type: "wave_analysis" as const,
    step,
    analysis_schema_version: "workbench-v1" as const,
    knowledge_scope: scope === "all" ? { mode: "all" as const } : { mode: "single" as const, book_id: scope },
  };
}

type AiRunFetcher = (input: string, init: RequestInit) => Promise<Response>;

export async function submitAiRun(url: string, step: number, scope: KnowledgeScopeValue, fetcher: AiRunFetcher = fetch) {
  const payload = createAiRunRequest(step, scope, crypto.randomUUID());
  const request = () => fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  try {
    return await request();
  } catch {
    return request();
  }
}

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
    body: `分析背景：${analysis.instrument || "未命名品种"} · ${analysis.primary_timeframe}\n市场：${analysis.market || "未填写"}\n持仓风格：${analysis.holding_style || "未填写"}\n\n复盘记录：\n请补充实际执行、结构核验和下次改进。原始分析已保留在只读快照中。`,
    instrument: analysis.instrument,
    market: analysis.market,
    timeframe: analysis.primary_timeframe,
    tags: [],
    knowledge_ids: [],
    workbench_analysis_id: analysis.id,
    review_data: { editor_mode: "professional", analysis_snapshot: analysis, pattern: String(analysis.step_data["5"]?.pattern || "unknown"), final_pattern: "", error_category: "", discipline_notes: "", lesson: "" },
  });
  if (result.error) throw result.error;
  return id;
}
