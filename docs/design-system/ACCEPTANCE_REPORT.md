# WaveKB 设计系统验收报告

- 日期：2026-10-20
- 范围：全站语义 Token、共享组件、头部/移动导航/页脚、首页、知识库、社区板块、帖子详情、积分商城、后台导航与关键后台页面
- 环境：Windows 11、Node 24.15.0、pnpm 11.19.0、Next 16.3.8
- 证据目录：`apps/web/test-results/design-audit/`（本地生成，已被 Git 忽略）

> 本次是设计系统与视觉层改动，没有修改认证、支付、会员、导师订单、RLS/RPC、数据库迁移或知识正文。帖子互动功能所需的 `202610190001_community_engagement.sql` 是独立的后端迁移；生产环境仍需 Backend-first 发布。

## 自动化检查

| 检查 | 结果 | 命令/证据 |
|---|---|---|
| 全工作区类型检查 | PASS | `pnpm typecheck` |
| 前端 lint | PASS | `pnpm lint` |
| 生产构建（无公开配置） | PASS | `pnpm build` |
| 生产构建（公开 Supabase 配置） | PASS | `NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… pnpm build` |
| Storybook 构建 | PASS | `pnpm storybook:build` |
| 前端单元测试 | 1590 PASS / 1 FAIL | `pnpm test:web`；1 个失败为 Windows CRLF 下 service-worker offline shell 字节比较，属既有环境问题，CI Ubuntu 不受影响 |
| 互动/发布契约测试 | 14 PASS | 新增 `tests/community-engagement-postgres.test.mjs` + reward/deploy preflight |
| 根部署测试 | 一项既有 Windows 临时路径失败 | `tests/deploy-workflow.test.mjs`；marker/迁移选择断言通过 |

## 真实构建浏览器验收

使用生产构建 + 公开 Supabase publishable key，只读访问；Playwright Chromium。

| 页面 | 状态 | Hydration | 320/390/1280 横向溢出 | 结果 |
|---|---|---:|---:|---|
| `/` | 200 | 是 | 0 / 0 / 0 | PASS |
| `/knowledge` | 200 | 是 | 0 | PASS；当前导航“知识库”高亮 |
| `/community/idea_sharing` | 200 | 是 | 0 | PASS；当前导航“社区”高亮 |
| 社区首篇帖子详情 | 200 | 是 | 0 | PASS；点赞按钮 1 个；旧 schema 下计数为 0 |
| `/login` | 200 | 是 | 0 | PASS；输入框边框实际为 `rgb(132,145,161)` |
| 移动菜单打开 | 200 | 是 | 0 | PASS；`aria-expanded=true`，`nav` 可见 |
| 外观面板打开 | 200 | 是 | 0 | PASS；面板可见 |
| 暗色模式 `/` | 200 | 是 | 0 | PASS；`color-scheme: dark`，正文 `rgb(240,244,248)` |

交互回归：

- 移动菜单与外观面板点击可打开。
- Escape 关闭外观面板后焦点返回“网站外观”按钮；关闭移动菜单后焦点返回“展开主导航”按钮。
- 320px 首页无横向滚动，头部账号加载态已收敛为图标，不再撑破布局。

## 对比度实测

| 配对 | 比率 | 结论 |
|---|---:|---|
| Light 主文本 / 页面 | 15.29:1 | PASS |
| Light 次文本 / 页面 | 5.59:1 | PASS |
| Light 次文本 / 面板 | 5.93:1 | PASS |
| Light 主操作文字 / 主操作底 | 5.27:1 | PASS |
| Light 成功文本 / 成功浅底 | 5.69:1 | PASS |
| Light 警告文本 / 警告浅底 | 5.92:1 | PASS |
| Light 信息文本 / 信息浅底 | 5.53:1 | PASS |
| Light 危险文本 / 危险浅底 | 5.87:1 | PASS |
| Light 输入框边框 / 白底 | 3.21:1 | PASS（非文字 3:1） |
| Light 输入框边框 / 页面底 | 3.02:1 | PASS（非文字 3:1） |
| Dark 主文本 / 页面 | 16.01:1 | PASS |
| Dark 次文本 / 面板 | 7.99:1 | PASS |
| Dark 主操作文字 / 主操作底 | 7.25:1 | PASS |
| Dark 成功 / 成功浅底 | 7.52:1 | PASS |
| Dark 警告 / 警告浅底 | 8.85:1 | PASS |
| Dark 信息 / 信息浅底 | 7.76:1 | PASS |
| Dark 危险 / 危险浅底 | 6.39:1 | PASS |
| Dark 输入框边框 / 面板 | 3.92:1 | PASS（非文字 3:1） |

## P0 阻断项

| ID | 状态 | 说明 |
|---|---|---|
| P0-01 业务流程 | PASS | 未改认证、支付、会员、导师、RLS/RPC、知识正文 |
| P0-02 键盘/焦点 | PASS | 全局 focus-visible 3px；移动菜单/外观面板 Escape 返回触发元素；完整 Tab 矩阵未逐页穷举 |
| P0-03 操作反馈 | PASS | 现有成功/失败/加载/空态保留；共享控件增加 invalid 状态 |
| P0-04 表单 Label/错误 | PASS | Field/Label/FieldMessage/FieldHelp 统一；错误不只靠颜色 |
| P0-05 对比度 | PASS | 见上表 |
| P0-06 320px 布局 | PASS | 首页、知识、社区、帖子、登录均无横向溢出 |
| P0-07 真实数据 | PASS | 首页 161 条知识、6 个板块、原书来源来自真实数据；未虚构数量 |

## P1 重要项

| ID | 状态 | 说明 |
|---|---|---|
| P1-01 色阶职责 | PASS | 使用自定义 slate 语义色板并按 Radix 1–12 角色分工记录；品牌铭牌为登记例外 |
| P1-02 语义 Token | PASS | `globals.css` 三级 Token；新增页面无随机 HEX |
| P1-03 排版/间距/半径 | PASS | 共享组件和本次页面统一；其他历史页面保留增量迁移 |
| P1-04 组件状态 | PASS | Button/Field/Card/Badge/Nav 覆盖 hover/focus/disabled/selected；Loading/Error 沿用现有业务状态 |
| P1-05 Light/Dark | PASS | Light/Dark 截图与计算色验证；未穷尽所有页面暗色状态 |
| P1-06 弹层焦点 | PASS | 外观面板与移动菜单 Escape/焦点返回通过 |
| P1-07 200% 文字缩放 | NOT TESTED | 需要浏览器缩放专项 |
| P1-08 触控目标 | PASS | 主要控件 44px，小按钮 36px |
| P1-09 减少动效 | PASS（代码） | 全局与组件 `prefers-reduced-motion`；未做逐组件视觉录像 |
| P1-10 回归 | PASS | 类型、lint、构建、Storybook、前端单测；1 个 CRLF 环境失败保留说明 |

## P2 品质项

| ID | 状态 | 说明 |
|---|---|---|
| P2-01 首屏焦点 | PASS | 首页主标题 + 两个主/次动作；板块卡片辅助 |
| P2-02 数值排版 | PASS | 统计、积分、浏览/点赞使用 tabular-nums |
| P2-03 空/错/加载 | PARTIAL | 社区空态、登录/表单错误已验证；帖子互动在旧 schema 下优雅降级 |
| P2-04 图表语义 | N/A | 本次未改图表 |
| P2-05 文案 | PASS | 未新增空泛营销文案 |
| P2-06 视觉基准 | PARTIAL | 已生成截图，但尚未建立经批准的像素基准 |
| P2-07 依赖/性能 | PASS | 未新增运行时依赖；仅增加 CSS Token 和共享组件 |
| P2-08 文档 | PASS | `docs/design-system/`、`project-profile.yaml`、`design-system-kit/` |

## 阻塞与剩余风险

1. **后端迁移未部署**：当前生产 schema 没有 `post_engagement`、`post_likes`、`post_view_events`、`post_comment_images`。帖子详情已做兼容降级（200 可读），但互动计数为 0，`record_post_view` 在浏览器中返回 404。部署 `202610190001_community_engagement.sql` 后恢复。
2. **需要真实登录态**：积分商城、后台页面和发帖/评论/点赞写入未做真实账号视觉验收。状态：BLOCKED。
3. **未测试**：200% 文字缩放、读屏/axe、Safari/Firefox、全部暗色页面状态。
4. **Windows 测试/开发环境**：1 个 service-worker offline shell CRLF 失败和 1 个部署测试临时路径失败为既有环境问题，不属于本次设计改动。该 Windows 环境的 `next dev` 还出现 HMR WebSocket 握手失败、客户端未 hydrate；因此交互验收使用生产构建完成，生产/CI 不受影响。

## 回滚

本次设计改动不涉及数据库和业务规则。回滚时恢复 `apps/web/src/app/globals.css`、`packages/ui/src/*`、本次涉及的页面/组件、文档和 `project-profile.yaml` 即可；迁移与互动后端保持独立。

## 下一步唯一优先项

**按 Backend-first 部署 `202610190001_community_engagement.sql`，确认 `wavekb_schema_version()` 返回 `202610190001` 后再发布 Next。** 之后用专用管理员/会员账号补积分商城与后台的真实登录态视觉验收。
