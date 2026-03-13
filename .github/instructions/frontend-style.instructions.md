---
description: "Astro 博客前端样式约定：CSS 变量、主题系统、Tailwind 模式、排版规则。自动应用于样式、组件和布局文件。"
applyTo: "{src/styles/**,src/components/**,src/layouts/**}"
---

# 前端风格约定

## 主题系统

站点使用 CSS 自定义属性实现明暗主题切换，由 `data-theme` 属性控制。

### 颜色变量（定义于 `src/styles/global.css`）

| 变量           | 亮色模式  | 暗色模式  | 用途                       |
| -------------- | --------- | --------- | -------------------------- |
| `--background` | `#fdfdfd` | `#212737` | 页面背景                   |
| `--foreground` | `#282728` | `#eaedf3` | 正文文字                   |
| `--accent`     | `#006cac` | `#ff6b01` | 强调色（链接、标记）       |
| `--muted`      | `#e6e6e6` | `#343f60` | 静音色（代码背景、滚动条） |
| `--border`     | `#ece9e9` | `#ab4b08` | 边框色                     |

### Tailwind 映射（`@theme inline`）

```css
--color-background: var(--background);
--color-foreground: var(--foreground);
--color-accent: var(--accent);
--color-muted: var(--muted);
--color-border: var(--border);
```

使用 Tailwind 类时引用这些语义色（如 `bg-background`、`text-foreground`、`text-accent`、`border-border`）。

## 暗色模式

使用 Tailwind v4 自定义变体：

```css
@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
```

在组件中使用 `dark:` 前缀时，它匹配 `[data-theme=dark]`（非 `prefers-color-scheme`）。

## 排版（Typography）

### `.app-prose` 类

定义于 `src/styles/typography.css`，扩展 `@tailwindcss/typography` 的 `prose` 类。

**关键规则：**

- 标题（h1-h4, th）：`text-foreground`，`mb-3`
- H3 额外 `italic`
- 链接：`text-foreground`，`decoration-dashed`，`underline-offset-4`，hover 时 `text-accent`
- 列表标记：`text-accent`
- 图片：`mx-auto`，`border border-border`
- 行内代码：`rounded bg-muted/75 p-1`，无引号包裹
- 引用块：`border-s-accent/80`，`opacity-80`
- 表格单元格：`border border-border p-2`

### 代码高亮

使用 Shiki 双主题（light/dark），通过 CSS 变量切换：

```css
.astro-code {
  /* 亮色 */
  background: var(--shiki-light-bg);
  color: var(--shiki-light);
}
html[data-theme="dark"] .astro-code {
  background: var(--shiki-dark-bg);
  color: var(--shiki-dark);
}
```

支持 Shiki transformers：`.line.diff.add`、`.line.diff.remove`、`.line.highlighted`、`.highlighted-word`。

## 布局约定

### 最大宽度

```css
@utility max-w-app {
  @apply max-w-3xl;
}
@utility app-layout {
  @apply mx-auto w-full max-w-app px-4;
}
```

页面内容区最大宽度 `max-w-3xl`（48rem），水平居中，`px-4` 内边距。

### 字体

```css
--font-app: var(--font-google-sans-code);
```

使用 Google Sans Code 字体族。

## 组件风格惯例

- 交互元素（a, button）使用 `outline-accent` 做 focus 样式，`outline-dashed`
- 导航激活态使用 `.active-nav`：`underline decoration-wavy decoration-2 underline-offset-8`
- Card 组件中标题使用 `text-accent`，`decoration-dashed underline-offset-4 hover:underline`
- 使用 `viewTransitionName` 实现页面切换动画

## 修改注意事项

1. **始终兼容双主题**：新增颜色必须同时在 `:root` 和 `html[data-theme="dark"]` 中定义
2. **优先使用语义色**：用 `bg-background` 而非硬编码 `bg-[#fdfdfd]`
3. **遵循 Tailwind v4 语法**：使用 `@theme inline`、`@utility`、`@custom-variant`
4. **不破坏 prose 排版**：修改 typography 时确保博客正文渲染不受影响
