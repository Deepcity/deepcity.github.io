---
title: "写完第一篇paper后的随笔"
pubDatetime: 2026-08-04T22:40:00Z
description: "针对论文行文，作图，逻辑以及语法做一个简短的随笔，并对未来的技能锻炼做展望"
slug: "blog-after-first-paperwork"
draft: false
tags:
  - "Paper"
  - "English"
  - "Plotting"
author: "Deepcity"
timezone: "Asia/Shanghai"
---

## 写完第一篇paper后的随笔

### 论文结构

一篇常见的系统论文通常由以下部分组成

- Introduction
- Background
- Motivation
- Findings / Observations / Attempts
- Design
- (Implementation)
- Evaluation
- (Discussion)
- Related Work
- Conclusion

当然，不是所有的论文都是这样的结构。但对于大部分计算机系统研究生而言，这是值得参考的结构。

### 论文写作顺序

在了解结构后，接下来就是写作顺序了。通常来说，论文的写作顺序并不是按照结构来写的，而是按照逻辑来写的。一般来说，论文的写作顺序如下：

1. Motivation
2. Findings / Observations / Attempts
3. Evaluation
4. Design
5. Background
6. Introduction
7. Related Work

基本上对于Design后的都是收尾工作，在AI辅助下，可以快速完成。

### 论文作图

一般而言，图表可以代表一篇论文中的核心内容。对于图而言，主要的类型只有两种类型，柱状图与折线图。柱状图一般是一篇论文中信息量含量最大，使用最广泛的图类型。

![bar_example](https://files.seeusercontent.com/2026/08/05/1Vhy/image-20260805210707689.png)

一个经典的柱状图如上图所示，这张图是Pulse这篇论文发表在HPCA.26中的一篇针对disaggregated memory的hierarchical hashing的工作。对于这里的三个Desgin的breakdown实验，这里对Avg. P50…等等值做了说明

通常来讲，我们将需要比较的柱状图的柱子放在一起，这里是breakdown后的方法。然后考虑横纵坐标的安排以及纵坐标的取值（包括是否使用对数坐标系），对左右子图，我们通常将其1：1排布，这里接近1：2的排布。

![cdf and bar](https://files.seeusercontent.com/2026/08/05/tr5V/image-20260805220124983.png)

很常见的一个排布是CDF图与柱状图的一个排布。这里我们通常可以见到，图例一般是放在图的上方，并且两张图的图例是分开的。而且对于图例，常见的一个布局是tight的，即图例与图放的很紧。

![line and bar](https://files.seeusercontent.com/2026/08/05/wRy8/image-20260805220338815.png)

另一个常见的搭配是 line and bar，这里对line chart，很常见的是line chart中通常有些说明文字，这里是因为line chart在论文中数据反而没有那么有效，因此通常需要一些补充说明。

这里的另一个不同点是，左边的bar图属于组合图，左右轴都有标识，这里可见对折线也是有一个图例的，并且容易注意到，这里的横坐标前加了一个“#”，这个符号在图中很常见，通常指代该坐标轴上的数值。

![single bar with ab..](https://files.seeusercontent.com/2026/08/05/dcS8/image-20260805221017326.png)

再看一个更加一般的图，我们可以注意到，对于一张分组柱状图而言，没有标题的(a)，(b)，(c)通常都是放在图内的。并且很容易注意到这里柱状图即使差别很小也是可以不标数字的。

![many bars](https://files.seeusercontent.com/2026/08/05/fDl4/image-20260805221213849.png)

对于一个多个bars的柱状图而言，很容易注意到，对于多个图案的使用是必然的，这是由于论文中的作图通常要考虑灰度打印时的情况。

![multi group bar](https://files.seeusercontent.com/2026/08/05/dQy9/image-20260805220800753.png)

对于一个数据更加多的图，这里可见对多个bars进行分组的情况也是存在的，当然这里适当的会对图的样式做一些调整。

![image-20260805221356287](https://files.seeusercontent.com/2026/08/05/J0xb/image-20260805221356287.png)

对于一个柱状图与折线图同时表达的图而言，很容易注意到，图例的框与线条实例是完全放在一起的。

最后，一般而言，图例是不宜超过2行的。总的来讲，对数据图像而言，总的原则就是紧凑，尽可能的不要过多的占用论文的空间，将信息量压缩并留出空间给更需要的地方。以上就是数据图主要需要注意的点，下面是对一些较为特殊数据图的记录。

![Hockey stick curve](https://files.seeusercontent.com/2026/08/05/q9Un/image-20260805221646850.png)

Hockey stick curve，棒球曲线，一般是两个对立的指标，例如吞吐量与延迟。两者不可兼得，通常会标注离四个对角哪里更近更好。