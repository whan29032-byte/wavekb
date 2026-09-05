# WaveKB 第一批可靠性修复

日期：2026-09-05。基于 `9f2625e`，在用户指定的当前目录完成。本批仅本地修改，未提交、推送或部署。

## 已修复

- 好友完整管理和全站浮窗共享同一个 Presence 生命周期，避免对已订阅频道再次注册回调。最后一个使用者卸载才释放频道；覆盖站内切换、账号变化和 React StrictMode。
- 回撤序列不再把尾部分隔符误当作零；真实输入的零权益保留。无效文本、非有限数和负数明确报错。最大金额回撤和最大比例回撤分别计算。
- 硬规则先校验六个端点和方向；未输入价格只显示占位提示，不以示例价格冒充输入。
- 普通推动浪、未选结构、尚未实现的楔形规则分开处理，不对楔形套用普通推动浪规则。
- 撤掉固定的 66/71 分，明确显示未评分；展示已实现规则的检查明细和计算错误。
- 修改相关输入、品种或周期后，清除当前草稿中过期的派生结果。旧规则结果保留在历史数据中，但界面提示重新检查，不再显示为验证通过。
- 资料编辑预览复用现有个人主页封面层级和 AvatarFrame，解决头像被盖住，并使用现有铭牌渲染样式。
- 手机主导航提供知识库、社区、导师、积分商城；保持既有路由，不新增工作台或个人空间重复入口。
- 外观设置浮层移到页面顶层并约束在视口内；可滚动，支持 Esc、点击外部关闭及 Esc 后焦点返回。

## 主要修改文件

- `apps/web/src/hooks/use-member-presence.ts`
- `apps/web/src/components/friend-directory.tsx`
- `apps/web/src/components/social-desktop.tsx`
- `apps/web/src/lib/workbench/analysis-calculators.ts`
- `apps/web/src/components/workbench-analysis-editor.tsx`
- `apps/web/src/components/profile-editor.tsx`
- `apps/web/src/components/site-header.tsx`
- `apps/web/src/components/mobile-navigation.tsx`
- `apps/web/src/components/appearance-settings.tsx`

测试与本地验证文件：`friends-presence.test.tsx`、`workbench-analysis-editor.test.tsx`、`analysis-calculators.test.ts`、`src/test/browser-storage.ts`、`profile-editor.stories.tsx`、`site-header.stories.tsx`、`e2e-ui/reliability.spec.ts`、`playwright.ui.config.ts`。旧迁移测试移除了要求频道名称必须位于原组件文件的断言，替代覆盖为实际组件并存测试。`next-env.d.ts` 的类型路径由 Next.js 构建自动更新。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 全部项目类型检查 | 通过 |
| 前端 ESLint | 通过，无 lint 警告 |
| 根目录测试 | 90/90 |
| AI Gateway 测试 | 60/60 |
| Domain 测试 | 14/14 |
| Knowledge 测试 | 5/5 |
| 前端单元及组件测试 | 93/93 |
| 本地浏览器回归 | 6/6 |
| 知识资源存在性 | 374 个图片引用、2 本 PDF 均存在 |
| Webpack 生产构建 | 通过，生成 227 个静态页面并准备 standalone 文件 |
| 本地构建启动 | 通过 |
| 本地 HTTP 抽查 | 健康检查、知识库、好友页、登录、注册、找回密码均 200；三类图片与两本 PDF 均 200 且 MIME 正确 |
| 独立只读代码审查 | 两处遗漏已补测试修复，复查无新增阻断问题 |

浏览器测试使用本地 Storybook 组件和测试夹具，阻止访问外部服务。375/768/1440px 头像遮挡测试均通过；375/768px 外观浮层和手机导航通过。成功截图保存在 `apps/web/test-results/`（已被 Git 忽略），已人工检查手机截图。UI/UX 检查沿用现有样式系统，重点验证层级、视口边界、入口可达性和键盘操作，没有重新设计个人主页或铭牌特效。

## 构建限制与未验收项

- 默认 `pnpm --filter @wavekb/web build` 的 Turbopack 在本机创建内部端口时遇到 `Operation not permitted`。未修改默认配置；使用官方支持的 `next build --webpack` 完成生产构建验证。默认 Turbopack 构建仍需在发布环境通过，不能把本次结果视为该命令已通过。
- Node 的实验性 Web Storage 与 Storybook 依赖产生环境/弃用警告，不是测试失败。完整测试验证时使用 `NODE_OPTIONS=--no-experimental-webstorage pnpm test`。
- 本批没有对生产账号进行好友申请、真实聊天、资料保存、登录退出或密码重置操作；登录相关验证是现有自动化测试及本地路由读取，并非生产端到端验收。
- 没有执行真实发帖测试；本批不涉及发帖功能。
- 未切换用户生产浏览器主题、佩戴铭牌或减少动效设置。靓号其他对比度问题、导师/商城/后台等后续优化不在本批内。
- 评分模型和楔形专用规则尚未实现，已明确提示，不声称补齐算法。

## 发布状态

没有操作数据库、用户上传文件、生产环境变量、收款配置、账号权益或正式站点。修复尚未上线，线上行为不会因这些本地改动自动改变。本次没有生产切换，因此不需要生产回滚。后续发布仍需单独检查默认流水线、创建生产备份并执行生产验收。

复跑 UI 回归：`pnpm --filter @wavekb/web exec playwright test -c playwright.ui.config.ts`。
