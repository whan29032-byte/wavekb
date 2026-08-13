function rounded(value: number, places = 8) {
  return Number(value.toFixed(places));
}

export function calculateMaxDrawdown(raw: string, sameDegreeRefresh: boolean, segmentComplete: boolean) {
  const values = raw.split(/[\s,，;；]+/).map(Number).filter(Number.isFinite);
  if (values.length < 2) return { ok: false, error: "至少需要两个连续价格或权益点。" };
  let peak = values[0];
  let peakIndex = 0;
  let drawdownPeak = peak;
  let drawdownPeakIndex = peakIndex;
  let trough = values[0];
  let troughIndex = 0;
  let maxLoss = 0;
  values.forEach((value, index) => {
    if (value > peak) { peak = value; peakIndex = index; }
    const loss = peak - value;
    if (loss > maxLoss) { maxLoss = loss; drawdownPeak = peak; drawdownPeakIndex = peakIndex; trough = value; troughIndex = index; }
  });
  return {
    ok: true,
    peak: rounded(drawdownPeak),
    trough: rounded(trough),
    max_drawdown: rounded(maxLoss),
    max_drawdown_percent: drawdownPeak ? rounded(maxLoss / Math.abs(drawdownPeak) * 100, 4) : null,
    peak_index: drawdownPeakIndex,
    trough_index: troughIndex,
    same_degree_refresh: sameDegreeRefresh,
    segment_complete: segmentComplete,
    classification: sameDegreeRefresh && segmentComplete ? "同级波段已刷新，且内部结构已标记完成" : "仅记录统计回撤，不能据此宣布上涨结束",
  };
}

export function calculateRisk(input: Record<string, number>) {
  const { equity, risk_percent: riskPercent, entry, stop, target, contract_multiplier: multiplier = 1, lot_size: lotSize = 1, fees = 0 } = input;
  if (![equity, riskPercent, entry, stop, target, multiplier, lotSize, fees].every(Number.isFinite)) return { ok: false, error: "风险输入必须是有效数字。" };
  if (!(equity > 0) || !(riskPercent > 0 && riskPercent <= 100) || !(multiplier > 0) || !(lotSize > 0) || fees < 0) return { ok: false, error: "账户权益、风险比例或合约参数无效。" };
  const priceRisk = Math.abs(entry - stop);
  const priceReward = Math.abs(target - entry);
  if (!priceRisk) return { ok: false, error: "止损不能等于入场价。" };
  const longTrade = stop < entry;
  if ((longTrade && target <= entry) || (!longTrade && target >= entry)) return { ok: false, error: "目标价必须位于风险方向的另一侧。" };
  const maxLoss = equity * riskPercent / 100;
  const unitRisk = priceRisk * multiplier + fees;
  const rawPosition = maxLoss / unitRisk;
  return { ok: true, max_loss: rounded(maxLoss), unit_risk: rounded(unitRisk), max_position: rounded(Math.floor(rawPosition / lotSize) * lotSize), reward_risk: rounded((priceReward * multiplier - fees) / unitRisk) };
}

export function evaluateImpulse(values: Record<string, number>, direction: "up" | "down") {
  const up = direction === "up";
  const checks = [
    { key: "wave2_origin", passed: up ? values.w2_end >= values.w1_start : values.w2_end <= values.w1_start, message: "浪2不得越过浪1起点。" },
    { key: "wave3_beyond_wave1", passed: up ? values.w3_end > values.w1_end : values.w3_end < values.w1_end, message: "浪3必须越过浪1终点。" },
    { key: "wave3_not_shortest", passed: !(Math.abs(values.w3_end - values.w2_end) < Math.abs(values.w1_end - values.w1_start) && Math.abs(values.w3_end - values.w2_end) < Math.abs(values.w5_end - values.w4_end)), message: "浪3不得是浪1、3、5中最短者。" },
    { key: "wave4_no_overlap", passed: up ? values.w4_end >= values.w1_end : values.w4_end <= values.w1_end, message: "普通推动浪的浪4不得进入浪1价格区域。" },
  ];
  const violations = checks.filter((item) => !item.passed);
  const status = violations.length ? "eliminated" : "valid";
  return { status, checks: checks.map((item) => ({ ...item, status: item.passed ? "passed" : "failed" })), violations };
}
