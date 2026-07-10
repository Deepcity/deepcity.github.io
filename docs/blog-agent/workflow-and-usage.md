# 工作流与使用方法

本文描述 Blog Agent 的日常工作流和命令用法。

## 1. 常用命令

日常推荐使用仓库根目录的可执行入口：

```bash
./agent
```

无参时默认处理 git 变更集中的文章，等价于：

```bash
./agent --changed
```

常用命令：

- `./agent`
- `./agent src/data/blog/你的文章.md`
- `./agent --changed`
- `./agent --all`
- `./agent refresh-knowledge`
- `./agent check-knowledge`
- `./agent visual-check`
- `./agent --check`
- `npm run test:agent`

`package.json` 中的 `npm run agent:*` 脚本仍保留，主要用于兼容和排障。

## 2. CLI 子命令

CLI 入口是根目录 [`agent`](/home/deepc/deepcity.github.io/agent)，内部会编译并调用 [`scripts/blog-agent.ts`](/home/deepc/deepcity.github.io/scripts/blog-agent.ts)。

支持一个推荐入口和若干底层主命令。

### 2.0 默认智能入口

`./agent` 默认对应一个统一工作流，面向“我刚写了一篇文章，帮我处理好它”这个任务，而不是要求手动拆成多个内部阶段。

默认会做：

- 自动识别目标文章（单篇 / `--changed` / `--all`）
- 刷新轻量 knowledge-map
- 尝试补全或完善 frontmatter
- 执行格式检查与安全修复
- 生成文章 sidecar / Agent panel
- 更新 memory
- 刷新首页 Agent 导览 sidecar

最常用示例：

```bash
./agent src/data/blog/你的文章.md
```

```bash
./agent --changed
```

```bash
./agent --all
```

如果你已经写好了路径，还想顺手给 frontmatter 生成一点自然语言提示，也可以直接把提示跟在路径后面：

```bash
./agent src/data/blog/你的文章.md "偏向系统工程视角，标签包含 Agent 和 MCP"
```

也支持显式子命令形式：

```bash
./agent sync src/data/blog/你的文章.md
```

### 2.1 底层子命令
支持以下底层主命令：

### 2.2 analyze

对目标文章执行完整分析：

- 格式检查
- 安全修复
- Review 生成
- sidecar 写入
- memory 更新

示例：

```bash
./agent analyze src/data/blog/CMU-15213-ShellLab.md
```

```bash
./agent analyze --changed
```

```bash
./agent analyze --all
```

### 2.3 build-panel

只生成 sidecar 面板数据，不写回 Markdown，不做前端在线请求。

适合：

- CI
- 构建前静态更新 sidecar

示例：

```bash
./agent build-panel --changed
```

```bash
./agent build-panel src/data/blog/API-Agent-Embedding-MCP-Skills.md
```

### 2.4 build-home-panel

为首页生成专用的静态 Agent 导览 sidecar。

示例：

```bash
./agent build-home-panel
```

如果要强制使用 Gemini：

```bash
./agent build-home-panel --provider gemini
```

如果要显式回退本地启发式生成：

```bash
./agent build-home-panel --provider heuristic
```

输出文件默认写入：

- [`src/data/agent/site/index.json`](/home/deepc/deepcity.github.io/src/data/agent/site/index.json)

### 2.5 refresh-memory

只刷新 memory，不重新跑完整 review。

示例：

```bash
./agent refresh-memory all
```

```bash
./agent refresh-memory post src/data/blog/CMU-15213-ShellLab.md
```

```bash
./agent refresh-memory series cmu-15213
```

### 2.6 refresh-knowledge / check-knowledge

只刷新 knowledge-map，不重新调用 Gemini：

```bash
./agent refresh-knowledge
```

也可以写成：

```bash
./agent --refresh-knowledge
```

检查 `src/data/agent/knowledge/overrides.yml` 是否引用了不存在的文章、重复排序或未知系列：

```bash
./agent check-knowledge
```

也可以写成：

```bash
./agent --check
```

### 2.7 visual-check

对构建后的所有静态页面执行视觉归档与显示检查：

```bash
./agent visual-check
```

默认行为：

- 先运行项目 build script（有 `pnpm-lock.yaml` 且可用 pnpm 时使用 `pnpm run build`，否则使用 `npm run build`）
- 从 `dist/**/*.html` 枚举所有页面
- 为每个页面保存完整页面截图
- 写入 `src/data/agent/visual/runs/<runId>/manifest.json`
- 写入 `src/data/agent/visual/runs/<runId>/report.html`
- 写入 `src/data/agent/visual/runs/<runId>/report.md`
- 更新 `src/data/agent/visual/latest.json`
- 如果存在 `GEMINI_API_KEY`，默认只对截图输入或本地证据变化的页面做 Gemini 多模态审查；未变化页面复用上一轮审查结果

审查入口建议：

- `report.html`：默认人工审查入口，包含摘要、问题卡片、截图缩略图和完整截图 gallery。
- `report.md`：适合贴到 PR、issue 或终端审查记录；先给异常页面摘要表，再用可展开详情列出每页问题。
- `manifest.json`：机器消费的完整结构化数据，不建议作为人工主入口；人工判断以报告中的统一 `visual_findings` 为准。

审查证据模型：

- 本地浏览器会先收集坏图、横向溢出、KaTeX 错误、直接暴露的 LaTeX 环境源码等硬证据。
- Gemini 会收到全页概览图、硬证据区域的高质量局部 crop，以及结构化 `local_findings`。
- 最终报告只展示一份去重后的统一结论；本地 hard-check 不再作为另一份报告并排输出。
- 如果 Gemini 单页返回格式错误或超时，本地硬证据仍会进入统一结论，避免已验证问题被吞掉。
- 默认会应用 allowlist 内的 LaTeX 小修复，报告的 `Applied Fixes` 区块会列出源文件、修复规则、修改摘要和替换前后片段。

默认构建前会清理 Astro 生成内容缓存，确保前一次小修复写回 Markdown 后，下一轮截图和 hard-check 基于最新正文。

为降低本地截图环境误报，`visual-check` 会继承 `HTTPS_PROXY` / `HTTP_PROXY` / `ALL_PROXY`，并自动绕过 `127.0.0.1`、`localhost`、`::1`。截图前还会滚动整页触发 lazy images，并对加载失败的外链图片做有限重试。

成本控制：

- 默认 `--review-mode changed`：每次仍保存全量截图和统一报告，但只有页面输入 fingerprint、本地证据 fingerprint、viewport、provider/model 或审查版本变化的页面会重新调用 Gemini。
- `--review-mode all`：强制对所有页面重新做 Gemini 审查，适合修改了 prompt 或想做完整复核时使用。
- `--review-mode none` / `--skip-gemini`：只保存截图和本地浏览器检查，不调用 Gemini。
- `--no-visual-fix`：只审查与归档，不应用默认 LaTeX 小修复。

首次在新机器上使用前，需要安装项目依赖，并确保 Chromium 浏览器缓存存在：

```bash
npm install
npx playwright install chromium
```

使用 pnpm 时对应为：

```bash
pnpm install
pnpm exec playwright install chromium
```

如果只是复用现有 `dist`：

```bash
./agent visual-check --no-build
```

如果只想归档截图，不调用 Gemini：

```bash
./agent visual-check --skip-gemini
```

如果只想审查，不修改 Markdown：

```bash
./agent visual-check --no-visual-fix
```

如果要强制重新审查所有页面：

```bash
./agent visual-check --review-mode all
```

如果要针对某个页面复现视觉问题：

```bash
./agent visual-check --no-build --route /posts/example
```

如果 Gemini 审查响应慢，可以调短单页多模态超时：

```bash
./agent visual-check --gemini-timeout-ms 60000
```

移动端视口检查示例：

```bash
./agent visual-check --viewport 390x1200
```

## 3. 常用 flags

### `--changed`

只处理 git 变更集中的文章。内部通过 [`src/agent/git.ts`](/home/deepc/deepcity.github.io/src/agent/git.ts) 收集：

- unstaged changed
- staged changed
- untracked

### `--all`

处理 `src/data/blog/**/*.md` 全量文章。

### `--no-fix`

关闭安全自动修复，只做检查和报告。

### `--allow-unsafe-fixes`

允许修改：

- description
- slug
- tags

### `--provider`

可选值：

- `auto`
- `gemini`
- `heuristic`

### `--model`

仅在 Gemini provider 下有意义，用于覆盖默认模型。

### `--report-file`

把本次执行结果输出为 JSON 报告，适合 CI artifact。

### `--viewport`

仅用于 `visual-check`，格式为 `WIDTHxHEIGHT`，例如：

```text
390x1200
```

### `--skip-gemini`

仅用于 `visual-check`。保存截图和本地浏览器检查结果，但跳过 Gemini 多模态审查。

### `--generate-frontmatter`

显式启用 frontmatter 生成预处理。适合文章完全没有 frontmatter，或只有零散字段时使用。

注意：在默认智能入口 `./agent` / `./agent sync` 中，这个能力默认就是开启的；只有在你改用底层 `analyze` 时才需要显式加上这个参数。

### `--hint`

给 frontmatter 生成器一段简短提示，可写自然语言，也可写成键值行，例如：

```text
title: Agent Runtime Notes
tags: Agent, MCP
偏向系统工程视角
```

### `--hint-file`

从文件读取较长 hint，适合维护固定模板或系列文章规则。

## 4. 推荐工作流

### 4.1 写完一篇文章后

推荐直接执行：

```bash
./agent src/data/blog/你的文章.md
```

如果你当前在连续改几篇文章，直接让 Agent 自动发现变更集：

```bash
./agent --changed
```

如果你希望明确给它一段自然语言 hint：

```bash
./agent src/data/blog/你的文章.md "偏向系统工程视角，标签包含 Agent 和 MCP"
```

### 4.2 提交前只检查改动文章

```bash
./agent
```

### 4.3 重新生成全站 Agent 栏

```bash
./agent --all
```

### 4.4 验证系统本身

```bash
npm run test:agent
```

## 5. CI 工作流

CI 中的行为定义在 [.github/workflows/ci.yml](/home/deepc/deepcity.github.io/.github/workflows/ci.yml)：

1. 安装依赖
2. 执行 `./agent --changed --mode ci --report-file .tmp/blog-agent-report.json`
3. 上传 JSON 报告 artifact
4. 继续执行 lint / format / build

重要特性：

- Agent 步骤 `continue-on-error: true`
- 因此 Agent 不阻断 PR
- 它只是辅助提示和产物生成

## 6. 页面构建工作流

页面构建时不会调用模型。

真实行为是：

1. 先由 CLI 或 CI 运行统一 Agent 工作流，生成 sidecar 与必要的 Markdown 修复。
2. Astro 构建时通过 [`src/agent/site.ts`](/home/deepc/deepcity.github.io/src/agent/site.ts) 读取 JSON。
3. 文章页在 [`src/layouts/PostDetails.astro`](/home/deepc/deepcity.github.io/src/layouts/PostDetails.astro) 中渲染 [`AgentPanel.astro`](/home/deepc/deepcity.github.io/src/components/AgentPanel.astro)。
4. 首页在 [`src/pages/index.astro`](/home/deepc/deepcity.github.io/src/pages/index.astro) 中渲染 [`HomeAgentPanel.astro`](/home/deepc/deepcity.github.io/src/components/HomeAgentPanel.astro)。

## 7. 环境变量

如果要启用 Gemini provider，需要：

```bash
export GEMINI_API_KEY=your_api_key
```

可选地覆盖模型：

```bash
export BLOG_AGENT_MODEL=gemini-3.5-flash
```

如果不设置 `GEMINI_API_KEY`，系统会回退到 heuristic provider，但 sidecar 和页面都会标记 `degraded`，避免把保底结果当作完整 Agent Review。

## 8. 常见问题

### 8.1 为什么页面没有 Agent 栏内容

通常是因为对应 sidecar 不存在。先执行：

```bash
./agent src/data/blog/目标文章.md
```

### 8.2 为什么 build 时没有调模型

这是设计选择。构建阶段只读 `src/data/agent/posts/*.json`，不做在线调用。

### 8.3 为什么有些问题只给建议，不自动改

因为这些修改带语义判断，例如：

- summary / description
- slug
- tags

只有显式传 `--allow-unsafe-fixes` 才允许自动写回。

### 8.4 为什么 `format:check` 可能仍然失败

`format:check` 检查的是整个仓库。当前仓库里还有一些并非 Agent 系统引入的旧文件格式未统一，因此它和 Agent 的测试是否通过不是同一个问题。
