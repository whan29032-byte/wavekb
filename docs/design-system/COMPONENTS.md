# WaveKB 组件契约

共享组件位于 `packages/ui/src`；站点专属组合组件位于 `apps/web/src/components`。新增 UI 先复用这里已有的组件和 Token，不要平行造一套。

## Button

- 位置：`packages/ui/src/button.tsx`
- 变体：`primary`、`secondary`、`soft`、`outline`、`ghost`、`danger`
- 尺寸：默认 44px；`small` 36px；`large` 48px；`icon` 44×44
- 状态：default / hover / active / focus-visible / disabled；支持 `asChild` 包装 `Link`
- 规则：主要动作只用一个 primary；危险动作必须有明确动词和二次确认；加载中禁止重复提交（调用方设置 `disabled` + 文案）。

## Field 系列

- 位置：`packages/ui/src/field.tsx`
- `Field`、`Label`、`Input`、`Textarea`、`Select`、`FieldMessage`、`FieldHelp`
- 控件：44px 最小高度、8px 半径、focus ring、`aria-invalid` 红色边框与 ring、read-only 次级底色
- 规则：Label 必须绑定控件；占位符不能代替 Label；错误消息说明原因和恢复动作；帮助文本使用 `FieldHelp`，不与错误混用。

## Card

- 位置：`packages/ui/src/card.tsx`
- 变体：`panel`（默认，`shadow-card`）、`subtle`、`interactive`
- 内边距：`none` / `sm` / `md` / `lg`
- 半径：`card`（12px）/ `panel`（16px）
- 规则：可点击卡片使用 `interactive`，保证 hover 边框/阴影但不改变布局；不要把整页所有区块都做成浮起卡片。

## Badge

- 位置：`packages/ui/src/badge.tsx`
- 变体：`neutral`、`primary`、`success`、`warning`、`danger`、`outline`
- 规则：徽章表达状态或分类，不替代正文；状态必须同时有文字，不只用颜色。

## PageHeader

- 位置：`packages/ui/src/page-header.tsx`
- 组成：eyebrow、icon、title、description、actions
- 规则：页面只用一个 `h1`；eyebrow 使用短英文分类或明确中文短语；actions 放在桌面右侧、移动端换行。

## 导航

- `SiteNavigation`：桌面主导航，使用 `usePathname` 标记当前页；知识、社区、导师、收益榜、积分商城、机构研报。
- `MobileNavigation`：移动端菜单，点击链接后关闭；Escape 关闭并返回触发按钮。
- `AdminNavigation`：后台侧栏，当前后台页面使用 `primary-selected` 背景。
- 规则：所有导航项至少 44px 高；当前项有 `aria-current="page"`；图标仅装饰时 `aria-hidden`。

## 站点组合组件

| 组件 | 规则 |
|---|---|
| `PostCard` | Board Badge、作者/时间、标题、摘要、浏览/点赞 footer；整卡不嵌套第二个主链接 |
| `PostEngagement` | 浏览数与点赞按钮；不能给自己的帖子点赞；未激活 UID 显示原因 |
| `PostComments` | 评论头像、图片、回复、软删除；图片最多 4 张、单张 5MB |
| `EmptyBoard` | 说明原因、给出下一步动作；未连接 Supabase 时明确提示配置 |
| `DirectoryGroup` | 外链卡片，显示来源平台、名称、摘要和外部箭头 |

## 状态覆盖

| 状态 | 覆盖要求 |
|---|---|
| Default / Hover / Pressed | 按钮、表单、导航、卡片 |
| Selected | 导航、主题选择、分段控件 |
| Focus-visible | 所有可交互元素，3px focus ring |
| Disabled | 控件和按钮，保留可理解原因 |
| Loading | 提交类按钮使用明确“正在…”文案并禁用 |
| Success / Error | 表单、兑换、发布、删除、上传 |
| Empty | 列表和板块说明原因与下一步 |
