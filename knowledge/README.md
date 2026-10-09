# 波浪理论知识库

本站以《艾略特波浪理论：市场行为的关键（原书第11版）》作为主书阅读与检索入口，第10版保留为补充和版本对照。第11版提供321个真实PDF页位的正文与原页；可提取文字与图像页明确区分，不把机器抽取称为逐条规则人工核验。知识库用于在遇到判浪问题时，按“规则排除—指南排序—证据确认—失效管理”的顺序提供分析思路，不把指南、历史案例或作者观点冒充硬规则。

现有117个已整理知识单元仍保留原始来源：81条以第10版为正文来源，36条以第11版为正文来源。它们在补充与版本对照入口阅读，未被批量改标为第11版知识。`source/manifest.json`、原覆盖台账及图像registry的旧Primary/Supplement字段记录该批历史单元的来源核验层级；它们不是现在书架的阅读优先级。书架和AI检索的优先级由第11版新书元数据与独立检索产物决定。

## 当前规模

- 第10版覆盖：PDF 280/280页已建立唯一覆盖台账；117页同时具有明确 Unit source ref 与人工复核语义分段，159页由人工复核语义分段映射，4页确认为不产生独立 Unit 的分隔或归档页。全部280页为 `OK`。原PDF页数与SHA-256均已重新核验。
- 原书知识：保留117条可追溯原子单元的正文、真实版次与来源页，作为补充与版本对照；不声称已按第11版重新逐条整理。
- 知识关系：174条跨单元关系。
- 问题入口：18条常见问题路线，以及一套统一分析手册。
- 主书阅读：第11版321页，原PDF哈希绑定，图文按同一PDF页号定位；点击后才加载原页图像，避免预加载整本扫描图。
- 可点击知识页面：保留161个知识页面及既有URL，图片与引用明确标记实际版次。
- 扩展书架：另收录《艾略特波浪理论：自然法则》与《缠中说禅》CHM 的两本完整蒸馏 PDF，共61页。它们保留独立来源、覆盖范围和证据边界，不改写任何原书内容。
- 视觉核验：第10版全部280个PDF页已按连续页序渲染检查，章节边界与逐页蒸馏一致；旧报告中第217页扫描条带和281至320页引用属于版本页码混用，现已纠正。

## 主要入口

- `knowledge/units/all.jsonl`：现有117条整理知识的唯一正文；补充Pages、Chapters 与三种入口均引用这里的 Units，迁移阅读优先级不改其字节。
- `knowledge/pages/`：只保留页面视图配置；核心页面正文由 `scripts/build-knowledge.mjs` 从 Units 生成。
- `packages/knowledge/src/knowledge.json`：面向应用的构建产物，不是真源。
- `knowledge/browser/elliott-wave-knowledge-tree.html`：旧展示产物，不是真源。
- `knowledge/structure/tree.md`：纯文本全书分支树。
- `knowledge/questions/reasoning-playbook.md`：遇到问题时使用的分析步骤。
- `knowledge/questions/index.jsonl`：18条问题到规则、指南和方法的机器可读路由。
- `knowledge/coverage/tenth-edition-pages.jsonl`：第10版280页逐页覆盖账本。
- `knowledge/images/registry.json`：第10版 Primary 与第11版 Supplement 分离的图像语义注册表。
- `knowledge/source/library.json`：第11版主书及两本扩展书的书目、静态文件哈希、覆盖范围与阅读边界；不是旧 Unit 的来源覆盖层。
- `knowledge/source/book-text/elliott-wave-principle-eleventh-edition.json`：第11版原PDF的321个页位及各页原扫描图哈希；315页保留可提取正文，6个无可提取正文页明确标记为图像页（其中第231页文字层仅含页眉和页码）。
- `scripts/import-eleventh-edition.py --check`：全量验证第11版原PDF、正文、321页图像及其尺寸与哈希，不写入文件。
- `knowledge/source/supplements.json`：第11版补充来源清单。
- `knowledge/reports/quality-report.md`：最终质量与边界报告。
- `knowledge/reports/framework-verification.md`：未完善学习框架的核验结论。

## 知识结构

全书按用途组织为八个主题分支：强制规则与失效边界、基础结构与浪级、驱动浪、调整浪、分析方法与比例时间、波浪个性与确认、市场适用与历史案例、术语来源与理论边界。每条知识只归入一个主分支，关系文件再建立跨分支引用，避免同一内容重复维护。

## 使用边界

规则用于否定不可能的数浪；指南、比例、通道、个性和成交量用于给仍然有效的候选排序。历史预测与市场案例保留其原始语境，不视为独立统计验证。知识库提供分析框架和失效条件，不自动生成买卖信号，也不替代仓位、风险和账户管理。
