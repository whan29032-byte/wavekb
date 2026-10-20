# 给既有 AGENTS.md 追加的片段（不要整体覆盖 AGENTS.md）

当本工具包被放进工程时，将以下段落**追加**到仓库现有的 `AGENTS.md`；如果仓库没有该文件，可以创建。

---

## UI / Design System 规则

在设计、新增、重构、审查任何 UI、CSS、主题或可交互组件之前，先阅读 `design-system-kit/MASTER_PROMPT.md`、`design-system-kit/docs/DESIGN_RULES.md`、`design-system-kit/docs/PLATFORM_ADAPTERS.md`、`design-system-kit/docs/ACCEPTANCE.md`，并读取项目根目录 `project-profile.yaml`（如有）。现有产品与业务约束优先，必须增量开发。

采用 Radix Colors 的 12 级角色分工，新增设计值优先通过 Primitive → Semantic → Component Token 映射，严格控制随机颜色、字号、圆角和间距。Light/Dark/交互/键盘/对比度必须验证，UI 文案不得编造业务信息；任何例外写入文档。

执行优先级：真实业务流程 > 可访问性与可用性 > 品牌一致性 > 视觉装饰。不得以“高级设计”为由擅自改变功能。最后附设计变更与 PASS/FAIL/BLOCKED/NOT TESTED 的验收证据。

---

**提示：** 如果你采用了不同的文件部署路径，请同步调整上述相对路径。
