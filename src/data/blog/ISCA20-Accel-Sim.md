---
title: "ISCA20 - Accel-Sim: An Extensible Simulation Framework for Validated GPU Modeling"
pubDatetime: 2026-09-15T00:00:00+08:00
description: "ISCA 2020 论文 Accel-Sim 阅读笔记：一个可在执行驱动 vISA 与追踪驱动 mISA 前端之间切换的 GPU 仿真框架，梳理其前端设计、性能模型演进与面向真实硬件的验证方法。"
slug: "isca20-accel-sim"
draft: false
tags:
  - "论文阅读"
  - "ISCA"
  - "GPU仿真"
author: "Deepcity"
timezone: "Asia/Shanghai"
---

# Accel-Sim: An Extensible Simulation Framework for Validated GPU Modeling

普渡大学AALP（Accelerator Architecture Lab at Purdue）做的工作：普渡 AALP（一作 Mahmoud Khairy，当时是 Rogers 的博士生，现在 NVIDIA）、UBC 的 Tor Aamodt 组（GPGPU-Sim 的原作者，Accel-Sim 的性能模型就是在 GPGPU-Sim 4.0 上演进的）、以及 Intel 的 Zhensheng Shen。

| 项目       | 内容                                                                                                                                                                                                                                                      |
| ---------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 论文标题   | Accel-Sim: An Extensible Simulation Framework for Validated GPU Modeling                                                                                                                                                                                  |
| 发表于     | ISCA 2020                                                                                                                                                                                                                                                 |
| 核心一句话 | 一个专门为简化未来 GPU 建模与验证而设计的仿真框架。通过利用一个灵活的前端（该前端能够在执行驱动的 vISA 仿真和追踪驱动的 mISA 仿真之间进行切换），我们能够在保留在适当情况下执行执行驱动仿真选项的同时，对来自 NVIDIA 二进制文件的手工调优机器码进行仿真。 |
| 适用场景   | GPU仿真                                                                                                                                                                                                                                                   |
| 代码/项目  | [dl.acm.org/doi/10.1109/ISCA45697.2020.00047](https://dl.acm.org/doi/10.1109/ISCA45697.2020.00047) [accel-sim/accel-sim-framework: This is the top-level repository for the Accel-Sim framework.](https://github.com/accel-sim/accel-sim-framework)         |

## Introduction

![table1](https://files.seeusercontent.com/2026/09/16/6sMq/image-20260916130955107.png)

这张表格横向对比了在20年时的不同GPU模拟器。其中的大部分东西都很好理解，这里简单列一下：

- ISA：支持的ISA的规范，对于vISA而言，基本上大家都是公开的，本身就用于在不同代际架构的硬件上的抽象语言，因此很容易支持。然而对于mISA而言，情况就有些截然不同，对于NV的SASS而言，完全不会公开，基本只有社区自己的逆向。AMD虽然公开，但是每次都会大改。Intel这里由于市占率不做考虑。HW的基本照搬NV的策略
- Front-end：这里是借用编译器领域的说法（编译器分为front与back），这里的含义是“程序要执行哪些指令”。指令从哪里来、指令流里每条指令是什么、带着什么操作数和地址。它产出的是**指令流**。这里Accel-Sim支持的是两种格式的输入一种是**Execution**（功能模拟现场"算"出指令流），一种是**Trace**（回放预先录制的指令流）

> 编译器中的front- back-end
>
> 源代码 → [Frontend] → IR（中间表示）→ [Middle-end 优化] → [Backend] → 目标机器码
>
> 基本思想是前端面向语言后端面向机器
>
> 做这样的区分的原因在于一个经典的数学问题 **M×N问题**
>
> 假设世界上有 M 种语言、N 种目标机器：
>
> - **不分离**：要为每对（语言, 机器）写一个完整编译器，共M×N个。
> - **分离**：写 M 个前端 + N 个后端，全部通过统一的 IR 对接，总共 M+N 个。

- Validation Perf. Model：这里指的是经过Counter-by-Counter验证的架构。

> 在这里的Counter-by-Counter基本上是将Profiling出的实际counter与模拟器的counter做对比，例如L1-miss之类的值

- Validation workload & Reported accuracy(error %)：字面含义。其中workload的validate的操作是，通过counter-by-counter的方式不断地区修改微结构参数或模型。例如cache大小，合并粒度，甚至修改模型代码等进行不断地迭代，这个部分有automated tuner半自动完成。其中Reported accuracy的计算方式是对80（worloads）x4(models)在跑完验证闭环后的周期&IPC的相对误差。
- Simulation rate (KIPS)：模拟速度，每秒模拟多少千条指令。在实际硬件上，对于CPU运行速度而言通常这个值在1e7-1e8级别。而在GPU上这个值通常在1e8-1e11级别。横向对比如gem2等模拟器这个值通常在几十到几百之间，CPU侧的其他模拟通常可以达到1e5级别
- Multi-threaded simulation：这是MGPU-Sim的独有特性，主要用于加速KIPS，但由于其对多核多进程的划分，导致其在精度方面有所损失。
- Hand-tuned NVIDIA libraries: 对cuDNN,cuBLAS,cuTLASS等闭源库能否提供支持。

## Design

![fig1](https://files.seeusercontent.com/2026/09/16/5hfN/image-20260916143053112.png)

这张图展示了Accel-Sim的端到端的模拟流程。

首先

- ISA Def file：opcode→执行单元映射表，图里就画了两行例子 `("FADD", FPU)`、`("IADD", INT)`。
- HW_Def.h file：硬件常量定义，如 `#define WARP_SIZE 32`、`#define SM_NUM 80`（warp 大小、SM 数量这类公开可查的参数）。
- 左下角的新 GPU（图上画了块显卡照片标注 "New HW"）：真实硬件本身也是输入——它要跑 microbenchmark、提供硬件计数器数据。

其次

1. Trace 路径：`Accel-Sim Tracer`（基于 NVBit，在真机上插桩）→ 产出 `SASS traces` → `Accel-Sim Trace-Driven SASS Frontend` 转成 ISA 无关 IR；
2. execute路径：`GPGPU-Sim PTX Emulation`（功能模拟 PTX，trace 不可用时的备选）。

两条路在中间那道标着 **"ISA INDEP."** 汇合，这里是整个系统的Frontend：右边的 `Configurable GPGPU-Sim Perf Model`（可配置性能模型）只看到 ISA 无关的 IR，不关心指令来自哪代 SASS。性能模型吃什么配置由 `Config Files` 决定。

最后

- Accel-Sim Correlator：把性能模型输出的 `Simulation stats` 和真机采集的 `Hardware stats`（NVIDIA profiler 的硬件计数器，论文说模拟器计数器和硬件计数器是 1:1 对应的）逐项对比，生成 `Detailed Correlation Graphs`（"Simulation QV100 SM Cycles vs Hardware QV100 SM Cycles"），并输出 `Correlation Guidance`，哪个计数器对不上、该回去修模型的哪部分。
- Accel-Sim Tuner + ubench suite：在新硬件上跑一套针对性 microbenchmark（测缓存延迟、单元吞吐等），tuner 自动生成/调整 `Config Files`，喂给性能模型。新执行单元（如 Tensor Core）的延迟吞吐就是这样标定的。

> 显然这里有一个很重要的内容——`Config files`
>
> ![tested-cfgs](https://files.seeusercontent.com/2026/09/16/Wq6e/image-20260916143209206.png)
>
> ![test-cfgs](https://files.seeusercontent.com/2026/09/16/vYo8/image-20260916143343419.png)
>
> 这两个文件在整个项目中分别属于gpu-simulator以及gpgpu-sim两个不同的部分
>
> tuner 解析 microbenchmark 输出后生成一个以硬件命名的文件夹，里面**恰好两个文件**，分别对应性能模型的两半边参数：
>
> - **`gpgpusim.config`** → 时序/微架构参数：SM 簇数与核数、时钟域、寄存器堆、流水线宽度与各执行单元（SP/DP/INT/SFU/Tensor）数量、指令延迟与发射间隔、sub-core 模型、warp 调度策略、L1/L2/inst/const cache 几何参数、shared memory、互连、DRAM 分区与时序。仓库里 `util/tuner/config_template/gpgpusim.config` 就是它的模板（待填项标 `X`）。
> - **`trace.config`** → trace 前端参数：各类 opcode 的延迟/发射间隔（`-trace_opcode_latency_initiation_int/sp/dp/sfu/tensor`）和专用单元声明（如本地 SM80_A100/trace.config 里的 `-specialized_unit_3 1,4,12,4,4,TENSOR`、`-specialized_unit_4 ...,UDP`）。
>
> 这里有一个很特殊的东西，在trace.config中的专用声明单元：`-specialized_unit_N` 声明，是在告诉性能模型：**这块 GPU 上存在一个不属於常规流水线（SP/DP/INT/SFU/MEM）的专用执行单元，请给它建一个硬件模型，并规定它的行为参数**。
>
> **这里之所以放在trace.config中因为这里的配置是给trace-drive的。**

![fig2](https://files.seeusercontent.com/2026/09/16/mlJ2/image-20260916150218556.png)

这是GPGPU-Sim 4.0的模型，而不是一个真实的硬件框架示例。在这里GPGPU-Sim是一个可配置的周期级抽象模型。

- **结构对齐真实设计**：SM 内分 4 个 sub-core（每个 = warp scheduler + 私有 RF + 私有 EU），sub-core 间隔离、只共享指令缓存和内存子系统——这是 Volta 之后 NVIDIA 的真实架构；自适应 L1/shared 划分、sectored cache、HBM/GDDR6 双总线等都是照真机建模的。
- **差别在于它是"逆向 + 参数化"的**：NVIDIA 不公开微架构细节，模型里很多行为是作者用 microbenchmark **探测出来再逼近的**（论文提到他们发现并建模了多个 undocumented 特性：自适应L1的streaming行为、L1/L2 sector化、sub-warp sector合并策略、L2写策略等）。所以差别主要是：未公开的真实实现细节被简化成可配置参数（如 L2 哈希用IPOLY交织来逼近），局部队列、仲裁器等不可能与 RTL 完全一致——这正是需要 counter 级验证（15% 平均误差）的原因。

> - adaptive（自适应划分）
>
> Volta 起 L1D cache 和 shared memory 共用同一块片上 SRAM。设备驱动会**按 kernel** 透明地决定这块 SRAM 怎么分：如果 kernel 不用 shared memory，全部容量划给 L1D；用得多就多分给 shared。这就是前面 Figure 2 讨论里说过的 adaptive cache 机制。论文作者通过 microbenchmark 摸清了划分的粒度和实际生效规则，并建进了模型。
>
> - streaming（流式访问行为）
>
> 指 L1D 面对**流式（streaming）访存模式**时的特殊替换/分配策略。流式访问 = 每个 cache line/sector 只被用一次、没有任何时间局部性（比如顺序扫一个大数组）。如果按普通 LRU 处理，这些"一次性"数据会占满缓存、把有复用价值的数据挤出去（cache thrashing），而自己永远命中不了。
>
> 作者在做内存系统相关性验证时发现，真实硬件的 L1 在这种情况下**不是简单的 LRU**——它表现出一种 streaming 感知的策略：流式数据的填充/逐出行为与有复用的数据不同（配合 sector 化的填充粒度和 sub-warp 合并策略），避免一次性数据把缓存冲刷掉。这个行为 NVIDIA 从未公开，是他们用针对性 microbenchmark 逆向出来、再逼近建模的"undocumented feature"之一。
>
> eg: L1 查找和填充都按这张 sector 列表走。比如 32 线程各读相隔 64B 的地址，会产生 32 个不同 sector 的请求，分布在 16 条 line 上；sector 中心策略只触碰这 32 个 sector，不会为每条 line 搬满 128B。
>
> - stream-aware buffer
>
> 真实 L1 在流式压力下表现出的填充/逐出行为**不是朴素 LRU**——一次性数据不会无限制地驱逐其他数据，L1 实际上退化成"合并缓冲区"的角色：为当次请求提供聚合和暂存，而不试图留存流式数据。
>
> - memory coalescing
>
> GPU 一条 load 指令是 warp 级（32 线程各要一个地址）。如果直接发 32 个独立请求，内存系统会被打爆。所以硬件有一个 **coalescing unit**：把 warp 内落在同一内存块上的线程访问**合并**成尽量少的物理事务。理想情况（32 线程连续访问 128 字节）合并成 1 次传输。
>
> "sector-centric"：合并和传输的基本单位是 sector（32B），不是整条 cache line（128B）
>
> "sub-warp"：按 warp 内连续 N 个线程分组分别合并
>
> - L2写策略
>
> 真实硬件用的是**带字节级有效位（byte mask / dirty bit）的 write-validate 策略**：L2 为每个 sector 内部维护字节粒度的有效/脏标记。部分写到达时，直接在 L2 里分配该 sector，只把写入的字节标为有效+脏，**不回填、不去 DRAM 读剩余字节**；将来这行被驱逐时，只把标脏的字节写回 DRAM（DRAM 层面按字节掩码写）。
>
> - **IPOLY 交织**：很重要，就观察而言贴近真实情况
>
> 现代 GPU 的 L2 是物理上分成 N 个分区（partition）的，每个分区挂一个显存通道。地址按某种函数映射到分区。传统做法是**线性交织**：取地址的某几位直接当分区号——比如 8 个分区就取地址的第 6–8 位（以 64B/256B 为粒度）。
>
> 问题在于 GPU 负载里 **2 的幂次跨步（stride）访问极其常见**（矩阵转置、按列访问、对齐的数据结构）。线性交织下，如果 stride 恰好是分区总数的倍数，所有访问都落在同一个分区上——其余分区闲置，一个分区被打爆。这就是 partition camping（论文 649 行），在 HBM 这种每 stack 8 通道、总共 2ⁿ 个分区的现代 GPU 上尤其严重。
>
> IPOLY（irreducible polynomial，不可约多项式）交织不再直接取地址位，而是：
>
> - 把 L2 bank 的选择位和**页行地址（page row）中随机选定的一些位做 XOR 混合**，混合关系由伽罗瓦域 GF(2) 上的**不可约多项式**定义——本质上是一个类似 CRC/LFSR 的线性反馈式比特搅拌。
>
> 效果：分区号变成地址多个比特的非平凡 XOR 组合，相邻或规律性跨步的地址被打散到不同分区。

![table2](https://files.seeusercontent.com/2026/09/16/V5cw/image-20260916154934860.png)

一个对mISA&vISA到与ISA无关的opcode的转换示例，其中*表示在执行过程中确定

![fig3](https://files.seeusercontent.com/2026/09/16/o5eA/image-20260916155112453.png)

一个测定L1 latency的microbenchmark，基本上通过PTX代码进行测定。

![table3](https://files.seeusercontent.com/2026/09/16/tc0D/image-20260916155211847.png)

这里测定了不同的benchmark suite所产生的trace size的大小。值得注意的是这里是使用**Accel-Sim 自带的 tracer**，构建在 NVIDIA 的 **NVBit** 二进制插桩框架上。NVBit 在 CUDA 二进制运行时注入探针，所以**不需要源码**。

**粒度**：**warp 级、指令级、per-kernel**。对每次 kernel launch，按 warp 记录每条**实际执行的 SASS 指令**，每条记录包含时序模拟必需的三类信息（562–567 行）：

1. 控制流：PC + active mask（warp 里哪些线程活跃）；
2. 数据通路：读写的寄存器、执行单元类型；
3. 访存指令的全部线程地址（一条 warp 访存指令对应最多 32 个线程地址）。

两层压缩：

- **base+stride 模式压缩（采集时）**：针对访存地址（572 行）。一个 warp 的 32 个线程地址绝大多数是规则的（`addr[i] = base + i×stride`），于是不存 32 个地址，只存 base、stride 和 active mask，不规则的退化为原始存储。这是 GPU trace 的经典压缩，利用的正是 GPU 访存的合并（coalescing）特性。
- **通用文件压缩（存储时）**：Table III 的 "Trace Size [Compressed]" 列，方括号里是压缩后大小。全量数据是 **6.2 TB 未压缩 → 317 GB 压缩**（每代卡各一份），约 **20×** 的总压缩率。例如 Rodinia 302 GB→15 GB，CUTLASS 2.5 TB→125 GB。

Table III 共 140 个 workload，但明确**砍掉了一批 trace 大到不可行的应用**（824–826 行）：Rodinia 的 cfd、heartwall、hotspot3D、huffman、leukocyte、srad-v2，Parboil 的 lbm、tpacf，Polybench 的 corr、cover、fdtd2d、gram-shm——原因都是 "trace sizes are prohibitively large"。这些应用仍可用 execution-driven（PTX）模式跑，只是没有 trace。

![table4](https://files.seeusercontent.com/2026/09/16/4Lkl/image-20260916162726843.png)

这里所展示的是横跨四个不同代际芯片的configure设定

> GPU SM 里每个 warp scheduler 的工作循环是：**选 warp（从就绪的 warp 里挑一个）→ issue（把它的下一条指令送入流水线）→ dispatch（把这条指令分发到对应的执行单元端口）**。"Issue" 回答"每周期发射几条"，"Dispatch" 回答"发射到哪类执行单元"。
>
> - **Dual-issue（Kepler/Pascal）**：一个 scheduler 每周期最多发射 **2 条指令**——但有限制：这两条必须来自**同一个 warp**、彼此**无数据依赖**、且去**不同的执行单元**（比如一条 FMA 去 SPU、一条访存去 LSU）。这是类超标量设计，目的是用指令级并行（ILP）榨干执行单元。Kepler 理论峰值因此达到 4 sched × 2 = 8 条 warp 指令/周期/SM。
> - **Single-issue（Volta/Turing）**：每个 sub-core 的 scheduler 每周期**最多 1 条**。峰值降为 4 条/周期/SM。
>
> Volta 引入**独立线程调度（ITS, Independent Thread Scheduling）牺牲发射宽度换调度灵活性**：单发射让调度器设计简化，同时实际上 dual-issue 本来就很难被编译器稳定利用（要凑出"同 warp、无依赖、不同单元"的指令对），ILP 的担子更多交给了编译器排布多 warp 间并行（TLP）来补。
>
> - IPOLY的机制设定只在HBM中存在，这是由于bank的数量为2的幂次导致的。

## Experiment

![table5](https://files.seeusercontent.com/2026/09/16/Dj6e/image-20260916170116151.png)

这里是衡量的周期数量的误差。MAE = **Mean Absolute Error（平均绝对误差）**，这里衡量的是**模拟周期数 vs 真机周期数**的偏差。Corr.（Pearson 相关系数）衡量的是各负载**快慢排序的吻合度**——即使 MAE 偏大，只要相关性接近 1，说明模拟器能正确判断"A 负载比 B 负载慢、慢多少比例"，做架构对比研究时结论仍然可信。

![table6](https://files.seeusercontent.com/2026/09/16/9bpO/image-20260916172656851.png)

与GPGPU-Sim 3.x之间的区别，很多都是架构审计带来的变化。例如subcore，warp scheduler isolation，DPU，INT，HBM等，认为没有必要详细看，前面基本上都有解释。

![table7](https://files.seeusercontent.com/2026/09/16/hF5i/image-20260916173028993.png)

**NRMSE = Normalized Root Mean Squared Error（归一化均方根误差）**

```python
RMSE  = sqrt( mean( (sim_i − hw_i) ** 2) )        # 先算均方根误差
NRMSE = RMSE / 归一化因子
```

![fig4](https://files.seeusercontent.com/2026/09/16/4Osw/image-20260916183716691.png)

这里的九张散点图是两个模拟器再QV100上的关键计数器与真机的对拍。其中每一个点都对应着一个kernel实例。x轴是真机的值，纵坐标是模拟的值。大多数图是log-log坐标。

每张图标题直接给出 Correl 和误差，与 Table VII 一一对应（Table VII 是这组图的数字汇总）。

1. **Cycles — 全图核心**。GPGPU的数据几乎全在红线上方，这说明其系统性高估cycle的值。一个可能的原因是其忽略了真实硬件上的一些优化
2. **Instructions — 隔离"输入指令流"变量**。GPGPU-Sim 跑 PTX，指令数与真机 SASS 有系统性偏差（27%）；Accel-Sim 用 SASS trace，几乎完美（MAE 1%）。这张图说明了在模拟器前端使用mISA的重要性。
3. **L2 Reads**：Accel-Sim 相关性 1.00、NRMSE 仅 0.03。由于sub-warp合并以及sectord L2。
4. **L2 Read Hits**：0.99 / 0.47。正文提到一个**方法论细节**：profiler 报的 L2 命中率本身不一致（有的超过 100%），所以作者改为对比**命中次数**。残余误差来自访存到达 L2 的次序（调度效应）。
5. **DRAM Read**：GPGPU-Sim 误差 5.69 的根因被定位到它的 **fetch-on-write 写策略**：每次写回 L2 都要从 DRAM 取 4 个 32B 扇区，导致 DRAM 读被高估（图上蓝点明显在红线上方形成平行带）。Accel-Sim 用 sector 化 + write-validate 消除了这个假象。Accel-Sim 自己的残余误差（0.92）集中在小负载上。
6. **L1D Reads（合并器之后的访存次数）**：Accel-Sim 做到 1.00 / 0.00，归功于 sub-warp 合并器 + sectored L1。
7. **IPC**：0.88/48% vs 0.98/22%。这里注意一个公平性处理：两个模拟器的 IPC 分子**都用机器指令数**，避免用 PTX 指令数惩罚 GPGPU-Sim。GPGPU-Sim 的 IPC 误差小于它的 cycle 误差（48% vs 94%），因为IPC作为比值天然对这类极端值钝感。

> IPC：instructions per cycle
>
> - **Accel-Sim** 跑的就是 SASS trace，指令数天然是机器指令，没有歧义；
> - **GPGPU-Sim 3.x** 执行的是 **PTX**——它"原生"的指令数是 PTX 指令数，而 PTX 和 SASS 的指令数量**系统性不同**（一条 PTX 可能被 ptxas 展开成多条 SASS，也可能多条 PTX 被融合成一条，寄存器分配、寻址模式差异都会改变总数——Figure 4b 量化了这个差异：MAB 27%）。
>
> eg：某个 kernel：真机执行 100M 条 SASS 指令、100M 周期，IPC = 1.0。GPGPU-Sim 模拟出 194M 周期（高估 94%），但它只"知道"自己执行了 80M 条 PTX 指令：
>
> - 不公平算法：IPC = 80M / 194M = 0.41 → 误差 59%；
> - 公平算法：IPC = 100M（机器指令数）/ 194M = 0.52 → 误差 48%。

8. **Occupancy — 唯一打平的图**（0.99 / 0.12 vs 0.13）。初始 occupancy 两个模型都能算对；偏差出现在**负载不均衡的 kernel** 收尾阶段，两边 occupancy 下降的速率与真机不同。

> Occupancy（占用率）是 GPU 的一个核心性能指标，指 **SM 上实际驻留活跃的 warp 数量占该 SM 最大可容纳 warp 数的比例**。

9. **L1 Hit Rate**：正文揭示了为什么这么难：microbenchmark的逆向发现，profiler对“命中”的判定是是否命中128B cache的tag，而不是32sector。第二点：命中率取决于访问到达时 line 还在不在缓存。几十个 warp 的访存在时间轴上如何交错、替换策略踢掉谁决定。而 warp 调度策略和替换策略恰恰是 NVIDIA **不公开**的部分，模拟器只能用 lrr/gto、LRU 去逼近。L1 容量小、竞争剧烈，处于" thrashing 边缘"：调度顺序差一点，某条 line 是被保留还是被踢掉就反转，一次 hit 变 miss。所以命中率对调度/替换策略的微小偏差非常敏感。而GPGPU-Sim，由于其在warp以及cache管理上差距过大，因此只会更差。

> profiler的cache命中可以用一个例子来解释
>
> sectored L1 里，某条 line 的 tag 已经在缓存中（因为之前访问过它的 sector 1），现在一个 warp 来读同一条 line 的 **sector 0——这个 sector 从未被取进来**。真实行为是：sector miss，请求照样发去 L2 取数据。但 profiler 看到 tag 存在，**记为一次 hit**。

![fig5&6](https://files.seeusercontent.com/2026/09/16/4ibZ/image-20260916173915022.png)

分别展示了PTX模式下于Sim模式下的cycle与Deepbench workload下的cycle的误差。可见使用PTX模式确实对仿真有一定影响，但很容易发现效果还是强于GPGPU-Sim，这是由于GPGPU-Sim在前面所提及的缺陷所导致的。值得注意的是，在第二张图中，虽然MAE达到了33%，1/3的误差，但是Correl系数仍然有95%，这说明趋势仍然是可信的。

然而，正文中对fig6有提及对cuTLASS的gemm-wmma误差，GPGPU-Sim反而误差更小。这是由于PTX 的抽象WMMA（Warp-level Matrix Multiply-Accumulate）指令恰好是HMMA（Half-precision Matrix Multiply-Accumulate）行为的不错近似，某些输入尺寸下甚至比 Accel-Sim 的 SASS 级 HMMA 模型还准。

> [!note]
> ## cycle 数就是模拟器的"最终产品"
>
> GPU 性能模拟器存在的唯一目的就是**预测程序跑多快**。真机的执行时间 = 周期数 × 时钟周期，而时钟频率是配置里定的常数——所以 **cycle 数 ≡ 执行时间**，它是整个模拟过程所有中间环节（指令流、调度、缓存、DRAM）误差**汇聚后的总出口**。

![fig7](https://files.seeusercontent.com/2026/09/16/oSt0/image-20260916194813967.png)

这个图是在用饱和的microbenchmark验证在各级缓存、内存上模拟出来的存储IO带宽最多能给多少。下面给出一些Accel-Sim自己说明的不足之处：

- L1带宽：这里的差距在10%以内。原因不明
- L2带宽：这里主要是partition camping所造成的影响，GPU上的哈希机制调优是这里最大的gap
- Mem：这里的原因可能在于DRAM时序细节

![table8](https://files.seeusercontent.com/2026/09/16/5yMk/image-20260916195922020.png)

![table8-add](https://files.seeusercontent.com/2026/09/16/h0Pm/image-20260916212157867.png)

这里没有deepbench workload是fig4&5的细则统计

| Suite              | GPGPU-Sim 3.x | Accel-Sim PTX | Accel-Sim SASS |
| :----------------- | :------------ | :------------ | :------------- |
| CUDA SDK MAE       | 13            | 16            | **9**    |
| Rodinia MAE        | 32            | 28            | **8**    |
| Parboil MAE        | 45            | 37            | **20**   |
| Polybench MAE      | **111** | 6             | **4**    |
| Microbenchmark MAE | 37            | 14            | **9**    |
| CUTLASS wmma MAE   | 11            | **0.5** | 12             |

Polybench是其中差距最大的benchmark，这直接归因于Polybench对cache容量十分敏感。GPGPU-Sim 的 L1 是**固定 32KB**，而 Accel-Sim 的 adaptive cache 能把 Volta 统一片上存储的**全部 128KB 分给 L1D**。即所谓的对SRAM的动态划分。而且32B的sector的取值粒度也增加了cache的使用率。这里将atax、bicg、gesummv、syrk、mvt这几个负载的误差从平均400%降低到20%。

cuTLASS wmma这一个负载PTX反而优于SASS，这可能是由于在特定输入尺寸下的问题。

**Rodinia 的残余误差有明确归属**：这批负载 cache 局部性差、行为不规则，误差对 **L2 带宽**最敏感——正是 Figure 7 里那消不掉的 22%。IPOLY 缓解了 partition camping 但不等于 NVIDIA 的真实哈希函数，表和图在这里互相印证。

**CUDA SDK（streaming 型负载）**：对 DRAM 带宽敏感，所以 HBM 模型 + SASS 指令流把它压到 9%——它吃到的主要是 Figure 7 的 Mem BW 那根柱子的红利。

另外值得注意的是小负载误差大、大负载误差小是全表的普遍模式。

## Case Studies

![fig8&9](https://files.seeusercontent.com/2026/09/16/9Myc/image-20260916212344041.png)

fig8基本是说L1 Cache的预留失败的次数，fig9基本是说FR-FCFS相对于FCFS的加速比。

对于fig8而言，7 个 cache 敏感负载，每个两根堆叠柱（GPGPU-Sim 3.x vs Accel-Sim），纵轴是每千周期的 **L1 reservation fail** 次数，堆叠成三种失败原因：MSHR 耗尽（MSHR_RESERV_FAIL）、cache line 分配失败（LINE_ALLOC_FAIL）、队列满（QUEUE_FULL）。

> 1. MSHR_RESERV_FAIL
>
> **MSHR（Miss Status Holding Register）**记录cache miss还没有从下层内存取回的的cacheline。这个视角是从SM的视角上统计的，对于每一个SM而言通常都只有几十个可以的在途请求。通常这个值决定了MLP的上限。
>
> 2. LINE_ALLOC_FAIL
>
> 取回miss的数据时，没有cache line资源使用，这个资源与MSHR结合取最低值。
>
> 3. QUEUE_FULL
>
> 这是**传输层面**的拒绝：L1 内部和周围有一串队列——LSU→L1 的请求队列、L1→L2 的 miss 请求队列、fill 队列等。队列深度有限，当**下游消费不动**（比如 L2/互连拥塞，miss 处理不过来），队列积满，新请求连缓存流水线的门都进不去，背压一路传回 warp scheduler。

对于fig9而言，在这个case下。13个访存密集型负载（DRAM带宽利用率>50%），比较两种DRAM调度策略：朴素**FCFS**（先来先服务）vs **FR-FCFS**（row-ready优先——优先服务命中已打开DRAM行的请求，是一种乱序内存调度），纵轴是FR-FCFS相对FCFS的归一化性能。
