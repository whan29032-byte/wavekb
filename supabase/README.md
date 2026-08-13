# 社区服务配置

本目录用于把艾略特波浪理论知识库接入真实的 Supabase 多人账号与发帖服务。前端只能使用公开的 Project URL 和 publishable key；任何时候都不要把 service-role key 写入网页、截图、聊天记录或本地发布目录。

## 1. 创建项目并应用数据库迁移

1. 在 Supabase 控制台创建项目，记录 Project ref。
2. 打开 SQL Editor。
3. 按文件名顺序完整执行 `migrations/` 下的 SQL：社区、会员空间、评论举报、交易工作台和 AI 控制中心不能跳过前置迁移。
4. 执行以下查询确认业务表均开启 RLS：

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'profiles', 'posts', 'post_images', 'private_entries', 'comments',
    'workbench_analyses', 'workbench_scenarios', 'workbench_reviews',
    'ai_providers', 'ai_provider_secrets', 'ai_models', 'ai_task_routes',
    'user_ai_connections', 'user_ai_connection_secrets',
    'ai_prompts', 'ai_prompt_versions', 'ai_jobs', 'ai_job_attempts',
    'ai_usage_ledger', 'knowledge_retrievals', 'review_decisions'
  );
```

所有结果的 `rowsecurity` 都必须为 `true`。`ai_provider_secrets` 与
`user_ai_connection_secrets` 不应存在
`anon` 或 `authenticated` 策略；该表只由服务器 service role 访问。

再确认图片 bucket：

```sql
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'post-images';
```

应返回一行，`public = true`，文件上限为 10485760 字节，只包含 JPG、PNG 和 WebP。

## 2. 配置邮箱账号

在 Authentication → Providers → Email 中：

- 开启邮箱和密码登录；
- 开启 Confirm email；
- 密码最低长度设为 10；
- 开启 CAPTCHA 或控制台提供的等效防刷功能。

在 Authentication → URL Configuration 中加入开发回调地址：

```text
http://127.0.0.1:8765/elliott-wave-preview.html
```

正式部署后，再加入正式 HTTPS 地址。不要把来源不明的网址加入回调白名单。

## 3. 配置生产邮件

Supabase 默认邮件服务只适合测试。正式开放注册前，在 Production SMTP 中配置经过验证的发件域名、发件地址和服务凭据，并检查以下邮件模板：

- 注册验证；
- 密码重置；
- 邮箱变更；
- 安全通知。

使用两个不同邮箱实际完成注册验证与密码重置后，才可开放给其他用户。

## 4. 写入前端公开配置

从 Project Settings → API 复制：

- Project URL；
- publishable key。

把它们写入 `knowledge/browser/community/config.js`：

```javascript
window.ELLIOTT_COMMUNITY_CONFIG = Object.freeze({
  supabaseUrl: "从已核对项目复制的 Project URL",
  supabasePublishableKey: "从同一项目复制的 publishable key",
  aiGatewayUrl: "https://你自己的服务器网关域名"
});
```

这里的 publishable key 本来就用于浏览器，但数据库仍必须依靠 RLS 保护。不要使用旧式 service-role key，也不要使用任何带管理权限的秘密。

## 5. 指定管理员

先让站点所有者完成邮箱验证和首次登录，再从 Authentication → Users 核对其 UUID。把核对后的 UUID 粘贴到 SQL Editor 的等号右侧，并确保查询只返回一个用户：

```sql
select id, display_name, role
from public.profiles
where id = '在控制台逐字符核对后的用户 UUID';
```

确认无误后再执行：

```sql
update public.profiles
set role = 'admin'
where id = '同一个已核对的用户 UUID';
```

随后再次查询并确认只修改了这一行。普通用户不能通过网页自行成为管理员。

## 6. 构建与发布

重新运行知识库构建器。发布时必须把以下内容放在同一目录结构中：

- `elliott-wave-preview.html`；
- `assets/`；
- `community/`。
- `workbench/`。

AI 网关必须单独部署在服务器环境，不能打包进静态网页。服务器配置和启动步骤见
`ai-gateway/docs/operations.md`。

本机预览可继续使用 `127.0.0.1:8765`。真实多人跨设备访问需要把整套静态文件部署到公网 HTTPS 地址，并把该地址加入 Supabase 回调白名单。

## 7. 上线前权限验收

使用普通账号 A、普通账号 B 和管理员账号依次确认：

- 访客可读、不能发帖；
- 未验证邮箱不能发帖；
- A 不能编辑或删除 B 的帖子；
- 普通用户不能修改自己的角色；
- 管理员可以隐藏或删除违规帖子；
- 管理员隐藏的帖子不能被原作者重新公开；
- 图片上传失败不会生成公开的残缺帖子。
- A 不能读取 B 的私人复盘、日记、工作台分析和 AI 任务；
- 普通用户访问 AI 控制中心返回 403；
- 服务商密钥只能写入、轮换和删除，任何读取接口都只返回末四位；
- AI 复盘在人工批准前不会进入正式经验检索。
