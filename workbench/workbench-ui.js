(function (root, factory) {
  const core = typeof module === "object" && module.exports
    ? require("./workbench-core.js")
    : root.ElliottWorkbenchCore;
  const rules = typeof module === "object" && module.exports
    ? require("./wave-rule-engine.js")
    : root.ElliottWaveRuleEngine;
  const calculators = typeof module === "object" && module.exports
    ? require("./workbench-calculators.js")
    : root.ElliottWorkbenchCalculators;
  const scoring = typeof module === "object" && module.exports
    ? require("./workbench-scoring.js")
    : root.ElliottWorkbenchScoring;
  const catalog = typeof module === "object" && module.exports
    ? require("../community/research-catalog.js")
    : root.ElliottResearchCatalog;
  const api = factory(core, rules, calculators, scoring, catalog);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ElliottWorkbenchUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  core,
  rules,
  calculators,
  scoring,
  catalog
) {
  "use strict";

  const STEPS = Object.freeze([
    {number: 0, title: "市场环境过滤", short: "环境"},
    {number: 1, title: "确认分析级别", short: "级别"},
    {number: 2, title: "确认当前浪级", short: "浪级"},
    {number: 3, title: "回撤确认", short: "回撤"},
    {number: 4, title: "调整结构识别", short: "调整"},
    {number: 5, title: "驱动结构检查", short: "驱动"},
    {number: 6, title: "规则检查", short: "规则"},
    {number: 7, title: "方案选择", short: "方案"},
    {number: 8, title: "风险收益评估", short: "风控"},
    {number: 9, title: "执行计划", short: "执行"},
    {number: 10, title: "复盘系统", short: "复盘"}
  ]);
  const RESULT_LABELS = Object.freeze([
    "结构置信评分",
    "交易适宜度",
    "规则状态",
    "指南证据",
    "最大回撤",
    "风险收益"
  ]);

  function aiRunPresentation() {
    return {
      label: "启动 AI 候选分析",
      disclaimer: "使用你在“AI 控制中心”中选择的模型生成候选方案；本站第10版知识库、硬规则闸门和风险计算仍由服务器处理。"
    };
  }

  function ruleCheckSections() {
    return [
      {key: "hard_rules", label: "硬规则：违反即淘汰"},
      {key: "guidelines", label: "指南：只用于候选排序"},
      {key: "unknown", label: "信息不足：等待补充"}
    ];
  }

  function reviewEntryFromAnalysis(analysis) {
    return {
      kind: "review",
      visibility: "private",
      title: `${analysis.instrument || "未命名品种"} ${analysis.primary_timeframe || ""} 交易复盘`.trim(),
      body: "",
      workbench_analysis_id: analysis.id,
      review_data: {
        analysis_snapshot: JSON.parse(JSON.stringify(analysis)),
        final_pattern: "",
        error_category: "",
        discipline_notes: "",
        lessons: ""
      }
    };
  }

  function createWorkbenchUI(options) {
    const contentHost = options.contentHost;
    const breadcrumbHost = options.breadcrumbHost;
    const repository = options.repository;
    const memberRepository = options.memberRepository || null;
    const auth = options.auth;
    const configured = Boolean(options.configured);
    const navigate = options.navigate;
    const gatewayUrl = String(options.gatewayUrl || "").replace(/\/$/, "");
    const doc = contentHost.ownerDocument;
    const view = doc.defaultView || window;
    let activeAnalysis = null;
    let renderSequence = 0;

    function element(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function button(text, className = "btn btn-ghost") {
      const node = element("button", className, text);
      node.type = "button";
      return node;
    }

    function notice(title, message) {
      const panel = element("section", "community-notice");
      panel.append(element("h2", "", title), element("p", "", message));
      return panel;
    }

    function setBreadcrumb(step, panel = "analysis") {
      const list = element("ol", "kb-breadcrumb-list");
      const labels = panel === "records"
        ? ["交易工作台", "复盘与记录"]
        : ["交易工作台", `第${step.number}步`, step.title];
      labels.forEach((label, index) => {
        const li = element("li");
        if (index) li.appendChild(doc.createTextNode("› "));
        li.appendChild(doc.createTextNode(label));
        list.appendChild(li);
      });
      breadcrumbHost.replaceChildren(list);
    }

    function hashLink(hash, text, className) {
      const link = element("a", className || "btn btn-ghost", text);
      link.href = hash;
      link.addEventListener("click", event => {
        event.preventDefault();
        navigate(link.hash);
      });
      return link;
    }

    function workspaceLink(route, text, className) {
      return hashLink(core.hashForWorkbenchRoute(route), text, className);
    }

    function workspaceNav(route) {
      const nav = element("nav", "workbench-section-nav");
      nav.setAttribute("aria-label", "交易工作台区域");
      const analysis = workspaceLink(
        {analysisId: route.analysisId, step: route.step, panel: "analysis"},
        "分析流程",
        "workbench-section-link"
      );
      const records = workspaceLink(
        {
          analysisId: route.analysisId,
          step: route.step,
          panel: "records",
          recordView: route.recordView || "all"
        },
        "复盘与记录",
        "workbench-section-link"
      );
      const ai = hashLink(
        "#workbench=new&step=0&panel=ai",
        "AI 模型",
        "workbench-section-link"
      );
      const active = route.panel === "records" ? records : analysis;
      active.setAttribute("aria-current", "page");
      nav.append(analysis, records, ai);
      return nav;
    }

    function recordKindLabel(kind) {
      return {review: "复盘", journal: "交易日记", draft: "研究草稿"}[kind] || "记录";
    }

    function recordCard(entry) {
      const card = element("article", "workbench-record-card");
      const meta = element("div", "workbench-record-meta");
      const date = new Date(entry.updated_at || entry.created_at || Date.now());
      meta.append(
        element("span", "workbench-record-kind", recordKindLabel(entry.kind)),
        element("time", "text-small text-muted", date.toLocaleDateString("zh-CN"))
      );
      const title = hashLink(
        `#space=entry&entry=${encodeURIComponent(entry.id)}`,
        entry.title || "未命名记录",
        "workbench-record-title"
      );
      const excerpt = element(
        "p",
        "text-small text-muted",
        String(entry.body || "").replace(/\s+/g, " ").slice(0, 140) || "这条记录还没有正文。"
      );
      card.append(meta, title, excerpt);
      return card;
    }

    async function renderRecordCenter(route) {
      const actor = auth.actor();
      if (!actor) return notice("登录后使用复盘与记录", "登录后即可管理私人复盘、交易日记和研究草稿。");
      if (!configured || !memberRepository || typeof memberRepository.listPrivateEntries !== "function") {
        return notice("记录服务尚未连接", "私人记录功能需要连接网站数据库后使用。");
      }
      const allEntries = await memberRepository.listPrivateEntries(actor.id, null);
      const rows = Array.isArray(allEntries) ? allEntries : [];
      const selected = route.recordView || "all";
      const visible = selected === "all" ? rows : rows.filter(item => item.kind === selected);
      const section = element("section", "workbench-record-center");
      const heading = element("header", "workbench-record-heading");
      const headingCopy = element("div");
      headingCopy.append(
        element("p", "member-eyebrow", "私人交易档案"),
        element("h1", "", "复盘、日记与研究草稿"),
        element("p", "text-muted", "分析、执行与复查统一留在交易工作台，默认仅自己可见。")
      );
      const actions = element("div", "workbench-record-actions");
      actions.append(
        hashLink("#space=entry&entry=new-review", "新建复盘", "btn btn-primary"),
        hashLink("#space=entry&entry=new-journal", "写交易日记", "btn btn-ghost"),
        hashLink("#space=entry&entry=new-draft", "写研究草稿", "btn btn-ghost")
      );
      heading.append(headingCopy, actions);

      const filters = element("nav", "workbench-record-filters");
      filters.setAttribute("aria-label", "工作台记录筛选");
      [
        ["all", "全部记录"],
        ["review", "复盘"],
        ["journal", "日记"],
        ["draft", "草稿"]
      ].forEach(([recordView, label]) => {
        const link = workspaceLink(
          {
            analysisId: route.analysisId,
            step: route.step,
            panel: "records",
            recordView
          },
          label,
          "workbench-record-filter"
        );
        if (selected === recordView) link.setAttribute("aria-current", "page");
        filters.appendChild(link);
      });

      const list = element("section", "workbench-record-list");
      if (!visible.length) {
        list.appendChild(notice(
          selected === "all" ? "还没有私人记录" : `还没有${recordKindLabel(selected)}`,
          "从上方选择一种记录开始，保存后会自动回到这里。"
        ));
      } else {
        visible.forEach(entry => list.appendChild(recordCard(entry)));
      }
      section.append(heading, filters, list);
      return section;
    }

    function storageKey(id) {
      return `elliott-workbench-v1:${id || "new"}`;
    }

    function defaultAnalysis(id) {
      return {
        id: id === "new" ? null : id,
        schema_version: "workbench-v1",
        input_source: "manual",
        instrument: "",
        market: "",
        parent_timeframe: "日线",
        primary_timeframe: "4小时",
        child_timeframe: "1小时",
        holding_style: "波段",
        step_data: {},
        rule_result: {},
        score_result: {},
        risk_result: {},
        drawdown_result: {},
        execution_status: "draft"
      };
    }

    function loadLocal(id) {
      try {
        const stored = view.localStorage.getItem(storageKey(id));
        return stored ? JSON.parse(stored) : null;
      } catch (_) {
        return null;
      }
    }

    function saveLocal(analysis) {
      try {
        view.localStorage.setItem(
          storageKey(analysis.id || "new"),
          JSON.stringify(analysis)
        );
      } catch (_) {
        // The in-memory draft still remains available in this session.
      }
    }

    function linkStep(analysisId, step) {
      const link = element("a", "workbench-step");
      link.href = core.hashForWorkbenchRoute({analysisId, step: step.number});
      link.append(
        element("span", "workbench-step-number", String(step.number)),
        element("span", "workbench-step-title", step.short)
      );
      link.addEventListener("click", event => {
        event.preventDefault();
        navigate(link.hash);
      });
      return link;
    }

    function stepper(route) {
      const nav = element("nav", "workbench-stepper");
      nav.setAttribute("aria-label", "工作台步骤");
      STEPS.forEach(step => {
        const link = linkStep(route.analysisId, step);
        if (step.number === route.step) link.setAttribute("aria-current", "step");
        nav.appendChild(link);
      });
      return nav;
    }

    function field(label, input, hint) {
      const wrapper = element("label", "community-field");
      wrapper.appendChild(element("span", "", label));
      wrapper.appendChild(input);
      if (hint) wrapper.appendChild(element("small", "text-muted", hint));
      return wrapper;
    }

    function textInput(value = "") {
      const input = element("input");
      input.value = value;
      return input;
    }

    function numberInput(value = "") {
      const input = textInput(value);
      input.type = "number";
      input.step = "any";
      return input;
    }

    function selectInput(values, selected) {
      const select = element("select");
      values.forEach(item => {
        const value = typeof item === "object" ? item.value : item;
        const label = typeof item === "object" ? item.label : item;
        const option = element("option", "", label);
        option.value = value;
        option.selected = value === selected;
        select.appendChild(option);
      });
      return select;
    }

    function stepText(step) {
      return {
        0: "宏观环境只决定是否适合交易，不改变波浪结构是否有效。",
        1: "不允许跳级分析：同时固定上一级、当前级和下一级。",
        2: "记录驱动或调整、完成度，以及主计数和两个备选。",
        3: "价格和时间比例属于指南；最大回撤刷新也不能单独宣布上涨结束，必须结合同级别和内部结构完成度。",
        4: "在锯齿、平台、三角和联合形之间检查还缺哪一段。",
        5: "普通推动、引导斜纹和终结斜纹必须分别应用规则。",
        6: "硬规则负责淘汰；比例、时间、通道、成交量和个性只负责排序。",
        7: "每个方案都要写成立、确认、失效和目标区，不填未经校准的概率。",
        8: "仓位、最大亏损和盈亏比由程序计算；结构失效位与交易止损分开。",
        9: "入场条件未触发时只能等待，不因临盘情绪提前执行。",
        10: "保留初始分析快照，对比实际走势，复盘数浪、执行和纪律。"
      }[step.number];
    }

    function generalStepForm(step, analysis, onChange) {
      const form = element("section", "workbench-form-card");
      form.append(
        element("p", "member-eyebrow", `第${step.number}步`),
        element("h1", "", step.title),
        element("p", "text-muted", stepText(step))
      );
      const stored = analysis.step_data[String(step.number)] || {};
      const notes = element("textarea");
      notes.rows = 10;
      notes.value = stored.notes || "";
      notes.placeholder = "记录判断、证据、未知项和下一步需要确认的条件";
      notes.addEventListener("input", () => onChange({notes: notes.value}));
      form.appendChild(field("分析记录", notes));
      return form;
    }

    function levelForm(step, analysis, onChange) {
      const form = generalStepForm(step, analysis, onChange);
      const instrument = textInput(analysis.instrument);
      const market = selectInput(catalog.MARKET_GROUPS, analysis.market || "crypto");
      const instrumentList = element("datalist");
      instrumentList.id = `workbench-instruments-${Math.random().toString(36).slice(2)}`;
      instrument.setAttribute("list", instrumentList.id);
      instrument.placeholder = "搜索或输入品种";
      const refreshInstruments = () => {
        instrumentList.replaceChildren(...catalog.instrumentsFor(market.value).map(name => {
          const option = element("option");
          option.value = name;
          return option;
        }));
      };
      market.addEventListener("change", refreshInstruments);
      refreshInstruments();
      const parent = selectInput(catalog.TIMEFRAMES, analysis.parent_timeframe);
      const primary = selectInput(catalog.TIMEFRAMES, analysis.primary_timeframe);
      const child = selectInput(catalog.TIMEFRAMES, analysis.child_timeframe);
      const style = selectInput(core.HOLDING_STYLES, analysis.holding_style);
      const update = () => {
        analysis.instrument = instrument.value.trim();
        analysis.market = market.value.trim();
        analysis.parent_timeframe = parent.value;
        analysis.primary_timeframe = primary.value;
        analysis.child_timeframe = child.value;
        analysis.holding_style = style.value;
        saveLocal(analysis);
      };
      [instrument, market, parent, primary, child, style]
        .forEach(input => input.addEventListener("change", update));
      form.append(
        field("市场分类", market),
        field("品种（可搜索）", instrument),
        instrumentList,
        field("上一级周期", parent),
        field("当前分析周期", primary),
        field("下一级周期", child),
        field("持有风格", style)
      );
      return form;
    }

    function riskForm(step, analysis, onChange, resultHost) {
      const form = generalStepForm(step, analysis, onChange);
      const stored = analysis.step_data["8"] || {};
      const inputs = {
        equity: numberInput(stored.equity || 100000),
        risk_percent: numberInput(stored.risk_percent || 1),
        entry: numberInput(stored.entry || ""),
        stop: numberInput(stored.stop || ""),
        target: numberInput(stored.target || ""),
        contract_multiplier: numberInput(stored.contract_multiplier || 1),
        lot_size: numberInput(stored.lot_size || 1),
        fees: numberInput(stored.fees || 0)
      };
      const calculate = button("计算风险收益", "btn btn-primary");
      calculate.addEventListener("click", () => {
        const value = Object.fromEntries(
          Object.entries(inputs).map(([key, input]) => [key, Number(input.value)])
        );
        const result = calculators.riskPosition(value);
        analysis.step_data["8"] = {
          ...(analysis.step_data["8"] || {}),
          ...value
        };
        analysis.risk_result = result;
        saveLocal(analysis);
        renderResultPanel(resultHost, analysis, step);
      });
      const labels = {
        equity: "账户权益",
        risk_percent: "单笔风险（%）",
        entry: "计划入场价",
        stop: "交易止损价",
        target: "目标价",
        contract_multiplier: "合约乘数",
        lot_size: "最小交易单位",
        fees: "单单位费用"
      };
      Object.entries(inputs).forEach(([key, input]) => {
        form.appendChild(field(labels[key], input));
      });
      form.appendChild(calculate);
      return form;
    }

    function drawdownForm(step, analysis, onChange, resultHost) {
      const form = generalStepForm(step, analysis, onChange);
      const stored = analysis.step_data["3"] || {};
      const curve = element("textarea");
      curve.rows = 7;
      curve.value = stored.equity_curve || "";
      curve.placeholder = "粘贴价格/权益序列，每行一个，也可用逗号或空格分隔\n例如：100, 112, 108, 125, 117";
      const sameDegree = element("input");
      sameDegree.type = "checkbox";
      sameDegree.checked = Boolean(stored.same_degree_refresh);
      const segmentComplete = element("input");
      segmentComplete.type = "checkbox";
      segmentComplete.checked = Boolean(stored.segment_complete);
      const calculate = button("测量最大回撤", "btn btn-primary");
      calculate.addEventListener("click", () => {
        const values = curve.value
          .split(/[\\s,，;；]+/)
          .map(value => Number(value.trim()))
          .filter(Number.isFinite);
        const value = {
          equity_curve: curve.value,
          same_degree_refresh: sameDegree.checked,
          segment_complete: segmentComplete.checked
        };
        analysis.step_data["3"] = {...stored, ...value};
        analysis.drawdown_result = calculators.maxDrawdown(values, {
          same_degree_refresh: value.same_degree_refresh,
          segment_complete: value.segment_complete
        });
        saveLocal(analysis);
        renderResultPanel(resultHost, analysis, step);
      });
      const update = () => {
        onChange({
          equity_curve: curve.value,
          same_degree_refresh: sameDegree.checked,
          segment_complete: segmentComplete.checked
        });
      };
      curve.addEventListener("input", update);
      sameDegree.addEventListener("change", update);
      segmentComplete.addEventListener("change", update);
      form.append(
        field("价格/权益序列", curve, "用于统计从峰值到后续低点的最大回撤。"),
        field("同级别波段刷新", sameDegree, "只有同级别波段才可刷新同级最大回撤。"),
        field("内部浪型已完成", segmentComplete, "完成标记是结构判断输入，不会由回撤百分比自动推断。"),
        calculate
      );
      return form;
    }

    function ruleForm(step, analysis, onChange, resultHost) {
      const form = generalStepForm(step, analysis, onChange);
      const stored = analysis.step_data["6"] || {};
      const pattern = selectInput(
        [
          {value: "impulse", label: "普通推动浪"},
          {value: "diagonal", label: "斜纹浪（引导/终结）"},
          {value: "zigzag", label: "锯齿型"},
          {value: "flat", label: "平台型"},
          {value: "triangle", label: "三角形"},
          {value: "combination", label: "联合型"}
        ],
        stored.pattern || "impulse"
      );
      const direction = selectInput(
        [{value: "up", label: "上涨"}, {value: "down", label: "下跌"}],
        stored.direction || "up"
      );
      const waveValues = {
        w1_start: numberInput(stored.w1_start || 100),
        w1_end: numberInput(stored.w1_end || 120),
        w2_end: numberInput(stored.w2_end || 110),
        w3_end: numberInput(stored.w3_end || 160),
        w4_end: numberInput(stored.w4_end || 140),
        w5_end: numberInput(stored.w5_end || 175)
      };
      form.append(field("候选结构", pattern), field("方向", direction));
      const waveLabels = {
        w1_start: "浪1起点",
        w1_end: "浪1终点",
        w2_end: "浪2终点",
        w3_end: "浪3终点",
        w4_end: "浪4终点",
        w5_end: "浪5终点"
      };
      Object.entries(waveValues).forEach(([key, input]) => {
        form.appendChild(field(waveLabels[key], input));
      });
      const evaluate = button("执行硬规则检查", "btn btn-primary");
      evaluate.addEventListener("click", () => {
        const value = {
          pattern: pattern.value,
          direction: direction.value,
          ...Object.fromEntries(
            Object.entries(waveValues).map(([key, input]) => [key, Number(input.value)])
          )
        };
        const scenario = {
          pattern: value.pattern,
          direction: value.direction,
          waves: {
            w1: {start: value.w1_start, end: value.w1_end},
            w2: {end: value.w2_end},
            w3: {end: value.w3_end},
            w4: {end: value.w4_end},
            w5: {end: value.w5_end}
          }
        };
        analysis.step_data["6"] = value;
        analysis.rule_result = rules.evaluateScenario(scenario);
        analysis.score_result = scoring.scoreScenario({
          rule_status: analysis.rule_result.status,
          structure: analysis.rule_result.status === "valid" ? 36 : 0,
          degree_context: 14,
          ratios_time: 8,
          supporting_guides: 8,
          macro: {score: 5}
        });
        saveLocal(analysis);
        renderResultPanel(resultHost, analysis, step);
      });
      form.appendChild(evaluate);
      return form;
    }

    function resultRow(label, value, tone) {
      const row = element("div", "workbench-result-row");
      row.append(
        element("span", "text-small text-muted", label),
        element("strong", tone || "", String(value))
      );
      return row;
    }

    function renderResultPanel(host, analysis, step) {
      host.replaceChildren();
      host.append(
        element("p", "member-eyebrow", "实时结果"),
        element("h2", "", "当前分析状态")
      );
      const rule = analysis.rule_result || {};
      const score = analysis.score_result || {};
      const risk = analysis.risk_result || {};
      const drawdown = analysis.drawdown_result || {};
      host.append(
        resultRow("硬规则", rule.status || "尚未检查"),
        resultRow("结构置信评分", score.structural_score ?? "尚未评分"),
        resultRow("交易适宜度", score.trading_suitability ?? "尚未评分"),
        resultRow("最大回撤", drawdown.ok ? drawdown.max_drawdown : "尚未测量"),
        resultRow("最大回撤比例", drawdown.ok && drawdown.max_drawdown_percent !== null
          ? `${drawdown.max_drawdown_percent}%`
          : "尚未测量"),
        resultRow("最大亏损", risk.ok ? risk.max_loss : "尚未计算"),
        resultRow("仓位上限", risk.ok ? risk.max_position : "尚未计算"),
        resultRow("盈亏比", risk.ok ? risk.reward_risk : "尚未计算")
      );
      const note = element(
        "p",
        "workbench-disclaimer text-small text-muted",
        score.disclaimer || "置信评分不是历史胜率；未满足入场条件时保持等待。"
      );
      host.appendChild(note);
      if (drawdown.ok) {
        host.appendChild(element("p", "workbench-disclaimer text-small text-muted", drawdown.disclaimer));
        host.appendChild(element("p", "text-small", drawdown.classification));
      }
      if (rule.violations && rule.violations.length) {
        const list = element("ul", "workbench-violations");
        rule.violations.forEach(item => list.appendChild(element("li", "", item.message)));
        host.appendChild(list);
      }
      const knowledge = element("a", "kb-knowledge-link", "打开对应的第10版规则页");
      knowledge.href = "#page=core-impulse";
      host.appendChild(knowledge);
    }

    async function persistForAI(analysis) {
      const actor = auth.actor();
      if (!actor) throw new Error("请先登录。");
      if (!configured || !repository) throw new Error("数据库尚未配置。");
      if (analysis.id) return analysis;
      if (!analysis.instrument.trim()) {
        throw new Error("请先在第1步填写分析品种。");
      }
      const saved = await repository.createAnalysis({
        ...analysis,
        ownerId: actor.id
      });
      Object.assign(analysis, saved);
      activeAnalysis = analysis;
      saveLocal(analysis);
      return analysis;
    }

    function appendAIRun(host, analysis, step) {
      if (step.number < 2 || step.number > 7) return;
      const panel = element("section", "workbench-ai-action");
      const presentation = aiRunPresentation();
      const run = button(presentation.label, "btn btn-primary");
      const message = element("p", "text-small text-muted", presentation.disclaimer);
      run.addEventListener("click", async () => {
        run.disabled = true;
        message.textContent = "正在保存分析并提交服务器任务…";
        try {
          if (!gatewayUrl) throw new Error("AI网关尚未配置。");
          const persisted = await persistForAI(analysis);
          const token = auth.session() && auth.session().access_token;
          if (!token) throw new Error("登录会话已失效，请重新登录。");
          const response = await fetch(
            `${gatewayUrl}/v1/analyses/${encodeURIComponent(persisted.id)}/ai-run`,
            {
              method: "POST",
              headers: {
                "content-type": "application/json",
                authorization: `Bearer ${token}`
              },
              body: JSON.stringify({
                task_type: "wave_analysis",
                step: step.number,
                schema_version: "workbench-v1"
              })
            }
          );
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            if (payload.error === "ai_connection_required") {
              throw new Error("请先在“AI 控制中心”中添加并选择一个模型。");
            }
            throw new Error(payload.error || `任务提交失败：${response.status}`);
          }
          analysis.step_data.ai_job_id = payload.job.id;
          saveLocal(analysis);
          message.textContent = "AI任务已进入服务器队列。结果会经过知识检索、结构校验和硬规则闸门。";
        } catch (error) {
          message.textContent = String(error && error.message || error);
        } finally {
          run.disabled = false;
        }
      });
      panel.append(run, message);
      host.appendChild(panel);
    }

    async function ensureAnalysis(route) {
      const local = loadLocal(route.analysisId);
      if (local) return local;
      if (route.analysisId !== "new" && configured && repository) {
        try {
          return await repository.getAnalysis(route.analysisId);
        } catch (_) {
          return defaultAnalysis(route.analysisId);
        }
      }
      return defaultAnalysis(route.analysisId);
    }

    async function render(route) {
      const sequence = ++renderSequence;
      const step = STEPS[route.step] || STEPS[0];
      const panel = route.panel === "records" ? "records" : "analysis";
      setBreadcrumb(step, panel);
      contentHost.replaceChildren(
        workspaceNav(route),
        notice("正在打开", panel === "records" ? "正在读取复盘与记录。" : "正在恢复工作台分析。")
      );
      if (panel === "records") {
        try {
          const records = await renderRecordCenter(route);
          if (sequence !== renderSequence) return;
          contentHost.replaceChildren(workspaceNav(route), records);
        } catch (error) {
          if (sequence !== renderSequence) return;
          contentHost.replaceChildren(
            workspaceNav(route),
            notice("记录暂时无法读取", String(error && error.message || error || "请稍后重试。"))
          );
        }
        return;
      }
      const analysis = await ensureAnalysis(route);
      if (sequence !== renderSequence) return;
      activeAnalysis = analysis;
      const shell = element("section", "workbench-shell");
      const resultHost = element("aside", "workbench-results");
      const onChange = value => {
        analysis.step_data[String(step.number)] = {
          ...(analysis.step_data[String(step.number)] || {}),
          ...value
        };
        saveLocal(analysis);
      };
      let form;
      if (step.number === 1) form = levelForm(step, analysis, onChange);
      else if (step.number === 3) form = drawdownForm(step, analysis, onChange, resultHost);
      else if (step.number === 6) form = ruleForm(step, analysis, onChange, resultHost);
      else if (step.number === 8) form = riskForm(step, analysis, onChange, resultHost);
      else form = generalStepForm(step, analysis, onChange);
      const main = element("div", "workbench-main");
      main.append(stepper(route), form);
      const nav = element("div", "workbench-nav-actions");
      if (step.number > 0) {
        const previous = linkStep(route.analysisId, STEPS[step.number - 1]);
        previous.className = "btn btn-ghost";
        previous.textContent = "上一步";
        nav.appendChild(previous);
      }
      if (step.number < 10) {
        const next = linkStep(route.analysisId, STEPS[step.number + 1]);
        next.className = "btn btn-primary";
        next.textContent = "保存并继续";
        nav.appendChild(next);
      }
      form.appendChild(nav);
      renderResultPanel(resultHost, analysis, step);
      appendAIRun(resultHost, analysis, step);
      shell.append(main, resultHost);
      contentHost.replaceChildren(workspaceNav(route), shell);
    }

    return {render, activeAnalysis: () => activeAnalysis};
  }

  return {
    STEPS,
    RESULT_LABELS,
    ruleCheckSections,
    reviewEntryFromAnalysis,
    aiRunPresentation,
    createWorkbenchUI
  };
});
