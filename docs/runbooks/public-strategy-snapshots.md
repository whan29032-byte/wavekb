# 公开策略图运维

Gateway 使用 `TRADING_PUBLIC_STRATEGIES_ENABLED` 控制预览、发布和访客读取。默认关闭。分享入口还要求私人逐笔成交图表已启用，内测账户同时受 `TRADING_FILL_CHART_PILOT_UIDS` 约束。关闭公开分享开关会撤下公开图表入口，已发布帖子和数据库快照仍可用于后续恢复。

## 发布顺序

1. 核对目标环境的 `wavekb_schema_version()` 和本次提交。当前公开策略图迁移终点为 `202611270005`。后端工作流会校验前置版本、表权限、匿名读取条件和成交评论保护。
2. 在诊断工作流运行 `strategy-pilot-preflight`，确认专用验收账号已绑定可用的只读账户，并有完整的已平仓交易。
3. 保持公开分享关闭，先应用数据库迁移，再发布同一提交的 Gateway 和 Next.js。后端工作流的 `trading_public_strategies` 和 `trading_fill_chart_scope` 默认保留已有配置。
4. 验收时把 `trading_fill_chart_scope` 设为指定的 5–6 位 UID。验证四种隐私组合、重复提交、隐藏帖子后的访客返回、评论和删除。
5. 验收通过后，将 `trading_fill_chart_scope` 设为 `all`，并确认 `trading_public_strategies` 已启用。

## 监测与关闭

Gateway 的 `strategy_preview` 和 `strategy_publish` 事件记录状态码。预览成功会记录字节数和 K 线数量，发布成功会记录是否恢复了原发布，失败只记录固定错误码。图表内容、账户标识、预览令牌和凭证不得进入日志。

需要暂停时，把后端工作流的 `trading_public_strategies` 设为 `disable`。核对健康接口的功能开关及访客快照路由。公共响应每次重用前都须重新校验。单篇帖子的隐藏与删除沿用社区管理流程，快照访问会跟随该帖状态。

## 过期预览清理

每轮交易维护会调用 `purge_expired_strategy_share_previews()`，按过期时间和 ID 最多处理 500 条。预览过期后无法进行首次发布。已使用的回执用于恢复同一次提交。

维护日志中的 `expired_previews` 为本轮清理数量。如果连续多轮均达到 500，可用具备后台服务权限的数据库连接手动调用同一函数。每次查询都是一个独立事务，返回 0 表示本轮没有可清理条目。

```sql
select public.purge_expired_strategy_share_previews();
```
