# `.github` 目录结构说明

本文档描述项目 `.github` 目录下各文件与子目录的用途。

```
.github/
├── README.md                          # 目录结构说明
├── CODE_OF_CONDUCT.md                 # 社区行为准则
├── CONTRIBUTING.md                    # 贡献指南
├── FUNDING.yml                        # 赞助/资金配置
├── PULL_REQUEST_TEMPLATE.md           # Pull Request 模板
├── ISSUE_TEMPLATE/                    # Issue 模板目录
│   ├── config.yml                     # Issue 模板全局配置
│   ├── ✨-feature-request.md          # 功能请求模板
│   ├── 🐞-bug-report.md               # Bug 报告模板
│   └── 📝-documentation-improvement.md # 文档改进建议模板
├── agents/                            # GitHub Copilot 自定义 Agent 配置
│   ├── blog-lint.agent.md             # 博客文章格式检查 Agent
│   └── blog-memory.md                 # 博客知识库/记忆文件
├── instructions/                      # GitHub Copilot 自定义指令
│   ├── blog-format.instructions.md    # 博客 Markdown 格式规范指令
│   └── frontend-style.instructions.md # 前端样式约定指令
└── workflows/                         # GitHub Actions 工作流
    ├── ci.yml                         # 持续集成：代码规范检查 + 构建
    └── deploy.yml                     # 持续部署：推送 main 后自动发布到 GitHub Pages
```

---

## 文件详细说明

### 根级文件

| 文件 | 说明 |
|------|------|
| `CODE_OF_CONDUCT.md` | 基于 [Contributor Covenant v2.0](https://www.contributor-covenant.org/version/2/0/code_of_conduct.html) 的社区行为准则，规定了可接受与不可接受的行为，以及违规处理流程（纠正 → 警告 → 临时封禁 → 永久封禁）。 |
| `CONTRIBUTING.md` | 面向贡献者的指南，涵盖提 Issue、提交 PR、修改博客内容、参与讨论和 Code Review 等贡献方式。 |
| `FUNDING.yml` | 配置 GitHub 赞助按钮，当前文件中填写的是 GitHub Sponsors 和 Buy Me a Coffee 的赞助账号，可按需修改为项目实际维护者的账号。 |
| `PULL_REQUEST_TEMPLATE.md` | 新建 Pull Request 时自动填充的描述模板，包含变更描述、变更类型勾选项（Bug Fix / New Feature / Docs / Others）及合并前检查清单。 |

---

### `ISSUE_TEMPLATE/` — Issue 模板

| 文件 | 说明 |
|------|------|
| `config.yml` | 禁用空白 Issue（`blank_issues_enabled: false`），并将用户引导至 AstroPaper Discussions 提问。 |
| `✨-feature-request.md` | **功能请求**模板，引导用户描述痛点、期望解决方案及备选方案，标签自动设为 `enhancement`。 |
| `🐞-bug-report.md` | **Bug 报告**模板，引导用户提供复现步骤、预期行为、截图及补充信息，标签自动设为 `bug`。 |
| `📝-documentation-improvement.md` | **文档改进**模板，引导用户描述文档问题和建议修改内容，标签自动设为 `documentation`。 |

---

### `agents/` — GitHub Copilot 自定义 Agent

本目录包含一个完整的 **GitHub Copilot 自定义 Agent**，专为博客内容管理而设计。Agent 采用「**定义文件 + 记忆文件**」的二文件架构：

```
agents/
├── blog-lint.agent.md   ← Agent 定义：角色、工具、能力、工作模式
└── blog-memory.md       ← Agent 记忆：系列状态、标签注册表、已知问题
```

---

#### `blog-lint.agent.md` — Agent 定义文件

**文件结构**：YAML frontmatter（元数据） + Markdown 正文（系统提示词）

**YAML frontmatter** 声明三项核心元数据：

| 字段 | 值 | 说明 |
|------|----|------|
| `description` | 触发关键词列表 | Copilot 根据用户输入自动选择 Agent 时的匹配依据（中英文混合，覆盖"博客格式检查"、"blog lint"等语义） |
| `tools` | 工具白名单数组 | Agent 可调用的所有工具，包括 `read/*`、`edit/*`、`search/*`、`execute/*`、`vscode/*` 等分组 |
| `model` | `claude-sonnet-4.6` | 指定运行模型，与系统默认模型解耦 |

**Markdown 正文**即 Agent 的系统提示词，定义以下内容：

##### 1. 启动时必做

每次激活时必须先读取两个文件作为上下文：
- `blog-memory.md` — 加载长期状态（系列进度、标签注册表）
- `src/content.config.ts` — 加载内容 Schema（字段类型与约束）

##### 2. 核心能力

| 能力 | 说明 |
|------|------|
| **Frontmatter 校验与自动填充** | 依据 `src/content.config.ts` 的 Schema 检查必填字段（`title`、`pubDatetime`、`description`），并对缺失/不规范的可选字段（`slug`、`draft`、`tags`）给出建议或自动填充 |
| **Tag 规范化流程** | 推断候选 tag → 查询 `blog-memory.md` 注册表 → 语义匹配与合并 → 数量约束（2–5 个）→ 新标签注册 → 在报告中列出替换决策 |
| **文件命名检查** | 新文件入库时检查是否符合系列命名规范（如 `CMU-15213-{LabName}.md`、`AscendC-part{N}-{topic}.md`、`{CONF}{YY}-{Keyword}.md`），不符合则建议重命名 |
| **Markdown 正文风格检查** | 检查标题层级不跳级、图片有 alt 文本、代码块有语言标识、无裸 URL、数学公式格式（`$...$` / `$$...$$`）等 |
| **内容系列追踪** | 扫描全部博客文件，识别系列（编号标题、共同前缀、共同标签），输出每个系列的完成状态和缺失篇目 |
| **前端格式维护** | 解答 `src/styles/`、`src/components/`、`src/layouts/` 下的样式问题，参考 CSS 变量体系、Tailwind v4 约定和 Shiki 代码高亮配置 |

##### 3. 工作模式

| 模式 | 触发方式 | 行为 |
|------|----------|------|
| **默认模式** | 未指定 | 检查当前提到的单个博客文件，输出格式报告 |
| **批量扫描模式** | "扫描全部"、"检查所有博客" | 遍历 `src/data/blog/` 所有 `.md` 文件，输出汇总报告 |
| **自动修复模式** | "帮我修"、"直接改"、"自动修复" | 执行文件编辑；否则只报告不修改 |
| **系列追踪模式** | "哪些系列没做完"、"内容进度" | 执行系列扫描，输出进度报告 |

##### 4. 约束

- 不修改 `src/content.config.ts`、`astro.config.ts`、`package.json` 等配置文件
- 不创建新博客文件（只检查和修复已有文件）
- 所有输出使用**中文**
- 不确定时询问用户，而非猜测

---

#### `blog-memory.md` — Agent 长期记忆文件

**作用**：为无状态的 AI 模型提供跨会话的持久化上下文。Agent 在每次启动时读取此文件，完成任务后若内容发生变化则**主动更新**它。

文件包含三个核心部分：

##### 1. 内容系列状态

追踪博客中所有已识别的系列及其完成进度：

| 系列 | 当前状态 | 说明 |
|------|----------|------|
| **CMU 15-213 Labs** | 7 / 8 | 已完成 DataLab ~ MallocLab，ProxyLab 未开始 |
| **群体人工智能** | 1 / ? | 仅 Part1-PSO，系列未完成 |
| **Ascend C 算子开发** | 5 / 5 | 全系列完成 |
| **论文阅读** | 3 / ∞ | 开放性持续扩展系列 |
| **独立文章** | — | 无系列归属的单篇文章 |

每个系列以表格形式记录：序号、主题、状态（✅ 已发布 / ❌ 未开始 / ❓ 未发布）、文件名和 slug。

##### 2. 标签注册表

定义所有**标准标签**及其语义等价词（禁用词），防止同义标签重复创建。按类别组织：

| 类别 | 示例标准标签 | 禁用词示例 |
|------|-------------|------------|
| 论文阅读类 | `论文阅读`、`OSDI`、`分布式系统` | `paper reading`、`osdi`、`分布式` |
| 课程实验类 | `CMU15213`、`汇编`、`反编译` | `CMU-lab`、`15213`、`CSAPP` |
| 算法/AI 类 | `群体人工智能`、`PSO` | `swarm intelligence`、`SI` |
| 开发类 | `Ascend`、`算子开发` | `昇腾`、`kernel development` |
| 软件/工具类 | `云服务`、`Microsoft` | `cloud`、`微软` |

##### 3. 已知格式问题

记录扫描中发现但尚未修复的格式问题，修复后从列表删除，实现问题追踪闭环。

---

#### Agent 整体工作流

```
用户输入
    │
    ▼
Copilot 根据 description 字段匹配并激活 Blog Lint Agent
    │
    ▼
Agent 读取 blog-memory.md + src/content.config.ts
    │
    ▼
┌───────────────────────────────────┐
│  根据模式执行任务                  │
│  • 格式检查  • 批量扫描            │
│  • 自动修复  • 系列追踪            │
└───────────────────────────────────┘
    │
    ▼
输出中文报告（或直接修改文件）
    │
    ▼
若内容变化 → 更新 blog-memory.md（持久化状态）
```

---

### `instructions/` — GitHub Copilot 自定义指令

| 文件 | 适用范围 | 说明 |
|------|----------|------|
| `blog-format.instructions.md` | `src/data/blog/**` | 博客文章 frontmatter Schema、标签体系、Markdown 正文规范及 Slug 命名约定。 |
| `frontend-style.instructions.md` | `src/styles/**`、`src/components/**`、`src/layouts/**` | 前端样式约定，包括 CSS 变量主题系统、Tailwind v4 映射、暗色模式、排版规则和布局约定。 |

---

### `workflows/` — GitHub Actions 工作流

| 文件 | 触发条件 | 说明 |
|------|----------|------|
| `ci.yml` | PR 创建 / 编辑 / 同步 / 重新打开；或被其他工作流调用 | **持续集成**：在 Node.js 20 + pnpm 环境下依次执行 `pnpm lint`（ESLint）、`pnpm format:check`（Prettier）和 `pnpm build`，确保代码规范且构建成功。超时限制 3 分钟。 |
| `deploy.yml` | 推送到 `main` 分支；或手动触发（`workflow_dispatch`） | **持续部署**：构建 Astro 站点后，将 `./dist` 目录作为制品上传，并通过 `actions/deploy-pages` 自动发布到 GitHub Pages。使用并发控制（`cancel-in-progress: false`）防止部署竞态。 |
