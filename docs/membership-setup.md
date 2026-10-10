# WaveKB 会员配置与上线验收

账号沿用网站原有注册与 UID 激活流程，不另设“免费会员”产品或注册入口。VIP 从本人个人中心的“开通 / 管理 VIP”进入，一次性购买月度或年度方案。确认的初始价格为月费 52 美元、年费 520 美元；VIP 平台 AI 每日 50 次，按北京时间零点重置；导师服务按原价 9 折结算。价格、方案是否展示和后续权益可在 `/admin/memberships` 调整。公开书籍和现有自带 Key 分析不收费、不消耗平台会员额度。

默认仅展示确认的 VIP 方案，不收款，不自动开启平台 AI。个人中心的新购买使用 USDT / USDC 链上转账；旧 Stripe 接入保留历史订单与必要的支付回调，不作为新购买入口。月度和年度购买均不自动续费。价格或权益调整不修改既有已付款订单的购买快照；有效手工授权、正式 Stripe 购买和已核验钱包购买权益按较高额度聚合，不重复叠加。测试付款有独立记录，但不授予正式权益。

## 发布顺序

1. 同一候选提交通过单元测试、实际 PostgreSQL 合同测试、构建、浏览器和知识库验收。
2. 经正常发布审批依次应用 `202610100001_admin_payment_hardening.sql`、`202610100002_membership_foundation.sql`、`202610100003_membership_commerce.sql`、`202610100004_membership_benefits.sql`、`202610100005_membership_wallet_payments.sql`，只应用当前已知 marker 之后的未部署部分。数据库公开 `wavekb_schema_version()` 必须为 `202610100005`。未知 marker 停止发布。
3. 发布同一提交的 Gateway 与 worker；`MEMBERSHIP_MANAGED_AI_ENABLED` 保持 `false`。
4. 独立部署会员钱包 Checkout。若已有 Stripe 历史订单，还须保留旧函数部署与回调。现有 Backend 工作流不代替此步骤：

   ```sh
   supabase functions deploy membership-wallet-checkout --project-ref PROJECT_REF --no-verify-jwt
   supabase functions deploy membership-checkout --project-ref PROJECT_REF --no-verify-jwt
   supabase functions deploy membership-payment-webhook --project-ref PROJECT_REF --no-verify-jwt
   ```

   Checkout 在函数内验证当前用户的 Bearer token、确认邮箱、本人身份和服务器账户资格。Webhook 在函数内验证独立 Stripe 签名，不能要求用户 JWT，否则 Stripe 无法回调。
5. 发布同一提交的 Next 网站。只读核验公开健康检查 SHA、仅展示 VIP 的方案页、原有注册返回路径及本人个人中心的 VIP 入口；收费与平台 AI 仍关闭。公共主导航和匿名账号导航不新增独立会员入口。

函数启用参数必须通过部署环境的秘密管理设置；不得把支付密钥、Webhook secret、模型 Key、主加密密钥或 service role 写入网站、Git、聊天、截图或操作日志。

## USDT / USDC 钱包收款配置

本接入只查询转账回执，不保管钱包私钥，不签名、不划转、不自动退款，也不涉及 Hermes、Bitget 或 Discord。尚未提供实际公开收款地址时，所有链的收款地址为空，钱包总开关及各网络开关关闭。不得用示例地址替代运营方实际钱包。

运营方已提供以下公开地址并通过格式检查，TRON 地址同时通过 Base58Check 校验。它们属于本次部署配置清单，不写成通用代码或测试的默认收款地址；尚未通过后台配置写入生产数据库。格式检查不等于证明钱包所有权或实际到账能力。

| 网络 | 运营方指定公开收款地址 |
| --- | --- |
| TRON | `TNz8J7W71XhJahxZ37MuY5bQDTTDggGQwN` |
| Ethereum | `0xe421df7d8e0f58af16b35c75f9f114a2046563cb` |
| Base | `0xe421df7d8e0f58af16b35c75f9f114a2046563cb` |

第一版固定支持以下官方主网合约，后台不能填写任意同名代币合约：

| 网络 | 币种 | 官方合约 | 精度 |
| --- | --- | --- | --- |
| TRON | USDT (TRC20) | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` | 6 |
| Ethereum，chain ID 1 | USDT (ERC20) | `0xdAC17F958D2ee523a2206206994597C13D831ec7` | 6 |
| Ethereum，chain ID 1 | USDC (ERC20) | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` | 6 |
| Base，chain ID 8453 | USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | 6 |

合约依据 [Tether 支持协议](https://tether.to/en/supported-protocols/) 与 [Circle USDC 官方合约表](https://developers.circle.com/stablecoins/usdc-contract-addresses)。[Circle 已停止 TRON USDC 支持](https://www.circle.com/blog/circle-is-discontinuing-support-for-usdc-on-the-tron-blockchain)，因此不提供该付款选项。Base-USDT 未在本次核对的官方清单中获得确认，暂不开放；“多网络”不等于任意币种、桥接代币或任意链均可付款。

### 后台与服务器配置

1. 在 `/admin/memberships` 填写每个支持网络的真实公开收款地址。TRON 校验 Base58Check；Ethereum / Base 使用 EVM 地址。价格、网络和地址调整须填写原因，保留审计记录。旧订单使用创建时的地址、合约、金额及权益快照，不能因后台修改改变收款目标。
2. 向 Gateway / 现有 AI worker 的服务器环境添加下表参数。RPC URL 可能包含供应商 Key，只能保存在服务端环境秘密中，不得截图、提交 Git 或记录在日志。使用受信任的主网 RPC 供应商并加入精确主机白名单。不能把客户端填写的 URL 当作核验节点。
3. `membership-wallet-checkout` 设置 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`SITE_ORIGIN` 与 `MEMBERSHIP_WALLET_ENABLED`。Checkout 验证用户会话、邮箱和账户资格，再由 service role 原子生成订单；没有私钥或支付签名权限。
4. 先保持数据库总开关和 `MEMBERSHIP_WALLET_ENABLED=false` 完成配置与验收。全部通过后按发布审批同时开启对应网络、数据库总开关、Edge 开关与 worker 开关。数据库或 Edge 任一关闭均不能创建新钱包订单；关闭新收款时只关闭数据库 / Edge 创建开关，保留已启用 worker 核对既有付款，不能删除历史记录或把关闭核验当作已结清。

| Worker 参数 | 用途 |
| --- | --- |
| `MEMBERSHIP_WALLET_ENABLED` | 默认 `false`；启用后独立循环核验，不影响 AI 工作队列 |
| `MEMBERSHIP_WALLET_ETHEREUM_RPC_URL` | Ethereum 主网 HTTPS JSON-RPC |
| `MEMBERSHIP_WALLET_BASE_RPC_URL` | Base 主网 HTTPS JSON-RPC |
| `MEMBERSHIP_WALLET_RPC_ALLOWED_HOSTS` | 上述 URL 的精确小写主机名，逗号分隔；无通配符 |
| `MEMBERSHIP_WALLET_TRONGRID_API_KEY` | 可选 TronGrid Key；服务固定查询官方主网 solidity 回执接口 |
| `MEMBERSHIP_WALLET_VERIFY_BATCH_SIZE` | 默认 2，允许 1–10；每个 RPC 超时 8 秒 |

标准部署的 `elliott-wave-ai-worker.service` 已运行独立钱包核验循环，无需重复启动额外 worker。`pnpm --dir ai-gateway membership:verify` 仅供选择独立进程部署时使用。缺少某条 EVM 网络的节点配置时，该链的任务等待并退避，不影响另外的网络；运营方不得在节点配置尚未验证时开放对应网络收款。

### 金额、归属与确认

- 以方案美元价格按 1 USD = 1 USDT / USDC 报价；这不是币价或脱锚补偿机制。52 / 520 基础金额加订单专属 6 位小数尾差。例如页面可能要求 `52.001237 USDT`，必须按完整金额支付。尾差介于 `0.000001` 与 `0.009999`，不使用浮点计算。
- 单笔订单创建后有效期 30 分钟。页面显示网络、代币、官方合约、收款地址、完整金额和截止时间；链上实际到账金额须完全一致，网络手续费另计，不能从应付金额扣除。分次、少付、多付、错误币种或错误网络不会自动开通。
- 相同网络 / 合约 / 收款地址的专属金额永久不复用，包括过期或撤销订单，避免迟到转账被配给新用户。每个基础价格的可用尾差池为 9999 个；耗尽时停止生成订单并提示运营方处理，不偷偷复用或改变价格。
- 用户提交交易哈希只进入核验队列，不代表付款成功。服务端验证成功交易的真实官方代币 Transfer 日志、网络、地址、精确金额、区块与最终性，不相信截图或客户端金额。
- EVM 核对 finalized 区块及规范区块哈希；TRON 核对 solidity 已确认成功回执。单个转账事件只能授予一次，重复提交或丢失回包重试不重复开通。实际转账时间在订单有效期内、确认稍晚的付款仍可核验；实际迟付进入人工核对，保留证据，不发起自动退款。
- 付款窗口按回执时间严格比较，不静默扩大。Ethereum / Base 的区块时间精度为秒，订单时间带毫秒；与创建订单处于同一秒的转账可能因不能证明秒内先后而进入 `payment_before_invoice` 人工核对。不得据此让用户重新付款、删除证据或把客户端时间当作到账证明；链特定的时间容差属于另行确认的付款政策。
- 核验队列有独立租约和指数退避。网络超时只保持等待，不把用户当成未付款、清除订单或撤销其他已购买权益。续费从当前有效正式权益结束后起算，历史退款/撤销不重排其他已授予期限。
- 交易哈希填错时可在同一订单提交正确哈希，不要求再次转账。新增哈希有服务端限额：每笔最多 3 个未完成核验、每用户 10 分钟最多 5 个新哈希、每笔累计最多 20 个不同哈希；重复同哈希继续读取原回执，不重复占限额。达到限额保留付款及订单证据，由运营方核对，不能靠反复创建请求绕过。
- 发生明确错账或需要撤销已支付钱包权益时，管理员可查看订单、核验记录和链上回执，并通过专门的原请求幂等操作填写原因撤销该笔已付权益。此操作不发起退款、不移动钱包资金，也不撤销其他 Stripe、钱包或手工授权；外部退款须由运营方独立处理并保留证据。

### 钱包收费前额外验收

验收必须包含：普通账户创建订单、不同用户的专属金额、双击与未知回包恢复、后台版本冲突、错链/假币/错误地址/少付/多付/过期支付、同哈希重复提交、批量交易中不同事件、节点失败退避、租约过期与旧 worker 禁写、跨 Stripe / 钱包续费，以及原有 AI / 导师权益不变。隔离 PGlite 合同测试不能替代真实 PostgreSQL 多连接竞态测试。

上线前还需在获授权环境，用真实收款地址和受控付款完成“转账 → 确认回执 → 正确用户开通 → 重试不重复开通”验收。即使已经提供地址，也必须取得部署成功和受控到账证据，才能宣称真实收款已开放。

### 当前本地验证记录

2026-10-10 的钱包候选代码已完成下列本地验证；这些结果不是线上收费证据：

- 网站单元测试 133 个文件、1316 项通过；后端与数据库回归 625 项通过、1 项显式隔离运行时入口跳过，其中钱包实际迁移合同测试 33 项、Edge / 跨层合同 16 项。跳过的真实多连接入口另行显式执行并通过，详见下方记录。
- Gateway 全套 237 项通过；网站与 Gateway 类型检查、网站 ESLint、Next 正式构建及 Storybook 构建通过。
- Storybook 浏览器验收 170 项通过，重试为 0；覆盖虚拟订单的 375px、横屏、桌面、明暗主题、等待 / 更正 / 人工核对 / 已付状态及后台配置。预览遮蔽所有收款地址且禁止实际付款写入，不能作为真实到账测试。
- 以正式工作流相同的公开 Supabase 参数重新构建后，独立 Next 服务的浏览器验收 154 项通过、10 项跳过，重试为 0；跳过的是需专用登录账号或 Tline 上游凭据 / 隔离夹具的场景，不冒称这些真实登录与付款路径已验收。仅在启动时设置公开参数不能代替 Next 的构建期配置。
- 隔离 PostgreSQL 18.4 的两个独立连接完成 8 个真实锁竞争场景，连同外层共 9 项通过、0 跳过；验证同请求幂等、金额占位、跨手工 / Stripe 续费、锁等待中租约过期，以及双向付款 / 撤销竞争。测试使用合成资料和临时本地数据库，数据库进程已停止。普通根目录回归不配置临时运行时会明确跳过该入口；`verify-release` 另有显式安装运行时并执行此测试的硬门槛。macOS 实测不能代替 Linux CI 首跑。
- 知识库验证通过，420 张阅读图片及 3 本受验收 PDF 引用无缺失；知识库包测试 6 项通过；生产依赖审计未报告漏洞。

数据库、Edge 与 worker 的实际部署、真实 RPC 连通性和获授权的受控到账验收仍须按上面的发布顺序完成。未完成这些步骤前，各收费开关维持关闭。

## 历史 Stripe 接入与回调

复用 Stripe 的技术接入方式，但会员使用独立订单表、独立函数配置和独立 Webhook secret，不复用导师订单或导师回调。必须由站点运营方提供可用的 Stripe 商户账户；代码上线不代表商户、收款能力或结算已开通。

| Edge Function 配置 | 用途 |
| --- | --- |
| `SUPABASE_URL` | 当前网站的 Supabase 项目 URL |
| `SUPABASE_ANON_KEY` | 验证用户会话使用的公开项目 Key |
| `SUPABASE_SERVICE_ROLE_KEY` | 仅函数服务器使用的 service role |
| `SITE_ORIGIN` | 正式网站 HTTPS 来源，如 `https://wavekb.com`；支付返回地址由服务器固定生成 |
| `MEMBERSHIP_BILLING_ENABLED` | 新 Checkout 总开关，初始 `false` |
| `MEMBERSHIP_PAYMENT_MODE` | `test` 或 `live`，必须与密钥及冻结订单模式一致 |
| `MEMBERSHIP_STRIPE_SECRET_KEY` | 对应模式的服务器 Stripe 密钥；不借用前端 Key |
| `MEMBERSHIP_STRIPE_WEBHOOK_SECRET` | 会员回调端点专用签名 secret |

在 Stripe 建立指向 `/functions/v1/membership-payment-webhook` 的 HTTPS 回调端点，订阅：

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `refund.created`
- `refund.updated`
- `refund.failed`

函数验证原始请求签名、时间窗口、模式、订单所有者、冻结金额和币种，并再次读取 Stripe 的对应 Session。异步失败还验证 PaymentIntent 的失败状态。退款必须核对原会员订单已经绑定的 Session 和 PaymentIntent；累计全额退款只撤销该订单的购买权益，不撤销其他购买或手工授权。

数据库后台的“开放付款”与函数的 `MEMBERSHIP_BILLING_ENABLED` 必须同时开启。关闭其中任一开关就不能创建或继续 Checkout；已经到达 Stripe 的付款和退款回调仍须处理。关闭新收款时不要删除或停用 Webhook，不要清理 pending 订单或幂等标记。

一个部署环境使用一个固定支付模式。存在 pending 订单时不能切换模式；已经有正式已付订单时，不能把该环境改回 test，以免未完成的退款和延迟回调失去原凭证。需要测试另一模式时使用隔离的测试项目，不替换正式环境的 Stripe Key 或 Webhook secret。关闭新购买不影响原模式的退款和付款核对。

## 平台 AI 配置

平台分析与 BYOK 分离。只有配置完成且 `MEMBERSHIP_MANAGED_AI_ENABLED=true` 时，平台分析才开放；用户自带 Key 的路径保持原有合同，不借用其 Key 为其他会员运行任务。

1. 配置并验证现有 `ai_providers`、`ai_models` 和 `ai_task_routes` 的 `wave_analysis` 路由。提供商、主模型与路由均须启用。
2. 使用网站原有服务器加密流程配置该提供商的 `ai_provider_secrets`，并确认服务器 `AI_SECRET_MASTER_KEY` 与密文对应。不直接把明文密钥写进 SQL。
3. 将提供商 HTTPS 地址加入服务器允许名单，设置适当的模型超时、输出 Token 上限和成本参数。
4. Gateway 和 AI worker 使用相同配置，保持关闭完成配置核对后再启用。配置失效不得改走任意模型或用户 Key。

每个被接受的平台任务在数据库中原子预留一次每日额度。重复请求和 worker 重试不重复计数；只有服务器确认的最终失败返还该任务额度。等待、处理中、取消和成功任务不因客户端声明返还。过期、退款、撤销或停用后的会员不能启动新平台任务，执行前也复核权益。

50 次是每日请求次数，不是 Token 数，也不是无限上下文。上线前须核验具体模型、单次成本与预算。仅有会员方案配置不能保证平台模型可用。

## 收费前验收

- 普通测试用户通过原有注册入口注册、验证邮箱、完成 UID 激活；原有登录和注册返回路径保持可用。本人个人中心与私有资料页有“开通 / 管理 VIP”入口，他人公开个人页没有该入口；登出或切换账户立即清除旧权益显示。
- 方案预览仅显示 VIP，不显示独立的免费账户卡或注册按钮；准确显示 52 美元月费、520 美元年费、平台每日 50 次与导师 9 折；公开书籍和 BYOK 仍可正常使用。
- 在 Stripe test 模式进行实际 Checkout 和签名回调，核对一次点击、重复点击、相同原请求重试、未知结果恢复、关闭收费、异步付款成功或失败和订单超时。测试订单不得授予正式 VIP。
- 用授权的验收账户验证正式权益来源。付款回跳 URL 和客户端“付款成功”声明不能开通 VIP；额度、退款和到期以服务端记录为准。
- 测试每日额度用尽、重复任务、失败返还和北京时间换日；验证非 VIP、过期 VIP 和未配置提供商不能使用平台额度。
- 新导师订单报价、实际收款金额和快照均为原价的 90%；原有订单不重算。9 折表示优惠 10%，不是优惠 90%。后台可设置优惠最多 99%，不支持零元导师 Checkout。
- 部分退款保留权益；累计全额退款仅撤对应订单购买权益；延迟或重复事件不能重新激活已退款或失败订单。
- 最后按审批把函数和数据库都设为 `live`，验证模式、签名 secret 和商户对应，再开启新收款。实际支付与平台模型调用需要单独授权并留存验收记录。

若 Session 创建结果或回包不明，继续读取本人原订单并使用原请求重试，不生成替代请求。超过外部幂等保护窗口仍不明的订单保留并由运营方核对 Stripe，不擅自当作失败删除或重新扣款。

支付行为依据 [Stripe Checkout 交付说明](https://docs.stripe.com/checkout/fulfillment)、[签名回调说明](https://docs.stripe.com/webhooks) 和 [事件类型说明](https://docs.stripe.com/api/events/types)。这些配置步骤不等于支付服务已经上线。
