# 波浪理论知识库

本目录以《艾略特波浪理论：市场行为的关键（原书第10版）》作为规则、指南与核心知识的主权威来源，以第11版图示、词汇和历史补充为辅助来源，并保存《波浪理论学习框架未完善 _WPS版.docx》的逐项核验结果。知识库用于在遇到判浪问题时，按“规则排除—指南排序—证据确认—失效管理”的顺序提供分析思路，不把指南、历史案例或作者观点冒充硬规则。

## 当前规模

- 第10版覆盖：PDF 280/280页已建立唯一覆盖台账；117页同时具有明确 Unit source ref 与人工复核语义分段，159页由人工复核语义分段映射，4页确认为不产生独立 Unit 的分隔或归档页。全部280页为 `OK`。原PDF页数与SHA-256均已重新核验。
- 原书知识：117条可追溯原子单元，其中核心规则、指南与定义已迁移到第10版主来源，第11版内容只保留为明确标注的补充。
- 知识关系：174条跨单元关系。
- 问题入口：18条常见问题路线，以及一套统一分析手册。
- 可点击页面：本地浏览器当前构建161页，并把第10版来源页与第11版图示补充分别折叠展示。
- 扩展书架：另收录《艾略特波浪理论：自然法则》与《缠中说禅》CHM 的两本完整蒸馏 PDF。它们保留独立来源、覆盖范围和证据边界，不会改写第10版核心规则的权威层级。
- 视觉核验：第10版全部280个PDF页已按连续页序渲染检查，章节边界与逐页蒸馏一致；旧报告中第217页扫描条带和281至320页引用属于版本页码混用，现已纠正。

## 主要入口

- `knowledge/units/all.jsonl`：唯一核心知识正文；Pages、Chapters 与三种入口均引用这里的 Units。
- `knowledge/pages/`：只保留页面视图配置；核心页面正文由 `scripts/build-knowledge.mjs` 从 Units 生成。
- `packages/knowledge/src/knowledge.json`：面向应用的构建产物，不是真源。
- `knowledge/browser/elliott-wave-knowledge-tree.html`：旧展示产物，不是真源。
- `knowledge/structure/tree.md`：纯文本全书分支树。
- `knowledge/questions/reasoning-playbook.md`：遇到问题时使用的分析步骤。
- `knowledge/questions/index.jsonl`：18条问题到规则、指南和方法的机器可读路由。
- `knowledge/coverage/tenth-edition-pages.jsonl`：第10版280页逐页覆盖账本。
- `knowledge/images/registry.json`：第10版 Primary 与第11版 Supplement 分离的图像语义注册表。
- `knowledge/source/library.json`：扩展书架的书目、静态文件哈希、覆盖范围与阅读边界；不是核心 Unit 来源。
- `knowledge/source/supplements.json`：第11版补充来源清单。
- `knowledge/reports/quality-report.md`：最终质量与边界报告。
- `knowledge/reports/framework-verification.md`：未完善学习框架的核验结论。

## 知识结构

全书按用途组织为八个主题分支：强制规则与失效边界、基础结构与浪级、驱动浪、调整浪、分析方法与比例时间、波浪个性与确认、市场适用与历史案例、术语来源与理论边界。每条知识只归入一个主分支，关系文件再建立跨分支引用，避免同一内容重复维护。

## 使用边界

规则用于否定不可能的数浪；指南、比例、通道、个性和成交量用于给仍然有效的候选排序。历史预测与市场案例保留其原始语境，不视为独立统计验证。知识库提供分析框架和失效条件，不自动生成买卖信号，也不替代仓位、风险和账户管理。
