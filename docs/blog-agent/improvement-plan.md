# Blog Agent 改进计划

> 2026-09-22 基于代码审查整理。按优先级从上到下推进，每完成一项在此打勾并记录改动要点。
> 状态：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 完成

## 阶段 1：审稿结果可信度（直接影响读者看到的内容）

- [x] **1.1 把正文真正送进 LLM**
  - 现状：`gemini.ts` prompt 只包含 160 字 excerpt + 结构统计，`technical_review` / `public_commentary` 本质是基于标题脑补。
  - 目标：prompt 携带完整正文（超长时按预算截断并显式告知模型），标题大纲单独列出。
  - 涉及：`providers/gemini.ts`、`core/analyzer.ts`（reviewInput 增加 body）、`parsers/post-snapshot.ts`。
- [x] **1.2 用 `responseSchema` 约束 Gemini 输出**
  - 现状：只设 `responseMimeType`，靠 `sanitizeReview` 的 `String()` 兜底，非法 severity 静默变 `warn`。
  - 目标：请求层带 JSON schema；sanitize 层对非法值记 note 而不是静默吞掉。
- [x] **1.3 缓存 key 纳入模型 / prompt 版本 / knowledge_hash；degraded 结果不参与 skip**
  - 现状：`analyzer.ts` skip 只比较 `source_hash`。换模型、改 prompt、知识图谱变化都不会触发重生成；一次 Gemini 超时写入的 heuristic 结果会被永久钉住。
  - 目标：sidecar 记录 `review_key = hash(source_hash, provider, model, prompt_version, knowledge_hash)`；`degraded: true` 的 sidecar 在有可用 provider 时总是重跑。
- [x] **1.4 Gemini 请求加重试与退避**
  - 现状：单次请求失败直接降级。
  - 目标：对 429 / 5xx / 超时做 2-3 次指数退避重试后再降级；降级原因保留在 sidecar。

## 阶段 2：CI 与产物一致性

- [x] **2.1 明确 sidecar 是 committed artifact，CI 只读**
  - 现状：`deploy.yml` 跑 `./agent --all --mode ci` 走 sync 分支，会改写 `src/data/blog/*.md` 与所有 sidecar / memory，但不提交；线上 ≠ 仓库；每次部署对不匹配的文章重新调 Gemini。
  - 目标：`--mode ci` 真正生效：不写 markdown、不生成 frontmatter、不调用 LLM 重生成（只校验 + 报告缺失/过期 sidecar）。sidecar 由本地 `./agent` 生成并提交。
  - 涉及：`scripts/blog-agent.ts`、`core/sync.ts`、`core/analyzer.ts`、`.github/workflows/*.yml`、`CLAUDE.md`。
- [x] **2.2 CI 去掉 `continue-on-error`，把 agent 失败暴露出来**（在 2.1 之后，CI 只读校验不再依赖网络即可安全去掉）

## 阶段 3：memory / knowledge 一致性

- [x] **3.1 memory 文件仅在内容变化时写入**（去掉无意义的 `updated_at` 抖动）
- [x] **3.2 删除 / 重命名文章后清理孤儿 sidecar 与 memory 条目**
  - 现状：`osdi22-orca.md` → `OSDI22-orca.md` 后旧 sidecar 与 memory 条目残留。
  - 目标：`sync --all` / `refresh-memory all` 时对照 blog 目录做 GC，并在报告里列出被清理的条目。
- [x] **3.3 negative-patterns 真正进入 prompt**（现在计算了但 `buildPrompt` 没用）
- [x] **3.4 系列/主题分类只定义一处**
  - 现状：`default-global-rules.ts` `series_naming_rules`、`home-panel.ts` `TRACK_DEFINITIONS`、`knowledge.ts` 硬编码正则三处重复。
  - 目标：以 global rules 为唯一来源，其余两处从它派生。

## 阶段 4：安全与健壮性小项

- [x] **4.1 API key 改用 `x-goog-api-key` header**（现在在 URL query，curl 分支下进程参数可见）
- [x] **4.2 `agent` wrapper 加载 `.env`**（当前只 source `.venv`）
- [x] **4.3 CLI 严格化**：未知子命令 / 无法解析的目标给出明确错误并列出已知命令。（保留文档化的 `./agent <post> "hint"` 用法，不改为仅 `--hint`）
- [x] **4.4 `git.ts` 不再吞错**：git 失败时抛出而不是返回空列表
- [x] **4.5 `REPO_ROOT` 用 `git rev-parse --show-toplevel` 或脚本位置推导，而非 `process.cwd()`**

## 阶段 5：长期债

- [x] **5.1 逐文件移除 `@ts-nocheck`**，为 sidecar / review / memory 定义共享类型（`src/agent/types.ts`），`AgentPanel.astro` 复用
- [x] **5.2 拆分 `visual-check.ts`（3014 行）** 为 server / capture / review / fixes / report 五个模块，并在 `CLAUDE.md` 架构章节补充说明
- [x] **5.3 `analyzePosts` 有限并发**（在 1.4 重试到位后再做，避免放大限流）

## 变更记录

（按完成顺序追加）

### 2026-09-22 · 阶段 1 + 3.3 / 4.1 / 4.2

- `providers/gemini.ts`
  - prompt 携带完整正文（`BLOG_AGENT_MAX_BODY_CHARS`，默认 24000；超长时保留头 70% + 尾 30% 并告知模型省略量）、标题大纲、negative-patterns；system instruction 要求所有判断落到具体章节。
  - 请求带 `responseSchema`；`sanitizeReview` 对非法 severity / confidence / 越界 related_post_ids 记 note。
  - `withRetry`：对 408/425/429/5xx、超时、传输错误做指数退避（`BLOG_AGENT_GEMINI_RETRIES` 默认 3，`BLOG_AGENT_GEMINI_RETRY_DELAY_MS` 默认 1500）。
  - API key 改走 `x-goog-api-key` header；curl 分支通过 0600 临时 header 文件传入，不再出现在 argv。
  - 导出 `REVIEW_PROMPT_VERSION`（改 prompt 时手动 bump）。
- `core/analyzer.ts`
  - sidecar 新增 `review_key = sha256(source_hash, provider, model, prompt_version)`、`prompt_version`、`related_post_ids`。
  - `resolveSkipReason`：key 不同 → 重生成；degraded 且有 LLM 可用 → 重生成；auto 模式下 LLM 不可用 → 保留已有 LLM sidecar（不会被 heuristic 覆盖）；显式 `--provider heuristic` 才允许覆盖。
  - 只有 knowledge 变化时 → `refreshSidecarKnowledge` 原地更新 related_posts / knowledge_position，不调 LLM。
- `agent` wrapper 同时加载 `.env` 与 `.venv`。
- 验证：`OSDI18-Ray` 重新生成后评审引用了正文具体章节与真实存在的排版/拼写问题；`npm run test:agent` 32/32。
- 注意：所有旧 sidecar 没有 `review_key`，下次 `./agent --all` 会全部重新生成一次（这是预期的：旧评审基于 160 字摘要）。


### 2026-09-22 · 阶段 2 + 4.3 / 4.4

- `--mode ci` 真正只读：`analyzer` / `home-panel` 接受 `regenerate: false`，只报告 `stale` / `missing`；`knowledge.verifyKnowledgeMap` 内存重算并与提交版比对，不写盘。
- `--strict`：stale / missing / hard-check error / 首页或 knowledge 过期 → exit 1。
- `--changed --base <ref>`：CI 里对比 PR 基准分支（原来 CI 中 `--changed` 永远是空集，agent 步骤实际是空跑）。
- `ci.yml`：`fetch-depth: 0` + `--mode ci --strict`，去掉 `continue-on-error`；`deploy.yml`：只审计 + 上传报告，不再传 `GEMINI_API_KEY`。
- `git.ts`：git 命令失败时抛错。
- 验证：`./agent --all --mode ci --strict` 处理 39 篇，磁盘 md5 前后完全一致；报告 32 stale / 6 missing，其中 4 篇是改动前就已经落后于正文的（AscendC-part1/2、MallocLab、ICCV25-AdaLLaVA）。

### 2026-09-22 · 阶段 3 + 4.5

- `shared/fs.ts`：`writeJsonIfChanged`（忽略 `updated_at` / `generated_at` 比较）。memory 三个文件与 `knowledge/map.json` 只在内容变化时落盘，不再每次运行都产生时间戳 diff。
- `core/gc.ts`：`pruneOrphans` 对照全量文章列表清理孤儿 sidecar，并从 series / topics / negative-patterns 里移除已删除文章。所有 `--all` 运行（sync / analyze / build-panel / refresh-memory all）结束后执行；`--mode ci` 下只报告（`--strict` 时算失败）。
- 分类只定义一处：`default-global-rules.ts` 的 `series_naming_rules` 新增 `tag_triggers` / `role_label`，paper-reading 的 `id_pattern` 扩到 EuroSys / ISCA / MICRO / ASPLOS 等；`knowledge.ts` 不再硬编码会议名与 `cmu-15213` 字面量；首页 track 定义迁到 `home_tracks`，`home-panel.ts` 只负责编译正则。
- `constants.ts`：`REPO_ROOT` 优先取 `BLOG_AGENT_REPO_ROOT`，其次 `git rev-parse --show-toplevel`，最后才 `cwd`。
- 验证：CI 模式 dry-run 报告 3 个孤儿 sidecar（`2026-03-28 AAAI25-MoLe-VLA.json`、`2026-03-28 ICCV25-AdaLLaVA.json`、`osdi22-orca.json`，均无对应正文）且磁盘无改动；`refresh-memory all` 实际清理。`refresh-knowledge` 后 paper-reading 系列正确纳入 EuroSys26-MAYA / ISCA20-Accel-Sim。`npm run test:agent` 35/35。

### 2026-09-22 · 阶段 5 部分

- 5.3：`analyzePosts` 以 `--concurrency` / `BLOG_AGENT_CONCURRENCY`（默认 2）并行调用 provider；memory 写入在全部完成后按输入顺序串行执行，避免共享 JSON 写竞争。
- 5.1（进行中）：新增 `src/agent/types.ts`（Severity / Review / ReviewProvider / PostSidecar / HomeSidecar / AnalyzeResult / SyncOptions / GcResult 等）。已移除 `@ts-nocheck` 并完成类型标注的文件：`shared/fs.ts`、`shared/utils.ts`、`shared/constants.ts`、`shared/git.ts`、`shared/model-meta.ts`、`core/gc.ts`、`core/sync.ts`、`providers/index.ts`、`site.ts`、`model-meta.ts`。`AgentPanel.astro` / `HomeAgentPanel.astro` 改为 `Partial<PostSidecar>` / `Partial<HomeSidecar>`，不再各自手写类型。
  - 仍带 `@ts-nocheck`：`core/analyzer.ts`、`core/checks.ts`、`core/frontmatter-generator.ts`、`core/home-panel.ts`、`core/knowledge.ts`、`core/visual-check.ts`、`memory/*`、`parsers/*`、`providers/gemini.ts`、`providers/heuristic.ts`、`shared/pathing.ts`、`scripts/blog-agent.ts`、`tests/*`。建议顺序：parsers → memory → providers → core，最后 visual-check（与 5.2 一起做）。
- 5.2 未开始：`visual-check.ts` 拆分需要单独一次专门的重构，避免和本轮功能改动混在一起。

### 2026-09-22 · 阶段 5 完成

**5.1 类型化**：`@ts-nocheck` 已从全部 agent 源码移除，只剩 `tests/blog-agent.test.ts` 和 `src/agent/core/visual/*`（见下）。

- `src/agent/types.ts` 扩充为完整契约：parsers（`MarkdownDocument` / `MarkdownAnalysis` / `PostSnapshot`）、memory（`GlobalRules` / `SeriesRule` / `HomeTrackRule` / 三个 memory store / `MemoryUpdateInput`）、checks（`CheckResult` / `CheckSuggestions`）、frontmatter 生成、以及原有的 sidecar / review / provider 类型。
- 新增 `RawJson` 类型（唯一一处 `eslint-disable no-explicit-any`），专门标注真正的无类型边界：LLM JSON 响应、旧版 memory 文件格式、解析后的 YAML override。这样这些边界可 grep，而不是散落的裸 `any`。
- 顺带被类型检查暴露并修正的问题：`checks.ts` 的 `detectSeries` 未判空 `id_pattern`；`frontmatter-generator.ts` 的 `buildDescription` 在空正文时会返回 `null` 写进 frontmatter（现回退到 title）；CLI `refresh-memory series` 对无 `id_pattern` 的系列会构造 `RegExp(undefined)`（现明确报错）。
- `tests/blog-agent.test.ts` 保留 `@ts-nocheck`：测试里大量构造部分 snapshot / sidecar 桩对象，强制完整类型会让测试变得冗长而非更安全。

**5.2 拆分 visual-check**：3014 行单文件 → 11 个模块 + 406 行编排入口。

| 模块 | 行数 | 职责 |
|---|---|---|
| `visual/constants.ts` | 119 | viewport / 字体 / MIME / issue code 常量 |
| `visual/shared.ts` | 79 | `makeIssue`、`compactVisualText`、`sha256*`、`severityRank` 等通用小工具 |
| `visual/routes.ts` | 126 | dist HTML 枚举、route 过滤、artifact 命名 |
| `visual/server.ts` | 282 | 本地静态服务器与 CJK/emoji 字体注入 |
| `visual/build.ts` | 97 | 构建命令探测、Astro 缓存清理 |
| `visual/cache.ts` | 181 | 指纹计算、上轮 manifest 加载、复用判定 |
| `visual/capture.ts` | 838 | Playwright 抓图、DOM 度量、证据 crop、代理配置 |
| `visual/findings.ts` | 376 | issue 规范化、矩形去重、本地证据与模型结论合并 |
| `visual/review.ts` | 142 | Gemini 多模态审查 prompt 与调用 |
| `visual/fixes.ts` | 153 | allowlist 内的 LaTeX 安全修复 |
| `visual/report.ts` | 407 | summary、HTML 与 Markdown 报告渲染 |
| `visual-check.ts` | 406 | `runVisualCheck` 编排 + 对外 re-export |

- 模块依赖无环；`visual-check.ts` 继续导出 CLI 与测试依赖的全部公开 API，调用方无需改动。
- 这批文件暂时保留 `@ts-nocheck`：拆分与类型化分两步做，避免一次改动同时动结构和类型而无法定位回归。下一步可逐个模块摘掉（`constants` / `shared` / `routes` 最容易）。
- **等价性验证**：拆分前后各跑一次 `visual-check --no-build --skip-gemini`（107 个页面）。`visual_findings`、`hard_checks`、`render_input_sha256`、`html_sha256`、`local_findings_sha256`、`capture_ext` 在全部 107 页上逐字节一致。仅 `screenshot_sha256` 有 35 页不同——经第三次运行验证，**同一份代码连续两次运行也有 33 页 PNG 字节不同**，属于字体栅格化/图片加载时序造成的既有非确定性，与本次改动无关。

## 阶段 6：后续候选（已完成）

- [x] **6.1 frontmatter description/tags 改由模型生成**
- [x] **6.2 拆分 `runVisualCheck` 编排函数**
- [x] **6.3 `visual/*` 移除 `@ts-nocheck`**

### 2026-09-22 · 阶段 6

**6.1 frontmatter LLM 辅助**（新增 `core/frontmatter-assist.ts`）

- 仅在字段确实需要补时才调用模型：`getAssistableFields()` 检查 description 是否缺失/过短、tags 是否缺失或只有 `others` 占位；两者都不需要则完全不发请求。
- 优先级：显式 `--hint` > 已有 frontmatter > 模型 > 规则拼接。任一降级路径（`--provider heuristic`、无 API key、调用失败）都回到原有规则产出，并在 notes 里写明原因。
- tags 以站点既有 tag_registry 为优先词表，大小写按 registry 归一（避免 `agent` 和 `Agent` 分叉），过滤 `others` 占位和超长项，新增标签会记 note。
- 顺带修正：显式 `tags:` hint 过去会被规则推断的标签"补齐"到 5 个，导致 GPU 论文被打上 `汇编`/`指令集`。现在显式 tags 即最终列表。
- 实测（Accel-Sim 前端切换机制，无 frontmatter）：
  - 改前 `description` 截断在半句 `…（trace-drive…`，`tags: ["汇编","指令集"]`
  - 改后 description 覆盖取舍、双前端设计、Volta 校准与 15% IPC 结论；`tags: ["论文阅读","Accel-Sim","GPU模拟器"]`

**6.2 拆分编排函数**：`runVisualCheck` 406 → 109 行，五个阶段各归其位：

| 阶段 | 位置 |
|---|---|
| 1 解析运行上下文 | `visual/run-context.ts`（新增） |
| 2 抓图 | `visual/capture.ts` `captureAllPages()` |
| 3 审查 | `visual/review.ts` `reviewAllPages()` |
| 4 安全修复 | `visual/fixes.ts`（已有） |
| 5 组装 manifest | `visual/manifest.ts`（新增） |

拆分中发现 `emitVisualProgress` 归在 `review.ts` 会造成 `capture ↔ review` 循环依赖，它是通用进度回调，已移入 `shared.ts`。

**6.3 类型化 `visual/*`**：新增 `visual/types.ts`（`PageRecord` / `VisualIssue` / `VisualManifest` / `VisualRunContext` / `RouteEntry` 等），13 个模块全部移除 `@ts-nocheck`。

- `capture.ts` 同时运行在 Node 与浏览器两个运行时（`page.evaluate` 的回调在页面里执行），用文件级 `/// <reference lib="dom" />` 把 DOM 全局限定在这一个文件，其余 agent 代码保持无 DOM。
- Playwright 通过动态 import 懒加载以保持可选依赖，其对象标注为 `RawJson`。
- **类型检查当场抓到一个真 bug**：6.2 拆分时 `captureAllPages` 用到 `sha256Text` 却没有导入，`@ts-nocheck` 让它逃过编译，只在运行时报 `sha256Text is not defined`。
- 至此除 `tests/blog-agent.test.ts` 外，agent 全部源码已类型化。

**等价性验证**：当前代码与 git 中的原始 3014 行单文件版本各跑一次 107 页。`visual_findings`、`hard_checks`（均排除 `broken-image`）、`render_input_sha256`、`html_sha256`、`capture_ok`、`title` 全部 0 页差异。有差异的 4 个页面在 `page_metrics` / `local_findings_sha256` 上不同，且这 4 页与 `broken-image` 结果不同的页面**完全是同一组**——根因是站外图片（files.seeusercontent.com）加载成败随网络波动，同一份代码连跑三次分别得到 120 / 118 / 107 个 issue。
