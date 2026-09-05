# Tline 机构研报：持久目录与后台同步

站内入口为「机构研报」→ `/research` → `/research/{id}`。只增加独立研报 SQLite，不更改 Supabase、用户数据、登录、发帖或上传文件。

## 运行与读取边界

要求 Node.js 22.18+，使用内置 `node:sqlite`（Node 22 仍为实验性）。上传前用实际生产 `/usr/bin/node` 执行内存建表/查询探针；失败停止，不自动升级 Node。

生产路径固定为 `/srv/wavekb-next-preview/data/tline/research.sqlite`，用 `TLINE_RESEARCH_DB_PATH` 显式传入，独立于 releases、public、缓存和开发机。目录归部署服务账号所有，0750；新库0600。拒绝非规范路径/符号链接。

页面以 `readOnly: true` 打开，不创建/修复库、不访问供应商、不调用同步器。SQLite 可维护 WAL/SHM 协调文件；不能用 immutable 忽略活动 WAL。Web unit 使用 `UnsetEnvironment=TLINE_API_KEY`；读取、刷新、分页、搜索和已保存详情不依赖密钥；缺失详情不远程补抓。

列表每页30条，默认最近7天；分页/筛选固定 since/until 窗口。关键词在整个本地窗口内做 NFKC、不区分大小写、多关键词同时匹配，机构按slug筛选。「刷新列表」保留筛选、重置窗口/页码，只读取最新本地快照。正文只展示实际保存的分析，不冒充完整PDF。

显示最后成功时间；超过20分钟提醒延迟，失败继续展示已有内容。长期失联显示最后成功时的7天快照。未初始化显示准备状态，不制造研报。

## Worker 与增量语义

源码CLI：`pnpm tline:sync`（默认sync），或 `node scripts/tline-sync.mjs status`、`node scripts/tline-sync.mjs backup /absolute/private/snapshot.sqlite`。所有命令必须提供 DB 路径；只有sync需要进程环境中的 `TLINE_API_KEY`。不自动加载 .env.local；不把密钥写进 argv、日志或Git。

standalone 包含 `apps/web/tline-worker/cli.mjs`：显式复制CLI与client/store/sync三个.ts模块，保持源码相对导入。Node22.18原生类型剥离，不依赖开发工具；不复制测试、fixture初始化或数据库。

每轮先获取机构，再完整遍历since/cursor（200条/页）。首次since为开始前7天，后续为成功水位减10分钟。按ID幂等更新，完整成功后短事务发布，水位取开始时刻。请求期间没有长SQL写事务。最多50页/10,000条/8分钟；失败不推进水位、不删旧内容。

SQLite非阻塞租约保证单写者。`locked/deferred` 是正常运维跳过，但CLI exit0不等于完成同步：发布预热必须返回 `status: synced`，随后readonly status必须返回相同、有效lastSuccess。429长退避持久化retryAt，不提前绕过；401/403不重试。上游只有since语义，窗口外静默修订/删除不承诺自动发现；不自动清除历史。

## 事务发布顺序

`deploy-next-production.yml` 的历史名称 next-preview 指真正wavekb.com生产，不是沙盒。实施前核实线上基线为 `c1ead90`；每次仍重新核实实际live SHA、Nginx目标与current。

1. 全仓测试/类型/Lint/构建；actual Node22.18 standalone worker smoke；持有临时SQLite的standalone桌面/手机浏览器验收；导航/UI/知识资源门槛。构建不接收生产key/DB。
2. 固定指纹SSH只读核实生产服务、Nginx、实际Node/SQLite；全部通过后才上传。
3. 保留旧完整代码/静态archive、web unit原文/权限/live SHA；记录sync service/timer存在、原文/权限、active/enabled。未管理路径、drop-in、masked/runtime-enabled等无法精确恢复的配置fail closed，交人工核实。
4. 先停timer，active/activating旧oneshot最多等待540秒自然完成，再stop。超时不杀写者、不清租约，恢复原timer，旧网页不中断。已有库由服务账号SQLite VACUUM INTO生成同目录私有快照；关闭后root将一致快照复制到受保护备份目录，避免root在live库旁创建WAL/SHM，也不让服务账号写root备份目录。
5. GitHub environment key经SSH stdin写入版本专属 `/var/backups/wavekb-next-production/<SHA-run-attempt>/tline.env`（0600）。原 `/etc/wavekb/next-preview.env` 字节不变。systemd/root读取补充文件；worker不接收整站认证/Supabase环境。独立候选oneshot预热（systemd540秒上限），synced和lastSuccess复核后持久记录preheatComplete。
6. 原子切换current/web，安装 `wavekb-tline-sync.service` 和timer。worker仅能写研报目录；10分钟日历计划 `OnCalendar=*-*-* *:0/10:00`、`Persistent=true`。预热和web health/version成功之后才启用timer，检查下次计划、worker Result和本地状态。
7. 公网SHA、本地目录/30条分页/搜索/详情、知识资源与只读浏览器验收后finalize；再次检查timer/库。仅清理超过14天、不属于current/previous的明确识别releases。保留代码备份、SQLite快照、配置key和回滚元数据；cleanup不访问data目录。

所有版本共享同一数据库路径。备份失败、warmup失败或locked/deferred不能授权切换。首次合法空结果也可以成功，不得以合成数据代替生产预热。

## 回滚与验收

使用版本专属 retained `wavekb-deploy-<SHA-run-attempt>.mjs`，runner没有可能被新版覆盖的共享helper依赖。恢复exact previous current/web unit；warmup阶段失败不重启旧web。恢复此前sync/timer文件/模式/启用运行状态；此前正在执行的oneshot通过同一个systemd service安全排队一次，不恢复被中断的中间指令。首次新增managed units停用并删除，研报库/备份均保留。

finalize后普通失败任务rollback不覆盖已接受版本。人工rollback-accepted必须确认exact previous SHA且current仍为该候选。若恢复失败保留rolling-back元数据供重试，不声称已恢复。

回滚至c1ead90恢复按请求访问供应商的旧实现及旧unit/key配置引用，因此不保证上游离线可读。更早258dfcf若引用已撤销key，也不能保证研报可用。任何回滚不清空SQLite、用户数据库或上传。

本次人工批准read_only_acceptance=true，不执行真实发帖/member-shell变更验收；后续发布仍按live-base差异规则。报告必须区分“timer已配置、首次预热成功”与“已观察到后续真实定时执行”，不能把计划存在当作已运行证据。

## 本地与CI

构建前须提供 workflow 已有的公开 NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY；它们被编译进客户端，仅在启动时补充不能修复缺失的浏览器配置。TLINE_API_KEY 在构建与 fixture 验收中显式设为空。

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm dlx node@22.18.0 scripts/smoke-tline-worker.mjs
TLINE_E2E_FIXTURE=1 TLINE_E2E_STANDALONE=1 TLINE_API_KEY='' pnpm --filter @wavekb/web exec playwright test e2e/tline.acceptance.spec.ts --workers=1
```

fixture由Playwright独占本地服务器，拒绝PLAYWRIGHT_BASE_URL/live组合，reuseExistingServer=false；已有端口导致失败而非复用。临时DB位于规范系统tmp目录，owner token匹配才允许publish；helper拒绝已存在DB，退出清理其拥有的DB/WAL/SHM/owner。SIGKILL/掉电无法执行清理；遗留路径需人工核实，下次不会覆盖。不要指定真实数据或使用--workers=2。

已同步生产站的只读验收另用 `TLINE_LIVE_ACCEPTANCE=1 PLAYWRIGHT_BASE_URL=https://wavekb.com`，不启用fixture、不启动sync或发帖。真实部署、上游预热与后续timer观察由获授权发布控制者执行。
