# Visual Check Report

Run: `latex-auto-fix-verify-clean-2026-07-09`
Generated: `2026-07-09T08:17:33.266Z`

Pages: 2
Screenshots: 2
Reviewed: 2
Fresh reviews: 2
Cached reviews: 0
Issues: 2
Applied fixes: 0
Highest severity: `warn`

## Needs Attention

| Route | Severity | Count | Signals | Screenshot |
| --- | --- | ---: | --- | --- |
| /posts/mindspore-06-functional-autodiff | warn | 2 | text-readability, visual-blank-space | [open](screenshots/posts__mindspore-06-functional-autodiff.png) |

## Issue Details

<details><summary>/posts/mindspore-06-functional-autodiff · warn · 2 issues</summary>

Screenshot: [open](screenshots/posts__mindspore-06-functional-autodiff.png)

- **warn** `text-readability` (gemini): 代码块输出过于冗长。在‘总结输出（单次）’等区域，代码块直接打印了数十行重复的 Tensor 调试数据，未进行高度限制（如设置 max-height 并启用滚动条）或折叠处理，导致页面纵向跨度被无意义地拉长，严重影响了读者的阅读和滚动效率。 Region: 180 8000 780 3500. Selector: pre:has(code).
- **warn** `visual-blank-space` (gemini): 右侧侧边栏大面积空白。由于页面整体高度极长，右侧的目录和推荐卡片在页面滚动到中后段后便不再显示，导致右侧大面积留白，左右视觉分布极不均衡。 Region: 1050 2000 300 18000. Selector: aside.

</details>

## Screenshot Index

| Route | Status | Screenshot |
| --- | --- | --- |
| /posts/cmu-15213-malloclab | 0 issues | [open](screenshots/posts__cmu-15213-malloclab.png) |
| /posts/mindspore-06-functional-autodiff | 2 issues | [open](screenshots/posts__mindspore-06-functional-autodiff.png) |
