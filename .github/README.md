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

| 文件 | 说明 |
|------|------|
| `blog-lint.agent.md` | 定义一个专门用于博客文章格式检查的 Copilot Agent，可自动校验 frontmatter、标签、Markdown 规范等。 |
| `blog-memory.md` | 存储博客相关的上下文记忆（如已有标签体系、文章约定等），供 Agent 在后续任务中复用。 |

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
