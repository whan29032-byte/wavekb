# WaveKB 成交级交互复盘图与公共策略分享设计

日期：2026-11-26  
状态：待用户确认  
范围：`/workbench/trades/[id]`、社区帖子详情、交易同步网关、Supabase 数据模型

## 1. 意图

把现有“单笔交易详情 + 文字复盘”升级为成交级交互图表：用户绑定 Binance、OKX、Bybit、Bitget 或 Exness 的只读 API 后，每一个真实成交都自动显示在 K 线上，包括首次开仓、加仓、减仓、部分平仓、完全平仓和反手拆分产生的成交。用户可以在任意成交标记上写备忘录、添加标签和图片，并在明确确认隐私选项后，把当前复盘发布为全站可查看、可在成交点评论的公共策略图。

本功能的价值不是再做一个交易终端，而是把“发生了什么、当时为什么、之后如何改进”绑定到可核验的成交证据上。

## 2. 已确认的产品决定

- 图表引擎选用独立的 `openalgo-charts` 库，不引入完整 OpenAlgo 平台、订单路由、返佣、订阅或运营后台。
- 展示每一次成交，不把多次加减仓压缩为一条均价线。
- 图表缩小时允许视觉聚合，但底层成交、数量和时间不得丢失；展开聚合点必须能看到其中每一笔成交。
- 每个成交标记可写备忘录、标签和图片。
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
- 首版不保存或公开任意手动画线；只实现真实成交标记、点位说明和图片证据，手动画线作为后续独立功能评估。
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

OpenAlgo Charts 只负责绘制蜡烛图、缩放、十字光标、标记、基础绘图和导出画面，不获得交易所凭据，也不直接请求交易所。

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

### 7.3 行情缓存

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

### 7.4 公共策略快照

不把大体积 K 线直接塞入通用 `posts.chart_package`。新增：

`public_strategy_snapshots`

- `id uuid`
- `post_id uuid unique`
- `author_id uuid`
- `schema_version text`
- `provider/product/symbol/timeframe/price_type`
- `range_start / range_end`
- `snapshot_status`：`closed | open_at_snapshot`
- `candles jsonb` 或不可变压缩对象引用
- `markers jsonb`：仅含公开字段和稳定的 `marker_key`
- `public_annotations jsonb`：用户在发布预览中选中的公开说明
- `show_quantity boolean default false`
- `show_absolute_pnl boolean default false`
- `price_return_rate` 与固定的计算口径标签
- `source_revision`、`source_fill_digest`、`created_at`
- `supersedes_post_id uuid null`，只用于显示版本链，不继承旧帖评论

`trading_post_sources`

- 私有映射 `post_id -> cycle_id + owner_id + source_revision`
- 仅作者和 service role 可读，公共查询不得返回 `cycle_id`

快照写入后不可原地替换核心成交和 K 线。作者要分享最新复盘时创建一个全新的帖子、URL、快照和评论线程，并用 `supersedes_post_id` 连接旧版本；旧帖子保持可访问和可审核。可以从旧帖子进入“以最新私有数据创建新版本”。

### 7.5 成交点评论

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
- 若只凭公开字段仍可能高概率反推出隐藏数据，发布服务应进一步抑制相关衍生字段。

## 10. 私人复盘体验

在 `/workbench/trades/[id]` 中把图表放在交易事实摘要之后、文字复盘之前：

1. 顶栏：品种、平台、时间周期、价格类型、行情来源和覆盖状态。
2. 主图：K 线、全部成交标记、可选平均开仓/平仓辅助线。
3. 右侧面板（移动端底部抽屉）：成交事实、私人标注、标签、图片和保存状态。
4. 下方无障碍列表：按时间列出所有成交，可键盘导航并与图表双向定位。
5. “分享策略图”按钮：进入专门的发布预览，而不是直接公开当前页面。

标注自动保存需有“保存中 / 已保存 / 保存失败”明确状态。图表失败时，成交列表和文字复盘仍可用。

## 11. 发布与隐私确认流程

1. 用户点击“分享策略图”。
2. 系统固定待分享的周期 revision、fill digest、行情范围和时间粒度。
3. 用户逐条选择哪些私人标注正文和标签可复制为公开说明；私人标注默认不公开。首版私人标注图片永不复制到公共快照。
4. 显示两个独立开关：
   - 显示仓位数量：默认关闭；
   - 显示绝对盈亏金额：默认关闭。
5. 预览完整公共页面，包括标记弹窗和统计摘要；被隐藏字段显示为“未公开”，不留空白误导。
6. 用户确认后，服务端重新读取私有事实、验证 revision/digest 未变化、执行字段级脱敏，在一个事务中创建不可变快照和社区草稿。
7. 若同步在预览期间改变了周期，发布失败并要求刷新预览，不能把两个 revision 混合。
8. 用户补充标题、正文、板块后按现有社区规则发布。若来源是旧策略图的“最新版本”，创建新帖子并记录 `supersedes_post_id`，不复用旧评论线程。

服务端以允许清单构建公开对象，不采用“复制全部再删除敏感字段”的黑名单方式。

## 12. 公共策略图与互动

公共帖子详情检测 `chart_package.provider = "wavekb-trade-snapshot"` 后加载快照组件。公共图只读取 `public_strategy_snapshots`，绝不在访问时联表私有交易数据。

点击成交标记显示：公开动作、时间、价格、作者选择公开的说明、可公开的数量/盈亏、该点评论数。“评论此成交”创建带 `marker_key` 的顶层评论；回复仍限制为一层，沿用现有评论规则。

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
- `POST /api/trading/trades/:id/share-preview`
  - 返回可公开字段的服务端预览令牌和固定 revision/digest。
- `POST /api/trading/trades/:id/publish-snapshot`
  - 使用短期单次预览令牌、隐私选择和公开标注选择，原子创建快照与草稿。
- `GET /api/community/strategy-snapshots/:postId`
  - 只返回已发布、已脱敏的快照。
- 评论继续走现有 repository/RPC，增加 `marker_key` 校验。

所有响应都有大小上限、速率限制和固定安全错误码。行情上游错误不把响应正文、access point、账户 ID 或签名信息返回浏览器。

## 14. 安全与权限

- 私有成交、周期关系、标注、图片和行情授权缓存启用所有者 RLS；浏览器不能直接写事实表。
- 同步和周期关系仍只由 service role 的原子 RPC 写入。
- 发布 RPC 必须验证当前会话、UID 激活状态、帖子权限、周期所有权、revision、digest 和预览令牌。
- 公共快照 JSON 通过严格 schema 和字段允许清单；禁止连接 ID、账户 ID、原生订单 ID、原生成交 ID、余额/权益和上游原始对象。
- 标注正文和评论按纯文本/受限富文本规则处理，防止 XSS；图片复用现有上传安全限制。
- 行情请求按用户、连接、品种和时间范围限速；相同片段命中缓存，避免触发交易所限流。
- OpenAlgo Charts 依赖锁定精确版本，保留 Apache-2.0 `LICENSE/NOTICE` 要求；升级需重新跑图表契约、包体和安全测试。
- 不导入 `openalgo-charts/trade` 中的下单命令能力；若仅为展示持仓覆盖层需要其类型，必须构建无 broker command 的只读适配层并用测试证明无交易网络路径。

## 15. 性能与可用性

- 首屏只加载基础图表；指标、绘图工具按需动态加载。首版默认不加载 113 个指标和完整 90 个绘图工具。
- K 线窗口有上限并支持向前分页；标记数据单独加载，不能随 K 线窗口裁掉。
- 桌面目标：常见 500–3000 根 K 线、数百成交标记保持流畅缩放。
- 移动端优先保证查看、点选成交、写标注、隐私预览和评论；复杂绘图工具可放入“更多”。
- 尊重减少动态效果、键盘焦点、触控目标和屏幕阅读器；提供与图表等价的成交列表。
- 图表组件崩溃或浏览器不支持 Canvas 时降级为成交时间线，不影响复盘数据访问。

## 16. 错误与边界状态

- 无 K 线但有成交：显示成交时间线和“行情暂不可用”，不伪造背景图。
- 有 K 线缺口：在图表和覆盖状态中同时标记。
- 周期仍开放：可私人查看；分享时明确“截至某时的开放周期快照”。
- 周期 revision 改变：旧标注按 fill 身份重新关联；冲突进入用户确认。
- 上游品种已下架：尝试官方历史端点；不可用时保留成交列表。
- Exness bid/ask：默认依据成交方向选择可解释的价格层，同时允许查看双报价；快照记录选择，不能混用后不说明。
- 同一毫秒多笔成交：按 `occurred_at + sort_order + fill_id` 稳定排序。
- 反手成交：同一原生成交可以按分配数量在旧周期显示“平仓”，在新周期显示“反手新开”，两边共享来源但标记语义独立。

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
- 快照、HTML、RSC 数据、日志和错误中不存在连接/账户/API/原生订单标识。
- 私人标注默认不出现在快照；只有用户在预览中勾选的公开副本可见。
- 其他登录用户与匿名用户不能读取私有图表、标注、图片或私有来源映射。

### 17.3 社区与审核

- marker comment 只能引用同一帖子的有效 marker；跨帖子、伪造 marker 和回复跨 marker 被数据库拒绝。
- `comments_enabled=false`、拉黑、禁言、封禁、举报、作者删除和管理员隐藏沿用现有行为。
- 删除/断开私有连接不会破坏已发布不可变快照。

### 17.4 页面与性能

- 桌面、390px 移动端、iOS PWA standalone 完成全部主流程。
- 键盘可逐个选择成交；屏幕阅读器可从列表获取等价事实。
- 3000 根 K 线、500 个成交标记的性能预算通过；聚合展开不丢标记。
- 图表引擎卸载后无 ResizeObserver、定时器、WebSocket 或事件监听泄漏。
- 图表失败、行情部分可用和完全不可用状态均有组件测试。

## 18. 分阶段发布

1. Additive migration：周期-成交关系、私有标注、公共快照、评论 marker 字段、RLS/RPC。
2. 服务端行情适配器与缓存：先用固定夹具和官方沙箱/只读端点验证五个平台。
3. 私人图表：feature flag 下接入 OpenAlgo Charts、全部成交标记、成交列表和标注。
4. 公共快照：隐私预览、原子发布、公共只读图表。
5. 点位评论与现有审核/通知集成。
6. 桌面、移动端、PWA、性能、安全和生产只读烟雾验证后逐步开启。

回滚时关闭对应 feature flag，不删除迁移或用户标注；旧文字复盘和成交列表始终可用。

## 19. 实施前置与已知风险

- 当前 `main` 的全量测试在本功能改动前已有失败，主要涉及安全补丁哈希和 Windows 工作流脚本断言。实施必须保留该基线证据，并用本功能新增的定向测试、typecheck、build 与 Linux CI 作为合并门槛；不得把无关基线修复混入本功能。
- OpenAlgo Charts 当前官方文档版本为 2.7.5；实施时需要在 npm 官方包与仓库 tag 之间核对 tarball、许可证和 API，再锁定精确版本，不使用浮动范围。
- 公共快照体积必须在真实交易样本上测量。若 3000 根 K 线的 JSON 超过社区读取预算，使用压缩对象存储 + 内容哈希，不降低数据真实性。
- 公共分享属于用户主动公开动作，发布页必须保留明确确认和最终预览，不能因以后新增字段自动扩大公开范围。

## 20. 官方参考

- OpenAlgo Charts 仓库与集成说明：<https://github.com/marketcalls/openalgo-charts>
- OpenAlgo Charts 架构：<https://github.com/marketcalls/openalgo-charts/blob/master/ARCHITECTURE.md>
- OpenAlgo Charts Apache-2.0 NOTICE：<https://github.com/marketcalls/openalgo-charts/blob/master/NOTICE>
- Exness 历史 K 线：<https://www.exness-api.com/reference/trading/get-candle-history>
- Exness Access Point / Host Discovery：<https://www.exness-api.com/trading/get-started/access-point-host-discovery>
