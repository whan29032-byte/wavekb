# 可复用 UI 设计系统提示词工具包

**目标：** 让 Codex 在Web、SaaS、电商、原生 App 与工具软件项目中，先理解品牌和现有工程，再一致地构建/改造 UI，并用真实证据验收。

## 包含什么

| 文件 | 用途 |
|---|---|
| `MASTER_PROMPT.md` | 完整通用主提示词，可直接复制到 Codex；包含审计、设计、实施、检查全流程 |
| `docs/DESIGN_RULES.md` | 颜色、排版、间距、交互、可访问性、AI 风格反模式 |
| `docs/PLATFORM_ADAPTERS.md` | Web、SwiftUI、Compose、Flutter、桌面的跨平台实现边界 |
| `docs/ACCEPTANCE.md` | 自动/人工验收清单，杜绝“感觉不错就算通过” |
| `templates/project-profile.yaml` | 项目参数，可选填写；主提示词缺省也能运行 |
| `templates/tokens.dtcg.example.json` | DTCG 2025.10 风格的跨平台 Token 结构样例，颜色为示意 |
| `templates/tokens.example.css` | Radix CSS + 语义 Token 起始示例，**不是已验收的生产样式** |
| `AGENTS_SNIPPET.md` | 使规则在仓库后续 Codex 开发中持续生效的片段 |
| `examples/MOLIPLY.profile.yaml` | MOLIPLY 的独立配置示例，不影响其他项目默认风格 |

## 推荐用法 A：一次性审计或构建设计系统

1. 打开 `MASTER_PROMPT.md`，复制全部内容给已进入项目工作区的 Codex。
2. 按需补一句：`MODE=AUDIT，请只检查问题不要修改代码`，或 `MODE=IMPLEMENT，对现有页面增量实施并验收`。
3. Codex 先审计真实代码，再形成项目专属 Token、组件规范和验收报告。

## 推荐用法 B：让每个项目持续遵守同一套质量规则

1. 将本目录复制到目标仓库：`design-system-kit/`。
2. 可选：复制 `templates/project-profile.yaml` 为项目根目录的 `project-profile.yaml`，填写品牌、平台、任务与禁止改动范围。
3. 将 `AGENTS_SNIPPET.md` 里的片段追加到项目现有 `AGENTS.md`；**不要覆盖原有 AGENTS.md**。
4. 第一次对 Codex 说：

> 阅读 `design-system-kit/MASTER_PROMPT.md`、全部 docs 规范和项目配置；先扫描当前项目，执行 MODE=AUDIT，输出设计问题、建议 Token 与最小可验收改动，不要修改业务逻辑。

审计确认之后再下发 `MODE=IMPLEMENT`。

## 推荐用法 C：审查任何新增页面/PR

> 使用本工具包 `MODE=REVIEW` 审查本次 UI 变更。指出确切组件位置、违反的规则、证据、最小修复方案和验证方式；仅有猜测的内容标记为待核验。

## 适配原则

- **复用的是系统质量，不是统一审美。** 金融工具、创作编辑器、儿童产品、电商不应该被强迫使用一套视觉风格。
- 现有 Tailwind/shadcn/ui/Radix Themes/组件库优先，不重复造轮子。
- Light/Dark 仅在产品要求时都交付，不为符合模板强制重做。
- 任何“已完成”必须有具体测试证据；有截图不等于代码可运行。
- 设计建议不能擅自更改已经确认的业务规则。

## 官方参考

- https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale
- https://www.radix-ui.com/colors/docs/overview/usage
- https://www.w3.org/WAI/WCAG22/quickref/
- https://www.designtokens.org/tr/drafts/format/

## 本包不是

- 可编辑的 Figma 文件；
- 已完成可访问性审计的生产设计系统；
- 无需阅读项目代码就能保证 UI 效果的万能模板。

它是设计与工程执行规则，最终质量需要在你的真实项目中实施并检验。
