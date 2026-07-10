# 格式检查 Agent

本文描述当前负责博客格式检查与机械修复的 Agent 子系统。

## 1. 职责边界

格式检查 Agent 负责三件事：

1. 基于真实 schema 检查 frontmatter 必填项。
2. 检查 Markdown 基础结构问题。
3. 自动修复安全且机械的问题。
4. 在显式 visual lint 中归档页面截图，并用 Gemini 多模态做基础显示纠错。

它不负责：

- 对正文做大段改写。
- 重写技术观点。
- 在默认模式下自动修改 description、slug、tags 这类带语义判断的内容。

补充说明：

- 现在支持通过显式 CLI 开关触发“frontmatter 生成”预处理。
- 该能力会基于正文和用户 hint 补全完整 frontmatter，然后再进入常规检查阶段。
- 它不是默认行为，不会在普通 `analyze` / `build-panel` 流程里静默改写文章元信息。

主实现位于 [`src/agent/checks.ts`](/home/deepc/deepcity.github.io/src/agent/checks.ts)。

## 2. 真实约束来源

硬规则真相源是 [`src/content.config.ts`](/home/deepc/deepcity.github.io/src/content.config.ts)，通过 [`src/agent/schema.ts`](/home/deepc/deepcity.github.io/src/agent/schema.ts) 解析。

当前必填字段来自 schema：

- `title`
- `pubDatetime`
- `description`

注意：

- `slug` 不在 schema 中，因此当前是建议项，不是硬错误。
- `tags` 在 schema 中有默认值，因此缺失时不会被当成硬错误。

## 3. 检查内容

### 3.1 Frontmatter 检查

格式检查 Agent 当前会检查：

- frontmatter 是否存在
- schema 必填字段是否缺失
- `pubDatetime` 是否可解析
- `draft` 是否显式声明
- `description` 是否为空或过短
- `slug` 是否缺失
- `tags` 是否为空，或是否与标准标签库存在漂移

### 3.2 Markdown 检查

当前会检查：

- 正文是否出现 H1
- 标题层级是否跳级
- 图片是否缺少 alt
- 代码块是否缺少语言标记
- 是否存在裸 URL

Markdown 结构分析在 [`src/agent/markdown.ts`](/home/deepc/deepcity.github.io/src/agent/markdown.ts)。

## 4. 自动修复策略

### 4.1 默认会自动修的内容

只有安全机械修复会默认启用：

- 补全 `draft: false`
- 为空 alt 图片补一个基于文件名的 alt
- 为缺少语言标记的代码块推断语言并补上 fence language

这些 code 由 [`SAFE_FIX_CODES`](/home/deepc/deepcity.github.io/src/agent/constants.ts) 控制。

### 4.2 只有显式允许才会自动修的内容

以下属于“带语义判断”的修改，必须使用 `--allow-unsafe-fixes`：

- 自动生成 `description`
- 自动补 `slug`
- 自动推断 `tags`
- 把 `tags` 归一化到标准标签库

### 4.3 显式 frontmatter 生成

如果文章完全没有 frontmatter，或者只有部分字段，但你希望 Agent 结合正文和 hint 直接补成一版可用元信息，可以显式执行：

```bash
./agent analyze src/data/blog/你的文章.md --generate-frontmatter --hint "偏向系统工程视角，标签包含 Agent 和 MCP"
```

能力边界：

- 会生成或补全 `title`、`pubDatetime`、`description`、`draft`、`tags`、`author`、`slug`、`timezone`
- 如果 hint 里使用 `title:`、`description:`、`tags:`、`draft:` 这类键值行，会优先用作生成提示
- 已显式存在且质量足够的字段默认不会被覆盖；更像“补齐”而不是“强制重写”

## 5. 标签系统

标签规范化依赖 [`default-global-rules.ts`](/home/deepc/deepcity.github.io/src/agent/default-global-rules.ts) 和 [`global.json`](/home/deepc/deepcity.github.io/src/data/agent/memory/global.json) 中的 `tag_registry`。

工作方式：

1. 先建立 alias -> canonical tag 的映射。
2. 对已有 tag 做归一化。
3. 如果文章没有 tag，则根据标题、description 和首段内容做关键词推断。

这意味着当前 tag 推断不是 embedding / semantic search，而是基于规则的关键词匹配。

## 6. issue、建议和修复的关系

格式检查输出三类东西：

- `issues`
  已发现的问题，带 severity。
- `suggestions`
  对 description、slug、tags 的候选建议。
- `fixesApplied`
  已实际写回文件的修复动作。

这三类结果最终都会进入 sidecar：

- `hard_checks`
- `suggestions`
- `fixes_applied`

## 7. 典型执行结果

当运行：

```bash
./agent analyze src/data/blog/CMU-15213-BombLab.md
```

格式检查 Agent 可能产生如下结果：

- `warn`: 正文出现 H1
- `warn`: 某几个代码块缺少语言标记
- `info`: 建议显式加 `draft: false`
- `suggestions.description_suggestion`: 如果摘要过短
- `fixes_applied`: 如果启用了安全修复，会补代码块语言和 draft

## 8. 当前限制

当前格式检查 Agent 仍有几个明确限制：

- frontmatter 解析器是轻量实现，只覆盖仓库当前用法，不是完整 YAML 解析器。
- 代码块语言推断是启发式规则，不保证 100% 正确。
- 裸 URL 只报建议，不自动替换成 Markdown 链接。
- 不会检查外链是否可达。

## 9. Visual lint

`visual-check` 会先构建站点，再从 `dist/**/*.html` 枚举所有静态页面路由，逐页生成完整页面截图。

```bash
./agent visual-check
```

输出归档：

- `src/data/agent/visual/runs/<runId>/screenshots/*.png`
- `src/data/agent/visual/runs/<runId>/report.html`
- `src/data/agent/visual/runs/<runId>/report.md`
- `src/data/agent/visual/runs/<runId>/manifest.json`
- `src/data/agent/visual/latest.json`

人工审查优先打开 `report.html`。它会按摘要、问题页面、截图缩略图和完整截图 gallery 组织结果。

`report.md` 面向 PR / issue / 终端记录，默认只展开摘要表；需要深挖时再打开每个异常页面的详情块。`manifest.json` 主要给 CI 或后续 Agent 消费，不建议作为人工主入口。

检查结果会统一汇总成 `visual_findings`：

- 本地浏览器证据：HTTP 状态、页面脚本错误、console error、横向溢出、坏图、KaTeX 错误、页面中直接暴露的 LaTeX 环境源码。
- Gemini 多模态：接收全页概览图、本地证据对应的高质量局部 crop，以及结构化 `local_findings`，再输出一份统一的显示纠错结论。

本地证据不是第二份人工报告；它会作为已验证证据进入 Gemini prompt，并在最终 `report.html` / `report.md` 中与 Gemini 结论合并去重。即使 Gemini 单页响应失败，已验证的本地证据也会保留在统一 `visual_findings` 中。

`visual-check` 默认会应用 allowlist 内的内容小修复。目前只覆盖边界清晰的 LaTeX / KaTeX 渲染修复，例如转义 `\text{...}` 内裸下划线、把 display math 中的 `eqnarray` 改为 `aligned`、把同一行 `$$\begin{align}...\end{align}$$` 改为多行 `aligned`。报告会在 `Applied Fixes` 区块列出源文件、规则、修改摘要和替换前后片段。

默认只审查输入变化或本地证据变化的页面，未变化页面复用上一轮结果。

默认构建前会清理 Astro 生成内容缓存，确保前一次小修复写回 Markdown 后，下一轮截图和 hard-check 基于最新正文。

截图环境会继承 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`，并自动绕过本地静态服务器地址（`127.0.0.1`、`localhost`、`::1`）。截图前会滚动整页触发 lazy images，并对已失败的外链图片做有限重试，减少本地调试网络抖动造成的坏图误报。

成本控制：

- `--review-mode changed`：默认模式。每次仍全量保存截图和统一报告，但只对页面输入 fingerprint、viewport、provider/model 或审查版本变化的页面调用 Gemini。
- `--review-mode all`：强制全量 Gemini 审查。
- `--review-mode none` / `--skip-gemini`：只归档截图与本地浏览器检查。
- `--review-base-manifest-path <path>`：指定复用哪一轮 manifest 的 Gemini 结果，适合刚跑过局部 smoke 后再做 full run。
- `--no-visual-fix`：只审查与归档，不应用默认 LaTeX 小修复。

如果没有 `GEMINI_API_KEY`，命令仍会保存截图和 manifest，但会把结果标记为 degraded。

常用排障参数：

```bash
./agent visual-check --no-build
./agent visual-check --skip-gemini
./agent visual-check --no-visual-fix
./agent visual-check --review-mode all
./agent visual-check --review-base-manifest-path src/data/agent/visual/runs/full-visual-unified-2026-07-09/manifest.json
./agent visual-check --max-pages 5
./agent visual-check --route /posts/example
./agent visual-check --gemini-timeout-ms 60000
./agent visual-check --viewport 390x1200
```
