# Agent 架构试验集

`src/data/blog/_agent-experiment/` 只用来放真实文章迁移前的 Agent 调试样本。正式发布时应把文章提升到 `src/data/blog/` 根目录，避免 Astro content loader 对子目录文章的 id 归一化产生重复警告。

当前约定：

- `pubDatetime` 保留原文件中的写成时间。
- 调试阶段可临时设置 `draft: true`，避免样本进入正式发布列表。
- 准备发布时先移动到正式博客目录，再改为 `draft: false`，并删除 `agentExperiment` 与 `agentExperimentNote`。
- 不要把迁移日期写成 `modDatetime`；只有文章正文确实被作者更新时，才写真实更新时间。
- `_agent-experiment` 是以下划线开头的目录，站点路径生成会忽略这个目录名；迁移到正式博客目录后 URL 不会因此变化。

当前迁移状态：

- 2026-07-04：11 篇试验文章已经提升到 `src/data/blog/` 根目录，并作为正式文章发布；正式日期以原文件 `date` 或文件名中的初稿日期为准。

后续迁移到正式网站时，优先只做这些动作：

1. 移动文件到正式位置。
2. 把 `draft` 改为 `false`。
3. 删除 `agentExperiment` 与 `agentExperimentNote`。
4. 只修你肉眼可见的明显内容错误，不需要为了 Agent 维护额外结构。
5. 运行 `./agent --changed --force`，让 sidecar、首页 Agent 和知识网络中的路径一起更新。
