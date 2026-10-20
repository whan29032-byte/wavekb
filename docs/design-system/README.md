# WaveKB Design System

本目录是 WaveKB 的项目级设计系统文档。通用执行规范来自仓库内 `design-system-kit/`，项目参数来自根目录 `project-profile.yaml`。

## 工作方式

1. 修改 UI 前先阅读：
   - `design-system-kit/MASTER_PROMPT.md`
   - `design-system-kit/docs/DESIGN_RULES.md`
   - `design-system-kit/docs/PLATFORM_ADAPTERS.md`
   - `design-system-kit/docs/ACCEPTANCE.md`
   - `project-profile.yaml`
   - 本目录下的 FOUNDATION、TOKENS、COMPONENTS、CONTENT、ACCESSIBILITY。
2. 先审计现状，再改共享 Token/组件，最后改页面；不要直接复制一套平行样式。
3. 不改变认证、支付、会员、导师订单、RLS/RPC、数据库迁移 marker 和知识正文。
4. 完成后按 `ACCEPTANCE_REPORT.md` 记录 PASS / FAIL / BLOCKED / NOT TESTED，不凭感觉声称通过。

## 文件

| 文件 | 内容 |
|---|---|
| `FOUNDATION.md` | 视觉主张、品牌保留项、颜色/排版/空间/动效原则 |
| `TOKENS.md` | Primitive → Semantic → Component Token 与 Tailwind 映射 |
| `COMPONENTS.md` | 共享组件、站点组合组件与状态契约 |
| `CONTENT.md` | 中文文案、术语、数字与错误提示 |
| `ACCESSIBILITY.md` | WCAG 2.2 AA 门槛与测试计划 |
| `CHANGELOG.md` | 本次设计系统改动与保留项 |
| `ACCEPTANCE_REPORT.md` | 实测证据与剩余风险 |

## 代码位置

- 全局 Token 与基础样式：`apps/web/src/app/globals.css`
- 共享组件：`packages/ui/src/`
- 站点组合组件：`apps/web/src/components/`
- 主题与自定义强调色：`apps/web/src/lib/appearance.ts`、`apps/web/src/lib/appearance-bootstrap.ts`
