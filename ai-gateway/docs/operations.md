# AI 网关运维手册

## 运行边界

网关是浏览器与外部模型之间唯一允许的中转层。每个用户可以连接自己的模型接口，但 API Key 只在网关内加密处理；数据库 service role 和主加密密钥只能存在于服务器环境变量。静态网站只能保存 Supabase publishable key 和网关公开地址。

知识库属于网站本身。每次任务先由服务器从 `knowledge/units/all.jsonl`
检索第10版规则、指南和核验记录，再将最小必要上下文发送到该用户选择的模型。
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
