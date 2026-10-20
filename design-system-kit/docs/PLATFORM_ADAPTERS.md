# 跨平台设计系统落地规则

> **质量规则跨平台复用，实现技术不应该硬搬。** `tokens.example.css` 只演示 Web，不是 iOS/Android 的可直接执行样式。

| 平台 | 推荐承载方式 | 特别验收 |
|---|---|---|
| React / Next.js / Vue | CSS Variables、当前 Tailwind/shadcn/ui/Radix Themes 主题层 | CSS computed styles、WCAG、键盘、浏览器缩放、响应式 |
| iOS 原生（SwiftUI） | Color Assets、动态语义 Color、字体 Text Styles、ViewModifier、ButtonStyle、组件抽象 | Dynamic Type、VoiceOver、Dark Mode、Reduce Motion、触控热区、状态恢复 |
| Android 原生（Compose） | ColorScheme、Typography、Shapes、CompositionLocal、自建 Semantic Tokens | TalkBack、字体缩放、深色主题、系统高对比与不同 DPI |
| Flutter | ThemeData / ColorScheme / TextTheme / ThemeExtension | 文本缩放、Semantics、深色主题、目标平台可访问性 |
| 桌面端（Electron/Tauri） | Web 语义 Token + 桌面密度/快捷键层 | 键盘快捷键、焦点、窗口缩放、触控板与鼠标 |
| Figma/设计稿 | 组件变量、Color Styles、Typography Styles、明暗模式；可用支持 DTCG 的桥接工具 | 设计变量与代码映射、变更说明、截图对照 |

## 重要边界

1. WCAG 2.2 是本包 Web 检查的核心参考；iOS/Android 应进一步对照 Apple/Android 平台无障碍规范，不能仅因通过 Web 色彩公式就认定原生 App 已达到平台无障碍要求。
2. iOS 的最小目标尺寸与 Android 的 dp 不应机械照抄 Web 的 CSS px。使用各平台的 UI 控件指标并经真机测试。
3. 若无可运行的原生平台编译/模拟器环境，设计系统报告必须标记 native build / VoiceOver / TalkBack 验证为 BLOCKED 或 NOT TESTED。
4. 字体的文本样式必须适配动态字体而非直接硬编码像素；可用系统语义文字层级替换固定值。
5. 不应为了复用 CSS 而把明确要求原生的 App 变成 WebView 套壳。
6. 横跨多端时，复用 Token 的**语义、名字和状态契约**；各端实现可以不同，允许记录平台特例。

## 输出约定

项目配置声明 `platforms` 后，Codex 先识别真实框架，选择上表适配层，明确哪些 Token 可跨端同步、哪些必须平台定制。只创建目标工程需要的文件，禁止为一个 Web 站点强行生成 SwiftUI、Compose 或 Flutter 目录。
