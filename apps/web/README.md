# @wavekb/web

WaveKB 当前主站的 Next.js App Router 应用，按 standalone 方式发布。根静态 HTML、`community/`、`admin/` 与 `workbench/` 是冻结的历史/回滚实现，新功能在这里实现。

## 本地启动

开发与 CI 使用 Node `^22.22.2 || ^24.15.0 || >=26.0.0`、pnpm `11.19.0`。当前仓库锁定 Next `16.3.8`、React `19.2.8`、Tailwind `4.3.3` 与 sharp `0.35.5`；生产版本以线上 health SHA 和正式发布验收为准。

```bash
cp apps/web/.env.example apps/web/.env.local
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://localhost:3000`。Supabase 使用现有项目的 URL 和 publishable key，禁止填写 service-role key。

## 检查

```bash
pnpm audit:prod
pnpm typecheck
pnpm test
pnpm --filter @wavekb/web lint
pnpm --filter @wavekb/web build
pnpm storybook:build
pnpm test:e2e
```

知识源发生变化后，执行 `pnpm knowledge:build`，由 `knowledge/units`、关系/章节/问题映射、Markdown 视图和图示注册表生成 `packages/knowledge/src/knowledge.json`。根目录旧 HTML 仅为展示产物，不再作为知识数据上游。

认证发帖验收默认跳过。只有在隔离的预发布或最终验收环境中配置 `E2E_POSTING_IDENTIFIER` 和 `E2E_POSTING_PASSWORD` 才会创建测试帖子。

正式生产发布根据实际 live SHA 至候选 SHA 的差异决定是否必须跑专用账号的真实发帖/会员壳层验收；需要该验收却缺凭据时停止发布。会员与账号权益路径也属于这项分类。只有手动工作流的明确只读审批可跳过写入验收，schema、Gateway、构建、只读浏览器和准确回滚门槛继续生效。

`assets:sync` 复制知识资产并生成内容寻址的无损阅读 WebP。sharp 版本与 `knowledge/reading/image-delivery-integrity.json` 的编码器标记绑定；更新时必须证明全部原 PNG SHA、原生尺寸和像素一致，再更新派生清单。PDF、原 PNG 和知识正文不由该过程改写。

会员基础只提供有期限的手动权益与审计记录，不配置价格、支付或自动续费，也不限制既有公开内容。涉及数据库/Gateway 的发布顺序见根 [DEPLOYMENT.md](../../DEPLOYMENT.md)；本分支目标 schema 为 `202610100002`，不代表线上已经执行。
