# WaveKB 成交级交互复盘图与公共策略分享设计

日期：2026-11-26  
状态：已由用户批准<br>
范围：`/workbench/trades/[id]`、社区帖子详情、交易同步网关、Supabase 数据模型

## 1. 意图

把现有“单笔交易详情 + 文字复盘”升级为成交级交互图表：用户绑定 Binance、OKX、Bybit、Bitget 或 Exness 的只读 API 后，每一个真实成交都自动显示在 K 线上，包括首次开仓、加仓、减仓、部分平仓、完全平仓和反手拆分产生的成交。用户可以在任意成交标记上写备忘录、添加标签和图片，并在明确确认隐私选项后，把当前复盘发布为全站可查看、可在成交点评论的公共策略图。

本功能的价值不是再做一个交易终端，而是把“发生了什么、当时为什么、之后如何改进”绑定到可核验的成交证据上。

## 2. 已确认的产品决定

- 图表引擎选用独立的 `openalgo-charts` 库，不引入完整 OpenAlgo 平台、订单路由、返佣、订阅或运营后台。
- 展示每一次成交，不把多次加减仓压缩为一条均价线。
- 图表缩小时允许视觉聚合，但底层成交、数量和时间不得丢失；展开聚合点必须能看到其中每一笔成交。
- 每个成交标记可写备忘录、标签和图片。
- 首版提供可搜索的技术指标面板，以及经过允许清单限制的斐波那契、艾略特波浪、趋势线、水平线、矩形、文字和风险收益绘图工具。
- 私人指标配置和画线可保存；发布时由用户选择哪些指标和画线复制到公共策略快照。
- 公共策略图采用独立、不可变快照；私人复盘后续变化不会静默改写已发布内容。
- 每个公共快照只固定一个时间范围和一个 K 线周期；读者可以缩放，但不能切换到快照外的周期或继续加载快照外行情。
- 发布时分别询问“显示仓位数量”和“显示绝对盈亏金额”，两个选项默认关闭。
- 公开图固定显示“价格收益率”，它不含手续费、资金费和账户杠杆，并与账户 ROI 明确区分；账户名称、账户 ID、连接 ID、余额、权益、API 标识、API 密钥和原始上游响应永不公开。
- 公共读者可以在具体成交标记上评论；评论继续使用站内现有的身份、回复、举报、屏蔽和后台审核规则。

## 3. 目标

1. 五个平台的统一成交模型都能生成一致的成交标记。
2. 每个成交标记精确对应一条规范化 `trading_fills` 记录，并能在周期重建后保持稳定关联。
3. 用户可以在桌面端、移动端和 iOS PWA 完成查看、缩放、标注、发布和评论。
4. 行情来源、时间范围、缺口和更新时间清晰可见，不伪造、不插值、不用当前价格改写历史。
5. 公共分享只包含用户在预览页看到并确认的数据，服务端再次执行脱敏，不能只依赖客户端开关。
6. 已发布策略图在未来行情、交易同步或私有复盘发生变化后仍可稳定重现。

## 4. 非目标

- 不下单、不改单、不撤单、不平仓、不复制交易，也不提供自动策略执行。
- 不接入 OpenAlgo 完整后端和交易适配器。
- 不公开实时持仓；首版只分享用户主动选择的历史复盘快照。
- 不提供可执行脚本、任意第三方插件或用户注入代码。
- 不做自动艾略特波浪识别或“最佳浪型”推荐；首版艾略特能力是用户在真实 K 线上手动锚定的五类标准计数工具。
- 不把自动生成内容描述成投资建议，也不承诺收益。
- 不把某个平台缺失的行情替换为其他平台的近似行情而不告知用户。
- 不在首版实现多人协同编辑私人复盘。

## 5. 方案选择

### 5.1 已选：OpenAlgo Charts 作为纯前端图表引擎

WaveKB 安装并锁定经过审核的 `openalgo-charts` 精确版本，只导入基础图表和必要的绘图/标记能力。React 客户端组件在挂载时创建图表、尺寸变化时调整画布、卸载时调用 `destroy()`。Next.js 服务端不执行浏览器图表代码。

WaveKB 自己负责：

- 行情获取、缓存、缺口检测和来源说明；
- 成交周期与每笔成交的归属；
- 私人标注、图片、权限和 RLS；
- 公共快照、隐私脱敏和社区互动；
- 移动端抽屉、无障碍成交列表和降级状态。

OpenAlgo Charts 只负责绘制蜡烛图、缩放、十字光标、指标、标记、基础绘图和导出画面，不获得交易所凭据，也不直接请求交易所。WaveKB 不直接持久化不透明的第三方内部状态，而是把指标和画线投影为受版本控制、受允许清单校验的自有 DTO。

### 5.2 未选方案

- 在现有 TradingView iframe 上叠加标记：iframe 无法可靠注入 WaveKB 自有成交标记和点位评论。
- 自研 Canvas/SVG 图表：控制力高，但首版需要重复实现缩放、坐标、触控、性能和无障碍，风险与工期明显更高。
- 完整 OpenAlgo 平台：包含本项目不需要的交易和经纪商能力，许可证、部署和安全边界也更复杂。

## 6. 总体架构

```text
交易所只读 API
  ├─ 成交/费用/持仓历史 ─> 现有同步适配器 ─> trading_fills / trade_cycles
  └─ 历史 K 线 ─────────> 新增行情适配器 ─> 短期缓存与覆盖元数据
                                              │
                                              v
私人复盘 API ─> K 线 + 成交映射 + 私人标注 ─> OpenAlgo Charts
                                              │
                                 用户预览并确认隐私开关
                                              │
                                              v
                         服务端脱敏事务 ─> 不可变公共快照 ─> 社区帖子
                                                                  │
                                                                  v
                                                       成交点评论/回复/举报
```

所有交易所网络请求只从服务端发出。浏览器只访问 WaveKB API。

## 7. 数据模型

### 7.1 明确交易周期与成交的归属

现有周期修订的 `facts.fill_ids` 已保留原生成交 ID，但查询和外键关联不够直接。新增规范化关系表：

`trading_trade_cycle_fills`

- `cycle_id uuid`
- `cycle_revision integer`
- `owner_id uuid`
- `fill_id bigint`，外键到 `trading_fills.id`
- `native_fill_id text`，用于审计和同步重建比对
- `allocation_quantity numeric(38,18)`，处理一笔反手成交被拆分到两个周期的情况
- `allocation_role text`：`open | add | reduce | close | reverse_open`
- `sort_order integer`
- 主键：`(cycle_id, cycle_revision, fill_id, allocation_role)`

该表由现有原子发布 RPC 与周期修订同时写入。不能仅按“品种 + 开平时间范围”临时猜测成交归属。

### 7.2 私人成交标注

`trading_fill_annotations`

- `id uuid`
- `owner_id uuid`
- `cycle_id uuid`
- `fill_id bigint`
- `cycle_revision integer`
- `body text`，首版上限 5000 字
- `tags text[]`，数量和单项长度受限
- `created_at / updated_at / deleted_at`
- 唯一约束：每位所有者对一个周期中的一个成交保留一个主标注；编辑更新同一记录

`trading_fill_annotation_images`

- `id uuid`
- `annotation_id uuid`
- `owner_id uuid`
- `storage_path text`
- `sort_order integer`
- `created_at timestamptz`

图片使用私有存储桶、受限 MIME/体积/张数和所有者绑定。删除采用先软删除元数据、再异步清理对象的现有安全模式。

周期 revision 改变时，以 `fill_id`/`native_fill_id` 重新挂载仍存在的标注；无法唯一映射的标注进入“需要确认”状态，不静默移动到另一笔成交。

### 7.3 私人图表状态

`trading_chart_states`

- `cycle_id uuid`
- `owner_id uuid`
- `cycle_revision integer`
- `schema_version text`，首版为 `wavekb-trade-chart-v1`
- `timeframe text`
- `price_type text`
- `indicators jsonb`：仅保存指标 ID、窗格位置、顺序和经过 schema 校验的参数
- `drawings jsonb`：仅保存工具 ID、`{ time, price }` 锚点、样式、可选受限文本和稳定 drawing key
- `version integer`，用于乐观并发控制
- `created_at / updated_at`
- 主键：`(cycle_id, owner_id)`

每个交易周期首版只有一个私人图表工作区。切换 `timeframe` 或 `price_type` 会更新该工作区的偏好，但画线继续按绝对 `{ time, price }` 锚点存在，指标在新 K 线上重新计算，不创建互相分叉的多套布局。

不在该表保存 K 线、交易所响应、账户字段或 OpenAlgo 的任意原始序列化对象。每次读取和写入都根据锁定版本的指标/工具注册表执行允许清单、数量、锚点、参数类型和文本长度校验。

首版绘图允许清单：

- 基础：趋势线、射线、水平线、垂直线、矩形、文字、风险收益测量；
- 斐波那契：回撤、扩展/投射、时间投射、扇形及官方注册表中通过兼容测试的弧/圆类工具；
- 艾略特：`elliott-impulse`、`elliott-correction`、`elliott-triangle`、`elliott-double-combo`、`elliott-triple-combo`。

绘图 DTO 保存稳定 tool ID、锚点、层级、可见/锁定状态和受限样式。斐波那契额外允许保存有界的比例/水平、标签、颜色、显示和延伸设置；艾略特额外保存官方 degree 与工具支持的标签设置。磁吸到成交点时私人 DTO 可保存受所有权保护的 fill 绑定，公开快照只保留最终时间/价格锚点。不得保存可执行回调、任意 CSS、HTML 或未注册字段。

指标面板可以搜索 OpenAlgo 当前版本的完整内置目录，但只显示能由当前数据可靠计算的条目：

- 默认常用：SMA、EMA、WMA、HMA、VWAP、Bollinger Bands、RSI、MACD、Stochastic、ADX/DMI、ATR、Supertrend、Ichimoku、Donchian、Keltner、Chandelier Exit、ZigZag、Williams Fractals、Pivot Points/CPR、OBV、MFI、CMF；
- 其他仅依赖可靠 OHLCV 的内置指标按需动态加载；
- 需要开放兴趣、逐笔 bid/ask、订单流或外部数据但当前连接未提供时，隐藏或标为“数据不足”，不得用零值或蜡烛成交量伪造；
- Exness 的 volume 明确标为 tick volume，不能描述为交易所真实成交量。

指标和画线变更采用短防抖自动保存，并显示“保存中 / 已保存 / 保存失败”。周期 revision 改变时，时间/价格锚点仍保留；引用已不存在成交的磁吸关系进入“需要确认”，不静默移动。

### 7.4 行情缓存

`trading_candle_cache_segments`

- `provider`、`product`、`native_symbol`、`timeframe`
- `scope_kind`：`public_market | private_account`
- `scope_hash`：服务端使用版本化 HMAC 对 `owner_id + connection_id + native account scope` 计算；公开市场缓存使用固定公共作用域
- `price_type`：交易所统一为 `trade/mark` 中明确选择的一种；Exness 为 `bid | ask | both`
- `range_start / range_end`
- `source_host_kind`，只保存非敏感来源类型，不保存账户或 access point
- `candles jsonb` 或压缩对象存储引用
- `received_count`、`coverage_status`、`fetched_at`、`expires_at`

缓存键不得包含明文账户号。Exness 行情请求需要账户授权时，缓存只复用到同一 `scope_hash`；缓存表只允许 service role 读写，所有者只能经服务端接口读取已投影 K 线。连接断开、凭据轮换或作用域版本升级时失效对应私有缓存。公共快照发布后不再依赖该授权。

### 7.5 公共策略快照

不把大体积 K 线直接塞入通用 `posts.chart_package`。新增：

`public_strategy_snapshots`

- `id uuid`
- `post_id uuid unique`
- `author_id uuid`
- `schema_version text`
- `provider/product/symbol/timeframe/price_type`
- `range_start / range_end`
- `snapshot_status`：`closed | open_at_snapshot`
- `candles jsonb`：首版最多 3000 根，作为同一数据库事务的一部分
- `markers jsonb`：仅含公开字段和稳定的 `marker_key`
- `public_annotations jsonb`：用户在发布预览中选中的公开说明
- `indicators jsonb`：用户在预览中保留的指标 ID、顺序、参数和已经计算完成的标准化序列
- `drawings jsonb`：用户逐项选择的公开画线，使用新的公共 drawing key，不暴露私有状态 ID
- `show_quantity boolean default false`
- `show_absolute_pnl boolean default false`
- `price_return_rate` 与固定的计算口径标签
- `source_revision`、`source_fill_digest`、`created_at`
- `supersedes_post_id uuid null`，只用于显示版本链，不继承旧帖评论

`trading_post_sources`

- 私有映射 `post_id -> cycle_id + owner_id + source_revision`
- 仅作者和 service role 可读，公共查询不得返回 `cycle_id`

快照写入后不可原地替换核心成交和 K 线。作者要分享最新复盘时创建一个全新的帖子、URL、快照和评论线程，并用 `supersedes_post_id` 连接旧版本；旧帖子保持可访问和可审核。可以从旧帖子进入“以最新私有数据创建新版本”。

首版 `candles` 固定存为数据库 JSONB，最多 3000 根；超出时发布预览提高时间粒度，不使用对象存储，因此帖子、快照和全部图表事实可以在同一个数据库事务中提交。未来如需对象存储必须另行设计 staging、内容哈希、可见状态和孤儿清理，不能直接替换本契约。

公共快照保证“语义不可变”，不承诺不同浏览器上的逐像素一致：K 线、标记、指标计算结果、画线锚点/标签和统计值保持不变。快照记录 `renderer_schema_version` 与 `calculation_engine_version`；公共页面直接读取已保存的指标序列，不用未来版本重新计算旧帖。文字画线默认不公开；被选择公开的文字必须在最终预览中完整显示并经过文本长度与 XSS 校验。公共页面中的画线只读，访问者不能修改作者快照。

### 7.6 发布预览凭证

`strategy_share_previews`

- `id uuid`、`owner_id uuid`、`cycle_id uuid`
- `cycle_revision`、`source_fill_digest`、`chart_state_version`
- `projection_digest text`：对规范化后的完整公开候选 payload 计算内容摘要
- `projection jsonb`：包含固定 range/timeframe、隐私开关、公开标注、指标计算序列、画线、标记和统计
- `expires_at`，默认 15 分钟
- `consumed_at`，只能成功使用一次

预览接口接收全部分享选择并生成规范化 projection。发布接口不能再次接收或覆盖隐私、标注、指标、画线和统计字段，只能提交未过期预览 ID/令牌与帖子标题、正文、板块。服务端复核 projection digest、来源 revision/digest/state version 后原样提交用户看到的快照；任一变化都要求重新预览。

### 7.7 成交点评论

复用现有 `post_comments`，新增可空 `marker_key text`：

- 空值表示普通帖子评论；
- 非空表示评论绑定公共快照中的具体成交标记；
- 数据库触发器校验该 `marker_key` 属于该帖子的快照；
- 回复继承顶层评论的 `marker_key`，不能跨标记回复；
- 现有评论图片、删除状态、举报、管理员隐藏和通知继续生效。

这样无需维护第二套社区审核系统。

## 8. 行情与时间轴

### 8.1 提供方适配器

新增只读 `MarketCandleAdapter`，与成交同步适配器分离：

```ts
interface MarketCandleAdapter {
  provider: TradingProvider;
  listSupportedTimeframes(context: CandleContext): Promise<Timeframe[]>;
  fetchCandles(request: CandleRequest): Promise<CandleBatch>;
}
```

- Binance、OKX、Bybit、Bitget 使用各自官方只读 K 线端点和明确的品种映射。
- Exness 使用账户 access point 上的官方 `/v1/market-data/accounts/:account_id/candles`，先读取账户限制，再按限制分段请求；默认优先显示与成交语义一致的 bid/ask，并明确标签。
- 适配器返回标准 UTC 秒时间戳与 OHLCV，同时保留来源、价格类型、请求范围和缺口。
- 不允许任意用户 URL；上游主机继续使用现有 allowlist、Exness discovery 和 SSRF 防护。

### 8.2 自动时间粒度

根据第一笔到最后一笔成交的跨度选初始周期，并在前后增加上下文：

- 少于 2 小时：1 分钟；
- 2 小时至 1 天：5 分钟；
- 1 至 7 天：15 分钟或 1 小时；
- 7 天以上：4 小时或日线。

以上只是默认值。最终可用周期以提供方能力为准，用户可以手动切换。目标单次载入不超过约 3000 根 K 线；超出时增大周期或分页加载，而不是截断成交标记。

初始视图至少包含第一笔成交前 20% 和最后一笔成交后 20% 的时间上下文；开放持仓以当前可用时间为右边界，但公共分享首版仍要求用户明确生成一个时间点快照。

公共快照只保存发布预览中的单一 `timeframe + range`。读者可以在该范围内平移和缩放，但不能切换周期、向前分页或拉取快照外行情；作者若要展示另一个周期，应创建另一个帖子或新版本。这样公共预览与最终页面完全一致，也确保旧帖不再依赖上游 API。

### 8.3 完整性原则

- 不补造缺失 K 线，不对跨休市/停牌区间插值。
- 服务端返回 `complete | partial | unavailable` 及缺口区间。
- 图表对缺口使用明显的断带和提示，不用连续线掩盖。
- 每个公共快照记录来源和抓取时间；原上游数据后来修订也不改写旧快照。

## 9. 成交标记语义

每个标记至少包含：

- `marker_key`：公共快照内随机/哈希化标识，不暴露内部 fill ID；
- UTC 时间与价格；
- 开仓、加仓、减仓、部分平仓、完全平仓或反手新开；
- 多/空和买/卖；
- maker/taker（有可靠数据时）；
- 私人视图中的数量、费用、已实现盈亏与数据完整性；
- 用户标注是否存在、是否含图片。

颜色之外必须同时使用方向箭头、形状和文字缩写，满足色觉障碍与黑白截图场景。多个成交落在同一像素范围时显示聚合徽标，如“+4”；点击后列出四笔真实成交，选择任一项定位到精确成交。

公共快照中：

- `show_quantity=false` 时完全移除数量、手数、名义价值和可反推出仓位的字段，而不是只在 CSS 中隐藏；
- `show_absolute_pnl=false` 时移除所有绝对盈亏、费用金额、账户币种金额；
- 公开的 `price_return_rate` 使用周期已有的数量加权平均入场价与数量加权平均出场价计算：平仓周期为方向修正后的 `(exit_price / entry_price - 1) × 100%`；开放周期用快照最后一根可靠 K 线的收盘价替代出场价，并标注“截至快照时间、未实现”。它不含手续费、资金费、swap、账户杠杆或保证金，因此不能称为账户 ROI；
- 无可靠入场价、出场/快照价或周期完整性不足时，收益率显示“无法可靠计算”，不得猜测；
- 隐私开关约束的是字段是否直接公开，不可能在保留精确成交价格和价格走势的同时对所有数学推断作绝对保证。两个开关都关闭是严格隐私模式；若只公开数量或只公开绝对盈亏，预览必须警告另一项可能被近似推断，并要求额外确认。账户余额、账户 ROI、保证金、杠杆和原生账户身份无论选择如何都禁止公开。

## 10. 私人复盘体验

在 `/workbench/trades/[id]` 中把图表放在交易事实摘要之后、文字复盘之前：

1. 顶栏：品种、平台、时间周期、价格类型、行情来源、覆盖状态和可搜索指标入口。
2. 主图：K 线、全部成交标记、已启用指标、可选平均开仓/平仓辅助线。
3. 绘图栏：桌面端侧栏、移动端底部工具表；优先展示趋势线、斐波那契与艾略特工具，完整允许清单可搜索。
4. 右侧面板（移动端底部抽屉）：成交事实、私人标注、标签、图片、指标/画线对象列表和保存状态。
5. 下方无障碍列表：按时间列出所有成交，可键盘导航并与图表双向定位；画线对象也有可访问名称、显示/隐藏和删除控制。
6. “分享策略图”按钮：进入专门的发布预览，而不是直接公开当前页面。

标注自动保存需有“保存中 / 已保存 / 保存失败”明确状态。图表失败时，成交列表和文字复盘仍可用。

## 11. 发布与隐私确认流程

1. 用户点击“分享策略图”。
2. 系统固定待分享的周期 revision、fill digest、chart state version、行情范围和时间粒度。
3. 用户逐条选择哪些私人标注正文和标签可复制为公开说明；私人标注默认不公开。首版私人标注图片永不复制到公共快照。
4. 当前可见指标默认进入预览，但用户可逐项取消；画线全部默认不公开，用户逐项选择后才进入预览，尤其是文字画线。
5. 显示两个独立开关：
   - 显示仓位数量：默认关闭；
   - 显示绝对盈亏金额：默认关闭。
6. 服务端生成完整候选 projection、计算内容摘要和 15 分钟单次预览令牌；页面只渲染该 projection，包括指标、画线、标记弹窗和统计摘要，被隐藏字段显示为“未公开”。
7. 用户确认后只提交预览令牌与帖子元数据；服务端验证令牌、projection digest、revision/digest/state version 未变化，在一个事务中原样创建不可变快照和社区草稿。
8. 若同步或图表状态在预览期间改变，发布失败并要求刷新预览，不能把不同版本混合。
9. 用户补充标题、正文、板块后按现有社区规则发布。若来源是旧策略图的“最新版本”，创建新帖子并记录 `supersedes_post_id`，不复用旧评论线程。

服务端以允许清单构建公开对象，不采用“复制全部再删除敏感字段”的黑名单方式。

## 12. 公共策略图与互动

公共帖子详情检测 `chart_package.provider = "wavekb-trade-snapshot"` 后加载快照组件。公共图只读取 `public_strategy_snapshots`，绝不在访问时联表私有交易数据。

公共图恢复快照中固定的指标与只读画线。点击成交标记显示：公开动作、时间、价格、作者选择公开的说明、可公开的数量/盈亏、该点评论数。“评论此成交”创建带 `marker_key` 的顶层评论；回复仍限制为一层，沿用现有评论规则。首版评论只绑定真实成交标记，不绑定任意画线锚点。

普通评论与成交点评论共享总评论数，但界面分为：

- 图表点位内的评论线程；
- 帖子下方“全部讨论”，可按点位筛选。

作者删除私有交易数据时，已主动发布的公共快照默认保留；删除账号、删除帖子或明确删除公开快照时按社区/隐私政策级联处理。断开 API 不应让已发布帖子失效。

## 13. API 边界

建议新增或扩展以下服务端接口：

- `GET /api/trading/trades/:id/chart?timeframe=...&priceType=...`
  - 所有者校验后返回周期摘要、标准 K 线、全部成交标记、私人标注和覆盖状态。
- `PUT /api/trading/trades/:cycleId/fills/:fillId/annotation`
  - 幂等保存标注；校验 fill 确实属于当前用户的周期 revision。
- `PUT /api/trading/trades/:id/chart-state`
  - 使用乐观版本号保存受允许清单校验的指标和画线 DTO；拒绝未知工具、未知参数、超限对象和不安全文本。
- `POST /api/trading/trades/:id/share-preview`
  - 接收完整分享选择，返回服务端规范化 projection、内容摘要和固定 revision/digest/state version 的 15 分钟单次预览令牌。
- `POST /api/trading/trades/:id/publish-snapshot`
  - 只接受短期单次预览令牌和帖子元数据，不能重传或覆盖图表 payload；验证后原子创建快照与草稿。
- `GET /api/community/strategy-snapshots/:postId`
  - 只返回已发布、已脱敏的快照。
- 评论继续走现有 repository/RPC，增加 `marker_key` 校验。

所有响应都有大小上限、速率限制和固定安全错误码。行情上游错误不把响应正文、access point、账户 ID 或签名信息返回浏览器。

## 14. 安全与权限

- 私有成交、周期关系、标注、图片和行情授权缓存启用所有者 RLS；浏览器不能直接写事实表。
- 同步和周期关系仍只由 service role 的原子 RPC 写入。
- 发布 RPC 必须验证当前会话、UID 激活状态、帖子权限、周期所有权、revision、digest 和预览令牌。
- 公共快照 JSON 通过严格 schema 和字段允许清单；禁止连接 ID、账户 ID、原生订单 ID、原生成交 ID、余额/权益和上游原始对象。
- 指标和画线只接受锁定版本注册表中的已知 ID 和已知设置；不执行用户脚本、表达式、HTML、链接或第三方插件代码。
- 指标首版只能读取当前快照的同品种 K 线，并禁止 lookahead/repaint 和外部品种 `setBarsProvider`；高周期指标只能从已冻结 K 线按“已完成 bar”规则聚合，保证预览和历史帖子可重现。
- 标注正文和评论按纯文本/受限富文本规则处理，防止 XSS；图片复用现有上传安全限制。
- 行情请求按用户、连接、品种和时间范围限速；相同片段命中缓存，避免触发交易所限流。
- OpenAlgo Charts 依赖锁定精确版本，保留 Apache-2.0 `LICENSE/NOTICE` 要求；升级需重新跑图表契约、包体和安全测试。
- 不导入 `openalgo-charts/trade` 中的下单命令能力；若仅为展示持仓覆盖层需要其类型，必须构建无 broker command 的只读适配层并用测试证明无交易网络路径。

## 15. 性能与可用性

- 首屏只加载基础图表；指标、绘图工具按需动态加载。常用指标和精选工具优先，完整可用目录通过搜索触发动态模块，不把全部指标和 90 个绘图工具塞入首屏包。
- K 线窗口有上限并支持向前分页；标记数据单独加载，不能随 K 线窗口裁掉。
- 桌面目标：常见 500–3000 根 K 线、数百成交标记保持流畅缩放。
- 移动端优先保证查看、点选成交、写标注、隐私预览和评论；复杂绘图工具可放入“更多”。
- 尊重减少动态效果、键盘焦点、触控目标和屏幕阅读器；提供与图表等价的成交列表。
- 图表组件崩溃或浏览器不支持 Canvas 时降级为成交时间线，不影响复盘数据访问。
- 单个私人状态和公共快照均限制指标数量、画线数量、文字长度和序列化体积；达到上限时给出明确提示，不静默丢弃。

## 16. 错误与边界状态

- 无 K 线但有成交：显示成交时间线和“行情暂不可用”，不伪造背景图。
- 有 K 线缺口：在图表和覆盖状态中同时标记。
- 周期仍开放：可私人查看；分享时明确“截至某时的开放周期快照”。
- 周期 revision 改变：旧标注按 fill 身份重新关联；冲突进入用户确认。
- 上游品种已下架：尝试官方历史端点；不可用时保留成交列表。
- Exness bid/ask：默认依据成交方向选择可解释的价格层，同时允许查看双报价；快照记录选择，不能混用后不说明。
- 同一毫秒多笔成交：按 `occurred_at + sort_order + fill_id` 稳定排序。
- 反手成交：同一原生成交可以按分配数量在旧周期显示“平仓”，在新周期显示“反手新开”，两边共享来源但标记语义独立。
- 选中画线存在快照范围外锚点：预览自动扩展固定时间范围并重新请求/校验 K 线；若仍超过 3000 根则提高时间粒度并再次预览，不能静默裁掉锚点。

## 17. 测试与验收

### 17.1 数据正确性

- 五个平台均有开仓、加仓、减仓、部分平仓、完全平仓夹具。
- 反手、同时间多笔、乱序、重复、迟到成交和周期 revision 重建均保持确定性。
- 图表中的成交数与周期关系表中的记录一致；聚合只改变显示，不改变总数。
- 成交价格、方向、分配数量和时间与规范化事实一致。
- Exness candle limit、bid/ask、休市和无报价状态有测试。

### 17.2 隐私

- 四种隐私组合逐一验证公开响应和页面：都隐藏、仅数量、仅绝对盈亏、两者都显示。
- 默认必须为都隐藏；客户端篡改 payload 不能绕过服务端 schema。
- 仅公开数量或仅公开绝对盈亏时出现近似推断警告且必须额外确认；两者都隐藏时不返回任何绝对仓位/金额字段。
- 快照、HTML、RSC 数据、日志和错误中不存在连接/账户/API/原生订单标识。
- 私人标注默认不出现在快照；只有用户在预览中勾选的公开副本可见。
- 私人画线默认不出现在快照；只有预览中逐项选择的画线可见，文字画线逐字展示给用户确认。
- 其他登录用户与匿名用户不能读取私有图表、标注、图片或私有来源映射。

### 17.3 社区与审核

- marker comment 只能引用同一帖子的有效 marker；跨帖子、伪造 marker 和回复跨 marker 被数据库拒绝。
- `comments_enabled=false`、拉黑、禁言、封禁、举报、作者删除和管理员隐藏沿用现有行为。
- 删除/断开私有连接不会破坏已发布不可变快照。

### 17.4 页面与性能

- 桌面、390px 移动端、iOS PWA standalone 完成全部主流程。
- 键盘可逐个选择成交；屏幕阅读器可从列表获取等价事实。
- 3000 根 K 线、500 个成交标记的性能预算通过；聚合展开不丢标记。
- 常用指标、斐波那契和五类艾略特工具在桌面与移动端均可创建、编辑、撤销/重做、保存和恢复；公共快照恢复后只读且数据/锚点语义一致。
- 旧公共快照在图表库或指标实现升级后仍使用其保存的指标序列和版本化画线语义，不重新计算出不同结果。
- 未提供逐笔 bid/ask 或开放兴趣时，依赖这些数据的指标不可启用；Exness volume 始终显示 tick volume 标签。
- 图表引擎卸载后无 ResizeObserver、定时器、WebSocket 或事件监听泄漏。
- 图表失败、行情部分可用和完全不可用状态均有组件测试。

## 18. 分阶段发布

1. Additive migration：周期-成交关系、私有标注、公共快照、评论 marker 字段、RLS/RPC。
2. 服务端行情适配器与缓存：先用固定夹具和官方沙箱/只读端点验证五个平台。
3. 私人图表：feature flag 下接入 OpenAlgo Charts、全部成交标记、成交列表、标注和图表状态保存。
4. 指标与绘图：常用指标、数据能力过滤、斐波那契、五种艾略特波浪和移动端工具表。
5. 公共快照：指标/画线选择、隐私预览、原子发布、公共只读图表。
6. 点位评论与现有审核/通知集成。
7. 桌面、移动端、PWA、性能、安全和生产只读烟雾验证后逐步开启。

回滚时关闭对应 feature flag，不删除迁移或用户标注；旧文字复盘和成交列表始终可用。

## 19. 实施前置与已知风险

- 当前 `main` 的全量测试在本功能改动前已有失败，主要涉及安全补丁哈希和 Windows 工作流脚本断言。实施必须保留该基线证据，并用本功能新增的定向测试、typecheck、build 与 Linux CI 作为合并门槛；不得把无关基线修复混入本功能。
- OpenAlgo Charts 当前官方文档版本为 2.7.5；实施时需要在 npm 官方包与仓库 tag 之间核对 tarball、许可证和 API，再锁定精确版本，不使用浮动范围。
- 公共快照体积必须在真实交易样本上测量。若 3000 根 K 线的 JSON 超过社区读取预算，首版提高时间粒度并重新预览；不能静默截断，也不能未经新设计把 payload 移到对象存储。
- 公共分享属于用户主动公开动作，发布页必须保留明确确认和最终预览，不能因以后新增字段自动扩大公开范围。

### 19.1 删除与保留

- “不可变”表示发布后核心内容不能编辑，不表示永久无法删除。
- 作者删除帖子或账号删除流程触发时，公共帖子与快照立即不可见，快照 payload 在最长 30 天恢复窗口后硬删除；只保留不含正文、K 线、指标、画线、成交或身份详情的最小删除审计摘要最多 90 天。
- 管理员审核隐藏只改变可见状态，不改写快照；申诉期结束后的删除按社区审核保留规则执行。
- 私有 API 断开或私有交易数据删除不自动删除用户此前主动发布的公共快照；用户可在公开帖子上单独删除。

## 20. 官方参考

- OpenAlgo Charts 仓库与集成说明：<https://github.com/marketcalls/openalgo-charts>
- OpenAlgo Charts 架构：<https://github.com/marketcalls/openalgo-charts/blob/master/ARCHITECTURE.md>
- OpenAlgo Charts 艾略特五类计数发布说明：<https://github.com/marketcalls/openalgo-charts/releases/tag/v2.7.1>
- OpenAlgo Charts Apache-2.0 NOTICE：<https://github.com/marketcalls/openalgo-charts/blob/master/NOTICE>
- Exness 历史 K 线：<https://www.exness-api.com/reference/trading/get-candle-history>
- Exness Access Point / Host Discovery：<https://www.exness-api.com/trading/get-started/access-point-host-discovery>
