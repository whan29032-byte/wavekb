(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ElliottWorkbenchRepository = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function unwrap(result) {
    if (result && result.error) throw result.error;
    return result ? result.data : null;
  }

  function defaultGateway(client) {
    return {
      async createAnalysis(value) {
        return unwrap(
          await client.from("workbench_analyses")
            .insert(value).select("*").single()
        );
      },
      async getAnalysis(id) {
        return unwrap(
          await client.from("workbench_analyses")
            .select("*,workbench_scenarios(*)").eq("id", id).single()
        );
      },
      async updateAnalysis(id, value) {
        return unwrap(
          await client.from("workbench_analyses")
            .update(value).eq("id", id).select("*").single()
        );
      },
      async replaceScenarios(analysisId, rows) {
        unwrap(
          await client.from("workbench_scenarios")
            .delete().eq("analysis_id", analysisId)
        );
        if (!rows.length) return [];
        return unwrap(
          await client.from("workbench_scenarios").insert(rows).select("*")
        );
      },
      async saveReview(value) {
        return unwrap(
          await client.from("workbench_reviews")
            .upsert(value, {onConflict: "analysis_id"}).select("*").single()
        );
      },
      async listRecent(ownerId) {
        return unwrap(
          await client.from("workbench_analyses").select("*")
            .eq("owner_id", ownerId)
            .order("updated_at", {ascending: false}).limit(20)
        );
      },
      async listPending(ownerId) {
        return unwrap(
          await client.from("workbench_analyses").select("*")
            .eq("owner_id", ownerId)
            .eq("execution_status", "executed")
            .order("updated_at", {ascending: false})
        );
      }
    };
  }

  function createWorkbenchRepository(client, injectedGateway) {
    const gateway = injectedGateway || defaultGateway(client);
    return {
      createAnalysis(value) {
        return gateway.createAnalysis({
          owner_id: value.ownerId,
          schema_version: "workbench-v1",
          input_source: "manual",
          instrument: value.instrument,
          market: value.market || "",
          parent_timeframe: value.parent_timeframe,
          primary_timeframe: value.primary_timeframe,
          child_timeframe: value.child_timeframe,
          holding_style: value.holding_style,
          step_data: value.step_data || {},
          rule_result: value.rule_result || {},
          score_result: value.score_result || {},
          risk_result: value.risk_result || {},
          drawdown_result: value.drawdown_result || {},
          execution_status: "draft"
        });
      },
      getAnalysis(id) {
        return gateway.getAnalysis(id);
      },
      saveStep(id, step, data) {
        return gateway.updateAnalysis(id, {
          step_data: {[String(step)]: data}
        });
      },
      replaceScenarios(analysisId, ownerId, scenarios) {
        return gateway.replaceScenarios(
          analysisId,
          scenarios.map(item => ({
            ...item,
            analysis_id: analysisId,
            owner_id: ownerId
          }))
        );
      },
      saveExecutionPlan(id, value) {
        return gateway.updateAnalysis(id, {
          risk_result: value.risk_result || {},
          drawdown_result: value.drawdown_result || {},
          execution_status: value.execution_status || "waiting",
          step_data: value.step_data || {}
        });
      },
      saveReview(value) {
        return gateway.saveReview({
          analysis_id: value.analysisId,
          owner_id: value.ownerId,
          analysis_snapshot: value.analysisSnapshot,
          actual_result: value.actualResult || {},
          final_pattern: value.finalPattern || "",
          error_category: value.errorCategory || "",
          rule_violation_ids: value.ruleViolationIds || [],
          discipline_notes: value.disciplineNotes || "",
          lessons: value.lessons || ""
        });
      },
      listRecentAnalyses(ownerId) {
        return gateway.listRecent(ownerId);
      },
      listPendingReviews(ownerId) {
        return gateway.listPending(ownerId);
      }
    };
  }

  return {createWorkbenchRepository};
});
