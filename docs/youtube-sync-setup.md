# YouTube 绑定与视频同步配置清单

## 当前交付边界

这是默认关闭的接入代码，不是已经获得 Google 授权或已经上线的同步服务。
绑定入口位于「个人资料」。通过 Google 只读授权验证频道归属，只支持每个站内账号一个频道，
频道也不能同时绑定不同站内账号；不能仅粘贴频道链接冒用他人频道。
仅支持当前 OAuth 账号通过 YouTube API 可确认拥有的频道，不将 Studio 的编辑/经理权限当作所有者。

用户分别同意：导入全部历史公开视频、后台自动发布新公开视频。历史默认勾选，新视频自动同步默认不勾选，
必须由用户明确选择。历史视频分批、可恢复地导入「观点分享」，不是绑定后一次性发布全部。
暂停按钮只暂停新视频自动发布；已经请求的历史导入继续，解绑可停止全部并移除这项连接生成的帖子。
不下载视频、不重新上传、不使用 AI 改写；帖子使用原视频标题、说明及 YouTube 播放链接。

## Google Cloud 配置

1. 创建**专门用于 YouTube 同步**的 Google Cloud 项目，不复用含其他敏感服务的项目。
   Google 的程序化授权撤销可能影响同一项目其他 OAuth 客户端的授权。
2. 启用 **YouTube Data API v3**。配置 Google Auth Platform 的 Branding、Audience 和 Data Access。
   添加生产域名 `wavekb.com`，按 Google 要求验证域名、提供真实可访问的隐私政策及服务条款。
3. 创建 **Web application** 类型 OAuth 客户端，授权重定向 URI 精确填写：
   `https://wavekb.com/api/youtube/callback`。不添加通配符、不使用浏览器访问的 Gateway 内网地址。
4. 仅申请 `https://www.googleapis.com/auth/youtube.readonly`。代码使用 offline access、
   随机 state、S256 PKCE、10 分钟一次性状态及服务端账号绑定；不需要用户提供 Google 密码。
5. 初测时加入由管理员控制的测试用户。要开放给所有网站用户，需按 Google 当前要求完成应用发布与
   OAuth 验证。外部应用停留在 Testing 时，相关 refresh token 通常 7 天到期，不能视为长期无人值守部署。
6. **上线前补齐实际公开隐私政策**，说明 Google/YouTube API 数据、加密 refresh token 的使用、
   服务端存储、同步帖子、暂停/解绑、删除期限、Google 授权撤销入口；本清单不是已发布的隐私政策。

官方依据：[Web server OAuth](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps)、
[频道归属查询](https://developers.google.com/youtube/v3/docs/channels/list)、
[OAuth token 期限与撤销](https://developers.google.com/identity/protocols/oauth2)、
[YouTube API 开发者政策](https://developers.google.com/youtube/terms/developer-policies)。

## 服务端配置

只在服务器 `/etc/elliott-wave/gateway.env` 设置，不放进浏览器、Git、截图、聊天或 `NEXT_PUBLIC_*`：

| 配置 | 值 / 说明 |
| --- | --- |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | 已有服务器数据库配置 |
| `YOUTUBE_SYNC_ENABLED` | 初始 `false`；真实 OAuth 验收通过后才设为 `true` |
| `YOUTUBE_OAUTH_CLIENT_ID` | Google Web OAuth Client ID |
| `YOUTUBE_OAUTH_CLIENT_SECRET` | 对应 Client Secret，服务器专用 |
| `YOUTUBE_OAUTH_REDIRECT_URI` | `https://wavekb.com/api/youtube/callback` |
| `YOUTUBE_TOKEN_MASTER_KEY` | 独立随机 32 字节密钥的标准 base64，不复用 AI / 交易密钥 |
| `YOUTUBE_SYNC_POLL_SECONDS` | 默认 `600`，可设 `300`–`900` 秒 |
| `YOUTUBE_SYNC_MAX_PAGES_PER_CONNECTION` | 默认每次每连接最多 `2` 页，范围 `2`–`5`，保证最新页与续页都能进展 |
| `YOUTUBE_SYNC_MAX_CALLS_PER_POLL` | 默认每轮最多 `20` 次 Google 调用，最多 `100`，最低 `5 + 2 × ceil(50 / 批次大小)`，默认批次下最低 `7` |
| `YOUTUBE_SYNC_BATCH_SIZE` | 默认 `50`，范围 `1`–`50` |

运维可在安全终端用 `openssl rand -base64 32` 生成专用主密钥，并直接保存到服务器配置，不输出到 CI 日志。
改变主密钥前必须制定 token 重加密/重新授权方案；不能随便替换后仍假定既有授权可用。
Next 仅使用已有服务端 `AUTH_GATEWAY_INTERNAL_URL` 访问 Gateway，不持有 Google Secret 或数据库 service role。

默认后台每 10 分钟启动一轮，历史和增量分页游标分别保存，有全局调用预算、租约、退避和超时。
这是**轮询首版，不是实时 WebSub 推送**，10 分钟不是所有用户的保证延迟。
用户数/历史量增加时须根据真实配额和积压调大预算或设计分区 worker，不能无限缩短间隔。
频道历史很长时多轮导入；途中重启从已确认游标继续，响应不完整不推进游标。
无论历史是否导入完成，每轮先检查最新一页，再处理续页，避免旧视频队列阻塞新视频。
默认每轮只处理一项已排队授权撤销；批量用户上线前应按实际排队量验证撤销处理容量。

## 内容与授权保护

- refresh token 使用独立 AES-GCM 密钥加密，密文绑定站内 owner 与频道；浏览器不读取 token。
- 自动发帖遵守账号激活、已验证邮箱、UID、禁言和封禁限制，service role 不能绕过这些业务规则。
- 视频归属、公开状态由 API 验证，再由数据库复核；private/unlisted 不导入。
- 来源唯一记录和原子事务避免重复帖子，用户删除的同步帖保留不含视频详情的哈希墓碑，不会重新生成。
- 普通手工发帖规则保持不变；自动同步帖不因批量历史导入获得发帖积分。
- 每天分批复核已同步视频；私有化、删除或撤销授权时清理生成内容。不把网络错误当成视频已删除。
- 原始 API 元数据超过 30 天未复核会停止公开读取并清理，数据库读取策略不是只依赖 worker 正常运行。
- 暂停新增视频不停止已有元数据复核。全局关闭同步时仍执行本地过期清理，密钥仍可用时处理已有撤销队列。
- 解绑立即停止站内发布并移除该连接生成的帖子，手工帖子不受影响。Google 授权撤销使用独立重试队列，
  界面明确显示处理中；仅保留用于撤销的加密 token 最多 7 天，失败到期会要求用户手动移除 Google 授权。
  手动入口：[Google 第三方连接](https://myaccount.google.com/permissions)。

## 发布与真实验收

1. 先合并导师流程依赖 PR，再审核本批 PR；当前 PR/本地测试不等于上线。
2. 同一 SHA 的 Ubuntu release 检查全部通过后，先执行后端工作流：精确迁移到
   `202610080004_youtube_auto_posts.sql`，最终公共 marker 为 `202610080004`。
3. 发布同一 SHA 的 Gateway 与 `elliott-wave-youtube-sync.service`，保留旧代码和 systemd unit 回滚副本。
   配置缺失时保持关闭，不领取新同步任务，不产生 Google 绑定/扫描流量。
4. 最后发布同一 SHA 的 Next 前端，再在 HTTPS、已登录的受控站内账号上完成真实 Google 回调。
   检查单次 state、CSRF cookie、频道归属、后台 refresh 和生产客户端的 PKCE 兼容。
5. 用受控频道验证：历史超过 50 条的分页、新视频出现、重复轮询、暂停新视频、补导、私有化、
   站内删帖不复活、禁言不能发布、解绑删除及真实 Google 授权撤销。
6. 记录真实帖子 ID/来源/游标/授权状态的脱敏回执，验收后清理测试内容。
   数据库夹具、mock Google HTTP、Storybook 预览不能替代这些真实证据。

本批不改 Hermes、交易订单、持仓、风控、Bitget 凭据或交易通知。
