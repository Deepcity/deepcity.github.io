# 首页 Agent 栏改动说明

本文记录首页 `index` 的 Agent 栏接入方式、CLI 命令、sidecar 数据路径，以及这次顺手修复的宽度对齐策略。

## 1. 改动目标

这次首页改动有两个明确目标：

1. 让首页像文章页一样，采用 `主内容 + Agent 侧栏` 的双栏布局。
2. 把首页 Agent 栏视为一条独立的 Agent CLI 产物，而不是复用文章审稿命令。

## 2. 页面布局

首页入口是 [`src/pages/index.astro`](/home/deepc/deepcity.github.io/src/pages/index.astro)。

当前布局策略：

- 页面主容器改为 `app-layout-wide`
- 主体改为 `lg:grid lg:grid-cols-[minmax(0,1fr)_19rem]`
- 左栏承载首页原有 hero、研究兴趣、精选文章、最近发布
- 右栏承载首页专用 [`HomeAgentPanel.astro`](/home/deepc/deepcity.github.io/src/components/HomeAgentPanel.astro)
- 右栏在大屏下使用 `sticky + top-24`，行为与文章页 [`PostDetails.astro`](/home/deepc/deepcity.github.io/src/layouts/PostDetails.astro) 保持一致

因此首页现在和博客详情页共享同一类栏位比例：

- 左侧是主要阅读内容
- 右侧是静态 Agent 导览

## 3. 首页 Agent sidecar

首页 Agent 不读取文章 sidecar，而是使用首页专用 sidecar：

- 生成文件：[`src/data/agent/site/index.json`](/home/deepc/deepcity.github.io/src/data/agent/site/index.json)
- 读取入口：[`src/agent/site.ts`](/home/deepc/deepcity.github.io/src/agent/site.ts)
- 路径规则：[`src/agent/pathing.ts`](/home/deepc/deepcity.github.io/src/agent/pathing.ts)

sidecar 内容关注的是“站点导览”，而不是“文章审稿”，因此字段语义与文章 sidecar 不同，主要包括：

- `summary`
- `agent_role`
- `site_overview`
- `focus_topics`
- `highlights`
- `recommended_paths`
- `content_stats`

## 4. 独立 CLI 命令

首页 Agent 面板对应独立命令：

```bash
npm run agent:build-home-panel
```

对应脚本入口：

- npm script 定义在 [`package.json`](/home/deepc/deepcity.github.io/package.json)
- CLI 分发在 [`scripts/blog-agent.ts`](/home/deepc/deepcity.github.io/scripts/blog-agent.ts)
- 生成逻辑在 [`src/agent/home-panel.ts`](/home/deepc/deepcity.github.io/src/agent/home-panel.ts)

`build-home-panel` 当前是静态启发式生成，输入来自仓库内已提交的博客文章与 frontmatter，不会在页面访问时请求在线模型。

现在它也支持 provider 选择：

- 默认 `auto`
- 显式指定 `--provider gemini`
- 显式指定 `--provider heuristic`

如果环境里存在 `GEMINI_API_KEY`，`auto` 会优先使用 Gemini 生成首页导览；如果 key 缺失或请求失败，则回退到 heuristic。

## 5. 宽度对齐修复

为了避免之前出现过的“页眉 / 页脚栏位和内容区不对齐”问题，这次把布局宽度选择收回到布局层统一处理：

- [`Header.astro`](/home/deepc/deepcity.github.io/src/components/Header.astro) 已有 `layoutWidth`
- [`Footer.astro`](/home/deepc/deepcity.github.io/src/components/Footer.astro) 新增同样的 `layoutWidth`
- 首页和文章详情页都显式传 `layoutWidth="wide"`

这样可以保证：

- 首页的 header、main、footer 使用同一套宽度
- 文章详情页的 header、正文、Agent 栏、footer 也使用同一套宽度

## 6. 维护建议

如果首页主题文案明显过时，优先执行：

```bash
npm run agent:build-home-panel
```

如果你改的是首页栏位结构或字段展示，通常需要同时检查：

- [`src/components/HomeAgentPanel.astro`](/home/deepc/deepcity.github.io/src/components/HomeAgentPanel.astro)
- [`src/pages/index.astro`](/home/deepc/deepcity.github.io/src/pages/index.astro)
- [`src/data/agent/site/index.json`](/home/deepc/deepcity.github.io/src/data/agent/site/index.json)

如果你改的是 CLI 或 sidecar 路径，通常还要同步检查：

- [`scripts/blog-agent.ts`](/home/deepc/deepcity.github.io/scripts/blog-agent.ts)
- [`src/agent/home-panel.ts`](/home/deepc/deepcity.github.io/src/agent/home-panel.ts)
- [`tests/blog-agent.test.ts`](/home/deepc/deepcity.github.io/tests/blog-agent.test.ts)
