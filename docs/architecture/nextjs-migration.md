# WaveKB Next.js 全栈迁移架构

## 目标

在不停止现有网站、不复制生产数据的前提下，将浏览器全局脚本逐步迁移到可测试的 Next.js App Router 架构。旧静态站仍由当前 GitHub Actions 工作流发布，直到新应用通过功能对照和生产验收。

## 工作区

```text
apps/web                Next.js App Router 全栈应用
ai-gateway              现有 UID 登录、管理与 AI 网关
packages/domain         板块、帖子、验证与领域类型
packages/knowledge      从旧 HTML 抽出的 161 个知识条目
packages/ui             定制 shadcn/ui 基础组件
community               仍在线的旧社区实现
assets                  原书图片与知识库资源
supabase                数据库迁移和 Edge Functions
```

所有工作区由根目录的 `pnpm-workspace.yaml` 和单一 `pnpm-lock.yaml` 管理。`apps/web` 使用 Next.js Server Components 读取公开内容，交互式发布器被隔离为 Client Component。

## 数据边界

- 新旧前端共用现有 `posts`、`post_images`、`profiles` 表和 `post-images` 存储桶。
- 新应用使用 publishable key 和用户 JWT，所有写操作继续由现有 RLS 约束。
- UID 登录仍由 `ai-gateway` 在服务端解析，浏览器和 Next.js 都不会获得用户邮箱映射或 service-role key。
- 发帖先写入不可见草稿，图片和元数据全部完成后才发布。失败会清理已上传文件和草稿行。
- 数据库迁移、生产密钥、用户上传内容不进入前端发布包。

## 路由兼容

首批新路由：

```text
/                              新应用入口
/login                         邮箱或 UID 登录
/knowledge                     可搜索的知识库入口
/knowledge/[id]                规则、图示与原书来源
/community/[board]             板块列表
/community/[board]/new         登录后发布
/community/post/[id]           帖子详情
```

现有 `/#page=...`、`/#board=...` 和 `/#post=...` 路由在切流前保持不变。最终切流时由 Nginx 添加显式的旧 Hash 入口提示和可逆回退，不会静默改变已有链接。

知识数据由 `pnpm knowledge:extract` 从当前 `index.html` 的 `elliott-kb-data` 生成。提取脚本校验唯一 ID，并移除构建机绝对路径。Next 在构建期预生成全部 161 个详情页，原书图片仍由现有静态资源目录提供。

## UI 约束

- 单一冷灰底色和蓝色主强调色，亮色与暗色跟随系统设置。
- 卡片统一使用 12px 圆角，表单使用 8px 圆角，按钮文字不换行。
- 页面默认无自动动效，交互只使用 hover、focus 和 active 反馈。
- 组件库代码由项目持有，Storybook 对共享组件执行可访问性检查。
- 表单具备明确标签、帮助文本、字段错误、加载状态和失败恢复提示。

## 部署阶段

1. 旁路构建：Actions 验证 Next、Storybook 和 Playwright，但生产仍只部署旧静态站。
2. 预发布：服务器新增 `wavekb-next` systemd 服务，只通过受保护的预览域访问。
3. 功能对照：逐项验证知识库、账户、社区、会员、导师、好友、聊天、工作台和后台。
4. 发帖验收：使用专用账号在预发布环境完成文本、多图、外链、编辑、删除、权限和失败清理测试。
5. 灰度切流：Nginx 只将已通过的路径转发给 Next，未迁移路径继续由旧站处理。
6. 全量切流：保留静态站备份和一条命令回滚，观察稳定后再归档旧脚本。

## 完成定义

新应用不能因为“页面能打开”就视为迁移完成。每个功能需要领域测试、组件状态、Playwright 用户路径、移动端检查、权限验证和生产健康检查全部通过。发帖最终验收必须使用专用账号并在测试后清理内容和上传文件。
