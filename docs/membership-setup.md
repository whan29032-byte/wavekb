# WaveKB 会员配置与上线验收

会员采用免费注册账户和一次性购买的 VIP 月度或年度方案。确认的初始价格为月费 52 美元、年费 520 美元；VIP 平台 AI 每日 50 次，按北京时间零点重置；导师服务按原价 9 折结算。价格、方案是否展示和后续权益可在 `/admin/memberships` 调整。公开书籍和现有自带 Key 分析不收费、不消耗平台会员额度。

默认仅展示确认的 VIP 方案，不收款，不自动开启平台 AI。月度和年度购买均不自动续费。价格或权益调整不修改既有已付款订单的购买快照；有效手工授权与有效正式购买权益按较高额度聚合，不重复叠加。测试付款有独立记录，但不授予正式权益。

## 发布顺序

1. 同一候选提交通过单元测试、实际 PostgreSQL 合同测试、构建、浏览器和知识库验收。
2. 经正常发布审批依次应用 `202610100001_admin_payment_hardening.sql`、`202610100002_membership_foundation.sql`、`202610100003_membership_commerce.sql`、`202610100004_membership_benefits.sql`，只应用当前已知 marker 之后的未部署部分。数据库公开 `wavekb_schema_version()` 必须为 `202610100004`。未知 marker 停止发布。
3. 发布同一提交的 Gateway 与 worker；`MEMBERSHIP_MANAGED_AI_ENABLED` 保持 `false`。
4. 独立部署以下两支 Supabase Edge Function。现有 Backend 工作流不代替此步骤：

   ```sh
   supabase functions deploy membership-checkout --project-ref PROJECT_REF --no-verify-jwt
   supabase functions deploy membership-payment-webhook --project-ref PROJECT_REF --no-verify-jwt
   ```

   Checkout 在函数内验证当前用户的 Bearer token、确认邮箱、本人身份和服务器账户资格。Webhook 在函数内验证独立 Stripe 签名，不能要求用户 JWT，否则 Stripe 无法回调。
5. 发布同一提交的 Next 网站。只读核验公开健康检查 SHA、公开方案页、注册返回路径和会员中心；收费与平台 AI 仍关闭。

函数启用参数必须通过部署环境的秘密管理设置；不得把支付密钥、Webhook secret、模型 Key、主加密密钥或 service role 写入网站、Git、聊天、截图或操作日志。

## 会员收款配置

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

- 普通测试用户能从方案页注册、验证邮箱、完成 UID 激活并返回原会员目的地；登出或切换账户立即清除旧权益显示。
- 公共方案准确显示 52 美元月费、520 美元年费、平台每日 50 次与导师 9 折；公开书籍和 BYOK 仍可正常使用。
- 在 Stripe test 模式进行实际 Checkout 和签名回调，核对一次点击、重复点击、相同原请求重试、未知结果恢复、关闭收费、异步付款成功或失败和订单超时。测试订单不得授予正式 VIP。
- 用授权的验收账户验证正式权益来源。付款回跳 URL 和客户端“付款成功”声明不能开通 VIP；额度、退款和到期以服务端记录为准。
- 测试每日额度用尽、重复任务、失败返还和北京时间换日；验证非 VIP、过期 VIP 和未配置提供商不能使用平台额度。
- 新导师订单报价、实际收款金额和快照均为原价的 90%；原有订单不重算。9 折表示优惠 10%，不是优惠 90%。后台可设置优惠最多 99%，不支持零元导师 Checkout。
- 部分退款保留权益；累计全额退款仅撤对应订单购买权益；延迟或重复事件不能重新激活已退款或失败订单。
- 最后按审批把函数和数据库都设为 `live`，验证模式、签名 secret 和商户对应，再开启新收款。实际支付与平台模型调用需要单独授权并留存验收记录。

若 Session 创建结果或回包不明，继续读取本人原订单并使用原请求重试，不生成替代请求。超过外部幂等保护窗口仍不明的订单保留并由运营方核对 Stripe，不擅自当作失败删除或重新扣款。

支付行为依据 [Stripe Checkout 交付说明](https://docs.stripe.com/checkout/fulfillment)、[签名回调说明](https://docs.stripe.com/webhooks) 和 [事件类型说明](https://docs.stripe.com/api/events/types)。这些配置步骤不等于支付服务已经上线。
