# Discord 账号绑定设计

## 目标

让 WaveKB 成为网站用户资料的唯一事实来源，并让“悠悠的宝宝”通过受限接口读取已绑定用户的公开身份与积分数据。Discord 原有经验、等级和科学侧/魔法侧路线继续保存在机器人本地，不回写网站。

## 绑定流程

1. 机器人以共享密钥调用 `POST /api/integrations/discord/link`，提交 Discord 用户 ID 和服务器 ID。
2. 网站生成 32 字节随机令牌，只保存 SHA-256 哈希，并返回 10 分钟有效的 `/account/discord-link?token=...` 地址。
3. 用户在浏览器登录 WaveKB 后确认绑定；同源 POST 调用数据库事务函数兑换令牌。
4. 事务锁定令牌并校验未过期、未使用、未撤销，将 Discord ID 写入当前网站账户，并将令牌标记为已兑换。

## 数据契约

机器人通过 `GET /api/integrations/discord/member?discordUserId=...` 查询。成功响应只包含：

- `uid`：网站公开 UID。
- `displayName`、`avatarUrl`。
- `displayTitle`、`nameplateStyle`。
- `points.balance`、`points.lifetimeEarned`。

不得返回邮箱、手机号、Supabase 用户 UUID、会话信息或管理员审计字段。未绑定返回 404；封禁账户返回 403。

## 安全边界

- 机器人接口使用 `Authorization: Bearer <DISCORD_BOT_API_SECRET>`，通过定时安全比较校验。
- Supabase service-role key 只存在于 `server-only` 模块与服务器环境变量中。
- Discord 用户 ID 和服务器 ID 必须是 17–20 位十进制 snowflake；绑定服务器必须等于配置的服务器 ID。
- 原始令牌不落库、不写日志；令牌哈希为 64 位小写十六进制。
- 每个 Discord ID 最多绑定一个网站账户。网站账户可以用新的有效令牌改绑到尚未被占用的 Discord ID。
- 兑换 POST 必须为同源请求，数据库函数依赖当前已认证的 `auth.uid()`，并拒绝匿名、封禁账户、过期、重放和冲突。
- 所有接口均返回 `cache-control: no-store`，内部错误使用稳定错误码，不回显密钥或数据库细节。

## 数据库

`profiles` 增加 `discord_user_id` 和 `discord_linked_at`；`discord_user_id` 建立非空唯一索引。新增启用 RLS 且无客户端策略的 `discord_link_tokens` 表，记录哈希、Discord 用户/服务器、过期、撤销和兑换审计时间。`redeem_discord_link_token(text)` 为仅 `authenticated` 可执行的 `security definer` 函数。

## 页面体验

`/account/discord-link` 是服务器页面。未登录时保留完整返回地址跳转登录；已登录用户可看到当前公开 UID 和确认按钮。成功、过期、已使用、冲突和通用失败均显示明确状态，且成功后 URL 不再携带令牌。

## 运维配置

网站运行环境需要：

- `SUPABASE_SERVICE_ROLE_KEY`
- `DISCORD_BOT_API_SECRET`
- `DISCORD_BOT_GUILD_ID`
- 可选 `DISCORD_LINK_PUBLIC_ORIGIN`，默认使用请求来源

这些变量不得使用 `NEXT_PUBLIC_` 前缀，也不得提交真实值。
