---
title: "ICCV2025-Learning to Inference Adaptively for Multimodal Large Language Models"
pubDatetime: 2026-03-31T12:41:37Z
description: "由威斯康星大学麦迪逊分校（University of Wisconsin-Madison）、普渡大学（Purdue University）、香港大学（The …"
slug: "2026-03-28-iccv25-adallava"
draft: false
tags:
  - "论文阅读"
  - "大模型推理"
  - "LLM"
  - "机器学习"
  - "人工智能"
author: "Deepcity"
timezone: "Asia/Shanghai"
---

# Learning to Inference Adaptively for Multimodal Large Language Models

由威斯康星大学麦迪逊分校（University of Wisconsin-Madison）、普渡大学（Purdue University）、香港大学（The University of Hong Kong）发表于ICCV2025的一篇文章，解决多模态大模型推理时计算量固定，无法响应运行时资源约束的变化的核心问题。

给定输入图像、文本查询和时延预算，AdaLLaVA 学习在推理时动态重新配置 MLLM 内部的操作，使模型能够在单一权重下适应不同的精度-延迟权衡。

> [!note]
>
> 这篇论文的阅读范式与之前的论文阅读发生了结构性的改变，重点参照了Claude提出的建议。
>
> 包括但不限于
>
> 1. 通过10mins - 15 mins的时间产生一个Fast overview stage，搞清楚「这篇论文在说什么、为什么重要」
>
>    阅读顺序为
>
>    1. Title & Abstraction：对研究对象，核心方法，主要结论有基本印象
>    2. Introduction：理解研究背景，定位问题，找到作者提出的核心矛盾/gap
>    3. Conclusion: 直接看作者总结的Contribution，与Abstraction交叉验证
>    4. Figures & Tables：论文的视觉中心，通过不看文字理解的方式找到自己的不足
>
>    在这个stage的目标中，应该需要搞清楚，论文解决了什么问题，创新点是什么，结果如何
>
> 2. 理解方法
>
>    这是比较重要的一部分，花30-60mins目标是搞清楚「它是怎么做到的」。
>
>    阅读顺序为：
>
>    1. Related work：理解作者如何定义前人工作的不足之处，这一点决定了创新的边界
>    2. Method/Approach：精读
>       1. 核心假设（作者对问题做了什么简化或前提设定）
>       2. 关键设计决策（为什么这样做而不是那样做）
>       3. 公式/模型的直觉含义，不只是数学本身
>    3. 实验设计（Experiments）：
>       1. Baseline 选的是谁，为什么？
>       2. 消融实验（Ablation Study）说明了什么？
>       3. 哪些指标被刻意选择/回避？
>
>    这里的核心是要求能够一句话概括该方法的核心insight，它在哪些环节与前人不同
>
> 3. 批判性审视
>
>    15-30mins 去做自己的判断
>
>    1. 这个方法的适用边界是什么？在哪些情况下会失效？
>    2. 实验有没有刻意回避某些对比？
>    3. 这个 insight 能否迁移到其他领域？
>    4. 作者的思考范式（paradigm）是什么——是 reformulation、借鉴跨领域、数据驱动还是理论推导？
>
> 4. blog架构，参照这篇论文blog

## Infomation Card

| 项目       | 内容                                                         |
| ---------- | ------------------------------------------------------------ |
| 论文标题   | Learning to Inference Adaptively for Multimodal Large Language Models |
| 发表于     | ICCV2025                                                     |
| 核心一句话 | 通过一个概率分布采样的调度器在端到端联合训练中解决了“给定时间内的最好回答问题” |
| 适用场景   | 边缘计算推理，世界AI，具身智能                               |
| 代码/项目  | [ICCV 2025 Open Access Repository](https://openaccess.thecvf.com/content/ICCV2025/html/Xu_Learning_to_Inference_Adaptively_for_Multimodal_Large_Language_Models_ICCV_2025_paper.html)  [AdaLLaVA](https://zhuoyan-xu.github.io/ada-llava/) |

## Background & Motivation

为了设计高效的MLLM，学界提出了包含token selection techniques，mixture of experts, lightweight architecture在内的的多种技术，但这些技术通常都只能在固定的浮点计算数下运行大模型推理而与现实中的实际部署需求不适配。

> 来自移动应用程序（mobile application）的请求需要向用户提供即时反馈，而诸如视频摘要（video summarization）之类的异步处理任务由于其非交互式特性，可以容忍更高的延迟。此外，随着系统整体负载的波动，可用的计算资源可能会随时间而变化。
>
> 当部署在边缘设备（edge device）上时，延迟预算（latency budget）往往保持不变，但由于其他并发程序的资源竞争，计算资源可能会发生变化。

## Innovation

我认为这篇论文的创新方法论是在参数在约束下的训练，这样的训练迫使同一个模型在资源受限或在限定时间内依然表现出较好的性能。

提出了大模型应有一个参数latency用于设定模型应该使用的资源数量，并且提出了一个预训练时的优化框架用于得出一个概率建模的调度器，这个调度器分为两种运行逻辑，分别控制，layer运算的开关、head运算的开关。概率建模的意义在于，他不是离散而是可导的，这使得调度器本身可以与模型一同训练。

针对同一个input，调度器将始终给出同一种调度方案，且不在Transformer decode迭代步骤中改变，事实上这种方法减少了开销。

![Figure 4](https://files.seeusercontent.com/2026/03/31/6hOh/20260331194309.png)

例如对于这里的图4，在推理过程中，模型实际上表现出对特定位置的注意力机制。

## Method

### Pretrain stage

在训练中，调度器实际上通过一个概率公式确保每个任务都只在特定资源FLOPs下完成。并且，此时的调度器是针对每一个调度对象生成一个概率分布并从中取样，对于相同的输入实际上调度器可能给出完全不同的调度方案，这取决于两个因素

- 根据损失函数变化的概率分布
- 取样时的随机性

并且实际上整个训练的数据流是这样：

![Data flow](https://files.seeusercontent.com/2026/03/31/8Mah/20260331201310.png)

实际上针对这部分的分析很轻易的能发现，这里的latency实际上是由0.5的下限。

### Interfere Stage

这个过程主要是调度器在推理时如何控制各层各block的开关问题。

![AdaLLaVA-bypass](https://files.seeusercontent.com/2026/03/31/2ztZ/20260331201526.png)

开关 $s_i = 0 $ 时，对应的 Transformer block 不做任何运算，token 的表示直接通过残差连接"穿过"该层，等价于一个恒等映射 $x \mapsto x $。这不需要额外引入任何分支结构，因为标准 Transformer 本来就有残差连接，关掉整层只是让残差路径独走。

![AdaLLaVA-H：激活值归零（attention head + MLP neuron）](https://files.seeusercontent.com/2026/03/31/6Ycm/20260331201610.png)

粒度更细。开关 $s_j = 0 $ 时，对应 attention head 的输出被直接置零，不贡献到多头注意力的拼接结果里；对于 MLP，论文将通道分组（每组对应一个 attention head 数量的 channel），关掉某组等价于 dropout 的效果——激活值归零，对应权重列的计算也被跳过。

### 反向传播

这里只有一个 loss——next-token prediction loss，施加在后半段 LLM 的输出上。但反传时梯度通过两条独立的路径向前传播。

**梯度的两条反传路径**

只有一个 loss——next-token prediction loss，施加在后半段 LLM 的输出上。但反传时梯度通过两条独立的路径向前传播：

**路径 A：标准的序列路径**
$$
\text{Loss} \xrightarrow{\partial} \theta_2\text{（后半段）} \xrightarrow{\partial} \theta_1\text{（前半段）} \xrightarrow{\partial} \phi_\text{encoder}
$$
这条路径和普通 LLM 微调完全一样。前半段的 visual/text token 表示会被更新，使得整体的语言建模更好。

**路径 B：经过调度器的路径**
$$
\text{Loss} \xrightarrow{\partial} \theta_2\text{（被 s 选择性执行）} \xrightarrow{\text{Gumbel-Softmax}} \phi\text{（调度器）} \xrightarrow{\partial} z^s\text{（latency token）} \xrightarrow{\partial} \theta_1\text{（前半段）}
$$
这条路径的信号含义是："前半段处理完 latency token 之后送入调度器的那个向量，应该朝着能产生更好执行计划的方向变化。"

这里的问题是两条路径都在更新 $\theta_1 $（前半段参数），但它们对前半段的要求是不同的：

路径 A 要求前半段学好视觉语言表示，让后半段能更准确地预测 token。路径 B 要求前半段让 latency token $z^s $ 携带足够的"内容复杂度"信息，使调度器能做出合理的资源分配决策。

实际上我认为这是整篇论文最为割裂的地方，**调度器因为种种原因居然只能作用于一半的transformer**。

> [!note]
>
> **最核心的原因：因果依赖**
>
> 调度器的工作流程是：
> $$
> \underbrace{\text{前半段 LLM 处理}}_{\text{输入}} \rightarrow \underbrace{\text{调度器}}_{\text{决策}} \rightarrow \underbrace{\text{后半段执行计划}}_{\text{输出}}
> $$
> 调度器要产生执行计划，它的输入必须是一个已经充分处理过视觉语言信息的 latency token 表示。这个表示只有经过若干 Transformer blocks 的注意力计算之后才存在。
>
> 如果试图把开关也加到前半段，就会出现一个严格的循环依赖：
>
> - 调度器需要前半段的输出才能决定哪些层要跳过
> - 但前半段哪些层被跳过，取决于调度器的输出
>
> 这不是一个可以被 Gumbel-Softmax 或任何训练技巧解决的问题——它是一个**时序上的先有鸡还是先有蛋的矛盾**，在单次前向传播中无法解开。
>
> ------
>
> **第二个原因：特征质量的保证**
>
> 调度器本质上是在做一个高层次的语义判断："对于这个图像和问题，哪些计算模块是必要的？"这个判断需要输入足够丰富的多模态表示。
>
> 如果前半段也受开关控制，那么送入调度器的 latency token 质量就会随机变化——某些 token 是经过完整 8 层处理的，某些只经过了 3 层，调度器看到的是一个质量不稳定的输入，决策可靠性会大幅下降。
>
> 前半段完整执行，恰好给调度器提供了一个质量有保证的、充分融合了视觉和语言信息的条件向量。
>
> ------
>
> **第三个原因：预算下界与训练设计的自洽**
>
> 论文将预算从 $U(0.5, 1.0) $ 采样，最低 50%。这个下界不是随意选的，而是由架构决定的：
>
> - 前半段必须完整执行（约 50% FLOPs）
> - 后半段在 0%~100% 之间可调
>
> 如果前半段也可调度，预算理论上可以压到 50% 以下，但那样调度器就无法获得足够质量的特征来做决策，形成一个性能的硬悬崖。把下界固定在 50% 是一个让系统设计自洽的工程选择。

一个可能的扩展方向是引入**多级调度**——用一个极轻量的前置调度器先对前半段做粗粒度决策，再由主调度器对后半段做细粒度决策，但这会进一步复杂化训练目标和梯度流。

## Experiment

![Figure 5](https://files.seeusercontent.com/2026/03/31/Q3aw/20260331202505.png)

这个部分时对图四的补充说明，旨在说明针对不同图片输入，相同Prompt，Scheduler也会给出不同的调度计划。

![Figure 3](https://files.seeusercontent.com/2026/03/31/7sqY/20260331202609.png)

这个部分旨在说明与其他不同方法的正交性，指出在减少资源得到近似结论这条路上，该方法是另一个“无偏估计量”。

![overview](https://files.seeusercontent.com/2026/03/31/0suQ/20260331202903.png)

基本上最终效果的Overview。

## Review

这篇文章的质量一定程度上体现在

1. 调度器与大模型通过同一损失函数训练的数学结构，保证了大模型能在一定资源范围内完成任务。
2. 该方法与部分方案的正交叠加效果

不足之处在于

1. 引入该方案即使在latency为1时，也有可能无法达到原本模型的效果，即与该调度器一同训练可能会损失模型精度。
2. 缺乏对极限场景的泛化能力
3. 论文展示了调度器能对不同内容产生不同执行计划（Figure 4、5），但这种 content-awareness 的机制是否真的可靠？Figure 4 中的注意力可视化显示 latency token 会关注图像中与问题相关的区域，但这只是相关性，不是因果性——调度器可能只是学到了训练集中某类图像通常配合某种执行计划就够用，而不是真正理解了"这个问题需要更多的计算"。

整体上是篇及时的论文，提出的解决方案新颖。

## OpenSource individual experiment

![QuickStart](https://files.seeusercontent.com/2026/03/31/pT5s/20260331155814.png)

```py
# QuickStart 
CUDA_VISIBLE_DEVICES=0 .venv/bin/python -c "
from src.adallava.eval.run_ada_llava import eval_model

model_path = 'models/ada-llava-L-v1.5-7b'
prompt = 'What are the things I should be cautious about when I visit here?'
image_file = 'https://llava-vl.github.io/static/images/view.jpg'

args = type('Args', (), {
    'model_path': model_path,
    'model_name': 'ada_llava_llama',
    'query': prompt,
    'conv_mode': None,
    'image_file': image_file,
    'sep': ',',
    'temperature': 0,
    'top_p': None,
    'num_beams': 1,
    'max_new_tokens': 512,
    'latency': 0.9, # 最重要的参数
    'hardware': 'nvidia_A100_80G',
})()

eval_model(args)
"
```



这里的QuickStart在单卡A100上进行单次推理

- prompt: What are the things I should be cautious about when I visit here?

- Image: 

  ![view.jpg (1000×667)](https://llava-vl.github.io/static/images/view.jpg)

这里模型输出的翻译是：

> 参观这处拥有俯瞰广阔水域的码头时，有几点需要注意。首先，请注意天气状况，因为图片显示天空阴云密布。天气突变，例如下雨或刮大风，可能会降低码头的安全性，甚至导致其坍塌。其次，请注意水深和水流情况，因为码头可能延伸到较深的水域。这可能会给游泳经验不足或游泳能力较弱的人带来风险。最后，请注意该区域是否有野生动物，因为图片显示附近有一只鸟。这可能意味着附近还有其他动物，它们可能会对人类构成威胁或受到干扰。在码头上欣赏美景的同时，尊重环境和野生动物至关重要。

后面跟着六项指标，

![Output_QS](C:/Users/deepc/AppData/Roaming/Typora/typora-user-images/image-20260331160337039.png)

  关键设计点：latency 参数（0~1）控制 AdaLLaVA 在各层保留多少比例的注意力头。设为 1.0 时等同于标准 LLaVA（全头），设为 0.85 之类的值时模型会根据输入动态跳过部分头，FLOPs和延迟会相应下降，这正是论文"自适应推理"的核心机制。

这里是latency为1时的值，下面可以看一下不同值时模型的输出，依然由claude sonnet编写一个脚本，他会做一些数据分析。

### Basic latency experiment

```py
# latency_sweep.py
"""
Latency sweep: run AdaLLaVA quick start at latency = 1.0, 0.9, ..., 0.1
Stop on first inference failure and report all results.
"""
import sys
import json
import torch
import warnings
warnings.filterwarnings("ignore")

from llava.constants import (
    IMAGE_TOKEN_INDEX, DEFAULT_IMAGE_TOKEN,
    DEFAULT_IM_START_TOKEN, DEFAULT_IM_END_TOKEN,
)
from llava.conversation import conv_templates
from llava.utils import disable_torch_init
from llava.mm_utils import process_images, tokenizer_image_token
from src.adallava.model.builder import load_pretrained_model
from src.adallava.eval.ada_analyzer import AdaptiveAnalyzer, str_number
from PIL import Image
import requests
from io import BytesIO

MODEL_PATH  = "models/ada-llava-L-v1.5-7b"
HARDWARE    = "nvidia_A100_80G"
IMAGE_URL   = "https://llava-vl.github.io/static/images/view.jpg"
QUERY       = "What are the things I should be cautious about when I visit here?"
LATENCIES   = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1]

# ---------- load model once ----------
print("=== Loading model... ===", flush=True)
disable_torch_init()
tokenizer, model, image_processor, context_len = load_pretrained_model(MODEL_PATH)
analyzer = AdaptiveAnalyzer(MODEL_PATH, HARDWARE, "configs/Llama.py")

# ---------- prepare image & prompt ----------
resp = requests.get(IMAGE_URL)
image = Image.open(BytesIO(resp.content)).convert("RGB")
images_tensor = process_images([image], image_processor, model.config).to(model.device, dtype=torch.float16)
image_sizes   = [image.size]

qs = DEFAULT_IMAGE_TOKEN + "\n" + QUERY
conv = conv_templates["llava_v1"].copy()
conv.append_message(conv.roles[0], qs)
conv.append_message(conv.roles[1], None)
prompt = conv.get_prompt()
input_ids = (
    tokenizer_image_token(prompt, tokenizer, IMAGE_TOKEN_INDEX, return_tensors="pt")
    .unsqueeze(0).cuda()
)

# ---------- sweep ----------
results = []
SEPARATOR = "=" * 60

for lat in LATENCIES:
    print(f"\n{SEPARATOR}", flush=True)
    print(f"LATENCY = {lat}", flush=True)
    print(SEPARATOR, flush=True)
    try:
        with torch.inference_mode():
            outputs = model.generate(
                input_ids,
                images=images_tensor,
                image_sizes=image_sizes,
                latency=lat,
                return_dict_in_generate=True,
                do_sample=False,
                temperature=0,
                num_beams=1,
                max_new_tokens=512,
                use_cache=True,
            )

        answer = tokenizer.batch_decode(outputs.sequences, skip_special_tokens=True)[0].strip()
        print(f"[Answer]\n{answer}", flush=True)

        prompt_len  = outputs.prompt_len
        gen_len     = outputs.gen_len
        num_heads   = outputs.execution_plan

        metrics = analyzer.analyze_generate_task(
            prompt_len=prompt_len,
            gen_len=gen_len,
            num_heads=num_heads,
            batchsize=1,
            w_bit=16, a_bit=16, kv_bit=16,
            use_flashattention=False,
        )
        metrics_str = {k: str_number(v) for k, v in metrics.items()}
        print(f"[Metrics] {json.dumps(metrics_str, indent=2)}", flush=True)

        results.append({
            "latency": lat,
            "status": "ok",
            "answer": answer,
            "metrics": metrics,
        })

    except Exception as e:
        print(f"[ERROR] {type(e).__name__}: {e}", flush=True)
        results.append({"latency": lat, "status": "error", "error": str(e)})
        print(">>> Inference failed, stopping sweep.", flush=True)
        break

# ---------- summary ----------
print(f"\n{'=' * 60}", flush=True)
print("SUMMARY TABLE", flush=True)
print(f"{'=' * 60}", flush=True)
header = f"{'latency':>8} | {'status':>6} | {'flops':>8} | {'avg_flops':>10} | {'prefill_time':>12} | {'prefill_mem':>12} | answer_words"
print(header, flush=True)
print("-" * len(header), flush=True)
for r in results:
    lat = r["latency"]
    if r["status"] == "ok":
        m = r["metrics"]
        flops        = str_number(m.get("flops", 0))
        avg_flops    = str_number(m.get("avg_flops", 0))
        ptime        = str_number(m.get("prefill_time", 0))
        pmem         = str_number(m.get("prefill_memory_consumption", 0))
        wc           = len(r["answer"].split())
        print(f"{lat:>8} | {'ok':>6} | {flops:>8} | {avg_flops:>10} | {ptime:>12} | {pmem:>12} | {wc} words", flush=True)
    else:
        print(f"{lat:>8} | {'ERROR':>6} | {'':>8} | {'':>10} | {'':>12} | {'':>12} | {r['error'][:60]}", flush=True)
```

![latency_output](https://files.seeusercontent.com/2026/03/31/B9oh/20260331161521.png)

> [!note]
>
> 关键发现
>
>   1. 存在计算量下限（Floor），≤0.5 完全饱和
>
>   从 latency=0.5 开始，所有指标（FLOPs、显存、输出文本）完全相同，继续降低 latency 不再有任何效果。这说明模型在每层至少会保留一定数量的注意力头，存在硬性下限，当 latency 低于某阈值后约束不再起作用。
>
>   2. 有效计算节省范围：latency 0.6~1.0
>
>   ┌───────────┬──────────────┬──────────┐
>   │   区间    │  FLOPs节省   │   质量   │
>   ├───────────┼──────────────┼──────────┤
>   │ 1.0 → 0.8 │ -22%         │ 无损     │
>   ├───────────┼──────────────┼──────────┤
>   │ 1.0 → 0.6 │ -43%         │ 基本无损 │
>   ├───────────┼──────────────┼──────────┤
>   │ 1.0 → 0.5 │ -49%（上限） │ 开始退化 │
>   └───────────┴──────────────┴──────────┘
>
>   3. 质量拐点在 latency=0.5
>
>   0.6 的回答仍然连贯；0.5 出现 "swimming swimming swimming" 这类重复退化，是典型的注意力机制不足导致的 decoding collapse。
>
>   4. prefill显存与FLOPs线性相关
>
>   prefill 显存从 13.4G（lat=1.0）降至 6.8G（lat=0.5），降幅约 49%，与 FLOPs 降幅一致，说明计算量主导显存占用。
>
>   5. avg_flops/token 非单调
>
>   avg_flops 在 0.9（61G）时略高于 1.0（60.9G），在 0.7/0.6 稳定在 40G 附近。这是因为 avg_flops 由 total_flops / gen_len 决定，不同 latency 下生成长度略有差异，会产生波动。
>
> ---
>   实用结论：该模型的"甜点区"是 latency=0.7~0.8——FLOPs节省20%~30%，回答质量与全量推理无明显差别。latency < 0.5 无意义（饱和），latency=0.5 是质量劣化的临界点。

![latency_sweep](https://files.seeusercontent.com/2026/03/31/1pnS/20260331162236.png)



这篇论文和我们前面分析的一样，latency存在0.5的下限，这意味着对一个模型而言，其有一个“最快反应时间”。

### Advanced latency experiment

可以对这个值进行一下简单的实验，我们实验的指标包括：

- 单个request的首次请求时延
- 对同一图片的连续不同文本请求间隔时延
- 对不同图片不同文本的请求间隔时延

```py
# latency benchmark
"""
AdaLLaVA Latency Benchmark  (latency=0.5)
==========================================
Measures three types of inference latency:
  1. Single cold-start request (image encoding + prefill + decode)
  2. Same-image, different-text inter-request latency
  3. Different-image, different-text inter-request latency

Uses torch.cuda.Event for GPU-side timing (avoids CPU-GPU sync overhead).
Runs N_WARMUP warmup iterations before each measurement block.
"""

import sys, time, statistics, warnings
warnings.filterwarnings("ignore")

import torch
from PIL import Image
import requests
from io import BytesIO

from llava.constants import IMAGE_TOKEN_INDEX, DEFAULT_IMAGE_TOKEN
from llava.conversation import conv_templates
from llava.utils import disable_torch_init
from llava.mm_utils import process_images, tokenizer_image_token
from src.adallava.model.builder import load_pretrained_model

# ── config ──────────────────────────────────────────────────────────────────
MODEL_PATH  = "models/ada-llava-L-v1.5-7b"
LATENCY     = 0.5
N_WARMUP    = 2       # warmup runs before each block
N_MEASURE   = 8       # measured runs per block
MAX_NEW_TOK = 128     # cap decode length for repeatable timing
CONV_MODE   = "llava_v1"

# different prompts for same-image test
SAME_IMG_PROMPTS = [
    "What are the things I should be cautious about when I visit here?",
    "Describe the weather conditions visible in this image.",
    "What time of day does this photo appear to be taken?",
    "How many people are visible in this image?",
    "What is the main subject of this photograph?",
    "Describe the colors you see in this image.",
    "Is this location suitable for a family picnic? Why or why not?",
    "What type of infrastructure is visible here?",
    "What season does this image appear to depict?",
    "Estimate the distance to the horizon in this image.",
]

# different images (small public domain images)
DIFF_IMG_URLS = [
    "https://llava-vl.github.io/static/images/view.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Cat03.jpg/320px-Cat03.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/Dog_Breeds.jpg/320px-Dog_Breeds.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/b/b9/Above_Gotham.jpg/320px-Above_Gotham.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Good_Food_Display_-_NCI_Visuals_Online.jpg/320px-Good_Food_Display_-_NCI_Visuals_Online.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a7/Camponotus_flavomarginatus_ant.jpg/320px-Camponotus_flavomarginatus_ant.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/2/26/YellowLabradorLooking_new.jpg/320px-YellowLabradorLooking_new.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Cute_dog.jpg/320px-Cute_dog.jpg",
    "https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/Gatto_europeo4.jpg/320px-Gatto_europeo4.jpg",
]
DIFF_IMG_PROMPTS = [
    "Describe what you see in this image.",
    "What is the main subject of this photo?",
    "What colors dominate this image?",
    "Is this indoors or outdoors?",
    "What emotion does this image convey?",
    "Estimate the age of the subject in this image.",
    "What is unusual about this image?",
    "What activity is depicted here?",
    "How would you caption this photo?",
    "What time of day is suggested by this image?",
]

# ── helpers ──────────────────────────────────────────────────────────────────
def load_img(url_or_path):
    if url_or_path.startswith("http"):
        resp = requests.get(url_or_path, timeout=15)
        return Image.open(BytesIO(resp.content)).convert("RGB")
    return Image.open(url_or_path).convert("RGB")

def make_input_ids(prompt_text, tokenizer):
    qs = DEFAULT_IMAGE_TOKEN + "\n" + prompt_text
    conv = conv_templates[CONV_MODE].copy()
    conv.append_message(conv.roles[0], qs)
    conv.append_message(conv.roles[1], None)
    prompt = conv.get_prompt()
    return (
        tokenizer_image_token(prompt, tokenizer, IMAGE_TOKEN_INDEX, return_tensors="pt")
        .unsqueeze(0).cuda()
    )

def cuda_time_ms(fn):
    """Run fn(), return wall-clock ms (GPU synced)."""
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    fn()
    torch.cuda.synchronize()
    return (time.perf_counter() - t0) * 1000.0

def run_generate(model, input_ids, images_tensor, image_sizes):
    model.generate(
        input_ids,
        images=images_tensor,
        image_sizes=image_sizes,
        latency=LATENCY,
        return_dict_in_generate=False,
        do_sample=False,
        num_beams=1,
        max_new_tokens=MAX_NEW_TOK,
        use_cache=True,
    )

def section(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")

def stats(ms_list):
    return {
        "mean_ms":   statistics.mean(ms_list),
        "median_ms": statistics.median(ms_list),
        "std_ms":    statistics.stdev(ms_list) if len(ms_list) > 1 else 0,
        "min_ms":    min(ms_list),
        "max_ms":    max(ms_list),
    }

def print_stats(label, s):
    print(f"  {label}:")
    print(f"    mean={s['mean_ms']:.1f}ms  median={s['median_ms']:.1f}ms  "
          f"std={s['std_ms']:.1f}ms  [min={s['min_ms']:.1f} max={s['max_ms']:.1f}]")

# ── load model ────────────────────────────────────────────────────────────────
print("Loading model...", flush=True)
disable_torch_init()
tokenizer, model, image_processor, context_len = load_pretrained_model(MODEL_PATH)
model.eval()
print("Model loaded.\n", flush=True)

# pre-fetch all images (network I/O not part of timing)
print("Pre-fetching images...", flush=True)
base_image = load_img(DIFF_IMG_URLS[0])
diff_images = []
for url in DIFF_IMG_URLS:
    try:
        diff_images.append(load_img(url))
    except Exception as e:
        print(f"  Warning: failed to fetch {url}: {e}")
        diff_images.append(base_image)   # fallback
print(f"  {len(diff_images)} images ready.")

# ════════════════════════════════════════════════════════════════════════════
# PART 1 — Single request full breakdown
# ════════════════════════════════════════════════════════════════════════════
section("PART 1: Single Cold-Start Request Breakdown")

prompt0 = SAME_IMG_PROMPTS[0]
img0 = base_image
images_tensor0 = process_images([img0], image_processor, model.config).to(model.device, dtype=torch.float16)
image_sizes0 = [img0.size]
input_ids0 = make_input_ids(prompt0, tokenizer)

# --- measure image encoding time separately ---
def encode_image():
    with torch.no_grad():
        model.prepare_inputs_labels_for_multimodal(
            input_ids0, None, None, None, None,
            images_tensor0, image_sizes=image_sizes0
        )

def encode_prefill_only():
    """TTFT proxy: generate exactly 1 token."""
    with torch.inference_mode():
        model.generate(
            input_ids0, images=images_tensor0, image_sizes=image_sizes0,
            latency=LATENCY, return_dict_in_generate=False,
            do_sample=False, num_beams=1, max_new_tokens=1, use_cache=True,
        )

def full_generate():
    with torch.inference_mode():
        run_generate(model, input_ids0, images_tensor0, image_sizes0)

# warmup
print(f"\nWarmup ({N_WARMUP} runs)...", flush=True)
for _ in range(N_WARMUP):
    full_generate()

# measure
img_enc_times, ttft_times, total_times = [], [], []
for i in range(N_MEASURE):
    img_enc_times.append(cuda_time_ms(encode_image))
    ttft_times.append(cuda_time_ms(encode_prefill_only))
    total_times.append(cuda_time_ms(full_generate))
    print(f"  run {i+1}/{N_MEASURE}: img_enc={img_enc_times[-1]:.1f}ms  "
          f"ttft={ttft_times[-1]:.1f}ms  total={total_times[-1]:.1f}ms", flush=True)

# derived: decode time = total - TTFT
decode_times = [t - p for t, p in zip(total_times, ttft_times)]

print()
print_stats("Image encoding (vision encoder only)", stats(img_enc_times))
print_stats("TTFT (image enc + prefill + 1st token)", stats(ttft_times))
print_stats("Decode phase (total - TTFT)", stats(decode_times))
print_stats("End-to-End total (image enc + prefill + decode)", stats(total_times))

# ════════════════════════════════════════════════════════════════════════════
# PART 2 — Same image, different text (inter-request latency)
# ════════════════════════════════════════════════════════════════════════════
section("PART 2: Same Image, Different Text  (inter-request latency)")

images_tensor_fixed = process_images([base_image], image_processor, model.config).to(model.device, dtype=torch.float16)
image_sizes_fixed = [base_image.size]

# warmup
print(f"\nWarmup ({N_WARMUP} runs)...", flush=True)
for p in SAME_IMG_PROMPTS[:N_WARMUP]:
    ids = make_input_ids(p, tokenizer)
    with torch.inference_mode():
        run_generate(model, ids, images_tensor_fixed, image_sizes_fixed)

same_img_times = []
for i, prompt in enumerate(SAME_IMG_PROMPTS[:N_MEASURE]):
    ids = make_input_ids(prompt, tokenizer)
    def _run():
        with torch.inference_mode():
            run_generate(model, ids, images_tensor_fixed, image_sizes_fixed)
    t = cuda_time_ms(_run)
    same_img_times.append(t)
    print(f"  req {i+1}/{N_MEASURE}: {t:.1f}ms  | prompt: {prompt[:50]}...", flush=True)

print()
print_stats("Same-image inter-request latency", stats(same_img_times))

# ════════════════════════════════════════════════════════════════════════════
# PART 3 — Different image, different text (inter-request latency)
# ════════════════════════════════════════════════════════════════════════════
section("PART 3: Different Image, Different Text  (inter-request latency)")

# pre-process all image tensors (not part of timing)
diff_tensors = [
    process_images([img], image_processor, model.config).to(model.device, dtype=torch.float16)
    for img in diff_images
]
diff_sizes = [[img.size] for img in diff_images]

# warmup
print(f"\nWarmup ({N_WARMUP} runs)...", flush=True)
for i in range(N_WARMUP):
    ids = make_input_ids(DIFF_IMG_PROMPTS[i], tokenizer)
    with torch.inference_mode():
        run_generate(model, ids, diff_tensors[i], diff_sizes[i])

diff_img_times = []
for i in range(N_MEASURE):
    ids = make_input_ids(DIFF_IMG_PROMPTS[i], tokenizer)
    t_idx = i % len(diff_tensors)
    def _run():
        with torch.inference_mode():
            run_generate(model, ids, diff_tensors[t_idx], diff_sizes[t_idx])
    t = cuda_time_ms(_run)
    diff_img_times.append(t)
    print(f"  req {i+1}/{N_MEASURE}: {t:.1f}ms  | img#{t_idx+1}  prompt: {DIFF_IMG_PROMPTS[i][:45]}...", flush=True)

print()
print_stats("Diff-image inter-request latency", stats(diff_img_times))

# ════════════════════════════════════════════════════════════════════════════
# FINAL SUMMARY
# ════════════════════════════════════════════════════════════════════════════
section("FINAL SUMMARY  (latency=0.5, max_new_tokens=128, A100 80G)")
s1t = stats(total_times)
s1f = stats(ttft_times)
s2  = stats(same_img_times)
s3  = stats(diff_img_times)

print(f"""
  ┌─────────────────────────────────────────────────────────┐
  │  Metric                          mean      median   std  │
  ├─────────────────────────────────────────────────────────┤
  │  Image encoding (vision enc)  {stats(img_enc_times)['mean_ms']:7.1f}ms  {stats(img_enc_times)['median_ms']:7.1f}ms  {stats(img_enc_times)['std_ms']:5.1f}ms │
  │  TTFT (cold, 1st token)       {s1f['mean_ms']:7.1f}ms  {s1f['median_ms']:7.1f}ms  {s1f['std_ms']:5.1f}ms │
  │  End-to-End (cold)            {s1t['mean_ms']:7.1f}ms  {s1t['median_ms']:7.1f}ms  {s1t['std_ms']:5.1f}ms │
  ├─────────────────────────────────────────────────────────┤
  │  Same-image inter-request     {s2['mean_ms']:7.1f}ms  {s2['median_ms']:7.1f}ms  {s2['std_ms']:5.1f}ms │
  │  Diff-image inter-request     {s3['mean_ms']:7.1f}ms  {s3['median_ms']:7.1f}ms  {s3['std_ms']:5.1f}ms │
  └─────────────────────────────────────────────────────────┘

  Notes:
  - "cold" = after GPU warmup (kernels compiled), but no KV-cache reuse
  - same-image reuses pixel tensor; vision encoder still re-runs each call
  - max_new_tokens capped at {MAX_NEW_TOK} for reproducibility
  - latency=0.5 (AdaLLaVA floor: ~49% FLOPs vs full inference)
""")

```

![latency benchmark](https://files.seeusercontent.com/2026/03/31/Wx7s/20260331164005.png)

> [!note]
>
> 数据拿到了。来分析这些结果：
>
> ---
>   测量结果分析（latency=0.5, A100 80G, max_new_tokens=128）
>
>   关键数字
>
>   ![table](https://files.seeusercontent.com/2026/03/31/D7wy/20260331164107.png)
>
> ---
>   结构分析
>
>     1. TTFT 极稳定（63ms, std=0.6ms）
>        视觉编码 35ms + Prefill 28ms，这部分完全由输入长度决定，无随机性。TTFT 是用户感知延迟的关键指标，63ms 对于 7B 多模态模型非常优秀。
>
>     2. Decode 时间是主要开销（占总延迟 95%）
>        ~1357ms 生成约 128 tokens → 每 token 约 10.6ms（约 94 tokens/s）。这完全符合 A100 上 7B FP16 模型的预期吞吐。
>
>     3. inter-request 方差大（std ≈ 430~486ms）
>        方差来源不是图片切换（只有 35ms），而是不同 prompt 导致生成长度差异巨大（最短回答 ~25 tokens，最长 ~128 tokens）。decode 按 token 计费，输出越长越慢。
>
>     4. 同图 vs 不同图差异不显著（716ms vs 843ms）
>        这两类的主要差距来自 prompt 内容（即生成长度），而非视觉编码（35ms，占比 < 3%）。这说明：若要优化 inter-request 延迟，缓存视觉编码结果（image features）价值有限，减少生成 token 数（early stopping / beam
>          search）才是主要手段。
>
>     5. 一个异常点：Part 2 的 req1（1394ms）和 Part 3 的 req1（1297ms）偏高——这是因为 warmup 刚结束，PyTorch 的 CUDA 内存分配器还在调整，与后续请求相比属于正常的首次惩罚。

这里我认为有个非常值得注意的数据，在单图、不同文本下，**7B模型在单卡A100上实际inter-request最小达到了252ms**。而中位数则是508ms。

![latency_benchmark](https://files.seeusercontent.com/2026/03/31/iv9N/20260331164956.png)

### Supplementary experiment

以及，这里计算的都只是Total FLOPs，真实的大模型推理时延真的是与Latency线性减少的吗？我们同样可以设计一个实验。

```py
# latency_linearity_exp.py
"""
Experiment: Is wall-clock latency linearly correlated with latency parameter?

Hypothesis:
  - LLM-Viewer reports FLOPs reduction proportional to latency parameter.
  - Real GPU latency may NOT scale linearly because:
    (a) Prefill (long seq) = compute-bound → may scale with FLOPs
    (b) Decode (batch=1)   = memory-bandwidth-bound → may NOT scale with FLOPs
    (c) Fixed kernel-launch & memory-copy overhead floors the savings

Measurement plan:
  For each latency in [1.0, 0.9, 0.8, 0.7, 0.6, 0.5]:
    - TTFT      : max_new_tokens=1  (prefill + 1st token, N runs)
    - Per-token : max_new_tokens=50 then compute (total-TTFT)/49
    - E2E@50tok : max_new_tokens=50 (total, N runs)

Theoretical FLOPs from latency sweep (already measured):
  flops_T = {1.0: 10.8, 0.9: 9.2, 0.8: 8.4, 0.7: 7.6, 0.6: 6.2, 0.5: 5.5}
"""

import sys, time, statistics, warnings
warnings.filterwarnings("ignore")

import torch
import numpy as np

from llava.constants import IMAGE_TOKEN_INDEX, DEFAULT_IMAGE_TOKEN
from llava.conversation import conv_templates
from llava.utils import disable_torch_init
from llava.mm_utils import process_images, tokenizer_image_token
from src.adallava.model.builder import load_pretrained_model
from PIL import Image
import requests
from io import BytesIO

# ── config ────────────────────────────────────────────────────────────────────
MODEL_PATH  = "models/ada-llava-L-v1.5-7b"
IMAGE_URL   = "https://llava-vl.github.io/static/images/view.jpg"
PROMPT      = "What are the things I should be cautious about when I visit here?"
CONV_MODE   = "llava_v1"
LATENCIES   = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5]
N_WARMUP    = 3
N_MEASURE   = 10
FIXED_TOKS  = 50   # fixed decode length for per-token measurement

# Theoretical FLOPs from latency sweep (T)
THEO_FLOPS = {1.0: 10.8, 0.9: 9.2, 0.8: 8.4, 0.7: 7.6, 0.6: 6.2, 0.5: 5.5}

# ── setup ─────────────────────────────────────────────────────────────────────
print("Loading model...", flush=True)
disable_torch_init()
tokenizer, model, image_processor, context_len = load_pretrained_model(MODEL_PATH)
model.eval()

resp = requests.get(IMAGE_URL, timeout=15)
image = Image.open(BytesIO(resp.content)).convert("RGB")
images_tensor = process_images([image], image_processor, model.config).to(model.device, dtype=torch.float16)
image_sizes   = [image.size]

qs = DEFAULT_IMAGE_TOKEN + "\n" + PROMPT
conv = conv_templates[CONV_MODE].copy()
conv.append_message(conv.roles[0], qs)
conv.append_message(conv.roles[1], None)
prompt_text = conv.get_prompt()
input_ids = (
    tokenizer_image_token(prompt_text, tokenizer, IMAGE_TOKEN_INDEX, return_tensors="pt")
    .unsqueeze(0).cuda()
)

def cuda_ms(fn):
    torch.cuda.synchronize()
    t0 = time.perf_counter()
    fn()
    torch.cuda.synchronize()
    return (time.perf_counter() - t0) * 1000.0

def gen(lat, max_tok):
    with torch.inference_mode():
        model.generate(
            input_ids, images=images_tensor, image_sizes=image_sizes,
            latency=lat, return_dict_in_generate=False,
            do_sample=False, num_beams=1,
            max_new_tokens=max_tok, use_cache=True,
        )

# ── global warmup ─────────────────────────────────────────────────────────────
print("Global warmup...", flush=True)
for _ in range(N_WARMUP):
    gen(1.0, FIXED_TOKS)

# ── sweep ─────────────────────────────────────────────────────────────────────
results = {}   # lat -> {ttft, e2e50, per_tok}

for lat in LATENCIES:
    print(f"\nLatency={lat}", flush=True)

    # per-latency warmup
    for _ in range(2):
        gen(lat, FIXED_TOKS)

    ttft_ms, e2e_ms = [], []
    for i in range(N_MEASURE):
        t1 = cuda_ms(lambda: gen(lat, 1))          # TTFT proxy
        t2 = cuda_ms(lambda: gen(lat, FIXED_TOKS)) # full 50-token
        ttft_ms.append(t1)
        e2e_ms.append(t2)
        print(f"  [{i+1}/{N_MEASURE}] ttft={t1:.1f}ms  e2e50={t2:.1f}ms", flush=True)

    per_tok = [(e - t) / (FIXED_TOKS - 1) for e, t in zip(e2e_ms, ttft_ms)]
    results[lat] = dict(
        ttft   = ttft_ms,
        e2e50  = e2e_ms,
        per_tok= per_tok,
    )

# ── aggregate ─────────────────────────────────────────────────────────────────
lats         = LATENCIES
mean_ttft    = [np.mean(results[l]["ttft"])    for l in lats]
std_ttft     = [np.std(results[l]["ttft"])     for l in lats]
mean_e2e     = [np.mean(results[l]["e2e50"])   for l in lats]
std_e2e      = [np.std(results[l]["e2e50"])    for l in lats]
mean_pertok  = [np.mean(results[l]["per_tok"]) for l in lats]
std_pertok   = [np.std(results[l]["per_tok"])  for l in lats]
theo_flops   = [THEO_FLOPS[l] for l in lats]

# normalise to lat=1.0
base_ttft   = mean_ttft[0]
base_e2e    = mean_e2e[0]
base_pertok = mean_pertok[0]
base_flops  = theo_flops[0]

ratio_ttft   = [v / base_ttft   for v in mean_ttft]
ratio_e2e    = [v / base_e2e    for v in mean_e2e]
ratio_pertok = [v / base_pertok for v in mean_pertok]
ratio_flops  = [v / base_flops  for v in theo_flops]

# ── print summary ─────────────────────────────────────────────────────────────
print("\n" + "="*70)
print(f"{'lat':>5} | {'TTFT(ms)':>10} | {'E2E@50(ms)':>12} | {'per-tok(ms)':>12} | {'FLOPs(T)':>9}")
print("-"*70)
for i, lat in enumerate(lats):
    print(f"{lat:>5.1f} | {mean_ttft[i]:>8.1f}±{std_ttft[i]:.1f} | "
          f"{mean_e2e[i]:>10.1f}±{std_e2e[i]:.1f} | "
          f"{mean_pertok[i]:>10.2f}±{std_pertok[i]:.2f} | "
          f"{theo_flops[i]:>9.1f}")

# ── save data for plotting ────────────────────────────────────────────────────
import json, pathlib
data_out = {
    "lats": lats,
    "mean_ttft": mean_ttft, "std_ttft": std_ttft,
    "mean_e2e": mean_e2e,   "std_e2e": std_e2e,
    "mean_pertok": mean_pertok, "std_pertok": std_pertok,
    "theo_flops": theo_flops,
    "ratio_ttft": ratio_ttft, "ratio_e2e": ratio_e2e,
    "ratio_pertok": ratio_pertok, "ratio_flops": ratio_flops,
    "raw": {str(l): results[l] for l in lats},
}
pathlib.Path("docs").mkdir(exist_ok=True)
with open("docs/linearity_data.json", "w") as f:
    json.dump(data_out, f, indent=2)
print("\nData saved to docs/linearity_data.json")
```

![latency linearity](https://files.seeusercontent.com/2026/03/31/z7Gn/20260331170116.png)

![latency linearity](https://files.seeusercontent.com/2026/03/31/i0fB/20260331165858.png)

> [!note]
>
> 要分两种情况看：
>
> - E2E 和 Per-token Decode：近似线性 ✅
>
> ![E2E](https://files.seeusercontent.com/2026/03/31/v4Uc/20260331170348.png)
>
> R²极接近1，实际加速甚至略超FLOPs预期。这说明 AdaLLaVA 的注意力头跳过机制直接减少了每个 decode step 的计算量，decode 阶段（batch=1）虽然通常是 memory-bound，但跳过 attention head 同时减少了 KV cache 的访存量，两者协同使加速接近线性。
>
> - TTFT（Prefill）：线性但有固定开销拖累 ⚠️
>
> ![TTFT](https://files.seeusercontent.com/2026/03/31/S8no/20260331170335.png)
>
> 图④揭示了原因：TTFT = 固定视觉编码（~35ms，不随 latency 变化） + 可变 LLM prefill。在 lat=0.5 时视觉编码占 TTFT 的 55%，成为节能无法突破的固定下限。LLM prefill 部分本身也是近线性的——瓶颈在视觉编码，而不是 LLM 部分。
>
>   核心结论
>
>   ▎ FLOPs 减少确实近乎线性地转化为 decode 和 E2E 时延降低（R²≈0.994）；但 TTFT 因视觉编码的固定开销（~35ms）而加速效果仅为理论值的 74%。若要进一步压缩 TTFT，需要对视觉编码阶段也做自适应裁剪。

> 这里我有一个问题，这个问题可能对于长期接触大模型推理的人来说比较愚蠢：为什么TTFT降低不足70%，但是E2E的时延却能降低到原来的一半？
>
> 因为 TTFT 里包含了不随 latency 变化的固定开销——视觉编码（~35ms）。
>
> 具体拆解：
>
> TTFT(lat=1.0) = 35ms(视觉编码) + 57ms(LLM prefill) = 92ms
> TTFT(lat=0.5) = 35ms(视觉编码) + 28ms(LLM prefill) = 63ms
>
> LLM prefill 部分其实减少了约 51%，与 FLOPs 预期吻合。但视觉编码这 35ms 是铁板钉钉的固定成本，拉低了整体 TTFT 的加速比：
>
> TTFT 加速比 = 92 / 63 = 1.45×   ← 被35ms固定项拖累
>
> 而 E2E 的组成是：
>
> E2E = TTFT + decode(49个token)
>     ≈ 63ms  + 510ms   (lat=0.5时)
>     ≈ 92ms  + 1098ms   (lat=1.0时)
>
> decode 阶段占 E2E 的 95%，而 decode 每个 token 的加速比是 2.09×（与 FLOPs 几乎完全线性），所以 E2E 的整体加速被 decode 主导，最终达到 2.02×，接近理论预期。
>
> 一句话总结：TTFT 加速被 35ms 视觉编码"稀释"了，但 E2E 由占比 95% 的 decode 主导，而 decode 的加速非常线性，所以 E2E 表现远好于 TTFT。
>
> claude解释说有关这个现象有个特殊的名字：**Amdahl 定律**，这里指的是一个通用的定率，指当对系统中占比最大的部分做提升时，基本等同于对系统做提升。
>
> ---
>
> 值得注意的是，**这种现象对于大模型推理而言非常普遍**
>
> 这是大模型推理的基本特征。
>
> 根本原因：decode 是逐 token 自回归生成
>
> - Prefill 处理所有输入 token 是一次并行矩阵运算，GPU 利用率高，速度快
> - Decode 每步只生成 1 个 token，无法并行，必须串行重复 N 次（N = 输出长度）
>
> 从这次实验数据可以直观看到：
>
> - TTFT（prefill + 1st token）：~63ms（固定）
> - Decode 50 个 token：~525ms（占 E2E 的 89%）
> - 每 token 约 10.7ms，生成越长越慢
>
> 这就是为什么工业界把推理指标拆分为两个维度：
> - TTFT（Time To First Token）—— 衡量 prefill 速度，影响响应延迟感知
> - TPS / throughput（Tokens Per Second）—— 衡量 decode 速度，影响总完成时间
>
> 对于短输出（如分类、yes/no），prefill 比重上升；对于长文本生成（报告、代码），decode 几乎完全主导。7B 这种量级的模型在 batch=1 场景下，decode 是 memory-bandwidth bound（每步要把所有权重从 HBM 搬一遍），这是无法通过
> FLOPs 优化彻底解决的，需要 continuous batching、speculative decoding 等技术来提升 GPU 利用率。

基本上，是的，该篇论文对大模型的加速就是线性的，在这篇论文中，无法加速TTFT中的vision encode部分。但这部分在大模型中的占比极少。

> [!note]
>
>  Vision Encoding 是什么阶段
>
> 就是用 CLIP 视觉编码器（ViT）把输入图片转成 image token embeddings 的过程。在 ada_llava_llama.py 的 generate() 里对应这一调用：
>
> self.prepare_inputs_labels_for_multimodal(
>     inputs, ..., images, image_sizes=image_sizes
> )
>
> 内部流程：图片像素 → CLIP ViT 提取特征 → PruMerge 压缩 image tokens → 与文本 embeddings 拼接。
>
> ---
> 为什么 AdaLLaVA 无法加速这部分
>
> AdaLLaVA 的自适应机制作用于 LLM 的注意力头（每层选择性跳过部分 attention heads），而 Vision Encoding 是在 LLM 之前、完全独立运行的 CLIP 模型，二者是串行的两个模块：
>
> 图片 → [CLIP ViT] → image tokens → [AdaLLaVA LLM（注意力头自适应）] → 输出
>          ↑ 不受 latency 参数影响        ↑ latency 参数控制的范围
>
> latency 参数只编码为一个特殊 token 插入 LLM 的输入序列，用于控制 LLM 各层的 scheduler 决策，完全不触及 CLIP。所以无论 latency 设为 1.0 还是 0.5，CLIP ViT 都完整跑一遍，耗时固定在 ~35ms。

> [!note]
>
>    Prefill 阶段是 LLM 推理的第一步：将所有输入 token（图片 token + 文本 token）一次性并行处理，建立 KV Cache，输出第一个生成 token。它是计算密集型（compute-bound）的，因为可以对所有 token 做并行矩阵运算。
>
> ---
> 为什么 prefill 会随 latency 参数变化？
>
> AdaLLaVA 在 prefill 阶段就已经执行了注意力头的选择逻辑。每个 Transformer 层需要决定哪些注意力头参与计算，这个决策本身就发生在 prefill 中。
>
> 具体来说：
> - latency=1.0：每层所有 32 个注意力头都参与 prefill 的 self-attention 计算
> - latency=0.5：每层约一半的注意力头参与计算，Q/K/V 矩阵乘法的规模减小
>
> 所以 prefill 的计算量随 latency 降低而减少，时延也随之下降（92ms → 63ms）。
>
> ---
> 但为什么加速比不如 decode 明显？
>
> 就是图④所揭示的：TTFT = 视觉编码（35ms，固定） + LLM prefill（变化部分）。
>
> 视觉编码（CLIP encoder 把图片转成 image tokens）完全不受 latency 参数影响，是固定开销。当 latency 从 1.0 降到 0.5 时，LLM prefill 从 ~57ms 降到 ~28ms（接近线性），但视觉编码的 35ms 始终存在，把整体 TTFT 的加速比从理论1.96× 拉低到实际 1.45×。
