# AI 网关运维手册

## 运行边界

网关是浏览器与外部模型之间唯一允许的中转层。每个用户可以连接自己的模型接口，但 API Key 只在网关内加密处理；数据库 service role 和主加密密钥只能存在于服务器环境变量。静态网站只能保存 Supabase publishable key 和网关公开地址。

知识库属于网站本身。每次任务由服务器从随 Gateway 发布的
`knowledge/retrieval-index.json` 检索三本已发布图书的最小必要上下文，再发送到该用户选择的模型。
外部模型不能直接修改正式知识库。

## 必需环境变量

复制 `.env.example` 后填写服务器环境。`AI_SECRET_MASTER_KEY` 必须是随机 32 字节值的 Base64 编码。不要把实际 `.env` 提交或复制到网站目录。

## 数据库

按顺序部署 `supabase/migrations/`。AI 控制中心依赖：

- `202607260004_workbench.sql`
- `202607260005_ai_control_center.sql`

密钥表没有 `anon` 或 `authenticated` 策略。worker 通过 service role 领取任务；普通用户只能读取自己的任务、尝试和费用记录。

## 本地启动

运行时使用 Node.js 22 或更高版本：

```sh
node src/server.ts
```

默认监听 `127.0.0.1:8787`。健康检查为 `GET /health`。只有 `ALLOWED_WEB_ORIGINS` 中的站点来源会收到跨域许可。

## 密钥轮换

1. 用户在“我的 AI 接口”写入新密钥；接口不提供明文读取。
2. 服务器先校验地址和新凭证。
3. 新密钥用 AES-256-GCM 写入，并增加 `key_version`。
4. 新密钥生效后停用旧密文。
5. 日志只保留末四位，禁止记录请求认证头。

## 任务与故障切换

- 每个任务有唯一幂等键。
- 401/403 不使用同一凭证重试。
- 超时、429 和 5xx 可按路由设置切换备用模型。
- 每次尝试记录实际模型、延迟、错误分类、Token 与费用。
- 单次费用或月度预算达到上限时停止调用。

## 多书 AI 发布与验收

必须对同一个 `main` 提交按“Backend → Next”顺序发布。先等待该 SHA 的 Ubuntu
`Verify WaveKB release` 工作流通过，再手动运行 `deploy-backend-production.yml`，输入
`DEPLOY_WAVEKB_BACKEND` 并通过 `production` 环境审批。Backend 成功后，才可手动运行
`deploy-next-production.yml`，将 `gateway_release_approved` 设为 `true` 并完成 Next 环境审批。
任何一步失败都停止后续发布。

Backend 必须先发布，因为新 Gateway 同时接受版本 2 请求和未携带 `request_version` 的旧 Web
请求；旧请求会规范化为 `knowledge_scope: { "mode": "all" }`。因此 Backend-first 窗口兼容旧 Web，
Next-first 则没有这个保证。本次多书检索复用现有 AI 表和字段，不新增或执行数据库迁移；发布门禁只接受
精确 schema marker `202609090001`，任何更旧或更新的未知 marker 都应 fail closed。

Backend 归档只包含 `package.json`、`src/`、`knowledge/retrieval-index.json` 和
`DEPLOYMENT_VERSION`。上传前必须通过知识 artifact freshness、Gateway test/typecheck 和脱离源码 checkout
的归档 smoke；不得把原始 PDF、`.env`、service-role key、模型 API key 或其他 secret 放入归档。

设置已授权的测试用户、已有分析和同一发布 SHA 后，分别提交 all 与 strict single smoke。每次人工请求使用
新的 UUID；下面的 Bearer token 不得写入 shell history 或日志：

```sh
export RELEASE_SHA='<40-char-main-sha>'
export TEST_ANALYSIS_ID='<owned-workbench-analysis-uuid>'
export GATEWAY_BEARER_TOKEN='<short-lived-test-user-token>'

curl --fail --silent --show-error \
  -H "authorization: Bearer ${GATEWAY_BEARER_TOKEN}" \
  -H 'content-type: application/json' \
  -d "{\"request_version\":2,\"client_request_id\":\"$(uuidgen)\",\"task_type\":\"wave_analysis\",\"step\":5,\"analysis_schema_version\":\"workbench-v1\",\"knowledge_scope\":{\"mode\":\"all\"}}" \
  "https://wavekb.com/api/ai/analyses/${TEST_ANALYSIS_ID}/ai-run"

curl --fail --silent --show-error \
  -H "authorization: Bearer ${GATEWAY_BEARER_TOKEN}" \
  -H 'content-type: application/json' \
  -d "{\"request_version\":2,\"client_request_id\":\"$(uuidgen)\",\"task_type\":\"wave_analysis\",\"step\":5,\"analysis_schema_version\":\"workbench-v1\",\"knowledge_scope\":{\"mode\":\"single\",\"book_id\":\"chan-theory-complete\"}}" \
  "https://wavekb.com/api/ai/analyses/${TEST_ANALYSIS_ID}/ai-run"
```

轮询每个响应中的 job ID，直到状态终结。all 必须返回服务器展开的引用；single 的每条 citation
`book_id` 必须严格等于 `chan-theory-complete`，不能出现跨书引用。随后用只读审计查询核对 scope、发布的
知识版本、服务器生成的 query、命中的 knowledge/source IDs；将两个 job UUID 作为参数传入，不要放宽到全表：

```sql
select
  j.id,
  j.status,
  j.input_payload -> 'knowledge_scope' as knowledge_scope,
  j.knowledge_version,
  r.query,
  r.knowledge_ids,
  r.source_ids,
  r.context_hash,
  r.created_at
from public.ai_jobs as j
join public.knowledge_retrievals as r on r.job_id = j.id
where j.id in ('<all-job-uuid>', '<single-job-uuid>')
order by r.created_at;
```

必须同时精确核验 Gateway 和公开 Next health 的 SHA，不能只检查 HTTP 200：

```sh
curl --fail --silent --show-error http://127.0.0.1:8787/health |
  RELEASE_SHA="$RELEASE_SHA" node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const h=JSON.parse(s);if(h.ok!==true||h.deployment!==process.env.RELEASE_SHA)process.exit(1)})'
curl --fail --silent --show-error https://wavekb.com/api/health |
  RELEASE_SHA="$RELEASE_SHA" node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const h=JSON.parse(s);if(h.ok!==true||h.deployment!==process.env.RELEASE_SHA)process.exit(1)})'
```

Gateway 激活失败时工作流会读取该 release 的
`/var/backups/elliott-wave-gateway/<release-id>/previous-release`，用临时 symlink 原子替换
`/opt/elliott-wave-gateway/current`，恢复备份的 systemd units 并重启服务。人工回滚也必须使用这个已记录的
previous 路径，先确认目录和 `DEPLOYMENT_VERSION`，再以 `ln -sfn` + `mv -Tf` 原子切换；禁止猜测
`releases/` 中“最新”的目录。Next 验收失败则使用其不可变 release/current-symlink 自动回滚。

## 交易收益排行榜同步

排行榜只接受币安 U 本位合约单资产保证金账户的 `USER_DATA` 观察 API。用户必须在币安后台关闭交易和提现权限；网关只能验证读取能力，不能替用户证明一把 Key 没有额外权限。API Key 与 Secret Key 作为一个 JSON 密文使用同一套 AES-256-GCM 主密钥保存，浏览器和公开 RPC 都不能读取密文。

依次部署 `202609080001_binance_trading_leaderboard.sql`、`202609080002_realtime_trading_leaderboard.sql` 与 `202609080003_public_trading_amounts.sql` 后启用 `elliott-wave-trading-sync.timer`。绑定成功即建立基准快照和 0% 收益；用户明确同意公开金额后才加入实时榜。003 会保留既有连接和历史，但撤销旧的“不公开金额”排行授权，用户可在原连接上一键重新同意，无需重新填写 Key。定时任务执行 `node src/trading-worker.ts`，默认每 15 分钟同步一次账户权益和 `TRANSFER` 资金流水。公开参与者会显示最近同步的账户权益与绑定以来累计盈利；仓位、订单、资金流水和 API 信息不公开。多资产保证金、非 USDT 转账、连续同步异常或六小时未更新都会停止公开排名。

## 复盘知识准入

允许的状态为：

`draft → ai_reviewed → human_approved → published_experience`

任何阶段都可按权限转为 `rejected`。只有 `published_experience` 可进入正式经验检索；AI 自己生成的复盘不能绕过人工审核。

## 紧急停机

1. 将 `ai_task_routes.enabled` 全部设为 `false`。
2. 停止 worker。
3. 保留网关只读健康检查和任务状态查询。
4. 若怀疑泄密，轮换服务商密钥、Supabase service role 与主加密密钥。
5. 检查 `ai_job_attempts`、`ai_usage_ledger` 和服务器脱敏日志。
