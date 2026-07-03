# Blog Agent Knowledge Map

本文描述 Blog Agent 的轻量知识网络层。它的目标是让文章页 Agent Review 能理解文章在站内系列、主题和前后篇中的位置，同时不增加作者维护负担。

## 1. 设计原则

- 自动推断优先，人工只纠错。
- JSON 是 Agent 产物，YAML 是作者可见的少量 override。
- knowledge-map 不调用模型，只从 Markdown、frontmatter、全局系列规则、已有 sidecar 和 override 推断。
- 知识网络更新不自动重写旧文章评论，只通过 `knowledge_hash` 标记 stale。

## 2. 数据文件

自动产物：

```text
src/data/agent/knowledge/map.json
```

人工纠错入口：

```text
src/data/agent/knowledge/overrides.yml
```

`overrides.yml` 默认保持很小。只有看到明显错误时才需要改，例如系列顺序错误、某篇文章角色判断错误、前后篇关系错误。

示例：

```yaml
version: 1

series:
  ascendc:
    label: "Ascend C 算子开发"
    order:
      - "AscendC-part1-basic-concept"
      - "AscendC-part2-tiling-and-debug"
      - "AscendC-part3-operator-delivery"
      - "AscendC-part4-operator-invocation"
      - "AscendC-part5-pytorch-summary"

posts:
  AscendC-part5-pytorch-summary:
    role: "阶段总结"
    previous:
      - "AscendC-part4-operator-invocation"
    reader_context: "这篇更适合作为系列收束篇，而不是入门篇。"
```

没有写进 override 的字段全部由 Agent 自动推断。

## 3. map.json 内容

`map.json` 当前包含：

- `series`
  - `id`
  - `label`
  - `post_ids`
  - `expected_total`
  - `open_ended`
- `posts`
  - `post_id`
  - `title`
  - `route_path`
  - `series_id`
  - `series_label`
  - `role`
  - `previous_posts`
  - `next_posts`
  - `topic_neighbors`
  - `related_posts`
  - `position_summary`
  - `memory_refs`
- `knowledge_hash`
- `issues`

`related_posts` 是文章 sidebar 可渲染的站内白名单，最多取前置、后续和相邻主题中的少量文章。Gemini 只能从这份白名单里选择引用，不能自由生成站内路径。

## 4. 工作流

推荐日常入口：

```bash
./agent
```

无参时等价于：

```bash
./agent --changed
```

每次 Agent workflow 会先刷新 knowledge-map，再为目标文章生成或复用 sidecar。刷新 knowledge-map 不调用 Gemini。

只刷新知识网络：

```bash
./agent refresh-knowledge
```

检查 override 引用是否有效：

```bash
./agent check-knowledge
```

## 5. stale 策略

文章 sidecar 会记录生成时使用的 `knowledge_hash`。

如果文章内容没变，但 knowledge-map 发生变化，Agent 默认不会重写旧评论，而是在 CLI/CI 报告里标记 `stale-knowledge`。读者页面不会显示这个后台状态。

需要强制重评时再执行：

```bash
./agent --all --force
```

## 6. 页面关系

文章页 sidebar 优先展示 sidecar 的 `public_commentary`。旧 sidecar 没有该字段时，页面 fallback 到旧的 `summary`、`structural_review`、`technical_review`、`strengths` 和 `concerns`。

如果 Gemini 不可用，系统可以生成 heuristic 保底评论，但 sidecar 和页面都会标记 `degraded`，避免把本地规则结果伪装成完整 Agent Review。
