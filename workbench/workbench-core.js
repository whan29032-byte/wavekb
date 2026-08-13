(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ElliottWorkbenchCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TIMEFRAMES = Object.freeze([
    "年线", "季线", "月线", "周线", "日线",
    "4小时", "1小时", "15分钟", "5分钟", "1分钟"
  ]);
  const HOLDING_STYLES = Object.freeze([
    "长线", "波段", "中线", "日内", "超短"
  ]);
  const RECORD_VIEWS = new Set(["all", "review", "journal", "draft"]);

  function validateDegreeContext(value) {
    const required = [
      "parent_timeframe", "primary_timeframe", "child_timeframe"
    ];
    const errors = required.filter(key => !TIMEFRAMES.includes(value[key]));
    const indices = required.map(key => TIMEFRAMES.indexOf(value[key]));
    if (!errors.length && !(indices[0] < indices[1] && indices[1] < indices[2])) {
      errors.push("timeframe_order");
    }
    return {ok: errors.length === 0, errors};
  }

  function validateStep(step, value) {
    const errors = [];
    if (step === 1) {
      errors.push(...validateDegreeContext(value).errors);
      if (!HOLDING_STYLES.includes(value.holding_style)) {
        errors.push("holding_style");
      }
    }
    if (step === 2 && !["motive", "corrective", "unknown"].includes(value.mode)) {
      errors.push("mode");
    }
    return {ok: errors.length === 0, errors};
  }

  function workbenchRouteFromHash(hash) {
    const params = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    if (!params.has("workbench")) return null;
    const rawStep = Number(params.get("step") || 0);
    const panel = params.get("panel") === "records" ? "records" : "analysis";
    const requestedRecordView = params.get("records") || "all";
    return {
      kind: "workbench",
      analysisId: params.get("workbench") || "new",
      step: Math.min(10, Math.max(0, Number.isFinite(rawStep) ? rawStep : 0)),
      panel,
      recordView: RECORD_VIEWS.has(requestedRecordView) ? requestedRecordView : "all"
    };
  }

  function hashForWorkbenchRoute(route) {
    let hash = `#workbench=${encodeURIComponent(route.analysisId || "new")}`
      + `&step=${Math.min(10, Math.max(0, Number(route.step) || 0))}`;
    if (route.panel === "records") {
      const recordView = RECORD_VIEWS.has(route.recordView) ? route.recordView : "all";
      hash += `&panel=records&records=${encodeURIComponent(recordView)}`;
    }
    return hash;
  }

  return {
    TIMEFRAMES,
    HOLDING_STYLES,
    RECORD_VIEWS,
    validateDegreeContext,
    validateStep,
    workbenchRouteFromHash,
    hashForWorkbenchRoute
  };
});
