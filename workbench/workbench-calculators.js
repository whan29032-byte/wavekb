(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ElliottWorkbenchCalculators = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function rounded(value, places = 8) {
    return Number(Number(value).toFixed(places));
  }

  function retracementLevels(start, end) {
    const first = Number(start);
    const last = Number(end);
    const span = last - first;
    return Object.fromEntries(
      [0.236, 0.382, 0.5, 0.618, 0.786].map(ratio => [
        String(ratio),
        rounded(last - span * ratio)
      ])
    );
  }

  function timeRatios(firstDuration, secondDuration) {
    const first = Number(firstDuration);
    const second = Number(secondDuration);
    if (!(first > 0) || !(second > 0)) {
      return {ok: false, error: "持续时间必须大于0。"};
    }
    const actual = second / first;
    const guides = [0.618, 1, 1.618];
    const nearest = guides.reduce((best, item) => (
      Math.abs(item - actual) < Math.abs(best - actual) ? item : best
    ));
    return {
      ok: true,
      actual_ratio: rounded(actual),
      nearest,
      distance: rounded(Math.abs(actual - nearest)),
      classification: "guideline"
    };
  }

  function riskPosition(input) {
    const equity = Number(input.equity);
    const riskPercent = Number(input.risk_percent);
    const entry = Number(input.entry);
    const stop = Number(input.stop);
    const target = Number(input.target);
    const multiplier = Number(input.contract_multiplier || 1);
    const lotSize = Number(input.lot_size || 1);
    const fees = Number(input.fees || 0);
    if (![equity, riskPercent, entry, stop, target, multiplier, lotSize, fees]
      .every(Number.isFinite)) {
      return {ok: false, error: "风险输入必须是有效数字。"};
    }
    if (!(equity > 0) || !(riskPercent > 0 && riskPercent <= 100)) {
      return {ok: false, error: "账户权益和风险比例无效。"};
    }
    if (!(multiplier > 0) || !(lotSize > 0) || fees < 0) {
      return {ok: false, error: "合约乘数、手数或费用无效。"};
    }
    const priceRisk = Math.abs(entry - stop);
    const priceReward = Math.abs(target - entry);
    if (!priceRisk) return {ok: false, error: "止损不能等于入场价。"};
    const longTrade = stop < entry;
    if ((longTrade && target <= entry) || (!longTrade && target >= entry)) {
      return {ok: false, error: "目标价必须位于风险方向的另一侧。"};
    }
    const maxLoss = equity * riskPercent / 100;
    const unitRisk = priceRisk * multiplier + fees;
    const rawPosition = maxLoss / unitRisk;
    const maxPosition = Math.floor(rawPosition / lotSize) * lotSize;
    const unitReward = priceReward * multiplier - fees;
    return {
      ok: true,
      max_loss: rounded(maxLoss),
      unit_risk: rounded(unitRisk),
      max_position: rounded(maxPosition),
      reward_risk: rounded(unitReward / unitRisk)
    };
  }

  function maxDrawdown(points, options = {}) {
    const values = Array.isArray(points)
      ? points.map(Number).filter(Number.isFinite)
      : [];
    if (values.length < 2) {
      return {ok: false, error: "至少需要两个连续价格或权益点。"};
    }
    let peak = values[0];
    let peakIndex = 0;
    let trough = values[0];
    let troughIndex = 0;
    let maxLoss = 0;
    values.forEach((value, index) => {
      if (value > peak) {
        peak = value;
        peakIndex = index;
      }
      const loss = peak - value;
      if (loss > maxLoss) {
        maxLoss = loss;
        trough = value;
        troughIndex = index;
      }
    });
    const percent = peak !== 0 ? maxLoss / Math.abs(peak) * 100 : null;
    const sameDegree = options.same_degree_refresh === true;
    const segmentComplete = options.segment_complete === true;
    return {
      ok: true,
      peak: rounded(peak),
      trough: rounded(trough),
      max_drawdown: rounded(maxLoss),
      max_drawdown_percent: percent === null ? null : rounded(percent, 4),
      peak_index: peakIndex,
      trough_index: troughIndex,
      same_degree_refresh: sameDegree,
      segment_complete: segmentComplete,
      classification: sameDegree && segmentComplete
        ? "同级波段已刷新，且内部结构已标记完成"
        : "仅记录统计回撤，不能据此宣布上涨结束",
      disclaimer: "最大回撤统计、结构回撤和交易止损不是同一概念；内部子浪不改变上一级统计，只有同级别波段才可刷新同级回撤。"
    };
  }

  return {retracementLevels, timeRatios, riskPosition, maxDrawdown};
});
