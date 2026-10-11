# Hermes 云端研究接入：迁移边界与发布验收

本阶段实现经筛选理论的 v2 私有快照、原始→审查副本审计链、服务端私有存储和有界检索，以及研究输出、绘图与持久候选记录。部署是独立网站服务，不是把本机 Hermes 终端搬到云端。网站第十一版原书仍为主要来源；本机旧书蒸馏、课程经验和整合笔记只作为补充，不升级为原书硬规则。

**代码通过测试、资料已导出、数据库已迁移、生产服务已部署、真实模型验收是不同状态。** 发布应保存提交 SHA、工作流成功回执、独立可信的资料摘要和线上健康检查。没有网站专用模型密钥时，允许上线代码和私有资料，但托管模型仍关闭，不宣称真实 AI 已接通或自主学习已验证。

模型服务商已由用户确定为 **DeepSeek，使用网站独立的服务端密钥**。本轮完成它的协议适配，不借用或复制本机 Hermes、微信或用户 BYOK 的密钥。

## 波浪绘图一并迁移

已把本机绘图的关键呈现规范接入网站 Workbench 和 Gateway：命名浪点与每段有符号价差、主计数和两个备选、候选/存疑的文字与线型、最大反向价格幅度的**垂直**双向度量与水平端点参照。不是复制带本机路径、字体和案例坐标的 Python 模板；改为共享、纯数据 TypeScript 合同与浏览器内 SVG/PNG 渲染，不接受模型脚本或任意 SVG。

- 可导入原 Hermes TV 导出格式 `{symbol, interval, bars:[[Unix秒,open,high,low,close],…]}`，也可导入标准 `wavekb-chart-input-v1` JSON。导入时整体限制 64 KiB、1–128 根正有限价格的 K 线，严格递增整数秒与一致 OHLC；不静默截取，也不自动生成示例行情。
- 只保存标准 OHLC，另用站内 `wavekb-chart-context-v1` 绑定分析的标的与周期。原文件名、额外 metadata、账号或来源字段不进入模型。**导入不是数据源真实性验证**，源文件品种/周期别名需用户核对；修改站内标的/周期后，旧数据保留在草稿但停用，要求明确重新导入，不能把 BTC 数据悄悄用于黄金分析。
- 当前分析只采用不晚于当前步骤的最新、有效、已绑定行情，并在 UI 提示沿用哪一步；最新数据无效不得退回更早数据。没有 K 线但已填写连续的波浪价位时，可生成**无时间的结构示意**，不是历史 K 线或自动抓取行情。
- 模型可选的 `chart_spec` 只能引用真实输入的 `bar_index + open/high/low/close`，标记固定浪名及 `candidate/uncertain`，不能提供自造价格、时间、测量、URL 或代码。同根 K 线不能推定先高后低，因此不接受重复 K 线锚点。无计数证据时只画输入价格，不自动用 ZigZag 冒充波浪结论。
- 每个计数只接受一个推动浪级别：`0..5` 或 `0+i..v`，数字/罗马浪名在各自级别内须唯一且递增；同一个计数不能混合正数字推动浪与罗马小级别。两种标签均进入同一已实现的推动浪规则校验，不通过切换浪名绕过。多级别嵌套叠图仍需另立明确级别合同，本版不冒充已支持。
- 服务端按**实际将被绘制的锚点**运行现有推动浪规则，包括额外调整标注和已观察到的部分结构；手填图与规则检查使用同一版本的价格。被淘汰的计数移除，原始价格仍可展示。规则通过只是未发现已实现规则的冲突，**不是全部 Elliott 规则或行情预测已验证**；第十一版仍为主，本机模板中的经验性比例不自动成为硬规则。
- 最大反向幅度、百分比和“上涨顶减幅度／下跌底加幅度”参考阈值由程序计算并二次校验。它们只描述已标注点，不承诺整个行情窗口的最大回撤，**不等于账户回撤、账户止损或交易执行规则**。没有观测到反向运动时不编造测量。
- 公开输出仅含 `wavekb-wave-chart-v1` 的数值图表，原始 `chart_spec` 不入公开任务结果；重复轮询保留同一已校验图表。图表中的标的/周期也经过私有来源词检查，额外字段、伪造测量或未知版本拒绝发布。保存复用原有 owner 分析 JSON 和经过写入校验的 `ai_jobs.output_payload`，没有新增共享存储权限或租户绕过。
- SVG/PNG 在浏览器本地生成，主计数/备选切换、手机布局、图表说明与可展开数据表可用。导出再执行元素/属性白名单，拒绝脚本、外部资源和事件。
- 导出成功提示只表示文件已生成，不冒充浏览器已保存；受浏览器下载限制时提供本地 Blob 保存链接和 PNG 预览。更换计数或图表后旧导出释放，不展示失效文件。

合成端到端测试覆盖输入→受限模型规格→规则淘汰→发布→轮询→前端绘图；浏览器预览数据明确标为合成。**绘图代码接入完成不等于已经进行真实 DeepSeek 分析。** 本版没有服务器行情抓取，也不迁移本机图片目录。截图输入另有下述受限接入，不把输出绘图等同于已经识图。绘图迁移不读取或修改本机 Hermes 的交易、微信或 Discord 状态。

## 截图输入与最新视觉模型

2026-10-11 核对官方文档：`deepseek-flash` 对应 **DeepSeek V4.1 Flash**，支持视觉；`deepseek-v4-pro` 当时不支持视觉。使用现有 Chat Completions `user.content` 中的 `text` 与 `image_url`，不因识图迁移 API 产品。型号能力以部署时官方文档为准，适配器只对已核对的精确模型名启用视觉，不能仅凭名字包含 DeepSeek 放行。

- Workbench 的 AI 分析步骤 2–7 可明确选择最多 3 张 JPEG、PNG 或静态 WebP，每张最多 2 MiB、每边最多 4096 像素；动画、SVG、外部图片 URL、文件 ID 与脚本拒绝。预览使用短期私有链接，不公开图片。
- 原图保存到私有 `wave-analysis-images` bucket；metadata 先绑定真实 owner、analysis、步骤、标的与周期后，才允许不可覆盖的 Storage 上传。RLS 同时约束表与对象，匿名、跨账号、覆盖和直接删除拒绝；即使存在旧的宽泛 Storage policy，也不能绕过该 bucket 的 restrictive policy。每个分析最多 72 次上传，每个步骤/标的/周期最多 12 次，移除选择不会擦除在途任务的证据。
- 草稿与 v3 请求只保存显式所选图片 UUID 及标的/周期，数据库不保存 base64 或远端下载 URL。新任务必须匹配已保存选择，worker 再次核对所有者、metadata、上下文和格式；旧 v2 任务绝不自动带上后来上传的图片。同一请求的丢回执重试复用既有任务，不因后续取消选择再扣额度。
- Gateway 只从固定 Supabase 私有对象地址下载，无外部跳转，下载和解码有大小/时间界限。外发副本移除已支持的 EXIF、文本和 XMP 元数据，原始 Storage 字节不改写；这不是画面匿名化，用户仍需避免上传账号或隐私信息。
- 图片是**不可信的视觉参考**：不接受图中指令，无法确认的价格/坐标标为不确定；没有经过验证的真实 K 线输入，不从截图猜测 OHLC 或生成价格锚点 `chart_spec`。理论规则、公开结果隐私与候选复核合同继续生效。
- 按官方视觉上界预留每张 1024 Token，并纳入上下文与格式修复预算；最终 usage 仍由模型供应商返回。模型不支持视觉、原图不可读或上下文失效会返回明确安全错误，不静默删图改为纯文本分析。

这条链路的合成与权限测试不冒充真实模型验收。网站独立 Key、模型及 `wave_analysis` 路由配置完成前，托管模型保持关闭；只有受控真实图片请求成功且额度/usage/隐私复核通过，才确认“线上识图可用”。官方依据：[模型与视觉能力](https://api-docs.deepseek.com/quick_start/pricing/)、[视觉协议](https://api-docs.deepseek.com/guides/vision/)。

## DeepSeek 接入与配置门槛

专用适配仅在 `openai_compatible` 且解析后的 hostname 精确为 `api.deepseek.com` 时生效；相似域名不进入此配置。使用 `max_tokens` 与 `response_format: { type: "json_object" }`，系统提示包含 JSON 合同与示例，服务器仍执行结果结构、引用、规则和发布校验，不把“返回了 JSON”当作分析正确的证明。

受限 JSON 请求显式 `thinking: { type: "disabled" }`，避免默认隐藏推理与最终 JSON 共用小输出预算而导致空答案或截断。普通文本请求不强改其思考模式。只使用最终 `message.content`，不会用隐藏推理补答案或向用户返回 `reasoning_content`；输出 Token 按供应商返回的总量记账，不重复累加推理 Token。此选择是有界任务的初始可靠性配置，不代表分析已通过真实质量评测；将来若启用深度推理，应明确总预算、超时及验收结果。

上下文检查使用**实际序列化、转义后的完整提示词 UTF-8 字节数**作保守 Token 上界，并预留供应商协议开销、JSON 指令和一次格式修复。按检索优先级保留能完整容纳的知识块，不截断原书规则或静默删除用户输入。仅用户输入已超预算或没有完整证据块可容纳时，以 `input_context_too_large` 结束，外部请求尚未发送；不会改成无限重试。供应商返回的实际 usage 仍是计费记录，预估上界不是收费数。

后续配置清单：

1. 先部署兼容适配。生产后端工作流新增 `private_research: preserve|enable|disable`，默认 preserve 不改现有环境；enable/disable 通过服务端工具只追加精确允许主机 `api.deepseek.com` 和私有资料开关。enable 在写入前校验已激活资料；原始环境以 0600 字节备份，失败与代码/服务配置一起回滚。**不修改 master key 或 `MEMBERSHIP_MANAGED_AI_ENABLED`。** 未确认允许名单前，不要求用户在生产后台盲目保存 Key。
2. 之后在现有 `/admin/ai` 加密密钥入口保存 **独立的网站服务端 Key**。提供商名称 `DeepSeek`，适配器 `OpenAI 兼容`，API 地址 `https://api.deepseek.com/v1`。不要把 Key 放进聊天、代码、Git、SQL、前端环境变量或截图。后台“测试并保存”目前校验的是地址与加密保存，**不是实际模型调用成功证明**。
3. 为该 provider 配置 `ai_models` 与 `wave_analysis` 的 `ai_task_routes`。现有后台表单还不能创建模型和路由，不能假设只保存 Key 就自动完成。视觉模型使用当前已核对的 `deepseek-flash`（DeepSeek V4.1 Flash），初始服务端上下文上限 32,768、最终输出上限 4,096、超时 60,000ms；这是应用预算，不是模型的官方最大能力。成本与月预算仍须按部署时官方价格配置，不把数据库默认零成本当成免费；当前 worker 的 `cost_confirmed=false` 也不构成真实账单或月费用硬限额已生效的证据。
4. 先保持 `MEMBERSHIP_MANAGED_AI_ENABLED=false`，完成鉴权、每日额度、单次格式修复、空内容／截断、429／超时、费用记账和不泄露引用的受控真实请求验收后再启用。不能借用户 Key 或替换提供商来绕过未配置状态。

此前生产只读检查：启用的 provider、model、`wave_analysis` route 及已配置 secret 数量均为 **0**；没有读取密钥值。此结果不代表本轮实时状态，部署时必须重新核对，不能据此宣称云端 DeepSeek 已接通。

协议依据：[DeepSeek JSON 输出](https://api-docs.deepseek.com/guides/json_mode/)、[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)、[模型与价格](https://api-docs.deepseek.com/quick_start/pricing/)。模型名和价格可能变化，部署时再次核对。

## 对外分析合同

公开输出采用 `wavekb-public-analysis-v1`，只允许分析摘要、结构候选、成立/失效条件、数值风险和经校验的公开书引用。内部来源、检索诊断、原始模型 JSON、连接快照和 worker/provider 元数据不通过网站 AI 任务接口返回。

- `source_visibility: private_research`：输出 `citations: []`、`knowledge_citations: []`，不显示任何来源书名、文件路径或本地引用。混合了私有补充资料的结果也必须使用此模式，不能因为同时有公开书就降回 `public_books`。
- `source_visibility: public_books`：仅重建固定公开书索引中的引用，不信任模型提供的书名、路径或链接。公开附录中的文件目录不作为摘录展示，保留其公开页面入口。
- 未知显式 schema/policy 拒绝发布；旧结果只有完全缺少新合同字段时才兼容公开书模式。投影重复执行必须幂等。
- `analysis_basis` 表达本次输入的结构判断或未验证候选。模型自报的“已验证学习”不构成验证证据；本轮不接受此类标记，也不伪造复核经验。
- 已知本地资料的标题/别名须通过 `privateSourceTerms` 传给输出校验。通用路径/文件名扫描不能证明任意未知书名或个人资料均已隐藏，真实资料接入前仍需受控筛选和完整泄露测试。

现有 membership enqueue/authorize RPC、owner 限制、每日额度和重试幂等逻辑保持不变。未配置或未启用的平台模型继续关闭；没有开放 Hermes shell、文件、订单、持仓、任意 SQL 或管理工具。

**数据库边界不能由前端隐藏替代。** 现有 `ai_jobs` 和 `knowledge_retrievals` 仍有 owner-readable 列与历史记录，本轮不回写历史数据。新私有来源、审计、检索与候选独立放在 `hermes_research_private`，不写进 owner-readable 检索记录、请求或连接快照。六表均启用并强制 RLS，anon/authenticated 无 schema USAGE、表权限或私有 RPC 执行权。公开 RPC 使用固定 search_path 的 INVOKER，服务端角色与 JWT role 都必须是 service_role；不由用户自报 owner。

`HERMES_PRIVATE_RESEARCH_ENABLED` 默认 false。true 时仅网站服务端授权的 managed 任务使用私有资料，并继续经过会员额度授权；BYOK 保留公开四书，不向用户配置的第三方模型发送私有理论。managed worker 必须从已激活快照取得可信摘要，完整复核 v2 结构、来源/块/转换记录和正文；缺失、损坏或无法审计则在模型调用前 `knowledge_unavailable`。明确单书模式保持该公开书范围；all 模式的第十一版主要依据与私有补充有界合并，不扩大为整个知识库或任意工具。

## 私有理论快照

生产私有格式为 `hermes-private-theory-v2`。旧 v1 导出仅用于兼容验证，不用于生产私有运行。资料存放独立服务端私有 schema，禁止放进 Git、前端静态目录、网站公开下载目录或浏览器可读取的打包产物。

固定九份理论 Markdown 白名单为：

1. `references/source-pages-001-070.md`
2. `references/source-pages-071-140.md`
3. `references/source-pages-141-210.md`
4. `references/source-pages-211-280.md`
5. `references/updated-rules-and-examples.md`
6. `references/practical-courses-01-17-distilled.md`
7. `references/chanlun-trading-system.md`
8. `references/cross-market-sync.md`
9. `references/wave-chanlun-integration.md`

不递归扫描其他文件，不导出本机记忆、用户资料、微信聊天、逐句原始转录、私人案例、账号绑定、交易插件、订单持仓、数据库、凭据或备份。图片也不在本阶段导出范围。

内部来源记录分别保存原始字节 SHA-256/大小/内容指纹版本与审查副本 SHA-256/大小/转换版本；每份保留转换计数和 receipt 摘要。内容指纹版本不冒充原书版次。原文件不改写，数据库再次独立重算 canonical 快照摘要、块摘要和连接后的副本摘要；部署选择采用期望 revision 比较，拒绝覆盖并发选择。模型投影仅返回无文件名的 opaque `id`、纯文本 `text` 与 `supplement` 级别，不返回版本、标题、路径、来源标签或完整内部快照。

**curated 副本的 SHA 不能冒充原始来源 SHA。** v2 将两者明确分开：`sources[].original`、`sources[].curated` 与 `receipt`。`--curate` 仅使用已批准的确定性转换：图片替换为未载入警告、独立来源/导航条目省略、可分离引用片段去识别、书名去引用。不得整行删掉附有引用的理论规则；不能安全分离的文件引用拒绝导出。凭据、聊天、身份、角色指令及本机绝对路径不能靠清理隐藏后混入资料。

**隐藏对用户/模型的本地引用不等于删除内部审计，也不等于已经训练或“自主学习完成”。** 后续上线应把原始来源 SHA/版本与 curated text SHA/版本、批准的转换规则及审查记录保存在服务端私有边界；前端与模型只接触经检查的受限投影。

## 检查与显式导出

默认命令仅返回条目数、字节数和摘要，不写文件，不输出理论正文、文件名或本机路径：

```sh
node scripts/export-hermes-theory.mjs
```

如检查经人工审核的独立理论副本，可以指定绝对、规范化、非符号链接路径：

```sh
node scripts/export-hermes-theory.mjs --source-root /approved-private-theory
```

只有显式 `--output` 才会写 JSON 文件。输出父目录必须事先存在，由当前用户所有、权限 `0700`，不在任何 Git 工作树或公开目录下；文件权限为 `0600`，已存在的目标不会覆盖。不要把以下示例当作已执行的部署：

```sh
node scripts/export-hermes-theory.mjs --curate --source-root /approved-private-theory --output /private-artifacts/snapshot.json
```

输入每份不超过 512 KiB、九份合计不超过 2 MiB；输出不超过 4 MiB、文本块不超过 1,024 条、每块不超过 2,000 个 Unicode 字符。输入必须为严格 UTF-8 的普通文件，拒绝符号链接、硬链接、路径逃逸与读取期间变化。当前导出器要求 macOS/Linux 的 `O_NOFOLLOW` 与用户所有权权限检查；缺少这些能力的平台会拒绝导出，不以软检查替代。

扫描发现秘密格式、钱包地址/邮箱、本机路径或 URI、私有聊天、隐藏控制字符或模型角色标记时，失败只输出错误代码，不输出匹配文本。严格 v1 模式也拒绝来源引用；显式 v2 curate 只处理上述确定性引用转换，转换后再次严格校验。不会改写本机原文或降低正文检测。

实际迁移前先运行 metadata-only 的 `--curate`，再显式导出到 Git 外的 0700 私有目录。只打印摘要与计数，理论正文不进入发布日志。重复构建必须得到同一可信摘要；导出完毕由云端 loader 再次复核。用户记录与私人案例不能混入九份理论白名单。

## 持久候选与复核

服务端完成 `wave_analysis` 且得到有效公开输出时，数据库 success trigger 在同一事务中记录 `learning_candidates`，按 job 幂等，owner/analysis 从真实任务派生。running、failed、insufficient_evidence 与浏览器历史更新不产生候选。候选永远初始 `candidate`，既不是正式理论，也不是已验证经验；重试不能改变既有候选。

复核 RPC 要求真实 active admin，支持 supported/rejected/inconclusive 的有依据审查事件，按 request 幂等且不可改写；supported 也不会升级候选、改书籍或切换快照。当前没有将候选自动训练成模型、自动回测或自动发布到知识库的能力。真实请求完成前，合成测试记录仅在自动清理测试数据库，不伪造线上经验。

## 发布次序与验收门槛

1. 跑导出、loader/runtime、私有仓库、实际 PostgreSQL 语义权限/事务/幂等测试及 Gateway/Web 总回归，验证原书目录和图片不被改写；合成测试与线上真实分析分开记录。
2. 合并精确提交；依次应用 CLI 创建的 `20261010223739_hermes_private_research.sql` 与 `20261011001354_wave_analysis_images.sql`，检查六表 RLS、图片 owner/context/不可覆盖权限、私有 bucket、RPC marker 与安全 advisors。旧网关可兼容新附加 schema，数据库不做破坏性降级。
3. 私有导出在 Git 外；用受信来源摘要注册，云端独立校验后显式 activate。只保留审查理论与原始哈希/版本等审计，不复制原始全文、图片、微信、交易或模型密钥。
4. 后端同 SHA 发布，并明确选择 private_research=enable；工具验证 active artifact 后写两个允许的配置键，服务失败会恢复原配置和前一版本。后端验收成功后才能发布同 SHA Next。
5. 核对线上 `/api/health`、Gateway SHA、工作台资源和未登录/越权请求拒绝；匿名不能调用任何私有 RPC，私有 artifact 不在静态产物中。此时可以确认代码和私有资料部署，不能凭空确认模型可用。
6. 网站独立 DeepSeek Key 安全保存后，配置模型/路由与限流预算，受控真实请求检查每日额度、成功/失败、Token、绘图、持久候选与引用隐藏，再单独启用托管模型。Key 缺失则保持关闭并明确交付这一个门槛。

本次不迁移微信账号状态、聊天记录或交易工具。学习候选和审查事件已支持持久保存；自动训练、真实市场长期评测、经批准的学习发布机制仍不在本版能力中。用户输入不得直接改写共享理论或模型系统指令。

本阶段回归命令：

```sh
node --test tests/hermes-theory-artifact.test.mjs
node --test tests/hermes-private-research-postgres.test.mjs
node --test tests/wave-analysis-images-postgres.test.mjs
pnpm --dir ai-gateway test
pnpm --dir ai-gateway typecheck
pnpm --dir apps/web test
pnpm --dir apps/web typecheck
pnpm --dir apps/web build
```

测试仅使用自动清理的合成临时目录，不读取真实 Hermes 私有资料，不上传，不调用模型或微信，不涉及交易状态。
