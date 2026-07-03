---
title: "MindSpore 专题：番外、Transformer 模型"
pubDatetime: 2024-08-14T19:47:58+08:00
description: "MindSpore 入门系列番外篇，整理 Transformer、注意力机制、多头注意力与位置编码的基础结构。"
slug: "mindspore-extra-transformer-structure"
draft: false
tags:
  - "机器学习"
  - "人工智能"
  - "MindSpore"
  - "LLM"
author: "Deepcity"
timezone: "Asia/Shanghai"
---

# Transformer

Transformer是一种神经网络结构，有Vaswani等人在2017年的论文“Attention Is All You Need”中提出，用于处理机器翻译、语言建模和文本生成登自然语言处理任务。

<!--more-->

Transformer与传统NLP特征提取类模型的区别主要在以下两点。

- Transformer是一个纯基于注意力机制的结构，并将自**注意力机制**和**多头注意力机制**的概念运用到模型中；
- 由于缺少RNN模型的时序性，Transformer引入了位置编码，在数据上而非模型中添加位置信息；

以上的处理带来了几个优点

- 更容易并行化，训练更加高效；
- 在处理长序列的任务中表现优秀，可以快速捕捉长距离中的关联信息；

## 注意力机制

注意力机制是判断词在句子中的重要性，通过**注意力分数**来表达某个词在句子中的重要性

### 注意力分数的计算

#### query、key、value

- query:任务内容_目标序列_
- key:索引/标签（帮助定位到答案）_原序列_
- value:答案

![image-20240629145758835](https://s2.loli.net/2024/06/29/ESPv4kLWxinFZqy.png)

#### 常用的计算注意力分数的方法

additive attention可加性注意力计算方法

scaled dot-product attention缩放的“点-积”注意力
