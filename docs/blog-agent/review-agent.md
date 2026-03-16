# 内容评论 Agent

本文描述当前负责博客内容评论和页面 Agent 栏生成的 Review Agent。

## 1. 职责

Review Agent 的输入是：

- 文章 snapshot
- 格式检查结果
- 相关 series/topic/negative memory

它的输出是一个结构化 ReviewResult，最终写入 sidecar。

Review Agent 负责的不是“事实校验”，而是：

- 结构点评
- 技术点评
- 优点总结
- 负面建议
- 后续 action items

## 2. Provider 设计

Provider 选择逻辑在 [`src/agent/provider.ts`](/home/deepc/deepcity.github.io/src/agent/provider.ts)。

当前有两个 provider：

- [`src/agent/providers/gemini.ts`](/home/deepc/deepcity.github.io/src/agent/providers/gemini.ts)
  通过 Gemini API 生成 JSON 结构化点评。
- [`src/agent/providers/heuristic.ts`](/home/deepc/deepcity.github.io/src/agent/providers/heuristic.ts)
  本地启发式 provider，不依赖外部 API。

策略如下：

1. 若显式指定 `--provider heuristic`，直接使用 heuristic。
2. 若指定 `auto` 或 `gemini`，先尝试 Gemini。
3. 如果未提供 `GEMINI_API_KEY`，或 Gemini 请求失败，则回退到 heuristic。

## 3. ReviewResult 结构

当前 sidecar 中的评论字段包括：

- `summary`
- `structural_review`
- `technical_review`
- `strengths`
- `concerns`
- `action_items`
- `severity`
- `confidence`
- `memory_refs`

这些字段由 [`buildSidecar`](/home/deepc/deepcity.github.io/src/agent/analyzer.ts) 统一写入 JSON。

## 4. heuristic provider 的设计

heuristic provider 的目标不是“模拟大模型”，而是给出一份稳定、低成本、可离线运行的最小审稿结果。

### 4.1 结构点评

结构点评主要参考：

- 标题数量
- 代码块数量
- 图片数量
- 是否存在 `body-h1`
- 是否存在 `heading-skip`

### 4.2 技术点评

技术点评主要按主题类型分支：

- 论文阅读类
- CMU Lab / 课程实验类
- Agent / LLM / MCP 类
- 通用技术文章

### 4.3 strengths / concerns / action items

这些字段基于内容统计和格式检查结果组装：

- strengths 偏向文章已经具备的优点
- concerns 偏向还未解决的问题
- action items 偏向作者接下来可执行的修改建议

## 5. Gemini provider 的设计

Gemini provider 负责把相同输入喂给大模型，并要求它只返回 JSON。

Prompt 中会提供：

- 标题
- tags
- 摘要
- 结构统计
- 硬校验问题
- action items
- 相关 memory refs
- 系列和主题记忆
- 正文摘要片段

这样做的目的是：

- 避免全量正文灌入
- 保留足够的上下文信号
- 让输出保持结构化且可落 sidecar

## 6. severity 与 confidence

### 6.1 severity

最终 severity 取评论结果和硬校验 severity 的最大值。

这意味着：

- 即使 review provider 给出 `info`
- 只要硬检查里有 `warn`
- sidecar 最终 severity 仍然是 `warn`

### 6.2 confidence

confidence 用于表达“这份评论的可靠度”，不是质量分。

- heuristic provider 根据标题、代码块、heading 数量和 memory refs 粗略估算。
- Gemini provider 则直接接受模型返回值，再做边界规整。

## 7. 页面展示

文章页通过 [`src/components/AgentPanel.astro`](/home/deepc/deepcity.github.io/src/components/AgentPanel.astro) 展示以下内容：

- Summary
- Structural
- Technical
- Strengths
- Concerns
- Severity / Confidence / Generated At / Memory refs count

没有 sidecar 时会显示空态。

## 8. 当前设计取舍

这套 Review Agent 当前刻意采用“静态生成 + 构建期读取”模式，而不是请求时调用模型。

优点：

- 页面完全静态
- 不暴露 API key
- CI 和页面读取的是同一份产物

代价：

- 评论不是实时更新
- sidecar 需要显式重跑 CLI 或 CI 才会刷新
