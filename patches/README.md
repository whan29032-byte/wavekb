# braces 安全补丁维护说明

`braces@3.0.3.patch` 是本站维护的本地安全回补，不是上游发布版本。它封堵 [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) 所述的深层嵌套 AST 递归栈耗尽路径。2026 年 10 月 10 日核对时，npm 最新版本仍为 3.0.3，GitHub 官方公告仍未列出已修复版本；不能声明升级到了不存在的 3.0.4。

## 补丁范围

解析花括号和括号时固定限制为 100 层嵌套，不能通过 `maxDepth`、`maxLength` 或 `strict: false` 放宽。`compile`、`expand`、`stringify` 的直接 AST 入口先使用迭代检查，限制 100 层容器和 20,000 次节点访问，并拒绝祖先循环；非循环的共享兄弟节点仍被接受。`expand` 的父链遍历也有深度上限。越界以带稳定错误码的 `SyntaxError` 拒绝，不再进入深层递归栈耗尽。调用方仍应正常处理无效 glob 输入，不能将任意攻击者提供的 AST 或正则表达式视为安全。

`pnpm-workspace.yaml` 的 `patchedDependencies` 和 `pnpm-lock.yaml` 的补丁哈希将所有已解析的 `braces@3.0.3` 消费者绑定到同一补丁；目前入口为开发工具依赖 `micromatch@4.0.8`。安全测试检查所有实际消费者的解析路径、补丁文件 SHA256 和真实调用，不仅测试源码文本。生产依赖审计和现有发布门禁保持不变。

## 验证

```sh
pnpm install --frozen-lockfile
node --test tests/braces-security-backport.test.mjs
pnpm audit:prod
pnpm audit --json --registry=https://registry.npmjs.org
```

安全回归无需联网，且由根 `tests/*.test.mjs` 自动纳入 CI。用例覆盖公开 API、直接库入口、深层花括号与括号、100/101 层边界、循环 AST、节点预算、共享节点和正常 glob、extglob、数值范围、转义及引号语义。

原始 `pnpm audit` 仍根据版本号识别 3.0.3，会保留 1 条开发依赖高危记录；它不会识别本地代码回补。该告警没有被忽略或隐藏，不能将结果描述为“全依赖零漏洞”。`pnpm audit:prod` 单独核对生产依赖，当前为零漏洞记录。应区分“此递归攻击路径已回补并验证”与“上游审计告警已消失”。

## 后续正式升级

上游正式发布修复版后，先核对公告和真实 npm 包，升级依赖并重新生成锁文件，运行相同攻击回归、正常语义测试、构建和审计。只有正式版本通过这些检查后，才移除本地补丁及 `patchedDependencies`；不可提前删除回补、伪造版本或添加审计白名单。
