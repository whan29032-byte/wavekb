# WaveKB Agent Notes

## UI / Design System

在新增、重构或审查任何 UI、CSS、主题或交互组件之前：

1. 阅读 `design-system-kit/MASTER_PROMPT.md`、`design-system-kit/docs/DESIGN_RULES.md`、`design-system-kit/docs/PLATFORM_ADAPTERS.md`、`design-system-kit/docs/ACCEPTANCE.md`。
2. 阅读根目录 `project-profile.yaml` 与 `docs/design-system/`。
3. 优先复用 `packages/ui` 的 Button、Field、Card、Badge、PageHeader 和现有语义 Token。
4. 保留现有品牌、路由、认证、支付、会员、导师、RLS/RPC 与数据库迁移边界；不得为了视觉调整改变业务规则。
5. 完成 UI 变更后运行类型检查、lint、单测和构建；在 `docs/design-system/ACCEPTANCE_REPORT.md` 记录 PASS / FAIL / BLOCKED / NOT TESTED。

## Next.js

`apps/web/AGENTS.md` 中的 Next.js 约定继续有效；本文件不覆盖它。
