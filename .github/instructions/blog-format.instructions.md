---
description: "博客 Markdown 文件的格式规范和 frontmatter 约定。自动应用于 src/data/blog/ 下的所有文件。"
applyTo: "src/data/blog/**"
---

# 博客文章格式规范

## Frontmatter Schema

所有博客文章必须包含 YAML frontmatter（由 `---` 包围），字段定义源于 `src/content.config.ts`。

### 必填字段

```yaml
title: "文章标题"                        # 字符串，不能为空
pubDatetime: 2025-08-24T20:29:00Z       # ISO 8601，必须带 Z 后缀
description: "30-60 字中文摘要"          # 简洁描述文章核心内容
```

### 推荐字段

```yaml
slug: "kebab-case-slug"                 # 从文件名推导，全小写，连字符分隔
draft: false                            # 显式声明发布状态
tags:                                   # 2-6 个标签，中英文均可
  - "标签1"
  - "标签2"
```

### 可选字段

```yaml
author: "Deepcity"                      # 默认使用站点配置，通常省略
modDatetime: 2025-09-01T10:00:00Z       # 文章修改时设置
featured: true                          # 首页置顶
ogImage: "./og-image.png"               # 自定义 OG 图片
canonicalURL: "https://..."             # 规范链接
hideEditPost: true                      # 隐藏"在 GitHub 上编辑"
timezone: "Asia/Shanghai"               # 默认使用站点配置
```

### 完整示例

```yaml
---
title: "OSDI24-ServerlessLLM: Low-Latency Serverless Inference for Large Language Models"
pubDatetime: 2025-09-08T22:42:00Z
description: "OSDI 2024 论文阅读笔记：ServerlessLLM — 面向大语言模型的低延迟 Serverless 推理系统。"
slug: "osdi24-serverlessllm"
draft: false
tags:
  - "异构内存"
  - "内存延迟"
  - "大模型推理"
  - "OSDI"
  - "论文阅读"
---
```

## 标签体系

使用已有标签保持一致性，避免创建冗余标签：

- **论文阅读**：`论文阅读`、`OSDI`、`SOSP`、`分布式系统`、`异构内存`、`内存延迟`、`大模型推理`、`大模型应用`
- **课程实验**：`CMU15213`、`c`、`c++`、`汇编`、`反编译`、`x86-64`、`指令集`、`流水线处理器`、`Exploit String Attack`
  - 注：`CMU-lab` 和 `15213` 已废弃，统一使用 `CMU15213`
- **算法数学**：`算法`、`数论`、`数学`、`机器学习`、`人工智能`、`群体人工智能`、`PSO`
- **开发**：`Ascend`、`LLM`、`算子`、`c++`、`算子开发`
- **其他**：`软件`、`云服务`、`Microsoft`、`365`

新标签应确认不与已有标签语义重复。

## Markdown 正文规范

1. **标题层级**：正文从 `##`（H2）开始，`#`（H1）由站点模板从 `title` 自动生成。层级递进不跳级。
2. **图片**：必须有 alt 文本 — `![描述](url)` 而非 `![](url)`。
3. **代码块**：必须标注语言 — ` ```python ` 而非 ` ``` `。
4. **链接**：使用 Markdown 链接语法 `[文本](url)`，避免裸 URL。
5. **数学公式**：行内 `$...$`，块级 `$$...$$`。
6. **中英文混排**：中文与英文/数字之间加空格（如 `CMU 15-213` 而非 `CMU15-213`，但专有名词如 `ServerlessLLM` 保持原样）。

## Slug 命名约定

- 从文件名转换：去掉 `.md`，全部小写，空格和大写边界用 `-` 连接
- 示例：`CMU-15213-BombLab.md` → `cmu-15213-bomblab`
- 示例：`OSDI24-ServerlessLLM.md` → `osdi24-serverlessllm`
