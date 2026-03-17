# Blog Agent 架构与代码设计

本文描述当前仓库里已经实现的 Blog Agent 系统结构。

## 1. 总体架构

系统分成 5 个层次：

1. 命令入口层
   由 [`scripts/blog-agent.ts`](/home/deepc/deepcity.github.io/scripts/blog-agent.ts) 负责解析命令、收集目标文章、输出 CLI 报告。
2. 编排层
   由 [`src/agent/analyzer.ts`](/home/deepc/deepcity.github.io/src/agent/analyzer.ts) 负责串联检查、修复、审稿、sidecar 写入和 memory 更新。
3. 规则与分析层
   包括 schema 解析、frontmatter 读写、Markdown 结构分析、硬校验、标签归一化等模块。
4. Provider 层
   负责根据配置选择 Gemini 或 heuristic provider 生成 ReviewResult。
5. 数据与展示层
   负责存取 `src/data/agent` 下的 sidecar/memory，并在文章页静态渲染 Agent 栏。

## 2. 核心执行链

单篇文章的标准执行顺序如下：

1. 读取 Markdown 文件并解析 frontmatter。
2. 读取真实内容 schema。
3. 读取 global rules、series/topic/negative memory。
4. 如果显式启用了 `--generate-frontmatter`，先基于正文和 hint 生成或补全 frontmatter。
5. 执行硬校验和安全自动修复。
6. 组装 review 输入。
7. 调用 provider 生成结构化点评。
8. 写入 sidecar JSON。
9. 更新 series/topic/negative memory。

对应代码主要在 [`src/agent/analyzer.ts`](/home/deepc/deepcity.github.io/src/agent/analyzer.ts)。

## 3. 目录结构

### 3.1 Agent 代码目录

[`src/agent`](/home/deepc/deepcity.github.io/src/agent) 下的模块职责如下：

- [`constants.ts`](/home/deepc/deepcity.github.io/src/agent/constants.ts)
  定义根目录、sidecar/memory 路径、默认 provider/model、可安全修复的 issue code。
- [`schema.ts`](/home/deepc/deepcity.github.io/src/agent/schema.ts)
  从 [`src/content.config.ts`](/home/deepc/deepcity.github.io/src/content.config.ts) 解析出真实内容 schema。
- [`frontmatter.ts`](/home/deepc/deepcity.github.io/src/agent/frontmatter.ts)
  负责 Markdown frontmatter 的解析与重写。
- [`markdown.ts`](/home/deepc/deepcity.github.io/src/agent/markdown.ts)
  负责 heading、代码块、图片、裸链接、段落等结构分析，并推断代码块语言。
- [`post-snapshot.ts`](/home/deepc/deepcity.github.io/src/agent/post-snapshot.ts)
  把单篇 Markdown 组装成 analyzer 可消费的 snapshot。
- [`checks.ts`](/home/deepc/deepcity.github.io/src/agent/checks.ts)
  负责格式检查、标签归一化、description/slug 建议、安全自动修复。
- [`frontmatter-generator.ts`](/home/deepc/deepcity.github.io/src/agent/frontmatter-generator.ts)
  负责在显式开关下，基于正文与 hint 生成或补全 frontmatter。
- [`provider.ts`](/home/deepc/deepcity.github.io/src/agent/provider.ts)
  负责 provider 选择和 fallback。
- [`providers/heuristic.ts`](/home/deepc/deepcity.github.io/src/agent/providers/heuristic.ts)
  本地启发式审稿器，不依赖外部 API。
- [`providers/gemini.ts`](/home/deepc/deepcity.github.io/src/agent/providers/gemini.ts)
  Gemini API provider，要求 `GEMINI_API_KEY`。
- [`memory-store.ts`](/home/deepc/deepcity.github.io/src/agent/memory-store.ts)
  负责 global rules、series、topics、negative patterns 的存取和兼容迁移。
- [`git.ts`](/home/deepc/deepcity.github.io/src/agent/git.ts)
  负责 `--changed` 模式下的 git 变更集收集。
- [`site.ts`](/home/deepc/deepcity.github.io/src/agent/site.ts)
  负责页面构建时读取 sidecar。

### 3.2 数据目录

[`src/data/agent`](/home/deepc/deepcity.github.io/src/data/agent) 下保存 Agent 产物：

- [`src/data/agent/posts`](/home/deepc/deepcity.github.io/src/data/agent/posts)
  每篇文章一个 sidecar JSON，路径镜像 `src/data/blog`。
- [`src/data/agent/memory/global.json`](/home/deepc/deepcity.github.io/src/data/agent/memory/global.json)
  全局规则，包括 tag registry、series 命名规则、审稿 rubric、provider 默认配置。
- [`src/data/agent/memory/series.json`](/home/deepc/deepcity.github.io/src/data/agent/memory/series.json)
  L2 系列级记忆。
- [`src/data/agent/memory/topics.json`](/home/deepc/deepcity.github.io/src/data/agent/memory/topics.json)
  L2 主题标签级记忆。
- [`src/data/agent/memory/negative-patterns.json`](/home/deepc/deepcity.github.io/src/data/agent/memory/negative-patterns.json)
  复发问题模式记忆。

## 4. sidecar 设计

每篇文章的 sidecar 都是静态 JSON，主要字段由 [`src/agent/analyzer.ts`](/home/deepc/deepcity.github.io/src/agent/analyzer.ts) 统一生成。

核心字段：

- `post_id`
- `source_path`
- `route_path`
- `source_hash`
- `generated_at`
- `run_mode`
- `provider`
- `model`
- `summary`
- `structural_review`
- `technical_review`
- `strengths`
- `concerns`
- `action_items`
- `severity`
- `confidence`
- `memory_refs`
- `series_key`
- `tags_snapshot`
- `hard_checks`
- `fixes_applied`

其中 `route_path` 应始终使用站内 canonical route 形式，即全小写 kebab-case，例如 `/posts/api-agent-embedding-mcp-skills`。

设计原则：

- 页面渲染只读 sidecar，不触发运行时推理。
- sidecar 使用“旁路 JSON”，不污染 frontmatter。
- `source_hash` 用来标记 sidecar 是否对应当前文章内容。

## 5. memory 设计

### 5.1 L1: 全局规则

L1 存在于 [`global.json`](/home/deepc/deepcity.github.io/src/data/agent/memory/global.json)，包括：

- provider 默认值
- 审稿 rubric
- 标准标签库
- 系列命名规则

其默认种子定义在 [`default-global-rules.ts`](/home/deepc/deepcity.github.io/src/agent/default-global-rules.ts)。

### 5.2 L2: 系列 / 主题 / 负面模式

L2 是增量更新的聚合记忆：

- `series.json`
  保存系列下的文章列表、缺失项、期望总数。
- `topics.json`
  保存标签到文章集合的映射。
- `negative-patterns.json`
  保存高频问题模式，例如 `body-h1`、`missing-code-language`。

### 5.3 L3: 单篇文章

L3 直接就是每篇 sidecar，本质上是“单篇文章记忆 + 页面展示数据”的统一载体。

## 6. 兼容策略

旧的 `.github/agents` 文档和 memory 不是运行时真相，但仍被当作初始 seed 参考。

当前兼容逻辑主要体现在 [`memory-store.ts`](/home/deepc/deepcity.github.io/src/agent/memory-store.ts)：

- 可以兼容旧版 object 结构的 `series/topics/patterns`。
- 可以把旧版 `global.json` 合并进新版默认规则。
- 如果旧版全局规则缺少 `series_naming_rules` 或关键词集合，则回退到默认规则。

## 7. 页面接入

页面接入很简单：

1. 文章页在 [`src/layouts/PostDetails.astro`](/home/deepc/deepcity.github.io/src/layouts/PostDetails.astro) 调用 [`loadAgentSidecar`](/home/deepc/deepcity.github.io/src/agent/site.ts)。
2. sidecar 被传给 [`src/components/AgentPanel.astro`](/home/deepc/deepcity.github.io/src/components/AgentPanel.astro)。
3. 若 sidecar 不存在，显示空态，不触发任何在线请求。

## 8. CI 接入

CI 在 [.github/workflows/ci.yml](/home/deepc/deepcity.github.io/.github/workflows/ci.yml) 中做两件事：

1. 对变更文章执行 `agent:build-panel -- --changed --mode ci`。
2. 把报告写入 `.tmp/blog-agent-report.json` 并作为 artifact 上传。

这里使用 `continue-on-error: true`，因此 Agent 只提示，不阻断合并。
