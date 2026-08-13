(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.ElliottResearchCatalog = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MARKET_GROUPS = Object.freeze([
    Object.freeze({
      value: "commodities",
      label: "大宗商品",
      instruments: Object.freeze([
        "WTI原油", "布伦特原油", "天然气", "铜", "铝",
        "大豆", "玉米", "小麦", "咖啡", "棉花"
      ])
    }),
    Object.freeze({
      value: "precious_metals",
      label: "贵金属",
      instruments: Object.freeze(["黄金", "白银", "铂金", "钯金"])
    }),
    Object.freeze({
      value: "crypto",
      label: "加密资产",
      instruments: Object.freeze([
        "BTC 比特币", "ETH 以太坊", "SOL Solana", "BNB",
        "XRP", "DOGE", "ADA", "AVAX"
      ])
    }),
    Object.freeze({
      value: "indices",
      label: "股指",
      instruments: Object.freeze([
        "标普500", "纳斯达克100", "道琼斯工业指数", "罗素2000",
        "恒生指数", "恒生科技指数", "沪深300", "上证指数",
        "日经225", "德国DAX"
      ])
    }),
    Object.freeze({
      value: "stocks",
      label: "股票",
      instruments: Object.freeze([
        "苹果 AAPL", "微软 MSFT", "英伟达 NVDA", "特斯拉 TSLA",
        "小米集团 1810.HK", "腾讯控股 0700.HK", "阿里巴巴 BABA"
      ])
    }),
    Object.freeze({
      value: "forex",
      label: "外汇",
      instruments: Object.freeze([
        "美元指数 DXY", "欧元/美元", "英镑/美元", "美元/日元",
        "澳元/美元", "美元/瑞郎", "美元/人民币"
      ])
    }),
    Object.freeze({
      value: "rates",
      label: "债券与利率",
      instruments: Object.freeze([
        "美国2年期国债", "美国10年期国债", "美国30年期国债",
        "中国10年期国债", "德国10年期国债"
      ])
    }),
    Object.freeze({
      value: "other",
      label: "其他市场",
      instruments: Object.freeze([])
    })
  ]);

  const TIMEFRAMES = Object.freeze([
    "年线", "季线", "月线", "周线", "日线",
    "12小时", "8小时", "4小时", "2小时", "1小时",
    "30分钟", "15分钟", "5分钟", "3分钟", "1分钟"
  ]);

  const WAVE_PATTERNS = Object.freeze([
    Object.freeze({value: "unknown", label: "待确认"}),
    Object.freeze({value: "impulse", label: "普通推动浪"}),
    Object.freeze({value: "leading_diagonal", label: "引导楔形"}),
    Object.freeze({value: "ending_diagonal", label: "终结楔形"}),
    Object.freeze({value: "zigzag", label: "单锯齿"}),
    Object.freeze({value: "double_zigzag", label: "双锯齿"}),
    Object.freeze({value: "triple_zigzag", label: "三锯齿"}),
    Object.freeze({value: "flat", label: "平台型"}),
    Object.freeze({value: "expanded_flat", label: "扩散平台"}),
    Object.freeze({value: "running_flat", label: "奔走平台"}),
    Object.freeze({value: "contracting_triangle", label: "收敛三角形"}),
    Object.freeze({value: "barrier_triangle", label: "屏障三角形"}),
    Object.freeze({value: "expanding_triangle", label: "扩散三角形"}),
    Object.freeze({value: "combination", label: "联合型"}),
    Object.freeze({value: "double_combination", label: "双重联合型"}),
    Object.freeze({value: "triple_combination", label: "三重联合型"})
  ]);

  const WAVE_POSITIONS = Object.freeze([
    Object.freeze({value: "unknown", label: "待确认"}),
    ...["浪1", "浪2", "浪3", "浪4", "浪5", "浪A", "浪B", "浪C", "浪D", "浪E", "浪W", "浪X", "浪Y", "浪Z"]
      .map(label => Object.freeze({value: label, label}))
  ]);

  const DIRECTIONS = Object.freeze([
    Object.freeze({value: "up", label: "上涨"}),
    Object.freeze({value: "down", label: "下跌"}),
    Object.freeze({value: "sideways", label: "横向整理"}),
    Object.freeze({value: "unknown", label: "待确认"})
  ]);

  function optionLabel(options, value, fallback = "") {
    const found = options.find(option => option.value === value);
    return found ? found.label : fallback || String(value || "");
  }

  function marketLabel(value) {
    return optionLabel(MARKET_GROUPS, value, value);
  }

  function patternLabel(value) {
    return optionLabel(WAVE_PATTERNS, value, value);
  }

  function directionLabel(value) {
    return optionLabel(DIRECTIONS, value, value);
  }

  function instrumentsFor(group) {
    const found = MARKET_GROUPS.find(item => item.value === group);
    return found ? [...found.instruments] : [];
  }

  function clean(value) {
    return String(value || "").trim();
  }

  function section(title, value) {
    const text = clean(value);
    return text ? `【${title}】\n${text}` : "";
  }

  function compileStructuredPost(input, board) {
    const context = [
      clean(input.instrument) && `品种：${clean(input.instrument)}`,
      clean(input.market) && `市场：${marketLabel(input.market)}`,
      clean(input.timeframe) && `周期：${clean(input.timeframe)}`,
      clean(input.pattern) && input.pattern !== "unknown"
        && `浪型：${patternLabel(input.pattern)}`,
      clean(input.position) && input.position !== "unknown"
        && `当前位置：${clean(input.position)}`,
      clean(input.direction) && input.direction !== "unknown"
        && `方向：${directionLabel(input.direction)}`
    ].filter(Boolean).join("　");

    const sections = board === "case_submission"
      ? [
          section("分析背景", input.thesis),
          section("首选计数", input.primaryCount),
          section("备选计数", input.alternateCount),
          section("规则与指南依据", input.evidence),
          section("成立条件", input.confirmation),
          section("失效条件", input.invalidation),
          section("需要讨论的问题", input.question),
          section("补充说明", input.notes)
        ]
      : board === "question_answers"
        ? [
          section("问题与当前判断", input.thesis),
          section("规则与指南依据", input.evidence),
          section("适用边界与反例", input.invalidation),
          section("希望得到的回答", input.question),
          section("补充说明", input.notes)
        ]
        : board === "review_answers"
          ? [
            section("复盘对象与原始判断", input.thesis),
            section("规则与指南依据", input.evidence),
            section("最终走势与偏差", input.invalidation),
            section("希望得到的回答", input.question),
            section("补充说明", input.notes)
          ]
          : [
          section("核心观点", input.thesis),
          section("规则与指南依据", input.evidence),
          section("适用边界与反例", input.invalidation),
          section("实际应用", input.application),
          section("希望讨论的问题", input.question),
          section("补充说明", input.notes)
          ];

    const structured = [
      context ? `【分析对象】\n${context}` : "",
      ...sections
    ].filter(Boolean).join("\n\n");
    const onlyNotes = !context && !clean(input.thesis) && !clean(input.primaryCount)
      && !clean(input.alternateCount) && !clean(input.evidence)
      && !clean(input.confirmation) && !clean(input.invalidation)
      && !clean(input.application) && !clean(input.question);
    return onlyNotes ? clean(input.notes) : structured;
  }

  return {
    MARKET_GROUPS,
    TIMEFRAMES,
    WAVE_PATTERNS,
    WAVE_POSITIONS,
    DIRECTIONS,
    marketLabel,
    patternLabel,
    directionLabel,
    instrumentsFor,
    compileStructuredPost
  };
});
