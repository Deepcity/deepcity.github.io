# Blog Agent 更新记录

本文记录 Blog Agent 自身能力的变更。每次修改 Agent 行为、CLI、报告格式、修复规则或运行约定时，都应在这里追加一条记录，再按需更新对应专题文档。

## 2026-07-09 Visual Check 证据模型与 LaTeX 小修复

背景：

- `visual-check` 已经能保存全量页面截图，但早期人机交互主要依赖大 JSON，人工审查成本高。
- Gemini 只看高压缩全页图时，容易漏掉长文深处的公式渲染错误。
- 本地 hard-check 能抓到 KaTeX / LaTeX 明确错误，但不应变成和 Gemini 并列的第二份报告。
- 部分错误边界很清楚，例如 `eqnarray`、行内 `align`、`\text{... mem_sbrk ...}` 这类 KaTeX 兼容性问题，适合作为受控的小修复入口。

本次能力边界：

- 每次运行仍归档完整页面截图，并生成 `report.html`、`report.md`、`manifest.json`。
- 本地浏览器证据包括 HTTP / console / 横向溢出 / 坏图 / KaTeX 错误 / 直接暴露的 LaTeX 环境源码。
- Gemini 多模态审查接收全页概览图、证据区域高质量 crop，以及结构化 `local_findings`。
- 人类报告只展示统一后的 `visual_findings`，不会把 hard-check 和 Gemini review 拆成两份结论。
- 默认 `--review-mode changed` 只对截图输入、本地证据、viewport、provider/model 或审查版本变化的页面重新调用 Gemini。
- 小修复默认开启，但必须是 allowlist 规则；需要纯审查时使用 `--no-visual-fix`。
- 小修复不能让模型自由改正文，只能处理边界清晰、可机械验证的局部语法错误。
- 报告必须总结 Agent 已执行的内容修改，包括文件、规则、修改摘要和替换前后片段。
- `visual-check` 在默认构建前会清理 Astro 生成内容缓存，避免 Markdown 小修复后复核截图仍读取旧 content store。

当前 LaTeX 安全修复规则：

- `escape-text-underscore`：只在数学公式的 `\text{...}` 内转义裸下划线，例如 `mem_sbrk` -> `mem\_sbrk`。
- `eqnarray-to-aligned`：只把独立 display math 中的 `\begin{eqnarray}` / `\end{eqnarray}` 改成 `aligned`，并把对齐列分隔符从 `&=&` 规整为 `&= ...`。
- `inline-align-to-display-aligned`：只处理 `$$\begin{align} ... \end{align}$$` 这种单行 display math，将其改为多行 `aligned`。

专题文档：

- [`format-check-agent.md`](./format-check-agent.md)
- [`workflow-and-usage.md`](./workflow-and-usage.md)
