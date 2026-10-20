# WaveKB Token 体系

代码位置：`apps/web/src/app/globals.css`。颜色通过 Tailwind v4 `@theme inline` 暴露为 `bg-*`、`text-*`、`border-*`、`ring-*`。

## 1. Primitive → Semantic → Component

```text
Primitive        #3f6f9f, #18212c, #596574, 8px, 12px, 120ms ...
      │
      ▼
Semantic         --primary, --foreground, --muted-foreground, --border,
                 --success, --warning, --info, --radius-control, --motion-fast
      │
      ▼
Component        Button = primary + radius-control + motion-fast
                 Card = surface + border + radius-card + shadow-card
                 Input = surface + border-strong + radius-control + ring
```

组件优先使用 Semantic Token；只有品牌铭牌、图标和 OG 图等例外使用固定值。

## 2. 语义颜色

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--background` | `#f7f8fa` | `#111923` + 主题混色 | 页面底色 |
| `--surface` | `#ffffff` | `#19232f` | 卡片、面板 |
| `--surface-subtle` | `#f2f4f7` | `#151f2a` | 次级面板、悬停底 |
| `--surface-sunken` | `#e9edf2` | `#111923` | 输入/代码/凹陷区域 |
| `--surface-inverse` | `#18212c` | `#f0f4f8` | 反色面板 |
| `--foreground` | `#18212c` | `#f0f4f8` | 主文本 |
| `--foreground-secondary` | `#3d4855` | `#d5dde7` | 强次文本 |
| `--muted-foreground` | `#596574` | `#aeb9c7` | 辅助文本 |
| `--border` | `#d8dee7` | `#354354` | 默认边框 |
| `--border-subtle` | `#e6ebf1` | `#2b3847` | 分割线 |
| `--border-strong` | `#8491a1` | `#6f8094` | 控件边框，满足 3:1 非文字对比 |
| `--primary` | 主题强调色 | 主题强调色可读变体 | 主操作 |
| `--primary-selected` | 主题色 14% + 白 | 主题色 22% + 深色面板 | 选中/激活底 |
| `--success` | `#1d6e4e` | `#6dd3a8` | 成功、确认、目标命中 |
| `--warning` | `#7f5610` | `#f0c36a` | 警告、额度、待处理 |
| `--info` | `#2563a8` | `#8bbcf5` | 信息提示 |
| `--destructive` | `#b4232e` | `#ff7b85` | 危险、失败、撤销 |
| `--accent-gold-*` | 固定金棕 | 深色金棕 | 身份称号 |

文本与背景的实际配对应在实现页面上用 WCAG 2.2 AA 校验，不能只从 Token 名称推断。

## 3. 形状、深度、动效

| Token | 值 | 用途 |
|---|---|---|
| `--radius-control` | 8px | 按钮、输入、导航项 |
| `--radius-card` | 12px | 卡片、列表容器 |
| `--radius-panel` | 16px | 大面板、空态、浮层 |
| `--radius-pill` | 9999px | 徽章、药丸 |
| `--control-height` | 44px | 控件最小高度 |
| `--shadow-xs` | 0 1px 2px | 静态卡片 |
| `--shadow-card` | 0 8px 24px | 面板 |
| `--shadow-card-hover` | 0 14px 34px | 可交互卡片悬停 |
| `--shadow-floating` | 0 18px 50px | 弹层、浮窗 |
| `--motion-fast` | 120ms | 颜色、边框、阴影 |
| `--motion-normal` | 200ms | 一般状态变化 |
| `--motion-slow` | 280ms | 面板进入/退出 |
| `--ease-standard` | cubic-bezier(.2,.7,.2,1) | 统一缓动 |

## 4. Tailwind 映射

新增的常用类：

```text
bg-surface-subtle  bg-surface-sunken  bg-surface-inverse  bg-primary-selected
text-foreground-secondary  text-inverse-foreground
border-border-subtle  border-border-strong
bg-success  text-success  bg-success-surface
bg-warning  text-warning  bg-warning-surface
bg-info  text-info  bg-info-surface
bg-destructive-surface
rounded-control  rounded-card  rounded-panel  rounded-pill
shadow-card  shadow-card-hover
text-display  text-title  text-heading  text-caption
```

## 5. 组件 Token 映射

| 组件 | 关键 Token |
|---|---|
| Button primary | `bg-primary`, `text-primary-foreground`, `radius-control`, `motion-fast` |
| Button secondary | `bg-surface`, `border-strong`, hover `surface-subtle` |
| Button soft | `bg-primary-selected`, `text-primary`, border primary/15 |
| Input | `bg-surface`, `border-strong`, focus `ring`, invalid `destructive` |
| Card | `bg-surface`, `border`, `radius-card`, `shadow-card` |
| Interactive card | hover `border-primary/40`, `shadow-card-hover` |
| Badge | `rounded-pill`, 语义色 surface / border / text |
| PageHeader | `text-title`, `border-b`, `muted-foreground` |

## 6. 维护规则

- 新增颜色、阴影、半径、字号前，先检查是否已有语义 Token 可复用。
- 临时 HEX 必须写明用途和生命周期；第三方 Logo、OG 图、身份铭牌例外。
- 修改主题强调色时，必须同时验证 light/dark 按钮前景、焦点环和选中底色。
- 不覆盖 Tailwind 默认的 `rounded-lg`、`shadow-sm` 等尺度；使用项目命名，避免全站意外漂移。
