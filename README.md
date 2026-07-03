# Deepcity's Blog

Deepcity 的个人博客，记录系统软件、分布式系统、AI 基础设施、算法与论文阅读相关内容。

站点地址：[https://deepcity.github.io/](https://deepcity.github.io/)

## 技术栈

- [Astro](https://astro.build/) 5
- [AstroPaper](https://github.com/satnaing/astro-paper) 主题基础
- Tailwind CSS 4
- TypeScript
- KaTeX 数学公式
- Pagefind 静态搜索
- GitHub Pages + GitHub Actions 部署

## 本地开发

需要 Node.js 20+ 和 pnpm。

```bash
pnpm install
pnpm run dev
```

常用命令：

```bash
pnpm run build        # 类型检查、构建站点、生成搜索索引
pnpm run preview      # 本地预览生产构建
pnpm run lint         # ESLint 检查
pnpm run format       # Prettier 格式化
pnpm run format:check # 检查格式
```

## 内容结构

```text
src/data/blog/        # 博客文章 Markdown
src/pages/            # 页面路由
src/layouts/          # 页面布局
src/components/       # UI 组件
src/styles/           # 全局样式与 Markdown 排版
src/utils/rehype/     # Markdown/HTML 渲染插件
public/               # 静态资源
```

文章使用 Astro Content Collection 管理，主要字段包括：

```yaml
---
title: "文章标题"
pubDatetime: 2026-03-31T12:41:37Z
description: "文章摘要"
slug: "post-slug"
draft: false
tags:
  - "论文阅读"
author: "Deepcity"
timezone: "Asia/Shanghai"
---
```

## Markdown 扩展

站点支持：

- GitHub Flavored Markdown
- KaTeX 行内公式与块级公式
- Shiki 代码高亮
- GitHub 风格提示块，例如 `> [!note]`
- 目录、RSS、站点地图和全文搜索

提示块写法：

```markdown
> [!note]
> 这里是提示内容。
```

## 部署

推送到 `main` 分支后，GitHub Actions 会自动构建并部署到 GitHub Pages。

主要 workflow：

- `.github/workflows/deploy.yml`
- `.github/workflows/ci.yml`

## License

站点代码基于 AstroPaper 的 MIT License。文章内容版权归作者所有，未经许可请勿转载。
