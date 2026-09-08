# WaveKB 多书阅读与 AI 检索设计

**日期：** 2026-09-09

**状态：** 待书面确认
**目标：** 让三本书拥有一致且诚实的网页阅读体验，并让交易工作台 AI 默认检索全部三本、可严格限定单本、返回可验证引用。

## 1. 背景与现状

WaveKB 当前有三本书：

1. `elliott-wave-principle-tenth-edition`：第 10 版核心书。真源是 117 个 canonical Units；站点还生成章节、主题、问题路线等聚合页，因此目前共有 146 个 core 阅读视图。
2. `elliott-wave-natural-law`：《艾略特波浪理论：自然法则》。当前只有 36 页 WaveKB 蒸馏 PDF 的网页文字、阅读指南、四个主题标签和使用边界。
3. `chan-theory-complete`：缠中说禅文集。当前只有 25 页 WaveKB 蒸馏 PDF 的网页文字、阅读指南、四个主题标签和使用边界。

核心书拥有已核验章节、主题、问答、术语、失效条件和逐 Unit 来源；另外两本没有这些结构。统一界面不能把自动识别的标题冒充已核验章节，也不能把蒸馏 PDF 页码冒充上游原书页码。

当前交易工作台会创建 `ai_jobs`，worker 随后直接调用用户配置的模型。仓库虽已有词法检索、非可信知识隔离、输出校验和硬规则闸门模块，但生产 worker 尚未调用它们，`knowledge_retrievals` 也未写入。因此本功能必须接通真实后端检索链路，不能只增加前端选择框。

## 2. 方案选择

### 采用：构建期统一索引 + 服务器端确定性检索

构建脚本从核心 Units 和两本扩展书的 page JSON 生成一个版本化、可复现的检索产物。Gateway 在入队和执行时验证知识范围，worker 先过滤书籍、再排序、再构造受限上下文，并在调用模型前写入检索审计。

优点：

- 不引入向量数据库、外部 embedding 服务或新的持续费用。
- 可离线测试，结果稳定，容易证明单本检索不会跨书泄漏。
- 复用现有 `knowledge_retrievals`、`ai_jobs.input_payload` 和 `knowledge_version`，无需数据库迁移。
- chunk 与请求接口为未来混合检索保留稳定 ID 和版本字段。

### 不采用：直接让模型读取整本书

三本书全文会快速挤占上下文，费用和延迟不可控，且无法可靠证明引用来自哪一页。

### 暂不采用：embedding + pgvector

语义召回更好，但会增加 embedding 生成、向量版本、数据库容量、重建和线上回滚复杂度。词法检索上线并积累无命中评测后，再决定是否作为第二阶段加入；不得改变本次请求与引用契约。

## 3. 用户体验

### 3.1 图书入口

`/knowledge/books` 固定直接展示三本书，不再把扩展书藏在二级“扩展书架”入口中。每张卡显示：封面、书名、资料层级、可用结构、网页正文数量和进入阅读按钮。

核心书计数改为“117 个已核验知识单元”，另行说明站点提供 146 个阅读视图，避免把聚合页算成知识原子。

### 3.2 统一书籍详情壳

三本详情页使用同一信息架构：

1. 封面、书名、资料层级、简介和“开始阅读”。
2. 本书搜索；保留“搜索全部知识库”入口。
3. “阅读方式”导航。
4. 目录或顺序导航。
5. 网页正文。
6. 来源、生成方式和使用边界。
7. 存在可公开文件时显示 PDF 按钮。

核心书继续显示已核验的规则/指南、问题路线、章节、术语和八大主题。扩展书显示真实已有能力：阅读导览、主题标签、生成页码导航、网页正文和使用边界。自动识别的标题必须标注“生成导航”，不能标注“已核验章节”。

扩展书按钮从“查看原 PDF”改为“查看 WaveKB 蒸馏 PDF”。核心书在没有已确认可分发文件前不显示“原 PDF”。

### 3.3 搜索

- 书内搜索严格限定当前书，结果带书名、标题/生成页、片段和页锚点。
- 全库搜索加入两本扩展书的网页正文，不再只搜索书目元数据。
- 搜索结果不把扩展资料标为核心硬规则；资料层级始终可见。

### 3.4 AI 知识范围

交易工作台 AI 区增加一个单选控件：

- `全部三本（默认）`
- `艾略特波浪理论·第 10 版`
- `艾略特波浪理论：自然法则`
- `缠中说禅文集`

不提供任意两本组合。选择“单本”时，服务器必须在排序前严格过滤到该书；无命中时返回“该书证据不足”，不得自动扩大到其他书。

AI 结果除原有分析 JSON 外显示“本次知识依据”：书名、条目/生成页标题、蒸馏 PDF 页或已核验来源页、短片段和站内链接。所有展示元数据由服务器根据已检索 chunk 展开，不能信任模型自行生成的书名或页码。

第 10 版硬规则闸门始终独立运行，用于阻止明显违反硬规则的交易候选；当用户单选扩展书时，第 10 版正文不进入检索上下文，也不伪装成该书引用。

## 4. 统一知识模型

构建产物使用以下逻辑模型：

```ts
type BookRole = "core" | "supplement" | "extension";
type ContentStatus = "verified" | "generated" | "needs_review";

type BookManifest = {
  bookId: string;
  title: string;
  role: BookRole;
  description: string;
  coverAsset: string;
  topics: string[];
  readingGuides: Array<{ title: string; description: string }>;
  boundaries: string[];
  rightsStatus: "verified" | "unknown" | "restricted";
  sourceArtifacts: SourceArtifact[];
};

type SourceArtifact = {
  sourceId: string;
  kind: "canonical_units" | "distilled_pdf" | "generated_web";
  sha256: string;
  pageCount: number | null;
  authority: "primary" | "supplement" | "contextual";
  derivation: "verified" | "extracted" | "distilled" | "generated";
  redistributionAllowed: boolean | null;
};

type BookChunk = {
  chunkId: string;
  bookId: string;
  sourceId: string;
  sequence: number;
  title: string;
  headingPath: string[];
  text: string;
  kind: "unit" | "page";
  authority: "primary" | "supplement" | "contextual";
  contentStatus: ContentStatus;
  pdfPages: number[];
  href: string;
  topics: string[];
  searchable: string;
  contentSha256: string;
};

type RetrievalArtifact = {
  schemaVersion: "wavekb-ai-knowledge-v1";
  knowledgeVersion: string;
  books: BookManifest[];
  chunks: BookChunk[];
};
```

### 稳定 ID

- 三个现有 book slug 永久保留。
- 核心 Unit 保留现有知识 ID，统一 chunk ID 为 `<book-id>::unit::<existing-unit-id>`。
- 扩展页默认 ID 为 `<book-id>::page::p0001`；若一页必须分段，则依次使用 `p0001-c01`。
- 标题或文字校订不改变 ID；内容变化只改变 `contentSha256` 和顶层 `knowledgeVersion`。
- PDF 页体系变化时创建新 source revision，不静默重编号旧引用。

扩展书的 `pdfPages` 只表示 WaveKB 蒸馏 PDF 页。没有可靠上游定位时，不生成上游页码、文章 ID、作者日期或权威等级。

## 5. 构建与校验

`scripts/build-knowledge.mjs` 扩展为同时生成 Web 知识数据和 `ai-gateway/knowledge/retrieval-index.json`。生成物提交到仓库，使 backend 发布包可独立运行；测试重新构建到内存/临时目录并逐字节比较，防止源数据与生成物漂移。

构建规则：

- 核心 Units 一 Unit 一 chunk，不改变已核验语义边界。
- 扩展书先按现有蒸馏 PDF 页生成 page chunk。只有超过上下文上限的页才按段落确定性切分。
- 中文搜索文本执行 NFKC、大小写和空白规范化，并生成汉字双字词；英文/数字保留 token。
- 生成物不含机器本地绝对路径、密钥、原始扫描文件或未经授权的隐藏资产。
- 校验必须确保 book/chunk/source ID 唯一、页码有效、href 为站内安全路径、SHA 格式正确、三本书均有非空可检索内容。

## 6. AI 请求契约

新客户端发送版本 2 请求：

```json
{
  "request_version": 2,
  "client_request_id": "uuid",
  "task_type": "wave_analysis",
  "step": 4,
  "analysis_schema_version": "workbench-v1",
  "knowledge_scope": { "mode": "all" }
}
```

单本请求：

```json
{
  "request_version": 2,
  "client_request_id": "uuid",
  "task_type": "wave_analysis",
  "step": 4,
  "analysis_schema_version": "workbench-v1",
  "knowledge_scope": {
    "mode": "single",
    "book_id": "elliott-wave-natural-law"
  }
}
```

Gateway 规则：

- 版本 2 只接受 `wave_analysis`、合法步骤、`workbench-v1`、合法 UUID 和上述两种 scope。
- `all` 不能附带 book ID；`single` 必须且只能附带一个已发布 book ID。
- 拒绝数组、多书伪装、未知 mode、未知书、超长字段和额外嵌套对象。
- 缺少 `request_version` 的旧客户端按 legacy 请求兼容并规范化为 `all`，保证 backend 可先于 Web 发布。
- 入队保存服务器规范化后的 payload，并把 artifact 的 `knowledgeVersion` 写入现有 job 字段。
- `client_request_id` 参与现有唯一 `idempotency_key`，同一次传输重试不能创建重复 job；新的人工点击生成新的 UUID，允许重新分析。
- Worker 领取旧 job 或重试 job 时再次验证 scope 和知识版本。

## 7. 检索算法

查询只能由服务器根据 task、步骤、品种、周期、候选结构和用户笔记生成。用户文字可贡献检索词，但不能设置权重、路径或 book ID。

流程固定为：

1. 解析并验证 scope。
2. 在索引中先过滤 book ID。
3. 对每本候选书独立评分。
4. `all` 模式每本最多取 4 个相关 chunk，再全局稳定合并，总数最多 12；没有词项命中的书不强塞无关内容。
5. `single` 模式只从该书取最多 8 个相关 chunk。
6. 总知识正文默认不超过 12,000 字符，并根据用户模型 `context_tokens` 下调，永远给系统规则、用户输入和输出保留空间。

评分使用可解释规则：标题/heading 精确命中高于 topics，topics 高于正文；同书内核心 `rule > guide > method > case > term`，`primary > supplement > contextual`。authority 权重不能突破 scope，也不能让核心书在 `all` 模式吞掉另外两本的全部名额。

无命中时不调用模型，job 以成功的结构化“证据不足”结果结束，引用为空；这不是 provider 故障，也不触发重试。

## 8. Worker、Prompt 与输出

Worker 启动时加载并校验一次检索产物。每个 job 的处理顺序为：

1. 重读 active 用户、分析和 BYOK 连接。
2. 验证版本化请求与 knowledge scope。
3. 构造服务器查询并检索。
4. 在 provider 调用前写入 `knowledge_retrievals`；写入失败则停止任务，不能产生无审计 AI 调用。
5. 使用现有 `renderPromptBundle`，把系统规则、`UNTRUSTED_KNOWLEDGE` 和 `USER_INPUT` 分区。
6. 调用用户指定 provider，不擅自切换到其他连接。
7. 用现有 schema 校验模型 JSON，引用只能是本次检索 chunk ID。
8. 执行确定性风险覆盖和第 10 版硬规则闸门。
9. 服务器根据允许的 chunk ID 展开引用元数据，再写入 job output、attempt 和 usage。

知识正文和用户笔记均被视为不可执行数据。它们不能修改角色、系统规则、工具调用、输出 schema 或知识范围。

成功输出增加：

```ts
type KnowledgeCitation = {
  knowledge_id: string;
  book_id: string;
  book_title: string;
  title: string;
  source_id: string;
  pages: number[];
  href: string;
  snippet: string;
};

type KnowledgeRunMetadata = {
  scope: { mode: "all" } | { mode: "single"; book_id: string };
  knowledge_version: string;
  citations: KnowledgeCitation[];
};
```

模型只返回 citation ID；书名、页码、链接和 snippet 全由服务器补齐。模型引用未检索 ID、伪造页码或返回非法 JSON时，job 不得标为成功。

## 9. 审计、错误和兼容

复用现有表，不新增迁移：

- `ai_jobs.input_payload` 保存规范化请求与 scope。
- `ai_jobs.knowledge_version` 保存检索 artifact 版本。
- `knowledge_retrievals` 保存服务器 query、task、实际 chunk IDs、source IDs、预算和上下文哈希；book scope 保存在同一 job 的规范化 `input_payload` 中，可由 chunk ID 稳定反查 book ID。
- `ai_job_attempts`、`ai_usage_ledger` 保存调用状态和 token 使用。

失败行为：

- 索引缺失、损坏或 job 指定版本不可用：`knowledge_unavailable`，不调用模型。
- 单书/全库无命中：结构化“证据不足”，不跨范围，不重试 provider。
- Provider 401/403：立即失败并提示更新连接。
- Provider timeout/429/5xx：沿用有界重试，不切换用户连接。
- 非法 JSON、非法引用或规则校验失败：不返回原始输出；允许一次仅修复格式的尝试，仍失败则 `invalid_model_output`。
- AI 失败不删除或覆盖用户已保存的分析草稿。

旧 job 没有新 metadata 时继续用原始 JSON 展示；新 UI 仅在 `citations` 存在时渲染引用列表。

## 10. 安全与内容边界

- 保持 Next AI proxy 的认证、同源 POST、路径 allowlist 和 64 KiB body 上限。
- Book ID、scope、step 和 schema 由 Gateway 重验，不能只信任浏览器。
- 检索产物只包含站内已公开的蒸馏文字和已核验 Units，不加入本地原 PDF 路径或未公开原扫描。
- `rights_status=unknown` 的扩展资料默认只引用当前已公开的蒸馏工件，不声称具有上游原作再分发权。
- 第 10 版 primary、补充资料 supplement、扩展资料 contextual 的权威层级不能因统一 UI/索引而合并。
- AI 输出明确标注为研究候选，不构成投资建议；确定性风险字段不得由模型覆盖。

## 11. 测试与验收

### 构建和知识包

- 三本 manifest、chunk、source ID 唯一且稳定。
- 核心 117 Units 保留；扩展 36/25 页均可检索。
- 生成物与真源一致，内容哈希和 knowledge version 可复现。
- 扩展引用只标注蒸馏 PDF 页，不出现伪造上游定位。

### Web

- 三本书直接可见并使用统一详情结构。
- 核心与扩展能力标签真实，PDF 文案为“蒸馏 PDF”。
- 书内搜索不跨书，全库搜索能命中扩展正文。
- AI 默认 `all`，三种单本值正确，payload 符合版本 2。
- 新结果展示服务器引用；旧 job 保持兼容。

### Gateway/Worker

- scope 的所有非法组合均被拒绝；legacy 请求规范化为 all。
- 单本检索零跨书泄漏；all 模式有稳定的每书上限和总预算。
- 中文规范化、双字词、排序、去重和无命中行为可重复。
- Prompt injection 文本不能逃出非可信区块。
- 模型伪造 citation 被拒绝；服务器展开页码与链接。
- 检索审计在 provider 前写入；写入失败不调用 provider。
- hard-rule gate 和确定性风险覆盖真实接入 worker。
- 发布包脱离源码 checkout 后仍能加载三书索引。

### 全量门禁

- Ubuntu CI：`pnpm test`、`pnpm typecheck`、lint、Web build、Gateway typecheck/test、相关浏览器旅程全部通过。
- Windows 当前 27 个 Unix 部署夹具失败单独记录，不得掩盖 workspace 测试；生产发布以同一 SHA 的 Ubuntu 门禁为准。
- 上线后用真实 HTTPS 验证三本书详情、all/single AI、引用、job 审计、gateway health 和部署 SHA。

## 12. 发布设计

此次会修改 Gateway 和 Web，发布顺序必须是 backend 先、Next 后：

1. 修复 `deploy-backend-production.yml` 的数据库 marker：仓库当前最新迁移为 `202609090001`，工作流不得继续只接受 `202609080003`。
2. Backend archive 显式包含版本化 `ai-gateway/knowledge/retrieval-index.json`，并用脱离源码 checkout 的测试验证。
3. 在功能分支运行完整测试并做独立审查。
4. 推送功能分支并让 Ubuntu 的 `Verify WaveKB release` 对精确 SHA 全绿。
5. 合并到 `main`。自动 Next workflow 遇到 Gateway 变更且未授权时应在远程写入前 fail closed，这是预期保护。
6. 手动运行 `deploy-backend-production.yml`，输入仓库要求的生产确认值；验证 gateway health、worker 领取任务、`all` 与 `single` 检索和审计记录。
7. Backend 验收成功后，手动运行同一 main SHA 的 `deploy-next-production.yml`，设置 `gateway_release_approved=true`，并按实际变更选择只读/发帖验收输入。
8. 等待自动验收完成，核对 `wavekb.com` health SHA、三本书页面、AI scope 和引用。

任何阶段失败均停止后续发布。Gateway 激活失败使用现有 previous symlink/unit 恢复；Next 使用不可变 release 与 current symlink 自动回滚。此次不新增数据库迁移，因此代码回滚不会遇到 schema 降级问题。

## 13. 非目标

- 本次不实现 embedding、pgvector、语义 reranker 或外部检索服务。
- 本次不人工编造两本扩展书的主题关系、问答路线、术语定义或权威章节。
- 本次不恢复 CHM 缺失图片，也不声称公开 PDF 是出版社原版。
- 本次不让 AI 自动交易、调用交易所写权限或替用户做投资决定。
- 本次不开放任意多书组合；仅支持全部三本或严格单本。

## 14. 主要实现边界

预计修改范围：

- 知识真源/构建：`knowledge/source/*`、`scripts/build-knowledge.mjs`、`scripts/validate-knowledge.mjs`、`packages/knowledge/src/*`。
- 图书 UI：`apps/web/src/lib/knowledge/book-catalog.ts`、`apps/web/src/app/knowledge/books/*`、`apps/web/src/app/knowledge/page.tsx`、`apps/web/src/components/book-search.tsx`。
- AI UI：`apps/web/src/components/workbench-analysis-editor.tsx` 及其测试。
- Gateway：`ai-gateway/src/knowledge/*`、`routes/gateway-api.ts`、`worker-main.ts`、`prompts/render.ts`、pipeline/schema 及测试。
- 发布：`deploy-backend-production.yml`、Gateway archive/脱离 checkout 测试、AI operations 文档。

实施必须按 TDD 拆分为可独立审查的任务；每个任务先出现能证明缺口的 RED，再提交最小 GREEN。最终发布必须基于已验证、已推送且与生产 health 一致的精确 commit SHA。
