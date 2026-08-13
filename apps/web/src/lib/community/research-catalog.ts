import type { BoardSlug } from "@wavekb/domain";

export const MARKET_GROUPS = [
  ["commodities", "大宗商品"], ["precious_metals", "贵金属"], ["crypto", "加密资产"],
  ["indices", "股指"], ["stocks", "股票"], ["forex", "外汇"], ["rates", "债券与利率"], ["other", "其他市场"],
] as const;

export const RESEARCH_TIMEFRAMES = ["年线", "季线", "月线", "周线", "日线", "12小时", "8小时", "4小时", "2小时", "1小时", "30分钟", "15分钟", "5分钟", "3分钟", "1分钟"];
export const WAVE_PATTERNS = [
  ["unknown", "待确认"], ["impulse", "普通推动浪"], ["leading_diagonal", "引导楔形"], ["ending_diagonal", "终结楔形"],
  ["zigzag", "单锯齿"], ["double_zigzag", "双锯齿"], ["triple_zigzag", "三锯齿"], ["flat", "平台型"],
  ["expanded_flat", "扩散平台"], ["running_flat", "奔走平台"], ["contracting_triangle", "收敛三角形"],
  ["barrier_triangle", "屏障三角形"], ["expanding_triangle", "扩散三角形"], ["combination", "联合型"],
  ["double_combination", "双重联合型"], ["triple_combination", "三重联合型"],
] as const;
export const WAVE_POSITIONS = ["unknown", "浪1", "浪2", "浪3", "浪4", "浪5", "浪A", "浪B", "浪C", "浪D", "浪E", "浪W", "浪X", "浪Y", "浪Z"];
export const DIRECTIONS = [["unknown", "待确认"], ["up", "上涨"], ["down", "下跌"], ["sideways", "横向整理"]] as const;

export type StructuredPost = {
  market: string; instrument: string; timeframe: string; pattern: string; position: string; direction: string;
  thesis: string; evidence: string; invalidation: string; question: string; primaryCount: string;
  alternateCount: string; confirmation: string; application: string; notes: string;
};

const sectionKeys: Record<string, keyof StructuredPost> = {
  "核心观点": "thesis",
  "问题与当前判断": "thesis",
  "复盘对象与原始判断": "thesis",
  "分析背景": "thesis",
  "首选计数": "primaryCount",
  "备选计数": "alternateCount",
  "规则与指南依据": "evidence",
  "成立条件": "confirmation",
  "失效条件": "invalidation",
  "适用边界与反例": "invalidation",
  "最终走势与偏差": "invalidation",
  "实际应用": "application",
  "希望讨论的问题": "question",
  "希望得到的回答": "question",
  "需要讨论的问题": "question",
  "补充说明": "notes",
};

const clean = (value: unknown) => String(value ?? "").trim();
const section = (title: string, value: unknown) => clean(value) ? `【${title}】\n${clean(value)}` : "";
const labelOf = (options: readonly (readonly [string, string])[], value: string) => options.find(([key]) => key === value)?.[1] || value;

export function compileStructuredPost(input: StructuredPost, board: BoardSlug) {
  const context = [
    clean(input.instrument) && `品种：${clean(input.instrument)}`,
    clean(input.market) && `市场：${labelOf(MARKET_GROUPS, input.market)}`,
    clean(input.timeframe) && `周期：${clean(input.timeframe)}`,
    input.pattern !== "unknown" && clean(input.pattern) && `浪型：${labelOf(WAVE_PATTERNS, input.pattern)}`,
    input.position !== "unknown" && clean(input.position) && `当前位置：${clean(input.position)}`,
    input.direction !== "unknown" && clean(input.direction) && `方向：${labelOf(DIRECTIONS, input.direction)}`,
  ].filter(Boolean).join("　");
  const sections = board === "case_submission" ? [
    section("分析背景", input.thesis), section("首选计数", input.primaryCount), section("备选计数", input.alternateCount),
    section("规则与指南依据", input.evidence), section("成立条件", input.confirmation), section("失效条件", input.invalidation), section("需要讨论的问题", input.question), section("补充说明", input.notes),
  ] : board === "question_answers" ? [
    section("问题与当前判断", input.thesis), section("规则与指南依据", input.evidence), section("适用边界与反例", input.invalidation), section("希望得到的回答", input.question), section("补充说明", input.notes),
  ] : board === "review_answers" ? [
    section("复盘对象与原始判断", input.thesis), section("规则与指南依据", input.evidence), section("最终走势与偏差", input.invalidation), section("希望得到的回答", input.question), section("补充说明", input.notes),
  ] : [
    section("核心观点", input.thesis), section("规则与指南依据", input.evidence), section("适用边界与反例", input.invalidation), section("实际应用", input.application), section("希望讨论的问题", input.question), section("补充说明", input.notes),
  ];
  const structured = [context ? `【分析对象】\n${context}` : "", ...sections].filter(Boolean).join("\n\n");
  return structured || clean(input.notes);
}

export function parseStructuredPost(body: string): StructuredPost | null {
  const parsed: StructuredPost = {
    market: "crypto", instrument: "", timeframe: "4小时", pattern: "unknown", position: "unknown", direction: "unknown",
    thesis: "", evidence: "", invalidation: "", question: "", primaryCount: "", alternateCount: "", confirmation: "", application: "", notes: "",
  };
  let recognized = false;
  const sections = body.matchAll(/(?:^|\n\n)【([^】]+)】\n([\s\S]*?)(?=\n\n【|$)/g);
  for (const match of sections) {
    const title = match[1];
    const value = clean(match[2]);
    if (title === "分析对象") {
      recognized = true;
      for (const item of value.split("　")) {
        const separator = item.indexOf("：");
        if (separator < 1) continue;
        const label = item.slice(0, separator);
        const fieldValue = item.slice(separator + 1);
        if (label === "品种") parsed.instrument = fieldValue;
        else if (label === "市场") parsed.market = MARKET_GROUPS.find(([, name]) => name === fieldValue)?.[0] || "other";
        else if (label === "周期") parsed.timeframe = fieldValue;
        else if (label === "浪型") parsed.pattern = WAVE_PATTERNS.find(([, name]) => name === fieldValue)?.[0] || "unknown";
        else if (label === "当前位置") parsed.position = fieldValue;
        else if (label === "方向") parsed.direction = DIRECTIONS.find(([, name]) => name === fieldValue)?.[0] || "unknown";
      }
      continue;
    }
    const key = sectionKeys[title];
    if (!key) continue;
    recognized = true;
    parsed[key] = value;
  }
  return recognized ? parsed : null;
}
