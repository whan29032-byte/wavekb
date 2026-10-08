# 一次性实际邮件投递验收

导师订单提醒依赖前置导师 PR 的私有通知队列。当前手工支付流程只有“学员声明已付款”，
不等于到账；不能为了测邮件创建假付款订单，也不能发给不受控的真实导师。

本批新增 `Verify one mentor email delivery` 手动工作流和独立一次性验收器。
默认 `check-config` 只检查发信配置存在性；`send-once` 必须填写一个由请求者控制的收件地址及
`SEND_ONE_TEST_EMAIL`。测试主题明确为“邮件投递测试（非订单通知）”，不创建订单、
付款声明、权益或队列任务，不开启导师通知 worker。

服务器必须先在 `/etc/elliott-wave/gateway.env` 安全配置：

- `MENTOR_EMAIL_API_KEY`：Resend 服务端发信密钥。
- `MENTOR_EMAIL_FROM`：已验证发件域的真实发件地址。

不要把密钥提交到 Git 或发到聊天里。收件邮箱不写入代码。
发信域的 DNS 验证、SPF/DKIM/DMARC 与发信权限由运维按服务商控制台验证。
业务邮件配置与 Supabase 登录/验证码发信配置是两回事。

工作流只上传隔离测试器，SSH 固定主机指纹，读取服务器现有发信配置。
每个工作流 run 使用一个稳定 UUID；重跑同一 run 不重发已被服务商接受的邮件。
发信前写入永久脱敏回执，`mentor-email-smoke:<UUID>` 与付款提醒幂等键隔离。
已尝试但响应不明确的请求，仅在 23 小时内用相同 envelope 与幂等键重试；超过期限拒绝重发。
回执目录 `/var/lib/elliott-wave-gateway/mail-smoke/` 只保存测试编号、时间、envelope 哈希、
状态及服务商消息 ID，不保存密钥、邮件正文或明文收件地址。

## 证据层级

1. `blocked_unconfigured`：没有发信密钥/发件地址，**没有发送**。
2. `accepted`：服务商 API 接受请求，**不代表实际送达**。
3. 对相同消息 ID 的查询 `last_event=delivered`：收件服务器接收，仍不保证出现在收件箱而非垃圾邮件。
4. 收件人实际打开 Gmail 并看到邮件，才是收件箱验收；验收器不会自动声称这一项完成。

send-only key 无法查询时，记录 `not_permitted` 而不是要求扩大生产 key 权限。
遇到限流不自动重复发送。查询失败也不把 accepted 提升为 delivered。
官方接口：[发送](https://resend.com/docs/api-reference/emails/send-email)、
[读取消息投递状态](https://resend.com/docs/api-reference/emails/retrieve-email)。

## 已确认的生产阻塞

2026-10-08 12:55 UTC 只读服务器核查成功：`MENTOR_EMAIL_API_KEY`、`MENTOR_EMAIL_FROM`、
`MENTOR_EMAIL_ENABLED` 均未配置，YouTube 配置也未配置。
[本次脱敏核查回执](https://github.com/whan29032-byte/wavekb/actions/runs/37780329985)。
因此本批**尚未发出真实测试邮件**。代码/工作流测试通过不替代实际投递。
配置后可按已授权收件目标执行一次测试，再等待服务商回执与收件人确认。
新工作流需要先进入默认分支、获得所需环境访问后才能正常手动触发。
