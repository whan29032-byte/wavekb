# @wavekb/web

WaveKB 的 Next.js 全栈旁路应用。当前不会替换线上静态站。

## 本地启动

```bash
cp apps/web/.env.example apps/web/.env.local
pnpm install
pnpm dev
```

打开 `http://localhost:3000`。Supabase 使用现有项目的 URL 和 publishable key，禁止填写 service-role key。

## 检查

```bash
pnpm typecheck
pnpm test
pnpm --filter @wavekb/web lint
pnpm --filter @wavekb/web build
pnpm storybook:build
pnpm test:e2e
```

认证发帖验收默认跳过。只有在隔离的预发布或最终验收环境中配置 `E2E_POSTING_IDENTIFIER` 和 `E2E_POSTING_PASSWORD` 才会创建测试帖子。
