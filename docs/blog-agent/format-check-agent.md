# 格式检查 Agent

本文描述当前负责博客格式检查与机械修复的 Agent 子系统。

## 1. 职责边界

格式检查 Agent 负责三件事：

1. 基于真实 schema 检查 frontmatter 必填项。
2. 检查 Markdown 基础结构问题。
3. 自动修复安全且机械的问题。

它不负责：

- 对正文做大段改写。
- 重写技术观点。
- 在默认模式下自动修改 description、slug、tags 这类带语义判断的内容。

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
npm run agent:analyze -- src/data/blog/CMU-15213-BombLab.md
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
