---
title: "MLSys26 - Charon: a unified and fine-grained simulator for large-scale LLM training and inference"
pubDatetime: 2026-09-23T00:00:00+08:00
description: "解析面向大规模大语言模型训练与推理的细粒度仿真框架 Charon，系统梳理其算子图级建模、拓扑感知通信与计算重叠减速处理等核心设计，并结合多种 GPU 架构及万卡集群验证其在性能预测与推理配置寻优上的精确度与实际收益。"
slug: "mlsys26-charon"
draft: false
tags:
  - "论文阅读"
  - "LLM"
  - "大模型推理"
  - "分布式系统"
author: "Deepcity"
timezone: "Asia/Shanghai"
---

## Charon: a unified and fine-grained simulator for large-scale LLM training and inference

得克萨斯奥斯丁大学Mengtian Yang在Seed实习时的文章，作为本文的第一作者，这篇论文是其从芯片，加速器设计领域转向AIInfra领域在MLSys的第一篇论文。Zhekun Zhang做ML编译方向，ISSTA20上有篇软件测试的文章。Mingheng Wu双清硕士，PyTorch 和 torchtitan 贡献者，方向覆盖预训练图编译、ND 并行、异构推理。Hanshi Sun则是长下文推理场景下研究KVCache的CMU->Seed学者。Li-Wen Chang同样是ByteDance Research Scientist，主攻GPU体系结构与编译器方向。

| 项目       | 内容                                                         |
| ---------- | :----------------------------------------------------------- |
| 论文标题   | Charon: a unified and fine-grained simulator for large-scale LLM training and inference |
| 发表于     | MLSys 2026                                                   |
| 核心一句话 | Charon通过构建统一、模块化且细粒度的仿真框架来预测大模型训练与推理性能，将整体预测误差稳定控制在5.35%以内（大规模集群训练误差低于3.74%），并有效指导配置优化提升了推理吞吐量。 |
| 适用场景   | GPU仿真、机器学习负载仿真                                    |
| 代码/项目  | [Charon paper](https://mlsys.org/virtual/2026/oral/3861) [Charon project（截止 22 September）](https://github.com/ByteDance-Seed/Charon) |

![image-20260923132836526](https://files.seeusercontent.com/2026/09/23/2eAw/image-20260923132836526.png)

这里的Elevator Pitch主要是体现整个系统的三个设计点

- Graph-based Operator-level Simulation
- Different Computation Card Adoption
- Cluster Topology-aware Communication

以及作为仿真框架在实际运行时的两个优势：**低成本**，**准确**。

![table1](https://files.seeusercontent.com/2026/09/23/pz6M/image-20260923143306003.png)

这里补充一下EuroSys26的工作Maya，NSDI26的工作Phantora，26预印本工作Revati、LLM-Emu、Frontier、AgentServeSim。

![Supplementary materials](https://files.seeusercontent.com/2026/09/23/An6a/llm_simulator_comparison.png)

针对几个不好懂的维度做一些简短的解析：

- Optimizations: 这里一般指torch.compile等优化，针对compile，对kernel的影响是，会将部分kernel fused。更具体的扩展如下：

> 扩展一下Optimizations这里的内容，大致可以分为4层
>
> 1. kernel层级：算子融合（FlashAttention、fused MLP/RMSNorm/RoPE、torch.compile 生成的融合 kernel）、量化（FP8/INT8 换了 kernel 也换了耗时）、CUDA Graph（消除 launch 开销，还会把 decode batch pad 到捕获过的尺寸）、自定义/JIT kernel。
>
> > 这里所谓的把 decode batch pad 到捕获过的尺寸，指的是**用 CUDA Graph 运行推理时，实际进入模型的 batch 大小必须和你捕获（capture）Graph 时用的 batch 大小完全一致**。如果实际请求的 batch 比捕获时小，就要把 batch 填充（pad）到那个固定尺寸，多出来的位置放"废样本"。
> >
> > LLM 推理的 decode 阶段是逐个 token 生成的。batch 里活着的序列数量是**动态**的（有的序列提前生成完、退出，batch 从 8 掉到 5）。但 Graph 只认一种形状，所以引擎的做法是：
> >
> > - 捕获一组固定尺寸的 Graph，比如 batch = 1, 2, 4, 8, 16, 32...
> > - 运行时按"向上取整"选一个：当前有 5 条序列，就重放 batch=8 的那个 Graph
> > - 把空缺的 3 个位置 **pad** 成 dummy 序列（通常 token id 填成 `pad_token_id` 之类），这 3 个位置照常计算、照常浪费算力，只是结果被丢弃。
> >
> > - **浪费少量算力**：pad 的部分是纯白算，但相对 launch 开销的节省通常完全值得。
> > - **这就是为什么调度器会按 bucket 管理序列**：比如 vLLM 里的 `max_num_seqs` 对齐到捕获的 batch 尺寸，进出序列时尽量在桶内合并/复用，减少 pad 比例。
> > - **为什么捕获档位是 2 的幂或几个固定值**：档位太多会占显存（每个 Graph 都要保存一份参数和 workspace），所以只在几个常用尺寸上捕获。
>
> > 这里为什么会有自定义/JIT kernel?
> >
> > **通用框架（PyTorch 等）为了保证"任何形状、任何设备、任何 dtype 都能跑"，给每个算子提供了最通用但也最保守的实现。而实际模型里，算子是以固定组合、固定形状反复出现的，通用实现浪费了大量的显存带宽和 kernel 启动次数。**
> >
> > 例如LLM 里每个 transformer 层都要做 RMSNorm（Llama、Qwen 都是）。
> >
> > ```python
> > def rmsnorm(x, w, eps):
> >     return x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + eps) * w
> > ```
> >
> > `x.pow(2).mean(...)` 这一行，它在底层会拆成**多个独立 kernel**。
> >
> > **自定义 kernel 的做法**：写一个融合（fusion）kernel。
> >
> > 训推框架里到处都是这种东西：LayerNorm+残差融合、SwiGLU 融合、RoPE 融合、FlashAttention（把 softmax(QK^T)V 从 5 个 kernel 融合成 1 个，避免显式 materialize 注意力矩阵。
>
> 2. **调度与执行层**：计算-通信 overlap（TP overlap、FSDP prefetch、DualPipe、two-batch overlap）、流水线调度（1F1B/交错/DualPipe）、梯度累积、分布式优化器。
>
> > - **1F1B 和交错（interleaving）**
> >
> >   朴素做法GPipe：先把所有 microbatch 的 forward 全跑完，再倒序跑所有 backward。有两个问题：forward 期间显存要缓存所有 microbatch 的激活值，显存爆炸；两阶段交界处流水线完全排空，产生大量气泡（bubble）。
> >
> >   1F1B：来一个 microbatch 先算它的 forward，然后立刻对**最早进入的那个 microbatch** 算 backward。
> >
> >   - 任何时刻只缓存 N 张卡份（= 流水深度）的激活，显存占用和卡数无关 → 可以把 microbatch 切得更细
> >   - forward 和 backward 交替填充流水线，气泡相比 GPipe 大幅减少
> >
> >   **用一个滑动窗口限制"在飞的 microbatch 数"**
> >
> >   ![1f1b](https://files.seeusercontent.com/2026/09/23/xR9g/bb6e628.png)
> >
> > - **计算-通信 overlap**
> >
> >   - **TP overlap（张量并行内）**：TP 把每层 GEMM 按列/行切到多卡，每层 forward 和 backward 都有 allreduce，通信量虽然小但**在关键路径上**（每层两次）。Megatron 的做法是把 GEMM 沿 batch 维切成几块：第一块的 GEMM 算完后立刻发它的 allreduce，同时算第二块的 GEMM——通信和下一块的计算重叠，把 allreduce 的延迟藏进 GEMM 里。类似地还有把 dropout/layernorm 这类 elementwise 操作挪到通信期间做（sequence parallel 的思想：把非 GEMM 的部分沿序列维切分，让通信和这些轻量计算并行）。
> >
> >     ![tp overlap](https://files.seeusercontent.com/2026/09/23/c4qS/TP_overlap.png)
> >
> >   - **FSDP prefetch（参数预取）**：FSDP/ZeRO-3 把参数切成 shard 分散存放，用某一层之前必须先把这层的参数 allgather 回来。朴素执行就是：等参数 gather 完 → 算 → 再等下一层 → 算……全程卡顿。prefetch 就是：**算第 i 层的时候，提前把第 i+1 层的 allgather 发出去**。backward 时同理（反向顺序预取）。通信和相邻层计算重叠，层间停顿基本消失。这本质上和 CPU 缓存预取、GPU 软件流水是同一个思想。
> >
> >     ![FSDP prefetch](https://files.seeusercontent.com/2026/09/23/lz1Z/FSDP_prefetch.png)
> >
> >   - **Two-batch overlap**：上面两种都是"同一批数据的通信和计算重叠"。two-batch 则是**拿两个 microbatch 互相填空**：microbatch A 在等它的通信（比如 MoE 的 alltoall 或 expert-parallel 通信）时，立刻切换去算 microbatch B 的计算。通信天然变成了"别人的计算时间"。DualPipe 里就有这种味道（两个反向批次的通信和对方的计算对向穿插），广义的 two-batch overlap 不限于流水线场景。
> >
> >     ![two-batch overlap](https://files.seeusercontent.com/2026/09/23/eq3L/Two_batch_overlap.png)
> >
> > - **分布式优化器（Distributed Optimizer / ZeRO 的优化器侧）**
> >
> >   Adam 的优化器状态（一阶动量 m、二阶动量 v）和 fp32 主权重，大小是参数量的 4~6 倍（fp16 模型下）。一张卡放不下时怎么办？ZeRO-1/2 已经把梯度、optimizer states 切到 DP 各卡上了，但**每个 rank 仍然要持有全量参数**才能做自己的前反向。分布式优化器（PyTorch FSDP 的 `use_orig_params` + FlattenParams、Megatron 的 DistributedOptimizer，对应 ZeRO-3 的优化器部分）把这一步也切了：
> >
> >   1. **Backward** 算出梯度后，做 reduce-scatter：每个 rank 只拿到梯度的一个 shard，通信量比普通 allreduce 还小
> >   2. **本地更新**：每个 rank 只对自己那份 shard 的梯度做 Adam 更新（m、v、fp32 主权重都只存这一份 shard，内存 ÷ DP 度数）
> >   3. **Allgather 前向**：下次 forward 需要完整参数时，再 allgather 拼回来（配合上面说的 prefetch，这次通信也被藏掉了）
> >
> >   效果：**参数 + 梯度 + 优化器状态的显存占用都除以数据并行度数**，于是一台机器能装的模型大了一个数量级。代价是多了参数 allgather 的通信（但被 prefetch overlap 藏住了）。
> >   
> >   ![Distributed Optimizter](https://files.seeusercontent.com/2026/09/23/Dls7/8229a56.png)
> >   
> >   | 优化              | 藏的什么             | 代价                                      |
> >   | :---------------- | :------------------- | :---------------------------------------- |
> >   | 1F1B / 交错流水线 | 流水线气泡、激活显存 | 交错版通信变多                            |
> >   | TP overlap        | TP allreduce 延迟    | 代码/调度复杂度                           |
> >   | FSDP prefetch     | 层间参数 allgather   | 需要额外显存缓冲下一层参数                |
> >   | Two-batch overlap | 通信等待时间         | 调度复杂，切换开销                        |
> >   | 分布式优化器      | 优化器状态/参数显存  | 增加 allgather 通信（可被 prefetch 藏掉） |
>
> 3. **内存层**：激活重计算、ZeRO/FSDP 分片、offload、prefetch——它们同时改内存和时间（多一次重算、多一次 all-gather）。
> 4. **serving 层**：continuous batching、chunked prefill、prefix caching（RadixAttention）、分层 KV 缓存/换出、投机解码/MTP（一步变成 draft→verify→commit，每步 token 数变了）、PD 分离、DP-attention、MoE 路由与负载不均。
>
> > - **continuous batching**
> >
> >   **问题**：朴素批处理是"整批进、整批出"——一批 4 个请求一起开始，必须等**最慢的那个**生成完才能开下一批。但每个请求生成长度不同（有的 10 个 token，有的 500 个），快的早就完了，GPU 还得陪跑，算力大片闲置。
> >
> >   **做法**：把调度的粒度从"批"细化到**步**——每生成一个 token，就检查一遍：哪个请求结束了（输出 EOS），立刻把它踢出 batch、把 KV cache 释放，同时把新到的请求塞进来。**batch 的组成在每个 decode 步之间都在流动**，永远保持满员。
> >
> > - **Chunked prefill**
> >
> >   **问题**：一个 32k token 的长 prompt 到来时，prefill 要一口气算完，期间 decode 全被堵住——正在生成的用户会明显感到卡顿（每 token 延迟飙升）。Prefill 和 decode 混在一个 batch 里互相伤害。
> >
> >   **做法**：把长 prefill 切成固定大小的块（比如每块 2048 token），**一块一块地塞入调度流，和 decode 步交替执行**。每切一块只占一小段 GPU 时间，decode 的延迟抖动就被压住了。
> >
> > - **Prefix caching**
> >
> >   **问题**：大量请求共享前缀——同一个系统提示词、同样的 few-shot 示例、多轮对话的历史。朴素做法是每个请求都把自己的前缀重新 prefill 一遍，纯重复劳动。
> >
> >   **做法**：把 KV cache 组织成一棵 **radix tree（基数树）**：每个节点是一段 token 的 KV cache，共享前缀的请求走同一条路径。**新请求进来先查树做最长前缀匹配**，命中的部分直接从缓存读 KV，只对不命中的后缀做 prefill。
> >
> > - **投机解码 / MTP（Multi-Token Prediction）（一步变成 draft→verify→commit）**
> >
> >   **问题**：decode 每步只出 1 个 token，而瓶颈在显存带宽——每步都要把整个模型搬一遍，只换来 1 个 token，太亏。
> >
> >   **做法**：拆成三个阶段，让一步**期望产出多个 token**：
> >
> >   1. **Draft**：用便宜的小模型（或 MTP 头）快速猜出接下来的 k 个 token（小模型跑 k 次，便宜）
> >   2. **Verify**：大模型把这 k 个 token 当作输入，**一次并行前向**验证——哪些和"大模型自己本来会输出的"一致
> >   3. **Commit**：接受最长的一致前缀，从第一个错的地方开始重新生成
> >
> > - **DP-attention**
> >
> >   **问题**：在大 batch serving 下，attention 层的负载性质变了——每个请求各自算自己的注意力，**请求之间完全不需要通信**（天然数据并行）；但传统做法（Megatron 式 TP）把 attention 也切到多卡上，每层都要 allreduce。大 batch 时 attention 已经变成计算密集，TP 的通信纯属白付，还限制了扩缩粒度。
> >
> >   **做法**：**attention 用数据并行**（每张卡放完整的 attention 参数，一个请求从头到尾在一张卡上算完 attention），**MoE 层用专家并行**（alltoall 不可避免）。两类层解耦，各自用最合适的并行策略。DeepSeek-V3.2 的大型集群就是这么部署的：attention DP + MoE EP，去掉了 attention 的所有跨卡通信。
>
> 各个不同的仿真框架对这些优化手段的解决方式略有不同
>
> | 思路                                      | 代表                                        | 做法                                                         | 优点                                                         | 代价                                                         |
> | :---------------------------------------- | :------------------------------------------ | :----------------------------------------------------------- | :----------------------------------------------------------- | :----------------------------------------------------------- |
> | **隐式捕获：直接跑真实框架代码**          | Maya、Phantora、Revati、LLM-Emu             | 拦截 CUDA/NCCL（或替换 GPU forward），让 Megatron/DeepSpeed/vLLM/SGLang 的真实调度逻辑在 CPU 上运行，优化产生的 kernel 序列、batch 组成、依赖关系自然出现在 trace 里 | 新优化"零成本"进入仿真（Maya 原话 "captured without additional effort"）；不用重写调度器；Revati 说 PD 分离、prefix cache 等 "work out of the box" | 框架发出什么 kernel 就要能给出它的耗时，所以离不开真机 profiling；控制流不能依赖 GPU 张量内容（Phantora 要关 Megatron 的梯度裁剪）；JIT/自定义 kernel 需额外工程；框架特有 kernel（Revati 点名 flash attention、MoE routing）预测器仍要单独扩展 |
> | **显式建模：在纯仿真器里逐个实现**        | Charon、Frontier、AgentServeSim             | Charon 把每个优化写成 fx 图上的 pass（融合=match-and-replace、量化 pass、重计算 pass、DualPipe 调度），加/删 pass 即开/关；Frontier 用 Runtime Adapter 把 CUDA Graph（pad 到捕获尺寸、查 kernel-only profile）、MTP（每请求独立投机深度）、prefix caching（准入前标记命中块）做成一等对象；AgentServeSim 只显式建 prefix cache + 跨轮 KV 分层，其余直接不建 | 可组合、可做 what-if（评估框架里还没实现的优化）；不受"框架能否在 CPU 上跑"限制，能仿真到万卡 | 每个新优化都要写一遍并单独验证，有和真实框架行为漂移的风险；覆盖面取决于作者精力（AgentServeSim 就没有融合/CUDA Graph/投机解码） |
> | **吸收进测量：把优化埋进 profile 粒度里** | LLM-Emu（step 级）、各系统的 profiling 引擎 | profiling 单位越粗，自动包含的优化越多：per-kernel 只有 profile 到融合后的 kernel 才算捕获；per-operator 要显式加 "fused attention variants"（Revati 扩展 Vidur 时做的）；per-step 则 CUDA Graph、attention backend、async scheduling 全在里面 | 校准成本低、可解释                                           | 粒度越粗越不可迁移：LLM-Emu 每个模型×硬件×配置都要重采 3.5–4.5 GPU 小时，换一个 flag 就要重来 |

- Overlapping Slowdown: 这里指通信与计算之间的Overlap，进一步的讲，TMA所提供的overlap可能也包含其中。

> 当计算 kernel 和通信 kernel 被框架安排在同一块 GPU 上并发执行（不同 CUDA stream），或多个集合通信同时走同一条链路时，它们会争抢共享资源，导致**两边都比单独运行时慢**。争抢的资源具体是 SM（NCCL kernel 本身要占 SM 跑 reduce/copy）、HBM 带宽和 L2（通信要读写显存）、NVLink/PCIe/NIC 带宽（多个集合通信并发），以及功耗和频率。
>
> Echo（CUHK 同组的训练仿真器，arXiv 2412.12487）实测：训练中超过 50% 的计算算子和通信重叠，常见 kernel 重叠时平均慢 37.76%，GPT-2 个别 kernel 慢到 8 倍（平均 1.70×），整个训练 step 慢最多 1.48×。
>
> 主要有以下影响：
>
> 1. **系统性乐观**：所有靠事件流仿真“再现”重叠的系统用的都是单独profile的时间，一旦充电时间线就比真实短，而且误差随重叠比例增长——TP overlap、FSDP prefetch、DualPipe、DeepEP two-batch overlap最容易出现这样的问题
> 2. **扭曲设计结论**：不计减速时，"更多 overlap"永远看起来是免费午餐，Design Searching 会偏向重叠激进的配置，而真机上这些配置的收益可能被干扰吃掉一半。
> 3. **通信-通信的带宽分摊**：DP all-reduce 和 PP p2p、EP all-to-all 和跨节点 TP all-reduce 同时占一条链路时，若各自按满带宽算，通信时间也被低估。推理侧问题相对轻——单机 TP 的 all-reduce 小且 vLLM 默认基本串行——所以 Revati、LLM-Emu、AgentServeSim 干脆不涉及；但 PD 分离里 KV 传输与 decode 计算并发、EP 的 all-to-all 与专家计算并发，正在把这个问题带进推理仿真。
>
> 处理思路按代价从低到高大致五档：
>
> | 思路                       | 代表                                             | 做法                                                         | 优点                                                       | 代价                                                         |
> | :------------------------- | :----------------------------------------------- | :----------------------------------------------------------- | :--------------------------------------------------------- | :----------------------------------------------------------- |
> | **假设解耦，只再现不减速** | Maya v2、Phantora、Frontier、Revati              | 多流事件仿真捕获重叠结构，时间用孤立 profile 值              | 零建模成本                                                 | 系统性乐观；Maya v2 和 Phantora 都明确写成 future work，Phantora 的理由是 "impractical to profile for every possible overlap" |
> | **比例减速因子**           | Charon                                           | 从目标集群 profiling 标定两个因子（计算算子一个、通信算子一个），只作用于算子实际重叠的那段时长；可按算子类型细分 | 便宜、可解释、对 overlap 重的调度立刻见效                  | 因子和硬件/NCCL 配置强绑定（SM 数、协议、channel），换集群要重标；无法表达"重叠对象不同减速不同" |
> | **学习型减速预测器**       | Echo                                             | 用 XGBoost 以 NCCL 协议/channel 配置、kernel 的 SM 占用率、DRAM 利用率等为特征预测每对重叠算子的减速 | 能区分 compute-bound 和 memory-bound kernel 受影响程度不同 | 需要专门的重叠微基准数据集；泛化到未见 kernel/硬件不保证     |
> | **资源级建模**             | Charon（通信-通信）、Phantora netsim（链路）     | 显式建模共享资源的分配：链路上按 max-min 公平或带宽竞争比分摊；SM 上按 NCCL 占用的 SM 数折算计算吞吐；HBM 带宽按需求比例切分 | 有物理含义，跨配置可迁移                                   | 需要每个 kernel 的资源画像（SM/带宽需求），实现复杂；SM 级干扰目前没有系统做完整 |
> | **粗粒度直接测量**         | LLM-Emu（step 级）、Vidur 式带 TP 的层级 profile | 在真实调度下 profile 整层/整步，减速自然包含在测量里         | 零建模误差                                                 | 完全不可迁移，换并行度或调度就要重测；对训练的大规模配置根本测不起 |

![fig2](https://files.seeusercontent.com/2026/09/23/pTx0/image-20260923172755343.png)

相比于前面的横向对比，这里纵向剖析了为什么要进行负载仿真。结合多种现代不同的优化策略与拓扑架构阐述了现代LLM负载调优中的复杂度与高昂成本。

a. **Decode-only Transformer 架构图**：左半部分是一个流程图Embedding Layer → Transformer Block 1 → … → Transformer Block N → LM Head Layer。右半部分是**单个 Block 的放大图**，其中包含：

1. 输入先过 **Norm Layer**，然后兵分三路：**Query (Q) / Key (K) / Value (V) Generation** 三个投影算子
2. 进入 **Multi-head Grouped Query Attention**(GQA——注意画的是分组查询注意力，呼应 LLaMA-3/Qwen3 这类现代模型）

> Multi-head 解决的是**表达能力**问题（2017 年 Transformer 原始设计）,Grouped Query 解决的是**推理效率**问题（2023 年 GQA 论文提出）。图中把两者叠画在一起（"Multi-head Grouped Query Attention")，正是因为现代模型（LLaMA-3、Qwen3）是"多头查询 + 分组共享键值"的组合。
>
>  > Multi-head在表达能力上几乎没有问题，但是实际工程上会发现，其制造了严重的memory-bond。
>  > MHA 下 KV cache 大小 = 2 × 层数 × 头数 × 头维 × 序列长
>  > 这里注意力头数被直接乘进KVCache的大小中，占用大量显存的同时拖慢每步的decode。
>  > 一个极端的解决方式是： **MQA**(Multi-Query Attention, 2019)：所有 query 头共享**同一份** K/V,cache 缩小 h 倍，但质量明显下降——因为所有头被迫用同一套键值表征，等于把多头的表达力又砍回去了。
>  > GQA 在 MHA 和 MQA 之间取插值——query 头分组，组内共享一份 K/V:
>  > h 个 query 头分成 g 组（如 32 个 Q 头、8 个 KV 头，即每 4 个 Q 头共享一对 K/V)
>  > K/V 只生成 g 份，注意力计算时同组的 Q 头复用同一份 K、V
>  > KV cache 缩小 h/g 倍，decode 的显存读取量同比例下降
>  > 参数化上：g = h 退化为 MHA,g = 1 退化为 MQA。实证结论是 g 取 4~8 时质量几乎无损（接近 MHA)，而 KV cache 和 decode 带宽开销降低数倍（接近 MQA)。LLaMA-2/3-70B、Qwen3 等均采用。

3. Attention 输出经残差连接（⊕)，再过第二个 **Norm Layer**
4. 然后是 **Feed Forward**(Linear → Activation → Linear)，下方画出了 **MoE 变体**——多个 expert 子网络 + 路由

b. 这里左右两部分是完全不同的两部分图。左半部分是训练（上）与推理（下）两种不同的工作流图。右半部分是五种不同的并行方式。其中有些难理解的部分如下：

1. 这里训练与推理的结构似乎完全不同，Charon是如何进行统一的？

   这里Charon统一的层级是算子图级别的统一。

2. 在这里训练的工作流中，Error指的是什么？

   指模型预测值与真实值之间的误差，表示反向传播的输入，而右侧的gradient则是反向传播的输出

3. SP比较少见，它具体是怎样的并行方式？

   这里是针对除Megatron TP外的Transformer block中的操作

   - LayerNorm / RMSNorm
   - Dropout
   - residual add

   这里的三种操作，这些操作在TP中是每张卡上全量重复的，即`[seq_len, hiddern]`激活张量上做归一化，但在长序列场景下，激活显存等比与序列长度，存在大量显存以及计算上的重复。

   SP 的思路是**把序列切开，每张卡只存、只算 1/N 的 token**。序列长度 8192、TP=8 时，每张卡的 Norm 激活显存和计算量都降到 1/8。具体数据流如下：

   ```plain text
   输入(序列维已切分,每卡 [s/N, h])
     │
     ▼ LayerNorm      ← SP 域:每卡只算自己的 1/N 序列,无通信
     │
     ▼ All-Gather     ← 进入 TP 域前,把序列拼回完整 [s, h]
     │
     ▼ QKV proj / Attention / O proj(TP 切分)── 每张卡算 1/N 的权重分片
     │
     ▼ Reduce-Scatter ← 输出沿序列维重新切回 [s/N, h],回 SP 域
     │
     ▼ 残差 + LayerNorm  ← SP 域,无通信
     │
     ▼ All-Gather → MLP(TP)→ Reduce-Scatter
   ```

   这里比较不好理解的地方在于SP不会增加通信量。原 TP 里每层两次 all-reduce；改成 SP 后变成两次 "all-gather + reduce-scatter"。而一个 all-reduce 在数学上就等价于 reduce-scatter + all-gather（带宽项相同），所以 SP 是**零额外通信代价**地换来了激活显存 ÷N。

   这里Charon中说“at the cost of additional communication”实际上是说通信算子的形态发生了变化，而不是通信的信息总量发生了变化。

   另外，通常不将SP视作一种并行方式，而是TP中的一个开关。

   同名的还有另外一项技术，和megatron SP是不同机制：

   - **DeepSpeed-Ulysses**：切序列，但 attention 前用 **all-to-all** 把"序列切分"换成"注意力头切分"，每张卡拿到完整序列、只算 1/N 个头。这里与Ring不同的是蓝框中完全感知不到SP的存在，所以causal、sliding window、稀疏attention等kernel都能原样使用，不像Ring那样要改写kernel来处理分块合并与mask。

     ![https://arxiv.org/pdf/2309.14509v1](https://files.seeusercontent.com/2026/09/27/3tiI/image-20260927160937589.png)

   - **Ring Attention / Context Parallelism**：a子图中可见每个设备跑的是完整的 Transformer block，只是输入换成自己那段 query block，KV block 在设备之间从右往左传。FeedForward 也是分块的；FFN 逐 token 计算，这部分不需要任何通信。整层唯一的通信就是传 KV。b子图就是在说把 FlashAttention 的两层循环摊到了多张卡上。

     - **竖向的 Query Outer Loop**：每个设备负责外层循环的一次迭代，相当于外层循环在空间上展开。
     - **横向的 KV Inner Loop**：内层循环在时间上展开，每一步换一组 K/V。
     - **"compute, send to next" / "receive from previous" 这两个框**：就是双缓冲，算当前块的同时接收下一块。

     这张图画的是无 mask 的全注意力，每一步各设备的计算量相同。原论文没有处理 causal 下的负载不均，这个问题是后来 Striped Attention、zigzag 这类切分方式解决的。

     ![ring attention](https://files.seeusercontent.com/2026/09/27/gTs9/image-20260927161525254.png)

   - **Zigzag Attention**(LLaMA-3 用）：把序列按 zigzag 模式切 2N 份来均衡 causal mask 带来的计算不均。这里引用后面charon在case study中的案例。

     a图中这是 SP2、序列切 4 块的例子：Rank 0 拿 ①④，Rank 1 拿 ②③。每个 rank 画的三角形，是完整 4×4 因果矩阵里属于自己的那几行。

     有两个细节：

     1. **通信方式是 all-gather KV（图中的 AG），不是 ring**，和 LLaMA-3 的做法一致。
     2. **all-gather 会多传一部分数据**：Rank 1 的 KV 行里 ④ 是虚线（从别处收来的，但Rank 1 根本用不到 ④。all-gather 不区分谁需要什么，在 causal 下天然会多传。好在 GQA 下 KV 本来就小，这点浪费可以接受。

     b子图中展示了**Dynamic SP**的技术。

     图里有两个请求：Req1 长（蓝色），Req2 短（红色）。

     **不用动态 SP 时**，两个请求都用 SP4 zigzag。Req2 本来就短，还要切成 8 块，每块都很碎（图里的虚线小方块）。4 个 rank 的时间线完全一样：QKV Proj → AG1 → Attn1 → Attn2 → O Proj。AG2 藏在 Attn1 下面，也就是 Req1 算 attention 时顺带把 Req2 的 KV 收过来，这是跨请求的通信与计算重叠。

     **用动态 SP 时**，Req1 用 SP4，Req2 用 SP2 zigzag（编号 "0 1 1 0"，只放在 Rank 0 和 Rank 1 上）。

     ![Charon page12 fig12](https://files.seeusercontent.com/2026/09/27/4bOx/image-20260927161148233.png)

     | 名字                                     | 谁这么叫                        | 属于哪一族          |
     | ---------------------------------------- | ------------------------------- | ------------------- |
     | Sequence Parallelism（Korthikanti 2022） | Megatron                        | 切模型（TP 的附属） |
     | DeepSpeed-Ulysses                        | DeepSpeed 叫它 SP               | 切数据              |
     | Ring Attention / Context Parallelism     | Megatron 叫 CP，LLaMA-3 也叫 CP | 切数据              |

     |                | 非线性区     | 线性层               | attention 核心 | 区域切换时的通信             |
     | -------------- | ------------ | -------------------- | -------------- | ---------------------------- |
     | Megatron TP    | 复制（冗余） | hidden 维（切权重）  | 头             | all-reduce                   |
     | Megatron TP+SP | **序列**     | hidden 维（切权重）  | 头             | all-gather + reduce-scatter  |
     | Ulysses        | 序列         | **序列**（权重复制） | 头             | all-to-all                   |
     | Ring / CP      | 序列         | 序列（权重复制）     | **序列**       | KV 环传 P2P 或 all-gather KV |
	
        |                               | Megatron-SP                | CP                               |
        | ----------------------------- | -------------------------- | -------------------------------- |
        | 本质                          | 切模型                     | 切数据                           |
        | 序列切分覆盖                  | 只有 LN、Dropout、残差     | 整层                             |
        | 重计算部分每卡看到的 token 数 | 全部 S                     | S/CP                             |
        | 权重                          | 切成 t 份                  | 完整（显存要靠 ZeRO/FSDP 分）    |
        | 通信位置                      | 每个线性层前后             | 只在 attention                   |
        | 每卡通信量（每层）            | 约 4Sd，不随 t 下降        | Ring/AG 约 2S·d_kv；a2a 约 4Sd/P |
        | 并行度上限                    | 头数，实际多在节点内（≤8） | Ring/AG 无上限                   |
        | 能否单独开                    | 不能，必须和 TP 一起       | 可以                             |
        | 解决什么问题                  | TP 下激活的冗余            | 超长序列                         |

		> MLA（Multi-head Latent Attention，多头潜在注意力）是 DeepSeek-V2 提出、V3 和 R1 沿用的 attention 结构。它的目标是把 KV cache 压到接近 MQA 的大小，同时保持 MHA 的效果。
		>
		> MHA 要为每个 token、每个头各存一份 K 和 V。MLA 改成了三步：
		>
		> 1. **压缩**：先把 token 的 hidden 状态 h_t 压成一个低维向量，c_KV = W_DKV · h_t。DeepSeek-V3 里是从 7168 维压到 512 维。
		> 2. **缓存**：KV cache 里只存这个 c_KV。
		> 3. **解压**：用的时候再通过上投影恢复出每个头的 K 和 V，即 k_i = W_UK,i · c_KV，v_i = W_UV,i · c_KV。
		>
		> 所有头的 K 和 V 都从同一个 512 维向量解出来，相当于对 KV 做了一次低秩分解。query 也做了类似的低秩压缩（压到 1536 维） ，这里Q的压缩是训练中的省显存的方法。
		>
		> 由于这里在吸收之后MLA只剩一个所有头共享的KV“head”由此带来一些后沟，每个TP rank分到 128/t 个 query  head，这些head共享一份c_KV，因此每张卡都存一份完整的cache
		>
		> 在推理时一般用DP attention/DCP，技术分别是attenttion部分每张卡处理不同的请求，MoE部分走EP与把latent cache按照序列切分。
		>
		> 这个技术对PD分离的架构非常友好，P侧只需要发一份，D侧各rank共用一份cache。

c. Profiling 调优流程 + 成本爆炸图

这里的逻辑是对于不同GPU，不同parallelism组合，不同parallelism参数调优需要的GPU hours（Cost）与Search Space（Difficulty）的变化

- **折线（设计空间大小）的计算：逐层乘法展开**

这是组合计数，三个 X 轴阶段是**累乘**关系：

1. **GPU Types ≈ 10**：可选 GPU 型号约 10 种（H100/H800/A100/H20/L20 这类候选集）。
2. **× 并行策略组合数 → ~250**:5 种并行类型（TP/DP/PP/EP/SP）中混用 2~4 种，组合数约 C(5,2)+C(5,3)+C(5,4) ≈ 25 种；10 × 25 ≈ **250**——正好对上折线第二个点。
3. **× 每种类型的规模选择 → ~10³–10⁴**：按脚注假设"每种并行类型有 4 个规模选择"。混用约 3 种并行时，若 DP 规模由总卡数被动确定、只有 2 个自由度，则 4²=16,250 × 16 ≈ **4×10³**；若 3 种都自由，4³=64，则到 1.6×10⁴。折线终点落在 10³ 出头，说明作者按保守口径（部分规模被动推导）取的。

- **柱子（GPU 小时）的计算：设计点数 × 单点评估成本**

正文 §2.2 给了两个关键参数：

- **单点成本**:“Evaluating a single design point on a large-scale cluster needs repeated runs (cold launches and multiple warm-ups) and can consume **hundreds of GPU hours**”——即每个配置要在大集群上反复跑（冷启动 + 多轮预热），花掉数百 GPU 小时；
- **总量上界**:“The total exploration cost can **approach 10⁶ GPU hours**”。

柱子的值就是 **折线对应的设计点数 × 单点数百 GPU 小时**:

- 阶段一：10 点 × ~500 h ≈ **5×10³** ✓
- 阶段二：~250 点 × ~500–800 h ≈ **2×10⁵** ✓
- 阶段三：~10³–2×10³ 点 × ~300–500 h ≈ **5×10⁵–10⁶** ✓（对应正文 "approach 10⁶")

## Design

![fig3](https://files.seeusercontent.com/2026/09/27/x4yE/image-20260927162027263.png)

对模拟器而言，这里主要有两个部分的有效创新点：

1. **Profiling/Prediction/Analytical Engine**：三种引擎对应模拟器领域的不同方法，其中精度从上到下依次递减。在这里指的注意的是Prediction Engine这一部分，通常而言Prediction这个引擎是使用最多的引擎，一方面大模型所使用的算子种类很少，另一方面，其不会固定单一的shape。

   这里Charon直接采用每种算子一个随机森林预测器的方式做耗时预测，实际上这里Frontier做的更好，其对线性，非线性，shape分布，MoE路由负载特征等信息，补充了耗时预测。但根本上讲，要做到
   $$
   \text{算子类型} \times \text{硬件型号} \times {精度格式}
   $$
   这样笛卡尔积级别的复杂场景的预测还是困难的，本质上需要维护一个大型矩阵的profile的数据

2. **Op Overlap Processor 的双层模型**

   **粗粒度：Ratio 减速模型（适用于所有 overlap)**

   - 通信-计算 overlap：计算和通信各用一个**独立的减速因子**
   - 通信-通信 overlap：两个通信算子共享同一个减速因子
   - 因子来自目标集群的 profiling 标定，且**只作用于两个算子真正重叠的那部分时间**，非重叠部分不受影响

   **细粒度：带宽感知模型（通信-通信 overlap，配合解析引擎）**

   - 对重叠的每个时间片，逐层（NVLink → InfiniBand）检查链路拥塞，按**有效带宽竞争比**计算减速，模拟底层网络包级拥塞控制的效果

   - 图 6 给了具体例子：Op0 独占 NVLink 时能跑 200 GB/s;Op2 上来竞争后，NVLink 上两者按带宽需求分成 160/40,IB 上 Op1/Op2 从 50/50 被压到 25/25——拥塞感知后时间线明显拉长

     ![fig6](https://files.seeusercontent.com/2026/09/27/Wue0/image-20260927172957577.png)

   底层支撑是解析通信引擎把集合通信**分解到物理链路级传输**，因此能精确评估带宽共享和拓扑约束造成的拥塞（§3.3c)。这就是 Table 1 里 Charon 在 Overlapping Slowdown 一栏敢写 "Cluster-aware Modeling" 而 SimAI 只能写 "Ratio" 的原因。

3. **处理数据依赖的控制流问题。**

   模型用 `torch.fx.symbolic_trace` 或 `torch.compile` 转成 FX 图。训练时再加上 dummy loss 和 fake input tensor，走 AOT autograd 生成反向图。对 symmetric 架构只追踪并模拟**一个** Transformer block，再复制到所有层。也就是说，模拟的是一张固定形状的算子图，里面没有"按数据走不同分支"或"每个专家拿到多少 token"这类运行时信息。

   虽然这里在后面有展示MoE模型的实验，但是实际上这里并没有开启EP，没有热点专家的问题。

   > "dynamic routing introduces complex memory access patterns"
   >
   >  "calibrated collective communication buffer overheads and dynamic fragmentation effects"

   针对dynamic routing这里提到的解决方式是calibrated collective communication。

   **事实上，目前所有仿真模型都无法动态考虑有数据依赖的控制流问题，因为它们本质上都没有真实数据，最多做静态分布统计。**

![fig4](https://files.seeusercontent.com/2026/09/27/tiX5/image-20260927202424339.png)

这里fig4所阐述的是Charon的**前端（Graph-based Frontend）部分**，分上下两个部分 （a）把原生的PyTorch模型转成前向图与反向图；（b）在这些图上跑一系列编译器风格的pass。

 **(a) 从原生模型生成前向和反向计算图**

图中从左往右走：

1. **输入：原生 PyTorch 模型**
   - 来源可以是 HuggingFace、vLLM 或自定义 PyTorch 模型，不需要像 ASTRA-Sim 那样手写 workload，也不需要像 Vidur 那样在模拟器里重建模型。
   - 模型结构是 Embedding → Transformer × N → LM Head。对于对称架构，只取**一个 Transformer block** 来追踪，用来加速模拟。
   - 如果是非对称模型，或者需要 PP，就把不同的层分别追踪成独立的 FX 图，再按 rank 显式调度。prefill 和 decode 也可以分别追踪成独立的图，用来模拟 PD 分离部署。

> FX图指PyTorch 自带的 `torch.fx` 工具生成的计算图

2. **追踪前向图**：用 `torch.fx.symbolic_trace` 或 `torch.compile` 得到 **Raw Forward Graph**（算子级 DAG）。
3. **补齐训练所需的部分**：
   - 在前向图上加一个 **Dummy Input Tensor** 和一个 **Dummy Loss Function**，这样整张图有了可以求导的标量输出。
   - 然后交给 **Torch AOT Autograd**，自动求导生成 **Joint Graph（FWD + BWD）**。
4. **Graph Optimize + Refine**：清理联合图，包括补全 tensor 元数据、重命名输入和权重节点、删掉 view、detach 这类不改变 shape 或 dtype 的无用算子。
5. **Torch Partitioner**：用 `default_partition` 把联合图切成独立的 **Forward Graph** 和 **Backward Graph**。
6. **BWD Postprocess**：对反向图继续做清理，包括拆解 auto-functionalized 算子、去掉 self-clone、消除死代码。

> - **Torch AOT Autograd是什么意思？**
>
>   AOT 是 **Ahead-of-Time（提前）** 的缩写，意思是**在真正运行之前，就把反向计算提前生成出来**。
>
>   **普通 eager 模式下的 autograd：**
>
>   - 前向每执行一个算子，就在运行时动态记一个反向节点（`grad_fn`），串成一张反向计算的链。
>   - 调用 `loss.backward()` 时，才沿着这条链**一个算子一个算子地解释执行**反向。
>   - 所以反向图是**在运行过程中边跑边建**的，而且每次迭代都重新建一遍。你事先拿不到一张完整的反向图，也就没法对它做分析或优化。
>
>   **AOT Autograd：**
>
>   - 在**执行之前**，用 fake/meta tensor（只有 shape 和 dtype，没有真实数据）把前向走一遍，同时把 autograd 会产生的反向算子**也追踪出来**，写成一张静态的 FX 图，也就是上一问说的联合图。
>   - 拿到这张图以后，就可以在执行前做切分、重计算、融合等优化，再交给后端编译（`torch.compile` 里就是交给 Inductor）。
>   - 运行时直接执行编译好的前向和反向，不再需要逐算子解释执行。
>
> - **对算子融合这里FX图是怎么处理的？**
>
>   - 遍历 `graph.nodes`，按"算子类型 + 连接关系"找模式。比如 `mm → add(bias) → gelu`，或者 `q/k/v 的 mm → softmax → mm`。
>
>   - 匹配到之后，插入一个新节点，例如 `call_function[target=fused_linear_gelu]`。把原来最后一个节点的使用者改接到新节点上，再删掉被吞掉的中间节点。
>
>   - PyTorch 有现成的 `torch.fx.subgraph_rewriter.replace_pattern(gm, pattern_fn, replacement_fn)`，就是这套"写一个模式函数和一个替换函数"的接口。论文说"新规则只要定义 match pattern 和 transformation action 就能加"，和这个接口的风格一致。
>
> - **联合图指哪些内容?**
>
>   联合图（Joint Graph）是 **AOT Autograd 生成的一张 FX 图，里面同时包含前向计算和反向求梯度两部分**，用 aten 级算子表示。之后 Torch Partitioner 再把它切成独立的前向图和反向图。
>
>   **输入（placeholder），分两类：**
>
>   - **primals**：前向需要的原始输入，包括模型参数（权重、bias 等）和数据输入（Charon 用的 fake input tensor）。
>   - **tangents**：输出端传进来的梯度，也就是 ∂loss/∂output。Charon 加的 dummy loss 把输出变成一个标量，这个 tangent 就是 loss 对自身的梯度。
>
>   **计算节点，也分两部分：**
>
>   - **前向部分**：原始的 mm、add、softmax、norm 等 aten 算子。
>   - **反向部分**：autograd 按链式法则展开出来的梯度算子。例如 `y = x @ W` 对应的反向是 `grad_x = grad_y @ Wᵀ` 和 `grad_W = xᵀ @ grad_y`。它们也是普通的 aten 节点。
>
>   **连接前向和反向的边：**
>   反向算子需要用到前向的中间结果（x、softmax 输出、norm 的均值和方差等），这些中间结果在图里就是一条从前向节点指向反向节点的边。**这些边正是需要保存下来的激活（saved activations）。**
>
> - **为什么先生成联合图再切分?**
>
>   1. **能看到完整的依赖关系**：哪些前向中间结果被反向用到、用到什么时候，在同一张图里一目了然。
>
>   2. **切分就是决定哪些东西要保存**：Partitioner 沿着这些"前向→反向"的边把图切开。
>
>      - 前向图多出一些输出，就是要保存的激活。
>      - 反向图的输入变成：保存的激活 + tangents。
>
>      Charon 用的是 `default_partition`，它会**把反向需要的中间结果全部保存**，不做自动重计算。另一个选项 `min_cut_rematerialization_partition` 会用最小割自动选择一部分中间结果重算。Charon 选择前者，是因为重计算要由它自己的 Recompute pass 来显式模拟和控制。
>
>   3. **显存分析的基础**：保存的激活的大小和生命周期（从前向产生，到反向用完释放）决定了训练时的显存峰值。Charon 能在反向阶段按 liveness 精确算出峰值（§3.2 显存部分、Fig. 9），依据就是这些边。

**（b） 在图上跑三类 pass**

这些 pass 是 Charon 在 torch.fx 图上自己实现的图变换，思路类似编译器的 pass pipeline。但论文只到"每个 pass 做什么"这一层，没有公开代码，也没有给出实现细节。

| 类别                            | 例子                                                         | 作用                                                         |
| ------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| **Optimization Passes**（优化） | Operator Rewrite、Operator Fusion、Recompute / Reorder       | 用"模式匹配加替换"改写图，模拟融合、重计算、重排序、量化等优化 |
| **Parallelism Passes**（并行）  | Shard Pass（TP/EP/SP）、Pipeline Parallel Pass、Data Parallel Pass | 切分 tensor、修改算子 shape，并插入通信算子：TP/EP/SP 插 all_reduce、all_gather 等；PP 插 send/recv 并生成 1F1B 或 DualPipe 的调度依赖；DP 插梯度同步，另外支持 FSDP/ZeRO 的分片和预取 |
| **Analysis Passes**（分析）     | MFU Analysis、Memory Analysis、Timeline Analysis             | 不需要依赖关系的指标（如 FLOPs、MFU）直接遍历图算；需要依赖关系的指标（如时间线 trace）要调用后端拿到每个算子的耗时，再由调度器按依赖排出时间线 |

![fig5](https://files.seeusercontent.com/2026/09/27/R8ja/image-20260927211612736.png)

fig5描述的是Charon的后端部分，对应overview中的三种不同的Engine。这里比较复杂的是Communication Analysis与通信-通信，通信-计算算子之间的overlap。

- 对Communication Analysis而言这里与其他仿真不同的点在于，通信算子是分层以链路为中心的集群模拟器。

  - 输入是Comm Type + Size 与 Cluster Info，节点内走 NVLink，节点间走 IB。
  -  all-reduce、all-gather 这类高层集合通信**拆成物理链路上的数据传输**。每条链路的延迟 = 校准过的握手延迟 + 数据量 / 有效带宽。这里的延迟和带宽来自实测校准。
  - 支持 Ring 和 Tree 两种集合通信算法，以及 Ring、Switch、Mesh 等拓扑。
  - 输出有两个：**Comm Latency** 和 **Link Utilization**。链路利用率会被 §3.4 / Fig. 6 的带宽感知拥塞模型用到，用来计算多个通信同时进行时各自的减速。

- 对overlap而言，这里似乎没有表示出来，作为整个results的postprogress过程。

  具体在 §3.2(c) 和 §3.4，流程是这样的：

  1. **后端各引擎**（profiling、prediction、analytical）先给出每个算子**单独运行**时的耗时。
  2. **算子调度器**按依赖关系（包括 PP 的跨 stage 依赖）和 stream，排出每个算子的开始和结束时间。这时计算和通信、通信和通信之间会在时间上重叠。
  3. **Overlap Processor** 找出这些重叠区间，只对**重叠的那部分**施加减速，然后更新各算子的结束时间，得到最终时间线。
  4. Timeline Analysis pass 再从这条时间线上算出 block 延迟、端到端延迟、MFU 等指标。

- 这里的Cluster Simulator是怎么实现的？

  - **SimAI、ASTRA-Sim**：可以选择接入 ns-3 这类**包级网络模拟器**，更精细，但慢得多。论文 §4.1 批评 SimAI 的通信是按层（layer-level）建模的，所以处理不好重叠。
  - **Charon**：选择的是**解析公式加实测校准**。精度靠校准参数保证，速度快，适合设计空间探索时大量评估不同配置。拥塞只在链路层面用比例分配来近似，不模拟真实的包和拥塞控制协议。

![fig6](https://files.seeusercontent.com/2026/09/27/So2f/image-20260927212752258.png)

这里有几点需要注意：

1. **计算与通信的重叠。**

   这里非常复杂，需要考虑通信的“动态减速过程”造成的overlap的变化，还要考虑与不同算子之间overlap的减速因子设置（这里计算与通信之间所用因子是独立的），论文这里说固定系数表示重叠了就变慢，并且说这里是粗粒度的模型，可以认为这里的变慢是非递归的。

2. **通信与通信的重叠。**

   如图中例子所示，这里基本上是分层递归的，例如，在op0中虽然绿色部分属于nvlink，但这里被IB 25GB/s bond。

## Experiments

![fig7](https://files.seeusercontent.com/2026/09/27/t7Gm/image-20260927213727107.png)

端到端的横向对比。基本上都能领先于SOTA，在LLama3-8B上的TTFT上有些翻车。有以下需要注意的点。

硬件上这里的setup如下

| 组合                            | 并行维度     | 配置                       | GPU 数       |
| ------------------------------- | ------------ | -------------------------- | ------------ |
| Qwen3-8B / Llama3-8B + Megatron | TP×PP×DP     | 8×1×1、1×1×8、8×1×2、2×4×2 | 8、8、16、16 |
| Qwen3-8B / Llama3-8B + VeOmni   | TP×DP        | 8×1、1×8、8×2              | 8、8、16     |
| Qwen3-30B-A3B + VeOmni          | **EP×SP×DP** | 4×4×1、4×4×2               | 16、32       |

- **TP4 的 TTFT 存在系统性低估**：三个模型分别是 −9.0%、−10.2%、−8.3%。而且 Qwen3-8B 上 Vidur 的误差数字完全相同。一个合理的推测是：两者用了相似的 profiling 数据或 TP all-reduce 通信模型，在 prefill 阶段大消息量的 TP4 通信上都低估了开销。
- **对比条件**：论文说所有基线模拟器都"修了小 bug、加上了对 Qwen3/Llama3 的支持，并按 profiling 结果重新校准过"。所以基线表现在一定程度上取决于作者的移植质量。另外，全部实验最多只有 16 卡。

![table2](https://files.seeusercontent.com/2026/09/27/4dxP/image-20260927214846841.png)

![fig7-qwen3-8b-train](https://files.seeusercontent.com/2026/09/27/b6kQ/image-20260927215049113.png)

![fig7-qwen3-8b-infer](https://files.seeusercontent.com/2026/09/27/pKo2/image-20260927215119559.png)

| 算子                 | Prof(F) | Sim(F) | 误差      | Prof(B) | Sim(B) | 误差       |
| -------------------- | ------- | ------ | --------- | ------- | ------ | ---------- |
| Attention            | 1842    | 1770   | −3.9%     | 30275   | 30329  | +0.2%      |
| Feed-Forward         | 6589    | 6490   | −1.5%     | 40280   | 38430  | −4.6%      |
| Others               | 3842    | 3788   | −1.4%     | 8743    | 8658   | −1.0%      |
| All-Gather           | 13180   | 12980  | −1.5%     | 13130   | 12980  | −1.1%      |
| Reduce-Scatter       | 13876   | 12980  | **−6.5%** | 14500   | 12980  | **−10.5%** |
| **合计（简单相加）** | 39329   | 38008  | −3.4%     | 106928  | 103377 | −3.3%      |

| 算子         | Prof(P) | Sim(P) | 误差  | Prof(D) | Sim(D) | 误差       |
| ------------ | ------- | ------ | ----- | ------- | ------ | ---------- |
| Attention    | 3923    | 3906   | −0.4% | 58.206  | 72.1   | **+23.9%** |
| Feed-Forward | 9232    | 9195   | −0.4% | 93.47   | 109    | **+16.6%** |
| Others       | 141     | 142    | +0.7% | 6.84    | 12     | **+75.4%** |
| **合计**     | 13296   | 13243  | −0.4% | 158.5   | 193.1  | **+21.8%** |

claude针对这两个数据提出了几个重点疑问：

1. 反向和前向的比例很反常：Attention 的反向是前向的约 16 倍，FFN 约 6 倍，而通常反向约为前向的 2 倍。可能反向里包含了重计算、梯度同步前后的其他开销，或者统计口径不同，但论文没有说明。
2. TP8 按理应以 all-reduce 为主，这里出现的是 AG 和 RS，说明可能同时开了 SP，或者是 VeOmni 的 FSDP 通信。论文也没有说明。
3. **和 Fig. 7 对不上**：Fig. 7 中同样是 Qwen3-8B + vLLM + TP1，Charon 的 TPOT 误差只有 **+2.7%**，而这里 decode 的算子级合计误差是 +21.8%。可能的解释有：端到端统计时误差被其他部分抵消了；端到端时间里还有调度、采样等 Charon 另外建模的开销；或者两个实验的设置并不相同。论文没有说明。
4. **细节缺失**：表中没有说明数值是单层还是整个模型、是单步还是多步平均；训练表格是"简单相加"，没有扣除计算和通信的重叠部分，所以合计值并不等于实际的步时间。

这里decode阶段的算子被系统性高估，可能还是说明其在算子融合的分析上做的不够好。

![fig8](https://files.seeusercontent.com/2026/09/27/L1wi/image-20260927215659395.png)

这里是对是 **Qwen3-8B 中一个 Transformer 层**，从整个模型的模拟和实测中截取出来的展示。对比了profiled trace with vLLM的实际trace的捕获。

**(a) Charon 生成的 trace**

- 这是 Perfetto / Chrome Trace 风格的时间线。坐标轴刻度为 0、5 000 000、10 000 000，单位应该是 ns，也就是 0、5 ms、10 ms。
- 每个色块对应前端 FX 图中的一个节点，名字是节点名：`output_parallel...`、`fwd`、`output_p...`、`output_parallel_2`、`s`、`output_parallel_3`，中间还有几个很窄的小色块。

**(b) vLLM 实测的 trace**

- 色块是真实的 CUDA kernel 名字：
  - `nvjet_tst_*`：Hopper上cuBLAS的GEMM kernel，名字里带有tile形状，例如 `320x128_64x3`、`128x256_64x4`。
  - `void cut...`：以 cutlass 实现的 kernel，这里应该是 FlashAttention。
  - `v`：一个很窄的 `void ...` kernel。

claude的推断如下

| 顺序 | Charon 节点         | vLLM kernel             | 推断对应的算子                                               |
| ---- | ------------------- | ----------------------- | ------------------------------------------------------------ |
| 1    | `output_parall...`  | `nvjet_tst_12...`       | QKV 投影 GEMM（vLLM 的 `QKVParallelLinear`，其 forward 中的输出变量名就是 `output_parallel`） |
| 2    | 几个窄色块          | 几个窄色块              | Qwen3 的 QK-Norm、RoPE、KV cache 写入等小算子                |
| 3    | `fwd`               | `void cut...`           | FlashAttention 前向                                          |
| 4    | `output_p...`       | `nvjet_ts...`           | O 投影 GEMM                                                  |
| 5    | `output_parallel_2` | `nvjet_tst_320x128_...` | MLP 的 gate_up 合并 GEMM，整层中最宽的一块                   |
| 6    | `s`                 | `v`                     | SiLU-and-Mul 激活                                            |
| 7    | `output_parallel_3` | `nvjet_tst_128x256_...` | down 投影 GEMM                                               |

![fig9](https://files.seeusercontent.com/2026/09/27/w2Tt/image-20260927220128130.png)

fig9这里描述了一个MoE模型单卡执行的

| 分量                         | 实测  | Charon | 偏差                       |
| ---------------------------- | ----- | ------ | -------------------------- |
| allocated                    | 68.93 | 69.20  | **+0.27 GB**               |
| 碎片（reserved − allocated） | 7.03  | 6.98   | −0.05 GB                   |
| 额外开销（total − reserved） | 2.25  | 2.00   | **−0.25 GB（约低估 11%）** |

值得注意的是，由于这里实际上知识仿真，整个Charon执行过程中实际没有reserved，和total的内存大小，这里后两项都是和真实仿真所联系的校准项，而不是从仿真数据中直接得出的。

另外这里还有很多质疑点，例如这里只有一个配置，虽然是边缘配置，但很难理解这里的显存利用是否是最优情况。**静态部分可能占了大头**：Qwen3-30B 约有 30.5B 参数。假设使用常见的 BF16 参数、FP32 主权重加 Adam 两个状态（每个参数 12 字节）：

- 分到 8 卡后，每卡优化器状态约 45.8 GB；
- BF16 参数和梯度各约 7.6 GB；
- 合计约 61 GB。

如果梯度用 FP32，合计约 69 GB。按这个估算，68.93 GB 的 allocated 里，**参数、梯度、优化器这些可以用静态公式算出来的部分占了绝大多数**。Charon 宣称的核心优势（激活和临时 tensor 的生命周期建模）在这个实验里可能只影响几个 GB，被验证的程度有限。实际比例取决于混合精度和重计算的配置，论文没有给出。

> FSDP 是 **Fully Sharded Data Parallel（全分片数据并行）** 的缩写，是 PyTorch 官方的一种数据并行实现（论文引用了 [22]），思想和 DeepSpeed 的 **ZeRO-3** 相同。

![fig10](https://files.seeusercontent.com/2026/09/27/Mu7s/image-20260927221512952.png)

这里prediction engine的profile data中是没有对应shape的该算子的。

显然这里prediction还是要稳定的多。有关是否是融合算子的分析如下：

| 算子                    | 是否融合                 | 说明                                                         |
| ----------------------- | ------------------------ | ------------------------------------------------------------ |
| **Linear**（N=390）     | **不是**                 | 本质就是一个GEMM（cuBLAS）。即使带bias，也通常只是 GEMM 的 epilogue，不算多算子融合 |
| **RMSNorm**（N=80）     | **很可能是**，但论文没写 | PyTorch 原生写法是 pow、mean、rsqrt、mul、mul 这样一串小算子；vLLM 和常见训练框架都会用一个 fused RMSNorm kernel 替换它。论文没有说明测的是哪一种实现 |
| **FlashAttn-3**（N=80） | **是**                   | 典型的融合 kernel：把 QKᵀ、softmax、×V 融合在一起，用 online softmax 分块计算，中间的注意力矩阵不写回 HBM |

但这里并不是对融合算子的分析（prediction engine完全可以预先profile这几个算子），但是这里确实显示，Roofline这类Analytical方法确实对融合算子的误差极大，相较普通算子误差扩大5x以上。

![fig11](https://files.seeusercontent.com/2026/09/27/Ib6v/image-20260927222554562.png)

| 任务 | GPU 架构     | 具体型号（据正文） | 误差   |
| ---- | ------------ | ------------------ | ------ |
| 训练 | Hopper       | H800               | +0.71% |
| 训练 | Ampere       | A100               | −2.82% |
| 推理 | Hopper       | H20                | −4.98% |
| 推理 | Ada Lovelace | L20                | −0.37% |

| 规模 | 推断的卡数（H800） | 误差       |
| ---- | ------------------ | ---------- |
| 1×   | 64                 | +0.71%     |
| 1.5× | 96                 | +2.06%     |
| 75×  | 4800               | **−5.35%** |
| 180× | 11520              | −3.74%     |

正文说大规模训练用到了"近万卡"，并且组合了 DP、PP、EP、SP、TP 五种并行，和 11520 卡对得上。**摘要里的两个核心数字就出自这张图**：最大误差 5.35% 来自 4800 卡，大规模训练误差低于 3.74% 来自 11520 卡。

我相信这里与前面小规模的程序一定是有些差别的，当扩大到万卡的场景下时，不仅网络拓扑发生了巨大的变化，并行与优化也有显著差异，理论上这些数据应该不会公开，只能说目前的仿真可以达到这样的效果。

1. **大规模时一致低估，符合确定性模拟器的特点**
   小规模时误差为正（+0.71%、+2.06%），大规模时变成负数（−5.35%、−3.74%）。论文把误差归因于网络抖动、动态拥塞、数据相关的 kernel 随机性，Charon 不建模这些因素。这些因素**只会让实际运行变慢，不会变快**；而且规模越大，同步点上等待最慢 rank 的效应越明显。

## Case Study

![fig12](https://files.seeusercontent.com/2026/09/27/9aRo/image-20260927223426554.png)

这里展示了一种动态SP分片的机制，旨在zigzag attention的负载均衡中加入动态SP分片优化，从而缩短Prefill阶段的attention延迟。

Charon 同时建模 kernel 执行和 NCCL 通信，可以**预测每个 rank 在不同 SP 方案下的延迟**，然后为 batch 中的每个请求生成最优的 SP 方案，目标是最小化 prefill 的 attention 延迟。

- **Results**

  **LLaMA-3 70B，8 张 Ada Lovelace 推理卡（应该是 L20）**：相比 zigzag baseline，**attention block 延迟平均降低 15%**。

![fig13](https://files.seeusercontent.com/2026/09/27/huO9/image-20260927223355993.png)

通过Charon找推理服务中的帕累托前沿配置。

- **横轴 TPS/User**：每个用户每秒得到的 token 数，约等于 1/TPOT，代表**用户体验**。越靠右，单个用户的生成速度越快。
- **纵轴 TPS/GPU**：每张 GPU 每秒产出的 token 数，代表**系统效率和成本**。越靠上，每个 token 的成本越低。

| 前沿位置 | 标注的配置   | TPS/User | TPS/GPU |
| -------- | ------------ | -------- | ------- |
| 最左上角 | 未标注       | ~15      | ~715    |
|          | BS48 TP4 PP1 | ~18.5    | ~670    |
|          | BS64 TP8 PP1 | ~24      | ~575    |
|          | BS48 TP8 PP1 | ~28      | ~510    |
|          | BS32 TP8 PP1 | ~34.5    | ~415    |
|          | BS24 TP8 PP1 | ~38.5    | ~345    |
|          | BS16 TP8 PP1 | ~43.5    | ~262    |
| 右下角   | BS6 TP8 PP4  | ~56      | ~40     |

1. **两个目标此消彼长**：batch size 越大，GPU 利用率越高、吞吐越高，但每个用户分到的算力越少、速度越慢。论文说放宽用户速度约束后，**TPS/GPU 最多能提升约 7 倍**（从右下约 100 提升到左上约 700）。
2. **中段主要由 TP8 PP1 占据，batch size 是主要调节手段**：从 BS64 降到 BS16，整体沿前沿滑向右下。
3. **两端的配置类型会切换**：
   - **最高吞吐的一端用 TP4**：不在乎延迟时，TP 度更小、all-reduce 开销更少，每张卡的效率更高。
   - **最低延迟的一端出现 PP4**：这一点有些反直觉。decode 时一个 token 要依次经过所有 PP stage，PP 一般不会降低单 token 延迟。这里的差异很小（右下角的点都挤在 54 到 57 之间），可能是 Charon 的建模细节导致的，论文没有解释。
4. **配置选择的影响很大**：在同样的 TPS/User（比如 20）下，蓝点的 TPS/GPU 从约 15 到约 670 都有，相差几十倍。选错配置的代价非常高，这也正是这个案例想强调的。

- **正文补充的信息**

  - **速度**：一次完整的设计空间探索**不到两分钟**，靠的是预先 profiling 好的 kernel 延迟和多进程并行模拟。相比之下，实测调优一个配置就要数百 GPU 小时（§2.2）。

  - **易用性**：Charon 已经集成进字节内部的推理框架和 HuggingFace Transformers，可以自动解析模型结构、抽取 FX 图和对应的 kernel 实现，作者称使用成本"几乎为零"。

  - **生产案例**：一个输出长度固定的服务，端到端延迟 SLO 为 100 ms。Charon 找到的配置"大幅超过"人工调优的 baseline，这也是摘要中"improved system throughput over an engineering-tuned baseline"的出处。

                                                          |
