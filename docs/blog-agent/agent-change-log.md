# Blog Agent 更新记录

本文记录 Blog Agent 自身能力的变更。每次修改 Agent 行为、CLI、报告格式、修复规则或运行约定时，都应在这里追加一条记录，再按需更新对应专题文档。

## 2026-09-22 审稿可信度、缓存失效与只读 CI

背景：

- Review prompt 只带 160 字 excerpt，`technical_review` / `public_commentary` 实际是基于标题和 tags 推测。
- sidecar 跳过逻辑只看 `source_hash`：换模型、改 prompt 都不会失效；Gemini 一次超时写入的 heuristic 结果会被永久钉住。
- `deploy.yml` 在 CI 里跑完整 sync，会改写 Markdown 和 sidecar 但不提交，线上内容与仓库不一致，并且每次部署都重新调用 Gemini。
- API key 挂在 URL query 上，curl 分支下可通过进程参数看到。

本次改动：

- Gemini review prompt 携带完整正文（`BLOG_AGENT_MAX_BODY_CHARS`，默认 24000，超长保留头尾）、标题大纲、negative-patterns；system instruction 要求评审引用具体章节。请求带 `responseSchema`。
- Gemini 请求对 429 / 5xx / 超时 / 网络错误做指数退避重试（`BLOG_AGENT_GEMINI_RETRIES`、`BLOG_AGENT_GEMINI_RETRY_DELAY_MS`）。
- API key 改走 `x-goog-api-key` header；curl 通过 0600 临时 header 文件传入。
- sidecar 新增 `review_key`（source_hash + provider + model + prompt_version）、`prompt_version`、`related_post_ids`。任一变化或上次 `degraded` 都会重跑；只有 knowledge-map 变化时原地刷新 knowledge 字段，不调模型。
- `auto` 模式下 Gemini 不可用时不再用 heuristic 覆盖已有 Gemini sidecar。
- `--mode ci` 变为真正的只读模式：不写文件、不调 LLM，报告 `stale` / `missing`；`--strict` 让它们导致非零退出。`--changed --base <ref>` 支持对比基准分支。
- `ci.yml` 在 PR 上以 `--strict` 校验改动文章；`deploy.yml` 只审计并上传报告，构建始终使用仓库里已提交的 sidecar。CI 不再需要 `GEMINI_API_KEY`，去掉 `continue-on-error`。
- `./agent` wrapper 自动加载 `.env`。
- `git.ts` 不再吞掉 git 错误。
- memory / knowledge-map 只在内容变化时写盘；`--all` 运行结束后自动清理已删除或重命名文章遗留的 sidecar 与 memory 条目（`--mode ci` 下只报告）。
- 系列 / 首页主题分类统一由 `default-global-rules.ts` 定义（`series_naming_rules.tag_triggers` / `role_label`、`home_tracks`），`knowledge.ts` 与 `home-panel.ts` 不再各自硬编码。
- `REPO_ROOT` 通过 `git rev-parse --show-toplevel` 推导（可用 `BLOG_AGENT_REPO_ROOT` 覆盖）。
- `analyzePosts` 支持 `--concurrency`（默认 2）并行审稿，memory 写入保持串行。
- 新增 `src/agent/types.ts` 共享类型；除 `src/agent/core/visual/*` 与测试外，agent 源码已全部移除 `@ts-nocheck`，两个 Astro 面板组件改用共享 sidecar 类型。无类型边界（LLM 响应、旧版 memory 格式、YAML override）统一标注为 `RawJson`。
- `visual-check.ts`（3014 行）拆分为 `core/visual/` 下 13 个模块 + 109 行编排入口，对外 API 不变；与原始单文件版本对比 107 个页面，审查结论完全一致（仅站外图片加载这一既有网络抖动会浮动）。
- frontmatter 的 description/tags 改由模型基于完整正文生成（`core/frontmatter-assist.ts`），仅在字段缺失或为占位值时调用；显式 `--hint` 始终优先，无 key / 调用失败时回退到原规则产出。显式 `tags:` hint 不再被推断标签补齐。

迁移说明：

- 已有 sidecar 都没有 `review_key`，下一次本地 `./agent --all` 会全量重新生成一次并需要提交。

专题文档：

- [`workflow-and-usage.md`](./workflow-and-usage.md)
- [`improvement-plan.md`](./improvement-plan.md)

## 2026-07-09 Visual Check 证据模型与 LaTeX 小修复

背景：

- `visual-check` 已经能保存全量页面截图，但早期人机交互主要依赖大 JSON，人工审查成本高。
- Gemini 只看高压缩全页图时，容易漏掉长文深处的公式渲染错误。
- 本地 hard-check 能抓到 KaTeX / LaTeX 明确错误，但不应变成和 Gemini 并列的第二份报告。
- 部分错误边界很清楚，例如 `eqnarray`、行内 `align`、`\text{... mem_sbrk ...}` 这类 KaTeX 兼容性问题，适合作为受控的小修复入口。

本次能力边界：

- 每次运行仍归档完整页面截图，并生成 `report.html`、`report.md`、`manifest.json`。
- 本地浏览器证据包括 HTTP / console / 横向溢出 / 坏图 / KaTeX 错误 / 直接暴露的 LaTeX 环境源码。
- Gemini 多模态审查接收全页概览图、证据区域高质量 crop，以及结构化 `local_findings`。
- 人类报告只展示统一后的 `visual_findings`，不会把 hard-check 和 Gemini review 拆成两份结论。
- 默认 `--review-mode changed` 只对截图输入、本地证据、viewport、provider/model 或审查版本变化的页面重新调用 Gemini。
- 小修复默认开启，但必须是 allowlist 规则；需要纯审查时使用 `--no-visual-fix`。
- 小修复不能让模型自由改正文，只能处理边界清晰、可机械验证的局部语法错误。
- 报告必须总结 Agent 已执行的内容修改，包括文件、规则、修改摘要和替换前后片段。
- `visual-check` 在默认构建前会清理 Astro 生成内容缓存，避免 Markdown 小修复后复核截图仍读取旧 content store。

当前 LaTeX 安全修复规则：

- `escape-text-underscore`：只在数学公式的 `\text{...}` 内转义裸下划线，例如 `mem_sbrk` -> `mem\_sbrk`。
- `eqnarray-to-aligned`：只把独立 display math 中的 `\begin{eqnarray}` / `\end{eqnarray}` 改成 `aligned`，并把对齐列分隔符从 `&=&` 规整为 `&= ...`。
- `inline-align-to-display-aligned`：只处理 `$$\begin{align} ... \end{align}$$` 这种单行 display math，将其改为多行 `aligned`。

专题文档：

- [`format-check-agent.md`](./format-check-agent.md)
- [`workflow-and-usage.md`](./workflow-and-usage.md)
