# Tline 机构研报（增量接入）

站内入口：桌面顶部/移动菜单「机构研报」→ `/research` → `/research/{id}`。复用现有布局与主题，不更改数据库、登录或用户权益。

## 服务端配置

使用 Node.js 22.18+。在 **Next.js 运行进程** 的环境中设置 `TLINE_API_KEY`（名称不能加 `NEXT_PUBLIC_`）。本地也可使用被 Git 忽略的 `apps/web/.env.local`；不要提交真实密钥，不要写到浏览器设置或网页源码中。构建不需要真实密钥。

客户端位于 `apps/web/src/lib/tline/client.ts`，固定调用 `https://tlines.tech/api/v1`，提供 `institutions()`、`researchPage(since,cursor?)`、`researchSince(since,cursor?)` 异步迭代器、`research(id)`、`consensus(ticker)`。HTTP 重定向禁止跟随，避免 Bearer 泄露；错误保留 `status/code/message`，反射密钥会脱敏。

## 本地验证

在已配置好环境变量的终端执行：

```bash
pnpm tline:research
```

先调用 `/institutions`，成功后取运行时最近 7 天的固定 ISO 起点，以 `limit=200`、`nextCursor` 连续翻页并打印标题和机构。中文优先、英文回退；不打印密钥。CLI 从当前进程环境读取密钥，不自动加载 Next.js 的 `.env.local`。

- 401/403 直接失败，不重试；其他非 429 错误也不自动重试。
- 429 支持 `Retry-After` 秒数和 HTTP 日期；缺失/非法头时退避 1、2、4 秒，最多重试 3 次。
- 单次 HTTP 超时 20 秒。支持服务端要求的 60 秒等待；等待超过 120 秒时，不提前重试，返回 `retryAfterSeconds`，应等待该时间后重新运行。
- 空中间页不代表结束；只有 `nextCursor: null` 才结束。重复 cursor/非法响应直接报错。
- 没有写数据库或持久化增量水位。将来做入库同步时，必须完成整个固定 since 窗口后再推进水位，按研报 ID 幂等更新；本次不实现定时采集。

## 网站行为

全部 Tline 请求在 Server Components/服务端模块执行，无浏览器 API 密钥或任意 URL 代理。列表逐页展示，下一页保持同一个 since；正文展示 API 实际提供的摘要、论点、风险、关键数据和解读，不冒充完整原始 PDF。原始报告链接仅作辅助核对，安全地在新标签打开。

相同服务器读取共享 Promise，成功后缓存 60 秒；最多 32 条缓存、4 个不同在途请求。失败不缓存，密钥轮换清除旧响应。翻页窗口限制在最近 8 天以内（给固定 7 天阅读窗口保留一天继续翻页余量），所有上游请求固定 `limit=200`。

缺密钥、无权限、限流或网络失败显示页面错误和重试入口；其他网站页面不受影响。真实接口故障不能用假研报替代。

## 测试

```bash
pnpm --filter @wavekb/web test src/lib/tline src/components/research-list.test.tsx src/app/research/page.test.tsx
pnpm --filter @wavekb/web typecheck
pnpm --filter @wavekb/web lint
# 运行中的本地站点已配置服务器密钥时：
TLINE_LIVE_ACCEPTANCE=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3108 pnpm --filter @wavekb/web exec playwright test e2e/tline.acceptance.spec.ts --workers=1
```

本功能与发帖无关，不执行生产发帖测试。部署前需另行配置服务器运行环境密钥；本地联调不会自动推送代码、创建 GitHub Secret 或更改生产环境。

## 2026-09-05 本地联调记录

- `/institutions` 真实返回 47 家机构；固定起点 `2026-08-29T12:08:52.865Z`，`limit=200` 按游标取完 207 篇研报，终端打印标题和机构，正常退出。
- 初次请求遇到 429、`Retry-After: 60`；按服务端要求等待后成功。页面冷读取可能受第三方限流影响，需要等待，并非即时响应保证。
- 全仓测试 484 项通过；类型检查、ESLint、Webpack 生产构建通过。构建没有注入 Tline 密钥，密钥只在本地运行进程中临时设置。
- 静态资源检查：374 处知识图片引用和 2 本 PDF 全部存在。
- 首轮浏览器测试发现一次上游网络超时，以及测试选择器和 Next.js 路由播报器冲突；页面正确显示失败状态，测试选择器已限定在主要内容区域。不是把失败数据替换为空列表。
- 最终浏览器专项 6/6 通过：桌面/手机导航入口、真实列表→站内详情、非法翻页恢复；同时确认没有浏览器直连 Tline 的请求。导航另覆盖 768/1024px，无横向溢出；已人工查看真实列表和详情截图。另有首页、注册/找回密码入口回归 4/4 通过（没有发送注册或密码重置请求）。
- 仅增量增加研报模块与导航入口，没有改动数据库、用户文件、登录权限、原有发帖逻辑，也没有上线或推送。

## 授权生产发布配置

用户随后要求上线，并明确批准本次仅做只读验收。生产发布使用 `next-preview` GitHub environment 的 `TLINE_API_KEY` Secret（这是既有正式服务的历史环境名称，不代表切换预览站）。构建不接收这个密钥；激活时通过 SSH stdin 传给事务脚本，写入 `/var/backups/wavekb-next-production/<SHA-run-attempt>/tline.env`，权限 `0600`。systemd 额外读取该文件，原 `/etc/wavekb/next-preview.env` 不改动。回滚恢复原 service unit，因此恢复原配置引用；密钥文件与受保护备份一起保留，不进入静态资源包或 Git。

手动发布可显式选择 `read_only_acceptance=true`。默认关闭，普通 push 仍按原差异规则决定是否需要真实发帖。本次手动选项同时跳过真实发帖与会触及登录会话/聊天窗口的 member-shell suite；全量单元测试、类型检查、构建、导航/UI、知识资源、生产研报、版本核对和自动回滚仍执行。禁止把此选项作为以后无条件跳过验收的默认值。

部署前使用 Nginx 只读配置解析，核对 `wavekb.com` HTTPS server 的根路径实际代理到本地 3100（支持同一已解析配置中的命名 upstream），并验证服务 active 和 current 工作目录。配置无法明确解析时停止，不猜测或修改 Nginx。
