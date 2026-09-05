# WaveKB 全站可靠性修复与发布验收

日期：2026-09-05。基于正式版本 `9f2625ecd70d796fae3254e8588d832668f344dd`，按用户要求直接在当前 main 目录修复。本文不包含生产账号、收款数字、会话正文、私密草稿或审计截图。

## 范围与数据边界

- 保留 Next.js App Router、React、TypeScript、Tailwind、Supabase 及现有路由。
- 不执行数据库迁移，不替换生产环境变量、用户上传文件、账号、积分、铭牌所有权或真实收款配置。
- 未改变注册、登录、密码找回和后台权限规则；仅修复客户端账号切换的异步状态竞争。有限的社区板块路由校验在流式渲染前返回真实 404。
- 保留铭牌金属材质、光泽、动态边框、头像框、昵称/签名效果与黑金驱动浪；UID 使用稳定清晰的文字色。减少动效保留静态材质，不退化为纯文字。
- 外观验收使用隔离的本地/CI 浏览器；不修改用户当前生产浏览器的主题和佩戴设置。

## 本批修复

| 模块 | 修复内容 | 主要文件（仓库相对路径） |
| --- | --- | --- |
| 好友与聊天 | 共用 Presence 生命周期；退出/切换账号丢弃过期响应；未读仅在可见窗口确认；粘贴/拖入图片及无 MIME 文件处理；共享提示音设置容错；好友计数排除待处理请求；表情摘要统一解析 | `src/hooks/use-member-presence.ts`、`use-social-sound.ts`、`src/components/social-desktop.tsx`、`friend-directory.tsx`、`message-thread.tsx`、`chat-message-body.tsx`、`src/lib/member/chat-*` |
| 资料与铭牌 | 头像盖在封面上方；装备后全站身份失效重读；服务端新权益/余额同步到客户端；账号隔离；同账号刷新不吞未保存资料；商城与个人资料真实效果预览 | `src/components/profile-editor.tsx`、`nameplate.tsx`、`account-navigation.tsx`、`reward-center.tsx`、`src/lib/member/identity-events.ts` |
| 主题与移动端 | 干净白灰底色；自定义色生成明暗派生与前景色；首屏脚本与运行时算法一致；减少动效持久化；外观弹窗约束视口、Esc/外部关闭；移动导航可达 | `src/app/globals.css`、`layout.tsx`、`src/lib/appearance*.ts`、`src/components/appearance-settings.tsx`、`mobile-navigation.tsx`、`site-header.tsx` |
| 工作台 | 修正回撤空值/负数/非有限数；金额和比例分别统计；端点方向检查；撤掉固定假分数；输入变化清除旧派生结果；本地草稿按账号/记录隔离及冲突提示；TradingView 配置恢复；列表分页与精确统计 | `src/lib/workbench/*`、`src/components/workbench-analysis-editor.tsx`、`private-entry-editor.tsx`、`private-entry-chart.tsx`、`src/app/workbench/page.tsx` |
| 导师 | 区分币安 UID 和链上收款；已明确的 binance 数字 UID 不使用残留 network 作支付路由；有歧义配置禁用；付款声明可追踪；未知请求保存核对标记/已返回订单号；读取现有 RLS 下买方声明及待核实订单；防止轻易重复提交 | `src/components/mentor-checkout.tsx`、`mentor-payment-status.tsx`、`mentor-thread.tsx`、`src/lib/mentor/payment-status.ts`、`client-repository.ts` |
| 社区与商城后台 | 社区/个人公开内容/评论稳定分页；卡片列表不取详情图表大字段；积分明细时间和任务规则说明；已有当前称号不重复兑换；AI 设置异步提交保留实际表单引用，连接状态不伪报在线 | `src/lib/community/server-repository.ts`、`src/lib/pagination.ts`、`src/components/pagination.tsx`、`admin-ai-center.tsx`、`src/app/community/*`、`src/app/member/[uid]/page.tsx` |
| 发布 | 按真实线上 SHA 判断验收范围；只读 schema 检查；gateway 变化中止；本地验证先于服务器上传；独立发布目录；完整前版代码与静态文件备份；外部验收失败回滚；缓存单独可写；验收后才清理 | `.github/workflows/deploy-next-production.yml`、`scripts/deploy-preflight.mjs`、`scripts/deploy-release.mjs`、`tests/deploy-*.test.mjs` |

表中 `src/` 均位于 `apps/web/`。完整文件清单以本次 Git 提交为准，相关行为回归测试与组件同目录。

## 本地验收

- 使用测试驱动和独立交叉审查；异步账号、表单草稿、付款未知结果、缓存权限及发布事务问题均增加失败后通过的行为回归。
- Storybook 隔离 UI：12/12；包含 320/375/768/1440px 头像、外观浮层、移动导航、明暗自定义主题、系统及用户减少动效。
- standalone 桌面/移动关键路由：28/28；覆盖首页分区、个人公开主页、登录/注册/找回密码表单、匿名权限、导师目录、知识查看器与书目 PDF MIME，以及 Nginx HTTPS 转发头下的无效板块 404。
- 静态知识资源：374 个图片引用及 2 本 PDF 全部存在。分页图片和原始 PDF 分开判断。
- 本机默认 Turbopack 曾因内部端口环境限制失败，采用官方 Webpack 构建通过；正式 CI 仍要求默认构建通过，不以本机替代结果冒充默认构建成功。
- 本地 standalone 的首轮运行遗漏公开 Supabase 环境配置而失败，已按 CI 的公开配置重建重跑；未修改生产环境配置。
- 最终全量本地自动化测试：460/460（根目录 115、gateway 60、domain 14、knowledge 5、web 266）；全部 workspace 类型检查和前端 ESLint 通过。补充身份兼容后重新通过生产构建、28 项导航和 12 项 Storybook UI 检查，不以本地通过代替上线完成。

## 生产路由与回滚边界

只读路由审计 [Actions 33959992086](https://github.com/whan29032-byte/wavekb/actions/runs/33959992086) 确认正式 `wavekb.com`：Nginx `/` 指向 `127.0.0.1:3100`，`/v1/` 指向 `127.0.0.1:8787`。`wavekb-next-preview.service` 的历史名称不代表预览页面；本次保留正式服务和 Nginx 路由。

发布环境回归曾发现 GNU tar 权限受 umask 影响，已使用显式权限恢复修复。随后生产验收发现 Next.js 对 HTTPS 转发头下的 loopback 404 重写产生 EPROTO；本地完整 Host/Forwarded 头已复现。失败运行 `33961398348` 自动恢复原 `9f2625e`，健康检查确认；无效板块现直接返回无用户插值的静态 404，正常路径与鉴权不变。真实发帖在该失败运行中尚未开始。

运行 `33961931003` 的发帖及两项鉴权验收通过，但聊天拖动后覆盖了测试要点击的好友管理链接，未通过全部门禁，因此自动恢复 `9f2625e`。验收改为真实最小化/恢复窗口操作，仍检查客户端路由切换和原 DOM 持久化，不使用强制点击。

上线只读检查另证实生产缺少 `get_public_post_profiles`（PGRST202），而现有 `search_profile_by_uid` 返回真实佩戴铭牌。补充共享公开身份兼容层：仅缺函数时通过既有 basic projection 查 UID，再有界并发读取旧公开接口；核对 ID/UID，限制输出公共身份字段。顶部、帖子/评论/时间轴和聊天同步使用它。无数据库迁移、不猜测权益、不以网络或权限错误触发降级。新增浏览器断言要求顶部及每张本人 PostCard 与 Hero 铭牌一致，避免缺失身份被空循环漏检。

发布前受保护备份：`/var/backups/wavekb-next-production/SHA-runid-attempt/`，包含旧版完整代码/static/public、原 systemd 文件及精确旧版本的回滚元数据。保留当前与 previous 目录。发布事务和操作命令见 `scripts/deploy-production-plan.md`。

## 明确保留的限制

- 不声称实现尚未建立的波浪评分模型或楔形专用算法，界面已明确显示未评分/未支持，避免假结论。
- TradingView 导入恢复本站保存的配置；不能恢复其平台未公开的私人绘图。刷新后的新选二进制图片仍需重新添加。
- 付款流程没有新增服务器幂等约束，不能承诺跨设备严格 exactly-once。无订单号的未知结果要求人工核实；不会把“未查询到”当作付款失败。
- 未进行真实付款、商城扣分兑换、生产资料保存或新增好友/聊天发送测试。必要的真实发帖仅在专用验收账户与受控测试记录内执行；不将其等同于其他生产写入测试。
- 只读 schema 标记一致不等于对所有生产 RLS 做了穷尽测试。现有数据与权限继续由既有数据库约束保护。
- 本批是既有功能和已确认缺陷的修复，不声称全站没有任何未知 bug，也未做与本任务无关的整站视觉重设计。
