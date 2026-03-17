---
title: "SOSP25-Robust LLM Training Infrastracture at ByteDance"
pubDatetime: 2026-03-17T05:47:44Z
description: "由香港大学和字节seed联合发布的LLM Traing的可靠性研究,详细介绍了用于支持**大规模 GPU 集群**稳定运行的管理系统 **ByteRobust…"
slug: "sosp25-byterobust"
draft: false
tags:
  - "论文阅读"
  - "SOSP"
  - "机器学习"
  - "人工智能"
author: "Deepcity"
timezone: "Asia/Shanghai"
---

# SOSP25-Robust LLM Training Infrastracture at ByteDance

由香港大学和字节seed联合发布的LLM Traing的可靠性研究,详细介绍了用于支持**大规模 GPU 集群**稳定运行的管理系统 **ByteRobust**。该系统旨在应对数万级 GPU 并行训练时频发的**硬件故障、隐性挂起及人为代码错误**，通过自动化的故障处理框架提升训练效率。

核心IDEA：优先快速隔离故障而非精准定位，通过替换可能的故障链上所有计算单元，启用温备设备热更新隔离故障发生。

## Background & Motivation

- **Complex parallelism strategies.**
- **Multi-stage configuration adjustments.**
- **Frequent failures and restarts.**

基本上是这类文章的通用Motivation，不过这里有所不同的是，特意提到了Complex parallelism strategies，Multi-stage configuration adjustments这与后面的温备替换策略有关。

---

- **Complex parallelism strategies**

介绍并引用了四种并行方式DP，TP，PP，SP。特别提到了Adam优化器比模型权重多小号了6xGPU Memory。额外说明了ZeRO（Zero Redundancy Optimizer）,以及通过GPU上分片优化器状态的ZeRO-1，通过梯度优化的ZeRO-2，通过模型超参优化的ZeRO-3。

---

- **Multi-stage configuration adjustments**

![5stages in LLM train](https://files.seeusercontent.com/2026/03/16/gUt6/20260316161246.png)

这里将LLM pretraining分为了五个阶段。Warmup、General、Enhance、Long Context、Cooldown。

- **warmup**: a small-scale pure text pretraining runs with a reduced DP size to validate algorithmic changes.

  这里有提到是通过早期频繁的代码调整确保稳定性和早期性能提升

- **General**：full-scale pretraining on a broad text corpus to absorb knowledge.

  基本上是一个大规模迭代的过程，scale-up，迭代式的改代码了，应该也是DP分片。

- **Enhance**：Data mixtures are re-weighted to bolster specific capabilities

  混合加权数据级训练，为STEM、math等能力。math引用了Qwen3的技术报告，multimodel corpra for cross-model这部分引用了Kimi以及FLUX方法

- **Long Context**：the context windows and the allocated machines are progressively expanded

  长上下文专项扩展训练，8K-256K，目前的Long Context通常指1M，但目前普遍的有效Long Context通常还是200K左右，这里采用HDP（Hybird Data Parallelism）。

- **option Anneal**： certain domain-specific or synthetic datasets are carefully unsampled to tune and stabilize the final performance

  一般是对齐，这里图里好像应该是cooldown stage。

> BTW，这里图里的TextPT，PT指pretrain,MMCT，CT指 continual training

---

- **Frequent failures and restarts**

![MFU](https://files.seeusercontent.com/2026/03/16/3Zyg/20260316163222.png)

这里论文在提到LLaMA的训练白皮书的同时（未引用，引入一个概念，MFU，Model FLOPs Utilization。通过这个指标衡量在训练过程中对集群的利用效率。

### Observation on Training incident

![Incident distribution](https://files.seeusercontent.com/2026/03/16/qvX3/20260316163735.png)

这里的分类通过是否存在准确的诊断指标进行clear diagnostic indicators。例如stdout or stderr logs or special exit codes。

![Different unproductive times](https://files.seeusercontent.com/2026/03/16/1idJ/20260316164114.png)

这部分重点讲述了非生产时间的构成，提出：

- 大部分故障都是explicit failures，diagnositcs(include detection times eg.60s localization times eg 2-15 minutes)时间较短。
- CUDA errors 导致的手工诊断通常需要花费hours level的时间，eg. communication hang issue caued by CUDA， took one and a half hours for manual diagnosis.
- SDC on GPU hardware造成了在大模型训练中造成了致命影响。文章称其为stochastic faults。修复时间则是 a short period of time。这里则采用了超过8hours的离线压力测试。

### Challenges to Achieve high ETTR

> ETTR: Effective Training Time Ratio

![Root cause of incidents](https://files.seeusercontent.com/2026/03/16/5gcM/20260316170435.png)

- **隐性故障难以检测与定位。**

1. 任务挂起
2. 性能下降
3. SDC（Silent Data Corruption）

三个隐性故障难以检测和定位。

---

- **故障转移（failover）的不确定性与高开销。**

如图 3 所示，故障转移操作包括：调度与已终止作业相关的新机器 [44]、重建pod环境、从远程存储 [80] 加载最新检查点（checkpoint），以及重新计算丢失的训练进度。

**二次故障**：在机器重新调度过程中，可能会分配到性能退化的机器，从而在作业重启后引入潜在的新故障。

**checkpoint从低带宽前端网络检索**：故障转移本身开销巨大，导致大量的非生产性时间损耗。

我们观察到，在 10,000 个 GPU 规模的大模型训练中，故障转移操作的耗时通常超过 10 分钟。随着大语言模型（Large Language Model, LLM）训练规模的扩大，故障频率随之增加 [19, 92, 94]，进一步放大了整个训练周期内故障转移操作的开销。

## ByteRobust Overview

![Architecture of ByteRobust](https://files.seeusercontent.com/2026/03/16/Se8x/20260316194942.png)

ByteRobust由两个核心组件构成，***Control plane and data plane***。

- **Control plane**

  控制平面。控制平面由两个模块组成，旨在实现大语言模型（Large Language Model, LLM）训练中可靠的故障检测、定位和恢复。鲁棒控制器（Robust Controller）利用实时监控和停机诊断来处理大多数故障事件，从而编排了一个自动化的故障缓解框架（第4节）。为了实现可控且快速的恢复，当没有机器被驱逐时，它使用原地热更新（in-place hot-update）机制来重启训练（第6.1节）。当确定需要驱逐某些机器时，它会请求通过自检预验证的热备用机器来恢复作业（第6.2节）。运行时分析器（Runtime Analyzer）通过汇总来自训练容器组（training pods）的堆栈跟踪信息，以隔离并（过度）驱逐可疑机器，从而解决作业挂起和性能下降的问题（第5节）。

- Data plane

  数据平面。Robust Agent 守护进程在每个训练 Pod 中运行，负责处理来自 Robust Controller 的控制信号，并管理以下四个子模块：Monitor（监控器）收集多维度数据以检测异常值，支持实时检查（第 4.1 节），并在出现异常时触发聚合分析。Diagnoser（诊断器）在任务挂起后运行特定领域的基准测试和测试套件 [89, 91]，实现对复杂故障的深入诊断（第 4.2 节）。On-Demand Tracer（按需追踪器）在调用聚合分析时捕获训练进程的堆栈跟踪信息，并将其上传至 Runtime Analyzer（运行时分析器）。CKPT manager（检查点管理器）执行异步检查点保存，通过跨并行组备份至 CPU 内存和本地磁盘，从而最大限度地降低恢复成本（第 6.3 节）。

## Automated flaut tolerance

![The automated fault tolerance mechanism of ByteRobust](https://files.seeusercontent.com/2026/03/16/Wh8g/20260316195428.png)

文章在这里提出

- 图形处理器（GPU）周期是训练集群中最昂贵的资源，快速、粗粒度的故障隔离在诊断覆盖率和效率之间往往能取得比昂贵、细粒度的根因定位更好的平衡。

因此在这里，为满足这些要求，我们提出了一个自动化容错框架（图 5），该框架结合了用于即时检测常见错误的实时检查、用于深入分析复杂故障的停机诊断、用于恢复瞬时故障的就地重试、用于回滚缺陷用户代码的代码回滚，以及用于应对静默数据错误（Silent Data Corruptions，SDCs）等边缘情况的重放测试。

### Proactive Real-time checks

- System inspection

  按照秒级间隔巡检轻量级系统级的巡检查询包含：

  （i）网络侧项目

  （ii）GPU 侧项目

  （iii）主机侧项目

- Metrics collection

  监控器还会基于以下三类数据收集各类指标：

  （i）工作负载特定的训练指标，包括损失（loss）、梯度范数（gradient norm）、模型硬件利用率（Model Flops Utilization, MFU）等。利用 wandb [81] 持续收集这些可观测指标，并将这些指标的显著变化视为故障信号，例如损失/梯度范数增加 5 倍、出现 NaN 值等。

  （ii）stdout/stderr 日志和进程退出代码，作为诊断的线索。

  （iii）事件，包括 CUDA、远程直接内存访问（Remote Direct Memory Access, RDMA）、主机和存储事件。这些事件对于推导系统性能指标（如 RDMA 流量和 TensorCore 利用率）至关重要。

### Hierarchical Stop-time Checks

**存在仅凭实时检查难以解决的问题。**

**诊断器（diagnoser）**通过分析日志和退出代码进行故障诊断，并运行相应的测试以定位根本原因。若发现故障温备机（warm standby machines）将被唤醒以重新启动训练。

**重试**：如果所有测试均通过，诊断器将推断故障是由瞬态故障引起的，例如临时的链路抖动、交换机宕机、连接重置等。此时，训练任务将直接重启（步骤 5）。

**回滚**：当重启训练无法解决问题（步骤 6），或者在机器逐出后训练再次崩溃（步骤 7）时，诊断器将推断用户代码的近期更新存在极高风险。随后，系统会利用热更新机制回滚用户代码，以移除集成的各项新功能（例如，新融合的计算内核），并重新启动训练。

**双阶段重放（Dual-Phase Replay）**：若训练依然失败，ByteRobust 会假设存在未知故障（如静默数据错误，Silent Data Corruptions, SDCs），并在受控环境下通过组测试（group testing）进行定位。**这里直接引用了微软在2024年的工作Superbench**。为了保持诊断的保真度，我们引入了一种双阶段、维度感知的重放机制，在仅改变数据并行（Data Parallelism, DP）规模的同时，保持原有的张量并行（Tensor Parallelism, TP）和流水线并行（Pipeline Parallelism, PP）规模不变（步骤 8）。

![Dual-Phase Replay](https://files.seeusercontent.com/2026/03/16/g1yN/20260317010807.png)

算法 1 详述了故障定位过程。将机器划分为若干横向和纵向组，缩减模型层数，并以减小的并行数据规模（Data Parallelism size, DP size）在每个组上重新运行作业（第 2–8 行）。故障横向组与纵向组的交集即锁定了故障机器（第 9–11 行），随后将其移除（步骤  9 ）。在实践中，我们设定 m = k· PP_size，n = DP_size/k，其中 k ∈ N+，且 m ≤ n 以确保解的唯一性。由于流水线并行规模（Pipeline Parallelism size, PP_size）远小于 DP_size，组内通信仍具有代表性。如图 6 所示，通过重运行两次训练作业并识别各阶段的故障组，可准确隔离 SDC 机器 #13。这种设计选择在无需依赖高级诊断工具的情况下，有效缩短了无效时间。根据我们的经验，每起静默数据错误（Silent Data Corruption, SDC）事件通常仅涉及一台故障机器，这也是大规模训练中的常见情形。

![SDC detect](https://files.seeusercontent.com/2026/03/16/r2Rp/20260317010854.png)

**经验教训：简单的方法即可解决大多数故障。**基于对 19 项大规模大型语言模型（LLM）训练任务（≥ 9,600 个 GPU）的实证观察，我们发现通过实时检查进行直接机器驱逐解决了 32.52% 的故障，重试恢复了 22.70%，回滚处理了 9.20%。**仅有 1.23%** 的故障需要双阶段重放。

### Case Study

若监控程序在训练过程中检测到 NaN 损失，首先执行标准的 GPU 和网络测试，包括 EUD(Extended Utility Diagnostics) 和 NCCL 测试。如果所有测试均通过，则进行按位对齐（bit-wise alignment）测试：每台机器加载一个参考模型，该模型的结构与目标训练作业（例如密集模型 [7] 或 MoE 模型 [66]）相匹配。随后，加载预定义的权重，采用特定的并行配置（例如 TP=2、PP=2、DP=2 或 EP=2、PP=2、DP=2），并在固定输入上执行一个训练步以确保可复现性。收集并分析所有机器的输出结果，以验证按位准确性。产生错误结果的机器会立即被隔离并移除。如果该测试未能识别出任何故障机器，则按顺序执行重试和回滚操作。

## Data-Driven Over-Eviction

ByteRobust 在检测到这些静默故障（例如挂起和MFU降低）时，会挂载并检查所有内部训练进程的堆栈跟踪（stack traces），以定位故障机器。在接收到聚合触发消息时，控制器会通知按需追踪器（on-demand tracer）捕获进程堆栈跟踪，随后将其发送至运行时分析器（runtime analyzer）在后台进行聚合分析。

### Aggregation Analysis

![Stack aggregation for backward-communication hang pinpointing. The parallelism configuration: TP=2, PP=4, DP=4.](https://files.seeusercontent.com/2026/03/16/yD8b/20260317011658.png)

图 7 展示了静默反向通信挂起（silent backward-communication hang）的情况。在此示例中，负责托管流水线并行（Pipeline Parallelism, PP）最后阶段以生成反向传播激活梯度的机器 15 在 `all_gather_into_tensor` 处卡住。与此同时，与机器 0-11（已完成所有反向传播相关算子的启动并进入优化器中的梯度同步阶段）不同，机器 14 以及机器 12-13 在传输特定微批次（micro-batch）的梯度时，分别阻塞于 `isend` 和 `irecv`。传统诊断方法难以高效且精准地确定故障机器集合。相反，ByteRobust 通过三步流程对孤立机器进行过量驱逐（over-evicting），从而避免了查明确切根因的需求。首先，ByteRobust 解析每个训练集群（pod）中的进程树，以识别与训练相关的进程，例如 `torchrun`、`dataloader` 和 `checkpoint` 进程。接下来，通过字符串匹配将这些已识别进程的堆栈跟踪（stacktraces）聚合为多个组，以区分异常源。占主导地位的组被视为健康组（图 7 中的绿色堆栈），而其余组则被归类为离群值（其他颜色）。最后，我们找到这些离群值所共享的并行组，并隔离相应的机器。在本例中，共享的并行组为一个 PP 组（机器 12、13、14 和 15）。鲁棒控制器驱逐可疑对象并随后恢复训练。对于变慢故障（fail-slow incidents，即 MFU 下降），ByteRobust 每 10 秒重复一次聚合，在每一轮标记离群值最多的并行组。在 5 轮中累计标记次数最高的并行组被标记为降级源，进而执行过量驱逐。

### Case Study

- **Envolution hang**

  在一个案例中，堆栈聚合分析隔离出一个跨越 6 台机器的特定流水线，其中中间阶段的堆栈与其他数据并行与张量并行（DP×TP）组中的秩（rank）不同。因此，这些阶段被卡在了各自的端到端（P2P）通信操作中。系统自动将这 6 台机器列入黑名单并进行驱逐，同时调度热备实例进行快速替换并重启训练。通过为期数天的后台压力测试，我们最终确定了根本原因：其中**两台机器的 CUDA 核心存在缺陷**，导致了挂起并阻碍了 P2P 操作。

## Controlled and Swift Recovery

### In-Place Hot-Update

**在大型语言模型（Large Language Model, LLM）训练过程中，因代码调整而手动重启训练已成为常态。**

为进行代码升级或回滚而重新调度机器，不仅会产生巨大的开销，还可能引入潜在的故障机器，从而在重启后发生故障时增加故障定位的难度。为了最大限度地降低开销，并规避重启过程中部署潜在故障机器的风险，我们引入了一种惰性热更新机制，可在不破坏现有 Pod 环境的情况下进行原地代码修改。更新策略会根据代码修改的性质进行定制。**对于紧急请求（如修复漏洞），训练会立即暂停以应用更新；对于非关键性变更（如实验性优化或软件版本更新），更新则利用大规模 LLM 训练中频繁出现的中断（例如，Llama 3.1 训练期间平均每 2.78 小时发生一次中断 [19]），整合到下一次故障恢复流程中执行。**无论如何，若非关键更新在默认触发窗口（例如 24 小时）内未被执行，系统将强制执行该更新。所有修改均会持久化保存在我们的数据库中，以确保可追溯和可复现。通过自动应用和回滚机制（第 8.1.2 节），该热更新机制还将演进中的训练代码的持续集成纳入了稳健的 LLM 训练流水线中。

### Warm Standby Machines

**涉及多个节点的并发故障及其罕见**

利用历史数据估算单机的日故障率，并采用二项分布对跨机并发故障进行建模。我们将热备实例（warm standby instances）的数量设定为该分布的第 99 百分位（P99）

每台新的备用机器都会执行 Pod 环境初始化，包括确保机器处于健康状态的自检、镜像安装以及库下载，随后进入低功耗睡眠模式。在发生机器驱逐时，如果有充足的备用机器，则直接将其唤醒并整合至训练任务中；否则，系统会立即进行补充，并在所有所需机器完成 Pod 环境初始化后重启训练。

### Over-Eviction-Aware Checkpointing

![Backup sharded model and optimizer state](https://files.seeusercontent.com/2026/03/17/9Pao/20260317105420.png)

ByteRobust 提倡通过在本地机器和对端机器上保存并备份检查点（checkpoint）来实现内存中（in-memory）检查点机制。它采用了一种分层检查点方案，利用主机 CPU 内存和 SSD 存储层，并结合了预判机器超额驱逐（见第 5 节）的备份策略，以确保可用性。通过消除对低带宽前端网络上远程存储服务的依赖 [20, 80]，ByteRobust 避免了因存储服务故障而导致的潜在训练挂起或崩溃（见表 1，其中记录了 1104 次 HDFS 错误）。

**操作调度。**通过精细的操作调度，ByteRobust 实现了近乎零开销的内存中（in-memory）检查点保存。以图 8 中的示例为例，为了备份分片后的模型和优化器状态，ByteRobust 利用了每个训练步骤中的空闲通信周期，即在前向和反向计算过程中，并采用点对点（P2P）通信，使每个秩（rank）与所选备份机器中的对等秩交换这些分片（详见备份策略）。随后，这些备份分片被保存到 CPU 内存中。检查点的输入/输出（I/O）操作与前向和反向计算以异步方式执行。

![Over-Eviction-Aware Checkpointing](https://files.seeusercontent.com/2026/03/17/2hoU/20260317105324.png)

ByteRobust 提倡采用跨并行组备份策略来应对潜在的机器过度驱逐。如图 9 所示，在进行大规模 3D 并行训练时，每个秩（rank）都会将其分片优化器状态备份到其 3D 并行组之外。例如，秩 8 和秩 9 与秩 2 和秩 3 交换其优化器状态，以确保它们不共享相同的流水线并行（Pipeline Parallelism, PP）、数据并行（Data Parallelism, DP）或张量并行（Tensor Parallelism, TP）组。同样，在数据并行组内进行去重后的分片模型状态 [80] 也遵循此备份策略。如果并行策略仅包含一个并行组（例如 ZeRO 并行），系统则默认备份到相邻机器。

## Implementation

- **Robust Controller and Agent**

  鲁棒控制器（Robust Controller）由**一个编排模块和一个控制模块**组成，共计 2 万行 Golang 代码。我们使用 Kubernetes 自定义资源定义（Custom Resource Definitions，CRDs）来实现编排模块，以表示作业操作（约 3000 行代码）。每个作业都有一个用于弹性训练规则的运行时 CRD 和一个用于 Pod 调度的作业 CRD。为了提高集群管理效率，我们将标准的 etcd [21] 替换为内部元数据系统，并利用内部调度器进行 Pod 组调度。控制模块以作业管理器服务（job manager service）为核心，负责维护作业控制器（约 1.7 万行代码）。**对于每个作业，我们都在作业管理器中注册一个专用控制器服务**，通过 Goroutine 实现高效的资源共享、多种热备份策略以及统一的故障恢复。鲁棒智能体（Robust agent）是一个运行在每个作业旁边的 Python 守护进程（约 5000 行代码），用于管理训练过程。该智能体通过基于 gRPC（Google Remote Procedure Call，gRPC）的心跳机制与控制器通信，并支持运行时热更新。

  > 这里回顾一下ByteRobust的核心由两层结构构成
  >
  > Control Plane(Robust Control & Runtime Analyzer) & Data Plane

----

- **Runtime Analyzer**

  运行时分析器（Runtime Analyzer）采用了约 1.2 万行 Go 语言（Golang）代码实现。**该分析器通过汇总日志、输入/输出（I/O）操作、主机异常、按需追踪器（on-demand tracer）输出以及容器组（pod）异常，将各类异常标准化为统一事件**。鉴于观测数据具有异构性和分散性，且需要进行快速的问题分类，我们设计了一个用于实时分析的事件驱动系统。该系统能够快速定位根本原因，并与**鲁棒控制器（robust controller）协同工作，以实现快速故障处理。针对多卡通信集合（NCCL, NVIDIA Collective Communications Library）超时问题，它会从使用 py-spy [5] 和 flight-recorder [61] 实现的按需追踪器中收集堆栈跟踪信息，并结合训练拓扑信息以辅助排查**。此外，分析器还会构建工作进程（worker training processes）的进程树，以满足各种分析需求。

---

- **Warm Standby**

  热备（Warm Standby）。我们利用鲁棒控制器（Robust Controller）的编排模块，通过异步配置（asynchronous provisioning）维持指定数量的热备节点。初始化时，每个鲁棒代理（Robust Agent）都会查询控制器以确定自身状态，即热备状态或主动训练状态。当执行过程到达阻碍代码运行的预设屏障（barrier）时，备用机器上的进程将验证其当前状态。若处于备用状态，这些进程将进入轮询循环（polling loop），周期性地向鲁棒控制器查询激活信号。一旦收到激活信号，训练即在屏障之后无缝恢复，将热备节点整合进正在进行的训练工作流中，且不会造成任何中断。

---

- **High-Frequency Checkpointing**

  高频检查点（High-Frequency Checkpointing）由 3000 行 Python 代码实现，并为 CPU 张量（tensor）配置了双缓冲区（dual-buffer），在不同迭代之间交替存储优化器的状态字典（state dictionary）。我们通过重叠执行设备到主机（Device-to-Host，D2H）复制、序列化以及发送至其他秩（rank）进行备份这三项操作，实现了异步检查点保存。当第一个 CPU 张量进行 D2H 复制时，我们同步对第二个张量执行序列化或发送操作。D2H 操作在专用的 CUDA 流（CUDA stream）上执行，使得 D2H 内存复制能够与训练计算并行独立运行。故障恢复则通过根据 D2H 和序列化的完成状态选择最新可用的检查点来实现。

## Evalutation

### Testbed

测试床（Testbed）。所有实验均在生产级图形处理器（GPU）集群上进行。针对 8.1 节中的部署结果，我们最多使用了 1200 台机器，每台机器配备 8 块 NVIDIA Hopper 80GB GPU。针对 8.2 节的评估，我们总共使用了 1024 台机器，每台机器配备 16 块 NVIDIA L20 48GB GPU，并通过 30GB/s 的 PCIe 总线连接，总计超过 16,384 块 GPU。上述所有机器均通过 8 条 400 Gbps 的远程直接内存访问（Remote Direct Memory Access，RDMA）链路互联，由 96 核 Intel Xeon 处理器提供动力，并配备 2 TB 动态随机存取存储器（DRAM）。

### 8.1 1200xGPU Dense&MoE model Train

ByteRobust 已部署在字节跳动的生产集群中，用于支持大语言模型（Large Language Model，LLM）的训练任务。我们证明了 ByteRobust 能够有效缩短故障检测时间（8.1.1 节），并通过自动容错框架和聚合分析来解决故障（8.1.2 节）。我们还报告了整体的平均修复时间（Mean Time To Repair，ETTR）和模型算力利用率（Model Flops Utilization，MFU）统计数据，以验证其端到端的有效性（8.1.3 节）。最后，我们将我们的自动容错框架与以往的实践进行了对比，以论证其优势（8.1.4 节）。我们收集了两个内部生产级模型的预训练任务：一个是训练密集型模型（类 Llama [19]，700 亿参数以上）为期三个月的任务，另一个是训练混合专家（Mixture of Experts，MoE）模型 [8]（2000 亿参数以上）为期一个月的任务。这些预训练任务是在包含 9600 个 Hopper GPU 的 GPU 集群上运行的。

### 8.1.1 Reduce Detection Time

![image-20260317124230604](https://files.seeusercontent.com/2026/03/17/Z5cv/20260317124247.png)

**第三列 `w/ Inspection (s)`（With Inspection）：**

- **含义：** 表示**在使用（该论文提出的）巡检/检测机制的情况下**，系统发现对应故障所需的时间。
- **单位：** 秒（seconds）。
- **说明：** 结合数据可以看出，使用该机制后，检测各种硬件或系统故障（如网卡崩溃、GPU 驱动卡死、系统内核故障等）的时间非常短，均在 2 秒到 60 秒（$30 \cdot 2$）之间。

**第四列 `w/o Inspection`（Without Inspection）：**

- **含义：** 表示**在不使用该巡检机制（即原生/默认的基线状态）下**，系统发现对应故障所需的时间。
- **说明：** 这一列填写的不是具体秒数，而是根据图注解释的系统默认监控阈值：
  - **$T_{timeout}$**：代表 PyTorch-Distributed 框架的默认超时阈值，大约长达 **10 分钟**（~10 minutes）。
  - **$T_{monitor}$**：代表通过监控 MFU（Model Flops Utilization，模型算力利用率）下降来发现故障所需的时间间隔。
     **总结来说：** 这两列的核心目的是为了**对比说明该系统（或方法）的显著优势**。通过对比可以看出，不使用该机制时，系统往往需要死等默认的超时设定（约10分钟）才能确认故障；而采用 `Inspection` 机制后，故障检测时间被极大地压缩到了秒级。

### 8.1.2 Resolve Incident

![image-20260317124455005](https://files.seeusercontent.com/2026/03/17/sl3K/20260317124456.png)

在Dense model与MoE model中四种方式的解决问题的比例

1) AutoFT-ER 是通过机器驱逐（machine eviction）并重启训练实现的自动容错（Automated Fault Tolerance）机制；
2)  AutoFT-HU 代表热更新（hot-update）机制；
3) Analyzer-ER 对应由聚合分析器（aggregation analyzer）诊断并通过机器驱逐及重启训练解决的故障；
4) 回滚（Rollback）则将代码恢复至先前的稳定版本。

这个图有些奇怪，这里我的理解是这些数据是从这个系统解决的问题集中展开分类，从Mechanism和Issue case展开，其中比例指的是 single Mechanism and issue case / ALL issues count

### 8.1.3 Guarantee Performance

![ETTR&MFU](https://files.seeusercontent.com/2026/03/17/2rPr/20260317125524.png)

在图 10 中观察到，在两个模型的训练后期，累积 ETTR 略有下降，而滑动窗口 ETTR 则表现出更剧烈的波动。这些变化的原因如下：工程团队首次部署了长上下文训练（long-context training）功能，导致了若干代码故障；此外，延长的训练时间使得集群更易受到影响，导致性能下降和故障的发生频率增加。尽管故障和手动重启的频率有所上升，ByteRobust 仍能高效地检测、诊断并恢复训练状态。

与初始运行相比，我们在稠密模型（dense）任务和混合专家模型（Mixture-of-Experts, MoE）任务中分别实现了1.25倍和1.58倍的 MFU 提升。这里可能有疑问的一点**rebuttal**后期的MFU提升是由于GPU kernel优化等操作带来的提升，但论文这里说这些更新带来了更多的unproduced time proportion.

### 8.1.4 Compare with Prior Practice

这里有些惊人的数据

![Incident resolution cost comparison](https://files.seeusercontent.com/2026/03/17/Hww2/20260317130401.png)

基本上所有压力测试的方法都将时间控制在了秒级。

### 8.2 Efficiency in Failure Recovery 16,384xGPU

### 8.2.1 Swift Restart

![Swift Job Restart](https://files.seeusercontent.com/2026/03/17/Ar9v/20260317130632.png)

1. requeue: kill and requeue the entire job, reallocating all machines;

   Apostolos Kokolis, Michael Kuchnik, John Hoffman, Adithya Kumar, Parth  Malani, Faye Ma, Zachary DeVito, Shubho Sengupta, Kalyan Saladi, and  Carole-Jean Wu. 2024. Revisiting Reliability in Large-Scale Machine  Learning Research Clusters. arXiv preprint arXiv:2410.21680 (2024).

   KubeDL Team. 2024. KubeDL Makes Deep Learning Workloads Run on Kubernetes More Easily and Efficiently. [https://kubedl.io/.](https://kubedl.io/)

   Kubeflow Team. 2024. Kubeflow: The Machine Learning Toolkit for Kubernetes. [https://www.kubeflow.org/.](https://www.kubeflow.org/)

   Volcano Team. 2024. VolcanoJob. [https://volcano.sh/en/docs/vcjob/.](https://volcano.sh/en/docs/vcjob/)

2. reschedule: spin up replacements only for evicted machines, reinstalling pods on them;

   Paul Barham, Aakanksha Chowdhery, Jeff Dean, Sanjay Ghemawat,  Steven Hand, Daniel Hurt, Michael Isard, Hyeontaek Lim, Ruoming Pang,  Sudip Roy, et al. 2022. Pathways: Asynchronous Distributed Dataflow for  ML. Proceedings of Machine Learning and Systems 4 (2022), 430–449.

3. oracle: assume unlimited warm standbys ready to replace any evicted machine.

- **高效热更新（hot-update）**：热更新机制比全量重新排队（full requeue）快 11.04 倍（表 7）。

- **高效暖备用（warm standby）**：暖备用方法相比重新排队和重新调度（reschedule）分别缩短了 10.87 倍和 5.36 倍的恢复时间，且仅比预言机上限（oracle upper bound）高出 5.19%。

  > 对于每个训练规模，我们首先确定第 99 百分位（P99）故障机器数量 $N$，然后模拟 1 到 $N$ 台机器的驱逐，以及灾难性的交换机故障（所有机器被驱逐，例如 32 个节点）。我们测量从故障检测到作业恢复的调度时间，并根据二项分布（第 6.2 节）对每种场景进行加权，计算加权平均调度时间（Weighted-Average Scheduling Time，WAS），其中灾难性故障的权重固定为 1%。

- **可扩展性（Scalability）**：ByteRobust在规模扩大的前提下，WAS时间并没有明显提升

### 8.2.2 Efficiency in Failure Recovery

![Training setup of two sparse LLM training jobs.](https://files.seeusercontent.com/2026/03/17/u8Ot/20260317131947.png)

![Efficiency in Failure Recovery](https://files.seeusercontent.com/2026/03/17/kZ5l/20260317131508.png)

在真实世界的文本生成任务上，利用结合了零冗余优化器（Zero Redundancy Optimizer，ZeRO1）的3D并行（3D parallelism）技术，对稀疏混合专家模型（Sparse Mixture-of-Experts，MoE）大语言模型（70B和256B模型规模）的检查点机制进行了评估。详细配置见表5。.检查点保存频率被设定为一次迭代。

ByteRobust通过利用零冗余优化器（Zero Redundancy Optimizer，ZeRO）式并行中的空闲 PCIe 和网络带宽来实现输入/输出（I/O）与训练过程的重叠，它将 MFU 损耗限制在仅 0.71%，较 Megatron save 和 Memory save 分别提升了 98.8% 和 89.6%。

## Experiences and Limitations

- **Immature Diagnostic Tools**

随着图形处理器（GPU）硬件的快速迭代，相关的监控与诊断工具往往在成熟度上滞后，使得故障根本原因分析（Root Cause Analysis, RCA）极具挑战性。为确保在此类约束条件下的稳健性，我们引入了系统级适配方案，包括诸如数据驱动过驱逐（data-driven over-eviction）和双阶段重放（dual-phase replay）等应用级隔离策略。这些技术在基于新硬件的GPU集群部署初期尤为重要，尽管随着诊断工具的日趋成熟，其必要性会逐渐降低。值得注意的是，诊断工具本身有时也会引发新的故障。在一个案例中，我们观察到训练期间模型峰值利用率（Model Flops Utilization, MFU）出现下降，经溯源发现，是由一项诊断程序（EUD）无意中解除了此前设置的频率锁定，导致GPU意外降频

---

- **False Positive**

1. 诊断工具局限性：端到端用户诊断（End-to-End User Diagnostics，EUD）或网络诊断等工具的不完善可能会触发错误警报，导致健康机器被不必要地驱逐并进行压力测试，这对集群利用率的影响较小。
2. 有意过度驱逐：为加速三维并行（3D parallel）训练中的故障定位，我们会驱逐整个流水线并行（Pipeline Parallel，PP）组（例如，在 9600 个 GPU 的作业中，每组包含 8 台机器），尽管通常只有 1–2 个节点出现故障。虽然这会导致 6–7 个误报。

---

- **Silent Data Corruption**

静默数据损坏（Silent Data Corruption, SDC）。在将大语言模型（Large Language Model, LLM）训练扩展至下一规模时，SDC 是一个至关重要却常被忽视的挑战。SDC 由输入敏感型数值不稳定性、竞态条件（race conditions）以及热波动（thermal variations）等因素引起，导致了诸如非数字（NaN）值或梯度异常等计算错误 [19, 35]。分布式训练中的集合通信模式（collective communication patterns）加剧了这些错误在多台机器间的传播。深度学习固有的鲁棒性可能会掩盖此类故障，从而增加了检测难度。在我们生产环境中，英伟达（NVIDIA）的 EUD 诊断工具 [56] 的召回率仅为 70%。为缓解这一问题，我们开发了 **MiniGPT 验证套件**，利用确定性工作负载（deterministic workloads）进行机内验证，并采**用双阶段重放测试（dual-phase replay testing）进行跨机故障复现**。然而，这些方**法会产生巨大的开销，且随着训练规模的扩大，SDC 的发生频率及其影响也随之增加**，这凸显了对更高效的检测、隔离与诊断技术的需求。

## Other

受到了字节跳动合作研究基金以及香港研究资助局（Hong Kong RGC）的合作项目资助。

## REF

1. [dl.acm.org/doi/10.1145/3731569.3764838](https://dl.acm.org/doi/10.1145/3731569.3764838)

