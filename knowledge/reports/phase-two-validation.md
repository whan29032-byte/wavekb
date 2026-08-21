# WaveKB 知识库第二阶段验证报告

生成日期：2026-08-21
分支：`codex/knowledge-phase2`
基线：`main@f8f0f97dc828f03a5e9e85bb1f3c6319961a38d0`

## 结论

第二阶段已经把运行时知识链改为 `Source → Chapters → Units → Pages`：117 条 Unit 是唯一核心正文，Chapter 与 Page 只维护顺序或视图配置，`packages/knowledge/src/knowledge.json` 由构建脚本生成。根目录大型 HTML 与旧知识树 HTML 均不再参与知识构建。

自动校验当前为通过状态，无断裂 Relation、Question Route、Page→Unit 或 Image Ref。第10版原始 PDF 已恢复，280页连续渲染、SHA-256、章节范围与语义分段均通过验证。仍有8条关系属于真正宽泛的 `related`，另有少数版本解释差异需要编辑确认。

## 回归计数

| 指标 | 结果 |
|---|---:|
| 第10版 Coverage rows | 280 |
| `OK` | 280 |
| `NEEDS_REVIEW` | 0 |
| Units | 117 |
| Unit pages | 117 |
| Compiled pages | 161 |
| Relations | 174 |
| Broken Relations / Orphans | 0 / 0 |
| Questions | 18 |
| Empty reasoning stages | 0 |
| Chapters | 12 |
| Themes | 8 |
| Image assets | 372 |
| Restored reduced Units | 38 |

Coverage 的280条 `OK` 由117页“明确第10版 source ref + 人工复核语义分段”、159页“人工复核语义分段”及4页“已复核且不产生独立 Unit 的分隔/归档页”组成。56个连续语义 packet 严格覆盖PDF 1–280页，无重叠、无缺页；全部117 Units 至少进入一个复核 packet。

## 类型与关系

Unit 已统一为九类：RULE 7、GUIDELINE 26、DEFINITION 11、METHOD 23、CHARACTERISTIC 10、CONFIRMATION 2、HISTORICAL_CASE 21、THEORY_BOUNDARY 12、TERMINOLOGY 5。旧类型保存在 `legacy_type`，便于迁移追踪。

174 条 Relation 当前分布：method 52、example 41、prerequisite 28、guideline 26、confirmation 8、rule 7、commonly_confused 4、related 8。原先 48 条泛化 `related` 已有 40 条按语义细化；23 个孤立 Unit 已修复，同时删除了 23 条冗余反向边，数量保持 174。

## 内容与来源边界

- 13 条第10版核心形态条目依据280页逐页蒸馏恢复完整解释、条件、失效、案例语境与常见错误。
- 25 条历史/理论条目依据各自第11版引用页恢复上下文，继续标为 `supplement`；未覆盖第10版规则。
- 历史案例页面固定显示“不是统计证明”的使用边界。
- RULE 页面突出强制条件与失效；GUIDELINE 页面明确标注“非硬规则”。
- 146 个核心/分支 Markdown 页面已收敛为视图配置；构建时从 Unit 生成快速答案与完整解释。18 个 candidate 页面继续保留其独立辅助正文。

## 图示

图像注册表共 372 项：第10版 Primary 原页摘录 25、 第11版 Supplement 原书图示 58、 第11版 Supplement 来源页 289。每项包含 `image id → unit_ids → figure_type → source_page → caption`，构建输出把 Primary、Supplement figure 与 Supplement source scan 分栏，旧混合字段保持为空。

Impulse、Extension、Truncation、Diagonal、Zigzag、Flat、Triangle、Combination 等核心 Unit 均至少有一项第10版 Primary 图像引用；Leading/Ending Diagonal、Expanded/Running Flat、Contracting/Barrier/Expanding Triangle、Double/Triple Three 由对应规则 Unit、caption 与来源页追踪，不按章节批量堆图。

## 三种入口

- 八大主题入口：递归解析 taxonomy 的同一批 Units。
- 18 条问题路线：每条均有规则排除、指南排序、证据确认、失效管理四个非空阶段，并有独立静态页面。
- 12 个原书入口：Front Matter、Chapter 01–08、Appendix、Glossary、Publisher Postscript 各有只维护顺序的 Unit 列表页。

## 自动化与用法

主要日常命令：

```bash
pnpm knowledge:build
pnpm knowledge:validate
pnpm knowledge:sync-primary-refs
pnpm --filter @wavekb/knowledge test
pnpm --filter @wavekb/web typecheck
pnpm --filter @wavekb/web test
pnpm --filter @wavekb/web build
```

Coverage 账本重建：

```bash
node scripts/build-knowledge-coverage.mjs --distillation /absolute/path/to/280-page-distillation.md
```

一次性迁移脚本：`migrate-chapter-indexes.mjs`、`migrate-unit-relations.mjs`、`migrate-unit-types.mjs`、`migrate-unit-schema.mjs`、`migrate-typed-relations.mjs`、`refine-related-relations.mjs`、`migrate-question-routes.mjs`、`migrate-pages-to-unit-views.mjs`、`migrate-knowledge-image-registry.mjs`、`restore-reduced-unit-content.mjs`。

## 测试结果

- `knowledge:validate`：通过，0 errors；仅保留8条真正宽泛 `related` 的1个 warning。
- `@wavekb/knowledge`：4/4 tests passed；TypeScript passed。
- `@wavekb/web`：55/55 tests passed；TypeScript passed。
- Next.js production build：通过；223 个静态/动态路由完成，其中知识页 161、章节页 12、问题页 18。
- 图像文件检查：372 个唯一引用，0 missing。
- `git diff --check`：通过。

## 尚未解决与人工确认

1. 8 条跨解释层关系仍是宽泛 `related`；它们是相邻波浪个性或理论解释间的非方向关系，若产品必须完全禁用 generic type，需要人工定义更窄语义。
2. 需人工确认版本解释差异：引导斜纹浪内部细分、罕见扩散斜纹浪、顺势平台实例强度、期货浪1/浪4短暂重叠例外、三角形冲击/边界交点指南的强度。
3. 第11版中的历史统计、作者哲学与出版者成功评价已隔离为 Supplement/Historical Case/Theory Boundary；36条 Supplement-led Units 现均另有第10版 Primary packet ref，但措辞仍建议由熟悉原书的编辑逐条复核。

本阶段没有修改社区、思路分享、交易复盘、好友、个人空间、工作台、积分商城，也没有编辑根目录大型 HTML 构建产物。
