---
title: "ISOCC20-Efficient TSV Fault Detection Scheme For High Bandwidth Memory Using Pattern Analysis#"
pubDatetime: 2026-03-21T09:52:22Z
description: "高带宽内存（High Bandwidth Memory，HBM）的通道可以通过 128 个数据硅通孔（Through-Silicon Via，TSV）和 16…"
slug: "isocc20-efficient-tsv-fault-detection-scheme-for-high-bandwidth-memory-using-pattern-analysis"
draft: false
tags:
  - "others"
author: "Deepcity"
timezone: "Asia/Shanghai"
---

## ISOCC20-Efficient TSV Fault Detection Scheme For High Bandwidth Memory Using Pattern Analysis#

### Backgroud

![TSV-ECC](https://files.seeusercontent.com/2026/03/19/d8oC/20260319135651.png)

高带宽内存（High Bandwidth Memory，HBM）的通道可以通过 128 个数据硅通孔（Through-Silicon Via，TSV）和 16 个奇偶校验 TSV 进行数据传输。一个通道可分为两个包含 72 个 TSV 的伪通道（pseudo channel）。如图 1 (a) 所示，在读取操作期间，一个伪通道从一个 TSV 发出 4 位突发数据（burst data），来自两个 TSV 的总共 8 位数据被归为一个符号（symbol）。

因此，通过 64 个数据 TSV 生成 32 个数据符号，通过 8 个奇偶校验 TSV 生成 4 个奇偶校验符号。这可以构成一个里德-所罗门码（Reed-Solomon code，RS）

> **DRAM 内部存储阵列的访问速度** 和 **外部 I/O 接口的数据速率** 不完全同一个节奏，所以现代 DRAM 普遍采用 **prefetch（预取）架构**。先从内部阵列一次取出多份数据，再连续地通过外部 I/O 总线送出去。
>
> - **DDR3** 采用 **8n prefetch**，因此常见是 **BL8**；Cadence 的说明里直接写到 DDR3 只支持 8-beat burst。
> - **DDR5** 的预取提升到 **16n**，默认突发长度是 **BL16**。
> - **HBM2E** 的 Micron 文档里给出的基本读写流程中，读和写数据都是 **burst of 4**。
>
> **64-bit DDR3 DIMM + BL8 = 一次 burst 传 64 bytes**。
>
> **单个 32-bit 通道 + BL16 = 一次 burst 访问 64B 数据**。

> **erasure-based ECC** 里**erasure** 指的是已经知道哪一个位置的数据丢失/不可信，但不知道这个位置原本的值是什么。

常规 ECC 将无法纠正从第三个符号错误（符号 4）开始的错误。然而，基于擦除的纠错码（erasure based ECC）可以纠正此问题 [5]。如图 1 (b) 所示，即使符号 4 存在额外的软错误（soft error），由于能够使用擦除纠正模式（erasure correction mode），错误纠正依然可行。为了使用擦除技术，必须预先获知故障 TSV（TSV 34 和 36）的位置。

### implement

![Flow chart](https://files.seeusercontent.com/2026/03/19/Ffi0/20260319141849.png)

该方案无法在正常运行期间检测硅通孔（Through-Silicon Via，TSV）故障，因此需要额外的 TSV 测试阶段。本文提出的方案基于一种模式匹配算法（pattern matching algorithm），该算法检查包含错误的符号是否为 0000（恒 0 故障，Stuck-At 0，SA-0）或 1111（恒 1 故障，Stuck-At 1，SA-1），这被视为固定型故障（Stuck-At Fault，SAF）模式。模式匹配检测方案是一种分析符号数据本身模式的方法，无需额外的测试逻辑。由于它不需要测试模式，因此可以在正常运行期间检测 SA-0 或 SA-1。在图 2 (a) 中，纠错译码（error decoding）完成后，比较器会对该错误数据执行模式分析。如果错误数据与错误模式（0000 或 1111）匹配，则激活标志位。如果随后在相同位置再次匹配到相同的错误模式，则判定发送这些错误数据的 TSV 存在硬故障（hard fault）。在其他情况下，首次错误模式匹配后，可能无法匹配到与之前相同的错误模式。此时，首次匹配后激活的匹配标志位将被停用，上述错误被归类为软错误（soft error）。模式匹配过程将结合图 2 (b) 进行详细说明。在图 2 (b) 中，为确定两种错误模式情况（SA-0 和 SA-1），比较器中分别存储了 0000 和 1111。纠错译码后，识别出符号 35 的错误位置和大小。随后，比较器检查这些突发错误（burst errors）是否与 0000 或 1111 匹配。针对每个 TSV（141 和 142）执行模式匹配，并根据匹配结果激活或停用标志位。由于本方案使用了基于擦除（erasure based）的纠错码（Error Correction Code，ECC），因此利用硬故障的位置，可以将包含故障 TSV 的符号视为擦除处理。

通过该方案，在极端情况下，**最多可纠正 6 个硬故障或 3 个符号错误。在软错误情况下，纠正方法与普通 ECC 相同。**

### The Summary

![result](https://files.seeusercontent.com/2026/03/19/C1qj/20260319142409.png)

完全仿真的结果，方法也很简单。这篇论文最主要的作用是了解HBM、DRAM的部分特征