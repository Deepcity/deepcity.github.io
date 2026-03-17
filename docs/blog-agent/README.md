# Blog Agent 文档索引

这组文档描述当前仓库已经落地的博客 Agent 系统实现，而不是历史方案草稿。

- 历史规划稿：[`docs/agent_feat_plan.md`](../agent_feat_plan.md)
- 当前实现代码入口：[`scripts/blog-agent.ts`](/home/deepc/deepcity.github.io/scripts/blog-agent.ts)
- Agent 核心目录：[`src/agent`](/home/deepc/deepcity.github.io/src/agent)
- 页面接入点：[`src/layouts/PostDetails.astro`](/home/deepc/deepcity.github.io/src/layouts/PostDetails.astro)
- 页面面板组件：[`src/components/AgentPanel.astro`](/home/deepc/deepcity.github.io/src/components/AgentPanel.astro)

## 文档导航

- [`architecture.md`](./architecture.md)
  说明整体架构、模块划分、sidecar/memory 数据布局，以及页面和 CI 的接线方式。
- [`format-check-agent.md`](./format-check-agent.md)
  说明负责博客格式检查与机械修复的 Agent 子系统。
- [`review-agent.md`](./review-agent.md)
  说明负责文章结构点评和技术点评的 Review Agent。
- [`workflow-and-usage.md`](./workflow-and-usage.md)
  说明 CLI、CI、构建时行为、常用命令和运维排障。
- [`homepage-agent-panel.md`](./homepage-agent-panel.md)
  说明首页 Agent 栏的双栏布局、独立 sidecar、CLI 命令以及宽度对齐策略。

## 系统目标

当前这套 Agent 系统有两个主要职责：

1. 对 `src/data/blog/**/*.md` 做基于真实仓库约束的格式检查，并自动修复安全的机械性问题。
2. 为每篇文章生成静态审稿 sidecar，供文章页展示 Agent 栏，也供 CLI / CI 输出集中报告。

这套系统刻意不做两件事：

- 不在访客侧在线调用模型。
- 不把 review sidecar 直接塞回 frontmatter。

补充：

- 文章元信息支持通过显式 CLI 开关触发 frontmatter 生成或补全。
- 也就是说，默认流程仍以 sidecar 为主；只有你主动要求时，Agent 才会回写 frontmatter。

## 当前运行形态

Agent 系统由四层组成：

1. CLI 层
   入口是 [`scripts/blog-agent.ts`](/home/deepc/deepcity.github.io/scripts/blog-agent.ts)。
2. 核心编排层
   入口是 [`src/agent/analyzer.ts`](/home/deepc/deepcity.github.io/src/agent/analyzer.ts)。
3. 数据层
   sidecar 和 memory 都存放在 [`src/data/agent`](/home/deepc/deepcity.github.io/src/data/agent)。
4. 展示层
   页面通过 [`src/agent/site.ts`](/home/deepc/deepcity.github.io/src/agent/site.ts) 读取 sidecar；文章页和首页分别渲染各自的 Agent 面板。

## 你应该先看哪一篇

- 如果你想理解系统全貌：先看 [`architecture.md`](./architecture.md)。
- 如果你要改 lint / fix 规则：先看 [`format-check-agent.md`](./format-check-agent.md)。
- 如果你要改评论生成逻辑：先看 [`review-agent.md`](./review-agent.md)。
- 如果你要改首页 Agent 栏：先看 [`homepage-agent-panel.md`](./homepage-agent-panel.md)。
- 如果你只想知道怎么跑：直接看 [`workflow-and-usage.md`](./workflow-and-usage.md)。
