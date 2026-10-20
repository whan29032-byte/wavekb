# Design System Changelog

## 2026-10-20

### 新增

- 三级 Token：Primitive → Semantic → Component；新增 surface、status、radius、shadow、motion Token。
- `Card`、`Badge`、`PageHeader` 共享组件；`Field` 增加 `Select`、`FieldHelp` 和 `aria-invalid` 样式。
- 全站语义类：`surface-card`、`surface-panel`、`surface-card-interactive`、`eyebrow`、`hero-grid`。
- 桌面主导航的当前页状态、移动导航的当前页状态和后台侧栏当前页状态。
- 设计文档：`docs/design-system/`、`project-profile.yaml`，并内置 `design-system-kit/` 执行规范。

### 调整

- 首页改为编辑式研究入口：真实知识条目/板块/原书统计、领域网格背景、板块卡片。
- 知识库、社区板块、帖子、积分商城和后台关键页面统一使用新的页面标题、卡片、徽章、控件和状态色。
- 页脚拆成品牌说明、服务链接和版权/免责声明三层。
- 旧的 `design-system/wavekb-member-experience/MASTER.md` 已标记为历史文件，实际规范以 `docs/design-system/` 为准。

### 保留

- 冷蓝灰品牌、五套主题、自定义强调色和现有 Appearance 行为。
- 导航信息架构、路由、认证、支付、会员、导师、RLS/RPC、知识正文和图片交付逻辑。
- 身份铭牌、头像框和会员视觉资产。
