# Visual Check Report

Run: `latex-auto-fix-2026-07-09`
Generated: `2026-07-09T08:07:10.297Z`

Pages: 2
Screenshots: 2
Reviewed: 2
Fresh reviews: 2
Cached reviews: 0
Issues: 5
Applied fixes: 5
Highest severity: `error`

## Run Notes

- Applied 5 visual safe fix(es) to Markdown sources. Rebuild and rerun visual-check to verify screenshots.

## Applied Fixes

- `src/data/blog/CMU-15213-MallocLab.md` `escape-text-underscore`: 转义数学公式 \text{...} 内的裸下划线，避免 KaTeX 把普通文本当作下标解析。
  Before: `--- title: "CMU-15213-MallocLab" pubDatetime: 2025-09-28T20:00:00Z description: "CMU 15-213 课程 Malloc Lab 实验记录，从隐式空闲链表到显式空闲链表实现动态内存分配器，最终得分 85/100。" slug: "cmu-15213-malloclab" draft: false tags: - "CMU15213" - "c" --- ## Malloc Lab ## Declaration 本文使用了 AIGC…`
  After: `--- title: "CMU-15213-MallocLab" pubDatetime: 2025-09-28T20:00:00Z description: "CMU 15-213 课程 Malloc Lab 实验记录，从隐式空闲链表到显式空闲链表实现动态内存分配器，最终得分 85/100。" slug: "cmu-15213-malloclab" draft: false tags: - "CMU15213" - "c" --- ## Malloc Lab ## Declaration 本文使用了 AIGC…`
- `src/data/blog/mindspore-06-functional-autodiff.md` `eqnarray-to-aligned`: 将 KaTeX 不支持的 eqnarray 环境改为 display math 内可渲染的 aligned 环境。
  Before: `$$ \begin{eqnarray} H(X)&=&-\sum_{i=1}^n p(x_i)log(p(x_i))\\ &=&-p(x)log(p(x))-(1-p(x))log(1-p(x)) \end{eqnarray} $$`
  After: `$$ \begin{aligned} H(X)&=-\sum_{i=1}^n p(x_i)log(p(x_i))\\ &=-p(x)log(p(x))-(1-p(x))log(1-p(x)) \end{aligned} $$`
- `src/data/blog/mindspore-06-functional-autodiff.md` `eqnarray-to-aligned`: 将 KaTeX 不支持的 eqnarray 环境改为 display math 内可渲染的 aligned 环境。
  Before: `$$ \begin{eqnarray} loss&=&-(0\times log(0.3)+1\times log(0.6)+0\times log(0.1)\\ &=&-log(0.6) \end{eqnarray} $$`
  After: `$$ \begin{aligned} loss&=-(0\times log(0.3)+1\times log(0.6)+0\times log(0.1)\\ &=-log(0.6) \end{aligned} $$`
- `src/data/blog/mindspore-06-functional-autodiff.md` `eqnarray-to-aligned`: 将 KaTeX 不支持的 eqnarray 环境改为 display math 内可渲染的 aligned 环境。
  Before: `$$ \begin{eqnarray} loss_猫 &=&-0\times log(0.1)-(1-0)log(1-0.1)=-log(0.9)\\ loss_蛙 &=&-1\times log(0.7)-(1-1)log(1-0.7)=-log(0.7)\\ loss_鼠 &=&-1\times log(0.8)-(1-1)log(1-0.8)=-log(0.8) \end{eqnarray} $$`
  After: `$$ \begin{aligned} loss_{\text{猫}} &=-0\times log(0.1)-(1-0)log(1-0.1)=-log(0.9)\\ loss_{\text{蛙}} &=-1\times log(0.7)-(1-1)log(1-0.7)=-log(0.7)\\ loss_{\text{鼠}} &=-1\times log(0.8)-(1-1)log(1-0.8)=-log(0.8) \end{aligned} $$`
- `src/data/blog/mindspore-06-functional-autodiff.md` `inline-align-to-display-aligned`: 将同一行 $$...$$ 中的 align 环境改为多行 display aligned，避免被解析成行内公式。
  Before: `$$\begin{align} p(cat) & = 1 \\ p(pig) &= 0 \\ p(dog) & = 0 \end{align} $$`
  After: `$$ \begin{aligned} p(cat) & = 1 \\ p(pig) &= 0 \\ p(dog) & = 0 \end{aligned} $$`

## Needs Attention

| Route | Severity | Count | Signals | Screenshot |
| --- | --- | ---: | --- | --- |
| /posts/mindspore-06-functional-autodiff | error | 4 | math-render-error x4 | [open](screenshots/posts__mindspore-06-functional-autodiff.png) |
| /posts/cmu-15213-malloclab | error | 1 | math-render-error | [open](screenshots/posts__cmu-15213-malloclab.png) |

## Issue Details

<details><summary>/posts/mindspore-06-functional-autodiff · error · 4 issues</summary>

Screenshot: [open](screenshots/posts__mindspore-06-functional-autodiff.png)

- **error** `math-render-error` (gemini+local-check): KaTeX 公式解析失败：ParseError: KaTeX parse error: No such environment: eqnarray。KaTeX 不支持 eqnarray 环境，导致公式源码暴露为红色错误文本。 Region: 160 11170 694 52. Selector: span.katex-error.
- **error** `math-render-error` (gemini+local-check): KaTeX 公式解析失败：ParseError: KaTeX parse error: No such environment: eqnarray。KaTeX 不支持 eqnarray 环境，导致公式源码暴露为红色错误文本。 Region: 160 13568 675 52. Selector: span.katex-error.
- **error** `math-render-error` (gemini+local-check): KaTeX 公式解析失败：ParseError: KaTeX parse error: No such environment: eqnarray。KaTeX 不支持 eqnarray 环境，且在公式内直接使用了中文字符，导致公式源码暴露为红色错误文本。 Region: 160 14440 775 52. Selector: span.katex-error.
- **error** `math-render-error` (gemini+local-check): KaTeX 公式解析失败：ParseError: KaTeX parse error: {align} can be used only in display mode。行内数学模式下不能直接使用 align 环境，应当使用 block 块级公式包裹，或改用 aligned 环境。 Region: 160 17986 479 24. Selector: span.katex-error.

</details>

<details><summary>/posts/cmu-15213-malloclab · error · 1 issue</summary>

Screenshot: [open](screenshots/posts__cmu-15213-malloclab.png)

- **error** `math-render-error` (gemini+local-check): KaTeX 公式解析失败：公式中的下划线字符 &#39;_&#39; 未正确转义，导致解析器期待公式结束或报错。公式以红色错误源码形式暴露在页面中。 Region: 160,3378,770,52. Selector: span.katex-error.

</details>

## Screenshot Index

| Route | Status | Screenshot |
| --- | --- | --- |
| /posts/cmu-15213-malloclab | 1 issue | [open](screenshots/posts__cmu-15213-malloclab.png) |
| /posts/mindspore-06-functional-autodiff | 4 issues | [open](screenshots/posts__mindspore-06-functional-autodiff.png) |
