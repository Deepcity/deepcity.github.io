 # 纯 API Blog Agent 替换方案

  ## Summary

  建立一套以 API 为核心、可被 CLI 与 GitHub Action 共同调用的 Blog Agent 系统，替代当前 .github/agents/blog-lint.agent.md 所描述的 Copilot/VS Code 专属工作流。
  首版目标不是复刻 Copilot 工具清单，而是保留其中真正有价值的能力，并将其拆成三类：

  - 硬校验：基于仓库真实约束做 frontmatter / Markdown /构建相关检查
  - 审稿点评：对文章结构与技术表达生成 Agent 栏内容，并在 CLI 中集中输出负面建议
  - 层级记忆：在每次 Agent 调度时按增量方式更新全局规则、系列/主题/负面评价记忆、单篇文章记忆

  首版默认行为：

  - 统一 Provider 抽象，默认接 Gemini
  - 默认自动修复可机械修复的问题
  - Agent 栏采用构建前静态生成，不做访客侧在线调用
  - GitHub Action 为软失败提示，不阻断合并
  - 技术点评允许引入外部知识，但只在需要时做受控检索，不做全站全文加载

  ## Key Changes

  ### 1. 核心架构

  新增一个独立的 Agent 核心模块，负责统一以下接口：

  - 输入：单篇文章路径、批量文章路径列表、运行模式 cli|ci|build
  - 输出：
      - 结构化审稿结果
      - 自动修复后的 Markdown
      - 侧栏展示用 sidecar JSON
      - 记忆更新补丁
      - CLI / CI 报告

  核心执行链固定为：

  1. 收集最小上下文
  2. 运行硬校验与机械修复
  3. 组装检索上下文与分层记忆
  4. 调用审稿模型生成结构化点评
  5. 写入单篇 sidecar JSON
  6. 增量更新 Memory
  7. 输出 CLI / CI 报告

  ### 2. 规则层与审稿层分离

  将现有 Copilot Agent 文档中的规则拆成两层，避免把“真实约束”和“写作建议”混在一起：

  - 硬规则
      - 以 src/content.config.ts 和实际构建行为为准
      - 必查：title、pubDatetime、description、tags、Markdown 基本结构、代码块语言、空 alt、显著格式错误
      - slug 在 v1 中视为 建议性字段，不作为 schema 真值；原因是当前 schema 未声明它，站点路由也主要基于 content id
  - 软规则
      - 标签规范化
      - 系列连续性判断
      - 摘要质量
      - 结构评价
      - 技术表达、术语、论证充分性点评

  这样可以避免旧 Agent 文档里的漂移继续污染新系统。

  ### 3. 产物与数据组织

  采用 旁路 JSON 作为主产物，不把 Agent 输出直接塞进 frontmatter。

  数据分三层：

  - L1 全局规则
      - 标签注册表
      - 系列命名规则
      - 审稿 rubric
      - provider / prompt 版本信息
  - L2 系列/主题/负面评价记忆
      - 系列状态
      - 主题簇摘要
      - 复发性问题模式
      - 某篇文章最近一次负面建议摘要
  - L3 单篇文章记忆
      - 当前文章的 Agent 报告
      - 历次评审摘要
      - 上次修复后残留问题
      - 展示到页面 Agent 栏的最终内容

  sidecar JSON 建议为每篇文章独立存储，字段固定为：

  - post_id
  - source_hash
  - generated_at
  - model
  - summary
  - structural_review
  - technical_review
  - strengths
  - concerns
  - action_items
  - severity
  - confidence
  - memory_refs

  其中：

  - 页面 Agent 栏展示 summary + structural_review + technical_review + strengths + concerns
  - CLI 重点展示 concerns + action_items + severity
  - CI 汇总严重项与自动修复结果

  ### 4. Hook 与上下文收敛

  禁止每次调度全量读取所有文章和所有 JSON。上下文收集采用固定增量策略：

  - 单篇 CLI
      - 读取目标文章
      - 读取 L1 全局规则
      - 读取与该文章同系列、同主题的少量 L2 记忆
      - 读取该文章自己的 L3 sidecar
  - 批量 CLI / CI
      - 仅处理变更文章集合
      - 额外读取受影响系列的索引与主题摘要
      - 必要时更新系列状态
  - 构建时 Agent 栏生成
      - 只消费已存在的 sidecar JSON
      - 不在页面构建阶段触发模型调用

  Hook 触发固定为：

  - CLI 手动调度时触发
  - GitHub Action 触发时触发
  - 二者都执行 读取最小上下文 -> 生成/修复 -> 更新 Memory

  不做文件系统实时 watch，不做页面请求时生成。

  ### 5. CLI、CI 与页面集成

  CLI 设计成统一入口，至少包含：

  - analyze <post>
  - analyze --changed
  - analyze --all
  - build-panel <post|--changed>
  - refresh-memory <post|series|all>

  默认执行自动修复，但只修机械性问题；涉及技术判断、段落重写、标签改写时，保留建议并要求显式确认参数后再改。

  GitHub Action 负责：

  - 检测变更文章
  - 调用同一核心分析流程
  - 产出 PR 注释或 artifact 报告
  - 软失败退出，不阻断合并

  页面集成放在 src/layouts/PostDetails.astro：

  - 新增右侧或下方 Agent 栏
  - 首版与目录栏统一成旁栏体系
  - 页面只读取对应文章 sidecar JSON
  - sidecar 不存在时显示空态，不触发在线请求

  ## Public Interfaces / Types

  需要显式定义的公共接口如下：

  - AgentProvider
      - generateReview(input, context) -> ReviewResult
      - generateFixes(input, context) -> FixPlan
  - ReviewResult
      - 固定对应 sidecar JSON schema
  - MemoryStore
      - loadGlobalRules()
      - loadSeriesContext(postId)
      - loadPostMemory(postId)
      - applyUpdates(updates)
  - RunMode
      - cli
      - ci
      - build
  - Severity
      - info
      - warn
      - error

  Prompt 层也分两路：

  - 审稿模型
      - 负责结构点评、技术点评、负面建议、页面栏位摘要
  - 修复模型
      - 负责 frontmatter、标签、格式与局部可机械修复内容

  ## Test Plan
  必须覆盖以下场景：

  - 单篇文章运行：
      - 只读取目标文章与最小相关记忆，不扫描全站
      - 生成 sidecar JSON
      - CLI 输出负面建议
  - 批量变更运行：
      - 仅处理变更文章
      - 正确更新系列/主题 L2 记忆
  - 自动修复：
      - 补全缺失 frontmatter
      - 修正代码块语言标记
      - 发现无法安全自动修复的问题时降级为建议
  - 页面展示：
      - 有 sidecar 时正常渲染 Agent 栏
      - 无 sidecar 时空态稳定
  - CI：
      - 变更文章可产出审稿摘要
      - 严重问题只提示，不阻断
  - 回归：
      - 现有 Astro 构建不因 sidecar 或 Memory 新增而破坏
      - slug 不被错误当成 schema 强校验项

  ## Assumptions

  - 现有 Copilot Agent 文档只作为能力来源，不作为运行时真相。
  - slug 在 v1 不升格为 schema 字段；若后续要把它纳入硬规则，应单独修改内容 schema 与路由语义。
  - sidecar JSON 与 Memory 文件都纳入版本控制，便于页面静态展示与历史对比。
  - L2 负面评价记忆与系列/主题记忆同级管理，不塞进单篇 sidecar。
  - 首版不做浏览器端在线 Agent，不在页面暴露 API key。
  - 页面 Agent 栏内容以“点评”为主，不做读者向花哨总结卡片。