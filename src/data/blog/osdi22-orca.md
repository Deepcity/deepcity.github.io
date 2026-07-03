---
title: "OSDI 2022 - Orca: A Distributed Serving System for Transformer-Based Generative Models"
pubDatetime: 2026-04-12T00:00:00+08:00
description: "OSDI 2022 Orca 论文阅读笔记，梳理迭代级调度、选择性批处理与生成式模型分布式推理服务的系统设计。"
slug: "osdi22-orca"
draft: false
tags:
  - "论文阅读"
  - "OSDI"
  - "分布式系统"
  - "大模型推理"
  - "LLM"
author: "Deepcity"
timezone: "Asia/Shanghai"
---

# Orca: A Distributed Serving System for Transformer-Based Generative Models

首尔大学发表于OSDI2022的一篇文章，针对基于Transformer的生成式大模型（如GPT-3）在推理服务中存在的效率低下的问题，提出了一种新型的分布式推理服务系统ORCA。

其中重点的改进是将Triton结合FasterTransfromer的请求级别（request-level）的调度改进为迭代级调度（Iteration-level scheduling），并提出了选择性批处理

得益于Iteration-level scheduling这一重大创新，该论文提出了pipeline parallelize trainning，该并行方式与DP，TP共同构成了大模型事实标准。

## Infromation Card

| 项目       | 内容                                                         |
| ---------- | ------------------------------------------------------------ |
| 论文标题   | Orca: A Distributed Serving System for Transformer-Based Generative Models |
| 发表于     | OSDI 2022                                                    |
| 核心一句话 | 通过迭代级调度（Iteration-level scheduling，后来在业界常被称为 Continuous Batching/In-flight Batching）和选择性批处理（Selective Batching）极大优化了大模型调度 |
| 适用场景   | 分布式系统、大模型调度，KVcache                              |
| 代码/项目  | [osdi22-orca](https://www.usenix.org/conference/osdi22/presentation/yu) [github-orca](https://github.com/LLM-Systems-Research/orca) |

## Background & Motivation

![transformer](https://p.ipic.vip/bnxzkm.png)

这片论文写于22年，基本上是LLM的黎明时期。Transformer的自回归机制与注意力机制还是相当新颖的东西。在当时，这片论文注意到了两个痛点

![batch sched](https://p.ipic.vip/glabdk.png)

1. 粗粒度的“请求级调度”（Request-level Scheduling）导致严重的资源浪费和高延迟

- **早完成的请求被强制等待（Early-finished requests）**：在一个Batch中，不同的请求需要生成的Token数量是不同的（有的只需生成10个词，有的需要100个词）。那些早早完成的请求无法立刻返回给用户，必须在系统里“陪跑”，系统甚至还会为这些已完成的请求执行无效的“Dummy computation（填充计算）”，这大大增加了部分用户的响应延迟并浪费了算力。
- **新到达的请求被严重阻塞（Late-joining requests）**：如果当前Batch正在GPU上执行，新到来的用户请求必须在队列中干等，直到当前Batch彻底执行完毕才能进入下一个Batch。这种长队列等待极大地拖慢了系统的整体吞吐量和响应速度。

2. 僵化的批处理机制难以合并不同状态的请求 (Inflexible Batching)

- **阶段不同的请求**：一个是刚进来的请求（处于Initiation阶段，输入是长句子），另一个是正在生成的请求（处于Increment阶段，输入只有1个Token）。
- **输入长度不同的请求**：两个刚进来的请求，一个输入了10个Token，一个输入了50个Token。 因为传统的执行引擎（如FasterTransformer）试图将模型的所有算子都进行Batch处理，这就要求所有请求的形状完全对齐。这种严格的限制导致系统在真实场景中很难凑齐完美的Batch，使得Batch Size被迫减小，极大地限制了GPU的并发能力。

3. 分布式执行中的通信与流水线开销 (Suboptimal Distributed Execution)

- **CPU-GPU 同步开销**：像FasterTransformer等现有系统在每一轮迭代中，都会使用GPU通信库（NCCL）来传递控制信息（如请求是否结束、Token长度等），这导致了大量不必要的CPU-GPU同步开销。
- **流水线并行效率低**：为了在请求级调度下实现层间流水线并行（Pipeline Parallelism），现有系统必须将一个Batch切分成更小的Microbatch（微批次）。但这是一种妥协，切分Microbatch会降低Batching的效率，且容易在流水线中产生气泡（Bubbles，即设备闲置等待）

最后第三点基本上的的得益于前面两点的设计。

## Innovation

我认为这篇文章的创新方法论是大胆更改了transformer种批处理的数据结构，同时设计了一套split与merge的操作，从而达成了Selective Batching的可能性。

具体来说：

- 在标准的 Transformer 批处理中，多个请求的输入张量会被拼接成一个规则的三维张量，形状为 `[B, L, H]`（Batch Size 批次大小，L 序列/Token长度，H 隐藏层维度）。
- **形状不匹配（Irregular shapes）：** 假设请求 A 有 2 个输入 Token，形状是 `[2, H]`；请求 B 有 3 个输入 Token，形状是 `[3, H]`。这两个矩形拼在一起不是一个完美的规则长方体，无法自然地合并成一个 `[2, L, H]` 的张量。如果强行合并，就必须用大量的“0”去填充（Padding）较短的请求，这不仅浪费显存，还会进行无意义的矩阵乘法浪费算力。
- **注意力机制（Attention）的状态不一致：** Attention 操作需要依赖之前所有生成的 Token 的 Key 和 Value（K/V Cache）。如果两个请求已经生成的长度不同，它们在参与 Attention 计算时所需的张量形状也不一样，传统系统无法用一个统一的 Batch 矩阵乘法（如 cuBLAS）来同时处理它们。

**论文的解决方案 (S2)：选择性批处理 (Selective batching)** 为了打破上述对齐长度的限制，ORCA 提出了**选择性批处理**。

- **核心洞察：** 论文指出，Transformer 层里**并非所有操作都需要区分不同的“请求”或关心“序列长度”**。除了 Attention 之外，诸如 Linear（线性投影）、LayerNorm（层归一化）、GeLU 等操作，对每个 Token 的数学计算都是完全独立且相同的。
- **拍扁（Flatten）张量：** 对于这些非 Attention 操作，ORCA 不再去构建 `[B, L, H]` 的规则 3D 张量，而是**直接把所有请求的 Token 拍扁，拼接成一个二维张量** `[所有 Token 的总数, H]`。例如请求 A（2个词）和 B（3个词），直接拼成 `[5, H]`，然后一次性送入全连接层计算，从而实现了任意长度的完美 Batching，没有任何 Padding 浪费。
- **分割与合并（Split & Merge）：** 当执行到 **Attention 层**时（因为 Attention 必须知道哪些 Token 属于同一个请求，不能交叉计算），ORCA 会插入一个 `Split` 操作，将那个 `[总数, H]` 的张量拆开，针对每个请求单独调用 Attention 算子（并结合 ORCA 专门设计的 Attention K/V Manager 来获取各自的历史状态）。Attention 计算完后，再通过 `Merge` 操作将结果重新拼凑回 `[总数, H]` 的形状，继续让后续的层进行高效的 Batching 计算。

## Method

### Iteration-level Scheduling (Continuous Batching/In-flight Batching)

ORCA 将调度的粒度从“请求（Request）”细化到了“**迭代（Iteration）**”。

- **机制：** 调度器每次只让执行引擎运行**一次迭代**（即所有请求往前生成一个 token）。跑完这一次迭代后，引擎立刻把控制权交还给调度器。
- **优势：**
  - **即时返回：** 一旦某个请求生成了 `<EOS>`，调度器在本次迭代结束后就能立刻把结果返回给客户端。
  - **即时加入：** 新到达的请求只需要等待当前这**一次迭代**结束，就可以在下一次迭代中被动态加入到 Batch 中。

#### 整体架构 (System Overview)

- **Endpoint（端点）：** 接收客户端请求，并将生成的 token 发送回客户端。
- **Request Pool（请求池）：** 维护当前系统中所有活跃的请求。
- **Scheduler（调度器）：** 大脑。每次迭代前，它监控请求池，挑选出一批请求，发给执行引擎。
- **Execution Engine（执行引擎）：** 苦力。接收调度器的命令，执行一次前向传播（只跑一轮，生成一个 token），并更新 Attention 的 Key/Value (K/V) 缓存。

![system overview](https://p.ipic.vip/izll5i.png)

#### 分布式执行设计 (Distributed Architecture)

- **模型并行（Intra-layer & Inter-layer）：** ORCA 支持张量并行（把矩阵切开给多个 GPU 算）和流水线并行（把 Transformer 层分段放在不同的机器/GPU 上）。
- **控制平面与数据平面分离：** 这是 ORCA 引擎非常重要的一个工程优化。
  - 传统的分布式推理（如 Megatron）在每次迭代时，CPU 和 GPU 之间会有大量的同步开销。
  - ORCA 让 **GPU（数据平面，通过 NCCL 通信）** 只负责纯粹的张量数据传输；而让 **CPU（控制平面，通过 gRPC 通信）** 负责传递元数据（比如这个 Batch 里有哪些请求的 ID）。两者异步执行，极大减少了 CPU-GPU 之间不必要的阻塞。

![distributed architecture](https://p.ipic.vip/2tl526.png)

#### 调度算法与 K/V 显存管理 (Scheduling Algorithm & K/V Management)

在算法 1 (Algorithm 1) 中，调度器采用**迭代级先到先服务（FCFS）策略，并引入了** `max_bs`**（最大批处理大小）限制。但这里最核心的设计是防死锁的显存管理**：

- Transformer 推理需要保存之前所有 token 的 Key 和 Value（即 K/V Cache）。
- **问题：** 如果调度器无脑塞入新请求，可能会导致显存中没有足够的空间存放新生成的 K/V Cache，造成引擎崩溃或死锁。
- **设计：** ORCA 的调度器在**第一次调度某个新请求时（Initiation phase）**，会直接根据该请求可能生成的最大长度（`max_tokens`），**预先在 GPU 显存中为其预留出所有的 K/V Slots（槽位）**。如果预留空间不足，新请求就先在请求池里排队。这保证了只要请求被调度，就绝对能顺利跑完，不会 OOM（Out of Memory）。

#### 高效的流水线并行 (Pipeline Parallelism)

如图所示

在旧的方法（例如triton + faster transformer）中，如果microbatch的大小切分的太大，以至于起流水线并行度不够，就会产生气泡，如下图b所示。而在orca中，得益于其迭代式调度，几乎消除了气泡的存在。

这里没有考虑显存的问题，假设资源是无限的。

![pp](https://p.ipic.vip/l1d1pi.png)

## Evaluation

A100 4*8 32张卡上跑实验。用GPT3，不同参数。

![evaluation](https://p.ipic.vip/ygbgzv.png)

有一点execution time 的 trade off，但其实这里根本不能算“off”，这里给人一种就应该这样，这点损失是“必要的”的感觉，毕竟这里能跑的batch size不仅更多了。而且下面的吞吐量具有数量级的提升。

![image-20260413011753461](https://p.ipic.vip/el7dfc.png)

对一个175b大模型的**同质请求（Homogeneous requests）的端到端评估**

在人为消除了“早退与迟到”问题后，FT的表现有所回升，但ORCA依然显著优于FT。这得益于ORCA更优秀的显存管理和无微批次（Microbatch）的流水线并行设计。

顶天立地的工作，手脚快，思路清，首尔大学，赢！

## Review

这篇文章提出的框架在许多地方显得过于草率，例如先到先得的调度处理，预留最大使用量的KVcache内存，但这些大多是因为其核心思想Iteration-level scheduling太过出众，几乎重构了大模型并行的范式。

1. 针对大模型数据流的格式化创新最令我深刻，其大胆引入了split + merge的flow，同时证明了其极低的开销与对模型的性能几乎没有影响
2. 该方法衍生的pipeline并行，极大程度消除了气泡，但这里在实际运行过程中很有可能并不会像论文中那样完美，因为这里仅仅是资源充足的理想情况

我认为这篇文章对后来论文的启发不仅仅是贡献了KVcahe，调度策略等研究点，而且应当指出，bubble作为一个不断被优化的对象，在这个阶段去做工作前景显然是越来越窄的。

## Opensource individual experiment

None，这个框架发布于2022年，在Transformer这个领域已经是寒武纪产品，冷的像实体。
