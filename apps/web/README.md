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

知识源发生变化后，执行 `pnpm knowledge:build`，由 `knowledge/units`、关系/章节/问题映射、Markdown 视图和图示注册表生成 `packages/knowledge/src/knowledge.json`。根目录旧 HTML 仅为展示产物，不再作为知识数据上游。

认证发帖验收默认跳过。只有在隔离的预发布或最终验收环境中配置 `E2E_POSTING_IDENTIFIER` 和 `E2E_POSTING_PASSWORD` 才会创建测试帖子。
