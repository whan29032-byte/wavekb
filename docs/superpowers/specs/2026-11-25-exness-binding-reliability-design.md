# Exness 绑定可靠性修复设计

## 意图

修复用户填写正确 Exness 只读凭据后仍只能看到笼统失败提示的问题，使绑定请求使用 Exness Key Management 中 DNS Widget 给出的 Gateway Host，并把安全、可操作的官方认证错误反馈给用户。

## 目标

- 用户必须填写当前 Exness API Key 对应的 HTTPS Gateway Host。
- 接受 Exness 生成的 128 位十六进制 Ed25519 私钥和无加密 PKCS#8 PEM。
- 十六进制私钥允许安全地去除首尾空白，但必须验证 seed 与 public half 匹配。
- API Key 无效、签名错误、权限拒绝、限流和上游不可用必须得到不同的固定错误码与中文提示。
- 错误响应、日志和测试不得回显 API Key、私钥、账户 ID 或上游响应正文。

## 非目标

- 不增加交易写权限。
- 不自动猜测、抓取或持久化 DNS Widget Host。
- 不改变其他交易所的凭据流程。

## 方案

采用用户显式填写 Gateway Host 的方案。相比继续硬编码官方示例域名，这符合 Exness 官方要求并适配账户或区域差异；相比服务端接受任意 URL，后端继续只允许 HTTPS 且主机必须属于 `exness.com` 或 `exness-api.com`，避免 SSRF。

前端展示字段说明和明确错误；后端保持最终安全边界，规范化私钥、验证账户 ID、校验 Host，并仅透传固定白名单错误码。

## 成功标准

- 缺少 Gateway Host 时客户端和服务端都拒绝请求并说明如何获取。
- 官方 128 位私钥的 seed/public half 不匹配时，在发出网络请求前拒绝。
- Exness `1000`、`1001`、`1002` 分别显示 API Key、签名、权限/账户访问提示。
- 现有 Exness 请求签名、动态历史窗口和其他交易所测试继续通过。
