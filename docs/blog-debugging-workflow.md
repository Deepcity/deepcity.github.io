# Blog 调试范例与工作流

本文记录博客文章、页面展示、构建产物和 Agent sidecar 的日常调试方式。它属于博客整体调试文档；Agent 只是调试链路中的一个环节，不属于 `docs/blog-agent/` 的子系统说明。

## 调试原则

- 文章正文仍然是唯一需要认真维护的源内容。
- sidecar、memory、knowledge-map 都应由 `./agent` 生成或刷新。
- 只修肉眼可见的明显错误，例如 frontmatter、路径、裸 URL、格式污染、渲染报错。
- 不为了迎合 Agent 手动维护大块结构化数据。
- heuristic 只能作为保底；如果生成结果 degraded，CLI、sidecar 和页面都必须明显提示，不能当作正常 Gemini 结果混过去。

## 0. 环境准备

仓库根目录的 `agent` wrapper 会自动读取根目录 `.venv`。本地可以这样写：

```bash
GEMINI_API_KEY=your_api_key
BLOG_AGENT_MODEL=gemini-3.5-flash
```

`.venv` 已被 `.gitignore` 忽略，不能提交。

常用命令默认从仓库根目录执行：

```bash
./agent --changed
```

```bash
pnpm run test:agent
```

```bash
pnpm run build
```

## 1. 单篇文章调试

适用场景：

- 新写一篇文章后想看 sidebar Agent 效果。
- 某篇文章侧栏 stale 或 degraded。
- 只想重跑一篇，不想刷新全站。

范例：

```bash
./agent analyze src/data/blog/algorithm-tree-palindrome-path-query.md --force
```

检查重点：

- CLI 是否输出 `Provider gemini failed`。
- sidecar 是否写入 `src/data/agent/posts/algorithm-tree-palindrome-path-query.json`。
- sidecar 中 `provider` 是否为 `gemini`。
- `degraded_notes` 是否为空。

快速检查某篇 sidecar：

```bash
node -e "const d=require('./src/data/agent/posts/algorithm-tree-palindrome-path-query.json'); console.log(d.provider, d.model, d.degraded_notes?.length ?? 0)"
```

如果 degraded：

1. 先单篇重跑一次。
2. 如果仍然失败，查看错误是否是 Gemini 返回 JSON 格式不稳定。
3. 修 provider 解析或 prompt，而不是静默接受 heuristic。
4. 确实只能保底时，保留 degraded 提示。

## 2. 迁移文章调试

适用场景：

- 把旧 Markdown 或附件文章迁移到网站。
- 想先试 sidebar Agent，再决定是否公开。
- 需要保留真实写成时间，避免迁移日期污染文章排序。

推荐流程：

1. 调试阶段可以先放在 `src/data/blog/_agent-experiment/`。
2. `pubDatetime` 保留文章原始写成时间。
3. 调试时可使用 `draft: true`，避免进入正式列表。
4. 调试时不要用 `modDatetime` 伪造近期更新；如果临时写过，发布前必须删除。
5. 准备发布时移动到 `src/data/blog/` 根目录。
6. 发布时改为 `draft: false`，删除 `agentExperiment` 与 `agentExperimentNote`。
7. 只有作者确实改写正文或补充内容时，才写真实的 `modDatetime`。
8. 运行 Agent 刷新 sidecar、memory、knowledge-map 和首页。

范例：

```bash
./agent src/data/blog/mindspore-05-construct-network.md --force
```

```bash
./agent build-home-panel --force
```

迁移后检查：

```bash
rg "_agent-experiment" src/data/agent src/data/blog
```

正常情况下，正式发布文章不应在 `src/data/agent` 或 `src/data/blog` 中残留 `_agent-experiment` 路径。

## 3. 系列文章与知识网络调试

适用场景：

- 某篇文章需要结合系列位置点评。
- sidebar 相关链接不对。
- Agent 对文章定位太泛。

先刷新知识网络：

```bash
./agent refresh-knowledge
```

检查 override：

```bash
./agent check-knowledge
```

只在明显错误时修改：

- `src/data/agent/knowledge/overrides.yml`

推荐只写轻量 override，例如：

```yaml
posts:
  mindspore-05-construct-network:
    role: "网络构建章节"
    position_summary: "位于 MindSpore 系列中部，承接 Tensor/Dataset，向自动微分和训练过渡。"
```

不要为每篇文章都手写完整结构。能从文件名、frontmatter、标签和正文推断的，就交给 Agent。

## 4. 首页 Agent 调试

适用场景：

- 首页 Agent 输出被新 draft 或试验文章污染。
- 新迁移文章发布后首页统计不对。
- 想确认首页使用 Gemini 而不是 heuristic。

刷新首页：

```bash
./agent build-home-panel --force
```

检查首页 sidecar：

```bash
node -e "const h=require('./src/data/agent/site/index.json'); console.log(h.provider, h.model, h.content_stats.total_posts, h.content_stats.latest_post_title)"
```

正常输出应类似：

```text
gemini gemini-3.5-flash 33 OSDI22-Orca: A Distributed Serving System for Transformer-Based Generative Models
```

如果首页把 draft 算进去了，优先检查：

- `src/agent/core/home-panel.ts`
- `src/utils/postFilter.ts`
- 文章 frontmatter 中的 `draft`

## 5. 页面预览调试

启动本地服务：

```bash
pnpm run dev --host 0.0.0.0
```

常看页面：

```text
/posts/algorithm-tree-palindrome-path-query/
/posts/mindspore-05-construct-network/
/posts/pgstudy-characterization-llm-development-datacenter/
/
```

检查重点：

- sidebar 是否显示 Agent 旁批。
- Gemini 标识、模型名、degraded 提示是否正确。
- public commentary 是否渲染 Markdown 后仍不破坏布局。
- 相关文章链接是否存在且不虚构。
- 移动端 sidebar 是否溢出或遮挡正文。

## 6. 常见问题

### Gemini 返回坏 JSON

现象：

```text
Provider gemini failed: Unexpected non-whitespace character after JSON
```

处理：

1. 单篇重跑。
2. 如果重复出现，修 `src/agent/providers/gemini.ts` 的 JSON 提取或 prompt。
3. 增加 `tests/blog-agent.test.ts` 回归测试。
4. 确认新 sidecar 没有 `degraded_notes`。

### 构建出现 duplicate id

先确认是否还有旧试验路径：

```bash
rg "_agent-experiment" src/data/agent src/data/blog
```

如果源码里没有残留，但本地构建仍提示重复 id，通常是 `.astro` 本地 content cache 过期。`.astro` 是 ignored 缓存，可以移走后重建：

```bash
mv .astro /tmp/astro-cache-backup
pnpm run build
```

### Pagefind 数量不对

先跑生产构建：

```bash
pnpm run build
```

看输出中的：

```text
Indexed 33 pages
```

如果数量不对，检查：

- 新文章是否 `draft: false`。
- `pubDatetime` 是否在未来。
- `src/utils/postFilter.ts` 是否过滤了文章。
- 新文章是否真的位于 `src/data/blog/`。

### sidecar stale

常见原因：

- 修改正文后没有重跑 Agent。
- 手动移动文章后 sidecar 仍指向旧路径。
- 只刷新了首页，没有刷新单篇文章。

处理：

```bash
./agent analyze src/data/blog/你的文章.md --force
./agent build-home-panel --force
```

## 7. 发布前清单

发布前至少跑：

```bash
git diff --check
```

```bash
pnpm run test:agent
```

```bash
pnpm run build
```

再确认：

- `.venv` 没有 staged。
- `dist/`、`.astro/`、`.tmp/`、`public/pagefind/` 没有 staged。
- 新文章 sidecar 是 Gemini 结果，除非明确接受 degraded 保底。
- 首页 Agent 的 `content_stats.total_posts` 与预期一致。
- 构建没有 duplicate id 警告。

发布时如果本地 hook 损坏，但上述检查都通过，可以使用：

```bash
git commit --no-verify -m "feat: publish agent-reviewed blog articles"
```

如果 GitHub 凭据不可用，推送会失败：

```text
fatal: could not read Username for 'https://github.com': No such device or address
```

这时需要先登录：

```bash
gh auth login
```

然后再推送：

```bash
git push origin main
```
