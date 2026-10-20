# WaveKB 可访问性规范

目标：WCAG 2.2 AA。设计 Token 只是起点，最终以真实渲染的前景/背景组合和键盘操作为准。

## 必须满足

1. 普通文本对比度 ≥ 4.5:1；大文本 ≥ 3:1；必要非文字 UI ≥ 3:1。
2. 所有可交互元素有可见 `:focus-visible` 焦点环；不得用 `outline: none` 移除而不提供替代。
3. 键盘可完成主导航、表单、弹窗、评论、点赞、兑换和后台操作；无键盘陷阱。
4. 触控目标至少 24×24 CSS px，主要移动操作按 44–48px 设计。
5. 状态不能只靠颜色；成功/失败/警告同时有文字或图标。
6. 支持 200% 文字缩放和 400% 页面缩放下的 reflow；320px 宽不出现阻断性横向滚动。
7. 尊重 `prefers-reduced-motion` 和用户“减少动态效果”设置。
8. 图片有替代文本；装饰图 `aria-hidden`；外链说明将离开站点。

## 当前关键配对的验证方式

- Light：`#596574` on `#f7f8fa`、`#596574` on `#ffffff`、`#ffffff` on `#3f6f9f`。
- Dark：`#aeb9c7` on `#19232f`、`#f0f4f8` on `#111923`、主题按钮前景 on 主题强调色。
- 状态色：成功/警告/信息/危险各自在 surface 与实心底上的配对。
- 使用 `apps/web/src/lib/appearance.ts` 的 `contrastRatio` 或独立脚本测量，不凭肉眼声称通过。

## 测试计划

| 项目 | 方法 | 状态 |
|---|---|---|
| 类型、lint、构建 | `pnpm typecheck`、`pnpm lint`、`pnpm build` | 见验收报告 |
| 键盘与焦点 | 浏览器 Tab/Shift+Tab、Escape、Enter | 手工抽查 |
| 320/390/768/1280/1440 | Playwright 截图 + DOM 检查 | 见验收报告 |
| 对比度 | 实际计算 | 见验收报告 |
| 读屏/axe | 未配置专用自动工具 | NOT TESTED |
| 真实业务状态 | 需要专用账号和 Supabase 环境 | NOT TESTED / BLOCKED |

## 设计侧约束

- 不使用只有颜色变化的 hover/selected 状态。
- 不用固定高度裁切长中文文本；必要时换行或折行。
- 不把关键操作放在仅 hover 可见的位置。
- 弹层打开后焦点移入，Escape 关闭并返回触发元素；现有 Appearance、MobileNavigation、对话框应保持该行为。
