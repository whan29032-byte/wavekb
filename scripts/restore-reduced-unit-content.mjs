import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const unitsPath = path.join(repositoryRoot, "knowledge/units/all.jsonl");
const units = fs.readFileSync(unitsPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));

// These summaries are deliberately bounded by the recorded source pages. The
// tenth-edition entries come from the 280-page page distillation; the historical
// entries come from the cited eleventh-edition supplement pages.
const primaryRestorations = {
  "ewp-rule-impulse-core": {
    explanation: "推动浪通常由五浪构成，浪1、3、5沿大一级趋势运行，浪2、4逆势调整。浪2不得越过浪1起点；浪3必须越过浪1终点且不得是浪1、3、5中最短的一浪；浪4通常不得进入浪1价格区。浪1、3、5都是作用浪，其中浪3本身必须是推动浪。",
    context: "延长会把某个作用浪进一步细分，使走势图看起来像九个同级摆动，但技术上仍是同一个五浪推动结构。通常只有浪1、3、5之一显著延长；股票指数中浪3延长最常见。通道、交替、相等、比例和波浪个性用于排序候选，不属于硬规则。",
    conditions: ["候选结构是沿大一级趋势运行的推动浪", "能在同一浪级辨认浪1至浪5及其内部结构"],
    invalidations: ["浪2越过浪1起点", "浪3未越过浪1终点", "浪3成为三个作用浪中最短者", "非斜纹浪情形下浪4进入浪1价格区"],
    mistakes: ["把通道、交替或比例指南当成硬规则", "看到九个摆动便把延长浪误判成不同形态"],
  },
  "ewp-guide-extension": {
    explanation: "延长是推动浪中某个作用浪被拉长并进一步细分的现象。一般只有浪1、3、5中的一个显著延长；股票市场最常见浪3延长，商品大牛市则较常见浪5延长。延长还可能递归出现，例如延长的浪3内部再次出现延长的第三浪。",
    context: "若浪1和浪3长度接近，浪5延长的可能性上升；若浪3已经延长，浪5往往较简洁并接近浪1长度。这些只是预期指南，必须继续服从推动浪硬规则，不能仅凭视觉长度确认。",
    conditions: ["已先验证候选推动浪的硬规则", "比较的是同一浪级的浪1、3、5"],
    invalidations: [],
    mistakes: ["把延长指南当成每次必然发生的比例", "为得到九个摆动而强行改变浪级"],
  },
  "ewp-guide-truncation": {
    explanation: "缩短指第五浪内部仍具备完整五个子浪，却没有越过第三浪终点。价格未创新高或新低本身不足以确认缩短，内部五浪结构是必要条件。",
    context: "缩短常出现在异常强劲的第三浪之后，表示趋势能量已在前一作用浪中过度释放。第10版以1962年古巴导弹危机附近及1976年末道指为历史案例；外部事件只是背景，结构判断仍依赖内部计数。",
    conditions: ["候选位置是推动浪的第五浪", "第五浪内部能够数出五个子浪"],
    invalidations: ["候选第五浪内部不能形成五浪", "价格越过第三浪终点后不再符合缩短定义"],
    mistakes: ["只因未创新高或新低便宣布缩短", "用新闻事件替代内部结构验证"],
  },
  "ewp-rule-diagonal": {
    explanation: "斜纹浪是驱动模式而非普通推动浪，允许浪4进入浪1价格区。终结斜纹浪通常细分为3-3-3-3-3，出现在第五浪或A-B-C的C浪末端；引导斜纹浪出现在浪1或浪A，内部结构须依原书所述变体检查。浪3仍不得是作用浪中最短者。",
    context: "终结斜纹浪多在会聚边界内形成楔形，扩散型较少见。其浪5有时翻越连接浪1与浪3终点的边界，也可能达不到边界；这些表现是常见特征而非定义本身。完成后常出现快速反向运动。",
    conditions: ["终结形态位于浪5或浪C，或引导形态位于浪1或浪A", "边界、重叠与内部细分共同支持斜纹浪"],
    invalidations: ["浪3成为三个作用浪中最短者", "位置不符合引导或终结斜纹浪允许的位置"],
    mistakes: ["把任何楔形价格图都标成斜纹浪", "忽略内部三浪式细分和允许位置"],
  },
  "ewp-guide-diagonal": {
    explanation: "趋势末端同时出现重叠、三浪式细分和楔形边界时，应优先评估终结斜纹浪，而不是把它继续解释为普通推动浪。会聚形态比扩散形态常见，浪5翻越边界时可能伴随成交量放大。",
    context: "1976—1978年的多个图例显示，上升或下降终结斜纹浪完成后，市场往往出现显著的反方向运动。该表现用于确认和风险管理，不保证反转的幅度或时间。",
    conditions: ["形态接近大一级趋势末端", "重叠、三浪细分与边界形状同时出现"],
    invalidations: [],
    mistakes: ["仅凭两条会聚趋势线确认形态", "把完成后的急反转当成确定性价格目标"],
  },
  "ewp-rule-zigzag": {
    explanation: "锯齿形是陡直的A-B-C调整，内部结构为5-3-5：A与C是驱动式五浪，B是调整式三浪。B不得越过A起点，C通常越过A终点。熊市中的向上锯齿使用相同结构但方向倒置。",
    context: "单个锯齿未完成足够回撤时，可由X浪连接第二个、极少数情况下第三个锯齿，形成W-X-Y或W-X-Y-X-Z。重复串联仍是调整结构，不能因外观具有多个推进段而误标为推动浪。",
    conditions: ["候选处于逆大一级趋势的调整位置", "A与C具备驱动式五浪，B具备调整结构"],
    invalidations: ["B越过A起点", "A或C无法满足驱动浪结构"],
    mistakes: ["把双重锯齿误作推动浪延长", "只按价格斜率判断而不检查5-3-5内部结构"],
  },
  "ewp-guide-zigzag": {
    explanation: "锯齿形的C常与A等长，B常回撤A的约38%至79%；A起点至B终点的连线与A、C终点连线常近似平行，可辅助估计C的区域。",
    context: "这些比例和通道关系只用于候选排序。首先必须满足5-3-5结构与B不越A起点等规则；比例不典型不能单独否定一个结构合格的锯齿形。",
    conditions: ["已确认候选满足锯齿形硬规则", "比例测量使用同一价格口径和浪级"],
    invalidations: [],
    mistakes: ["以0.618或等长关系单独确认锯齿形", "比例不典型时无视结构而强行改数浪"],
  },
  "ewp-rule-flat": {
    explanation: "平台形是3-3-5调整：A为三浪，B为三浪，C为推动或斜纹式五浪。B至少回撤A的大部分；规则平台的B约回到A起点，C略越A终点。",
    context: "扩散平台中B越过A起点，C随后显著越过A终点；顺势平台中B同样越过A起点，但C未到A终点，反映大一级趋势很强。顺势平台极少见，必须通过内部结构排除候选B其实是新推动浪第一浪的可能。",
    conditions: ["候选位于调整位置", "A、B、C分别满足3-3-5内部结构"],
    invalidations: ["A为五浪或三角形", "B未达到平台形所需的深度", "C不是推动或斜纹式驱动结构"],
    mistakes: ["过早使用罕见的顺势平台标签", "把B越过A起点直接视为新趋势而不检查内部结构"],
  },
  "ewp-guide-flat": {
    explanation: "平台形比锯齿形更偏横向、回撤通常更浅，常出现在大一级趋势强劲、延长浪之前或之后。推动浪中浪4常见平台，浪2较少出现平台，这与交替指南相容。",
    context: "扩散平台比规则平台更常见；顺势平台则非常少见。实际判别应以3-3-5结构为先，再用B、C相对A起终点的位置区分子类型。",
    conditions: ["先完成A、B、C内部结构检查", "再比较B和C相对A的价格位置"],
    invalidations: [],
    mistakes: ["根据外观横盘就忽略3-3-5结构", "把少见的顺势平台当成方便解释任何未达目标的标签"],
  },
  "ewp-rule-triangle": {
    explanation: "三角形由五个相互重叠的三浪A-B-C-D-E组成。连接A-C与B-D终点形成边界；E可以未达A-C边界，也可能短暂越过。主要变体为收缩、屏障和扩散三角形，屏障形的水平边位于随后突破的一侧。",
    context: "三角形通常出现在大一级模式最后一个作用浪之前，例如推动浪4、A-B-C的B、复杂调整的最后一个X，或作为联合形最后一个分量。子浪多为锯齿，其中C最常复杂化；三角形不会作为推动浪2出现。",
    conditions: ["候选由A至E五个调整式子浪构成", "所处位置允许三角形出现"],
    invalidations: ["内部不是五个三浪", "出现在推动浪2等不允许的位置", "边界和子浪关系不符合任何允许变体"],
    mistakes: ["只看到五次摆动便提前确认", "把顺势三角形与顺势平台混淆"],
  },
  "ewp-guide-triangle": {
    explanation: "第四浪三角形完成后常出现快速而短暂的冲击，典型测量目标接近三角形最宽处。边界延长线相交的时间附近也常出现转折，但两者都属于经验指南。",
    context: "C浪有时复杂化，个别E浪自身也形成三角形，使整个结构扩展成九个摆动。形态未完成前应给它足够时间，不能因预期冲击而提前下结论。",
    conditions: ["三角形A至E已经完成", "硬规则与允许位置均已验证"],
    invalidations: [],
    mistakes: ["在E浪完成前交易所谓突破", "把宽度目标或边界交点当成确定性预测"],
  },
  "ewp-rule-combination": {
    explanation: "联合形用一个或两个X浪连接两个或三个简单调整，写作W-X-Y或W-X-Y-X-Z。W、Y、Z表示完整调整模式，X表示连接它们的反作用调整；三角形若出现，只能作为最后一个分量。",
    context: "双重三浪和三重三浪整体多为横向，首个简单形态往往已经完成主要价格回撤，后续分量主要延长时间、触及通道或协调浪间比例。多重锯齿则继续补足价格回撤，目的与横向联合形不同。",
    conditions: ["每个W、Y、Z自身是完整的允许调整模式", "X浪承担连接作用", "三角形只位于最后一个分量"],
    invalidations: ["组合中使用多个三角形", "超过三个简单调整分量", "把子浪标签误作完整模式标签"],
    mistakes: ["继续沿用旧A-B-C标签而混淆浪级", "把多重锯齿与横向双重三浪视为同一目的"],
  },
  "ewp-guide-combination": {
    explanation: "当一个简单调整已经完成主要价格回撤、但持续时间或通道关系仍不协调时，市场可能以X浪连接另一个简单形态形成联合形。常见组合通过不同形态交替延长横向整理。",
    context: "组合应写作W-X-Y（必要时再接X-Z），而不是机械延长A-B-C。三角形通常只放在最后；边界尚未稳定或子浪仍在复杂化时，应保留候选而不是抢先定型。",
    conditions: ["首个简单调整结构完整", "后续结构通过X浪连接并仍处于大一级调整位置"],
    invalidations: [],
    mistakes: ["看到任何复杂横盘就不断追加X浪", "忽略每个分量必须自身完整"],
  },
};

const supplementContext = {
  "ewp-case-rare-double-three": "附录逐项比较1966—1982年循环浪IV的多个方案。双重三浪方案把第二个“三浪”解释为上升屏障三角形，并同时记录规则符合项、时间比例缺点、长期通道和后续广泛性证据。",
  "ewp-case-fibonacci-history": "相关章节回顾斐波那契数列及黄金比率的概念传播，用来说明术语和数学背景；它没有把历史叙述本身定义为市场入场或出场信号。",
  "ewp-theory-phi-natural-order": "作者列举建筑、艺术和自然形态中的黄金比例，并据此讨论秩序与成长。这是一种跨领域类比和理论解释，不等同于对某一市场数浪的独立实证。",
  "ewp-case-long-market-spirals": "书中把若干长期指数图与斐波那契计数、螺线关系并列，说明作者如何观察长期结构；所画关系依赖所选起止点和历史数据口径。",
  "ewp-case-historical-ratio-forecasts": "章节回顾艾略特、博尔顿、弗罗斯特和作者在特定时点依据既定数浪计算目标的实例，也包含目标与最低点或突破时点不完全重合的情况。",
  "ewp-case-benner-cycle": "贝纳以历史繁荣、恐慌和低价年份构造8-9-10与16-18-20年的周期序列。原书讨论它与斐波那契关系的可能呼应，但没有把它并入波浪形态的硬规则。",
  "ewp-theory-social-pattern-endogenous": "长期浪章节把市场形态解释为群体互动生成的内生社会模式，并区分群体结果与个人选择；该论述提供理论语境，不给出独立的数浪判定条件。",
  "ewp-case-millennium-wave": "作者尝试把公元950年以来的商业与工业发展阶段标成超长期五浪，同时承认早期资料粗略、价格序列和社会史分期难以精确对应。",
  "ewp-case-supercycle-1789": "1789年以来的历史图使用交替、趋势通道、第三浪延长和1929—1932年锯齿等证据比较长期顶部方案，展示的是完整分析过程而非可复制的点位比例。",
  "ewp-case-supercycle-1932": "1932年后的逐浪回顾同时使用内部结构、通道、前一第四浪区域、比例和备选方案；1978年以后尚未发生的部分在原文中属于当时预测。",
  "ewp-guide-stock-market-alignment": "个股章节给出约75%的股票随市场上涨、90%随市场下跌的历史观察，并讨论封闭式基金、周期股和强情绪成长股的差异。原文同时警告个股通常比平均指数难数。",
  "ewp-case-individual-stocks": "美国钢铁、道氏化学、柯达等图例展示完整五浪、A-B-C和通道破位在个股上的可能形态；这些精选图例与许多不可用的个股数浪同时存在。",
  "ewp-case-commodity-ratios": "1970年代咖啡、大豆和小麦图例把1.618、黄金分割、三角形和锯齿与实际行情并列，展示测量步骤，也显示商品第五浪延长的历史倾向。",
  "ewp-case-gold-price-control": "黄金在官方固定价格时期缺少自由形成的连续价格波动，解除限制后才出现可供分析的较清晰结构，因此市场机制与数据条件是应用方法前提。",
  "ewp-case-gold-1970s": "黄金案例同时检查五浪上涨、扩散平台、矿业股无印证、C浪目标与后续备选；原文中的买卖判断和黄金价值看法都属于当时语境。",
  "ewp-case-kondratieff": "原书把约50至60年的康德拉蒂耶夫扩张—收缩周期与超级循环浪作比较，并用战争、通胀和萧条阶段解释历史位置；两套模型的定义并不相同。",
  "ewp-case-decade-pattern": "十周年模式把多个十年的市场路径叠加成平均走势，再与艾略特结构比较。平均图会隐藏单个十年的差异，不能成为每十年必须重复的规则。",
  "ewp-case-random-walk-critique": "作者以长期成功的交易者、重复形态和自相似图例质疑纯随机解释。这是论证材料，未提供足以替代统计随机性检验的独立样本设计。",
  "ewp-theory-exogenous-forces-unproven": "章节罗列太阳黑子、地球物理与行星周期研究，同时把这些外生因素如何影响群体心理的问题明确留给其他研究者证明。",
  "ewp-case-1978-alternative-counts": "1978年的文本保留巨大斜纹浪与扩散平台两种长期研判，分别给出结构理由、概率判断和不同目标，示范候选必须随之后的市场行为重新排序。",
  "ewp-theory-natural-law-ideology": "艾略特演说中的纸币、政府、资本、权利和社会退化论述体现作者的政治经济立场及长期社会预期，与波浪形态的结构定义属于不同证据层。",
  "ewp-case-elliott-1935-forecast": "序言记述艾略特在铁路股跌破前低的背景下判断1935年下跌结束，并在随后行情中获得认可。它是理论传播史中的一次成功案例，而非频率统计。",
  "ewp-case-postscript-context": "后记补充1970年代末至1982年的高通胀、高利率和普遍悲观环境，使读者能区分预测当时可见的信息与后来牛市结果。",
  "ewp-case-time-and-equality-revision": "后记说明循环浪V的持续时间与涨幅远超早先估计，作者因而修订价格和时间看法，并把波浪等同明确留在指南层而非规则层。",
  "ewp-case-publisher-success-claim": "出版者后记回顾若干命中、修订和仍待市场验证的判断。它提供事后评价与历史结果，但不是独立于作者和出版者的验证样本。",
};

let restored = 0;
for (const unit of units) {
  const primary = primaryRestorations[unit.id];
  if (primary) {
    unit.content = `${unit.statement}\n\n${primary.explanation}\n\n${primary.context}`;
    unit.conditions = primary.conditions;
    unit.invalidations = primary.invalidations;
    if (unit.type === "GUIDELINE") unit.guidelines = [primary.explanation, primary.context];
    unit.examples = [primary.context];
    unit.common_mistakes = primary.mistakes;
    unit.content_audit = { status: "RESTORED", authority: "primary", method: "tenth_edition_page_distillation" };
    restored += 1;
    continue;
  }

  const context = supplementContext[unit.id];
  if (!context) continue;
  const use = unit.action?.length ? `使用边界：${unit.action.join("；")}。` : "使用边界：先验证当前市场结构；不得把精选历史图例直接外推为确定性预测。";
  unit.content = `${unit.statement}\n\n${context}\n\n${use}`;
  unit.conditions = ["只在回看所列版本、章节和页码的历史语境时使用", "与当前市场应用分开记录日期、数据口径和候选数浪"];
  unit.invalidations = ["不能用该单一案例替代结构规则、当前证据或独立统计验证"];
  if (unit.type === "GUIDELINE") unit.guidelines = [unit.statement, use];
  unit.examples = [context];
  unit.common_mistakes = ["把历史案例写成普遍统计证明", "隐去原预测时点、备选方案或后续修订", "让第11版补充材料覆盖第10版核心规则"];
  unit.content_audit = { status: "RESTORED", authority: "supplement", method: "eleventh_edition_cited_pages" };
  restored += 1;
}

if (restored !== 38) throw new Error(`Expected to restore 38 reduced Units, restored ${restored}`);
fs.writeFileSync(unitsPath, `${units.map((unit) => JSON.stringify(unit)).join("\n")}\n`);
console.log(`Restored source-bounded context for ${restored} Units (13 primary, 25 supplement)`);
