# Blog Memory — Deepcity's Blog

> 这是 Blog Lint Agent 的长期记忆文件。
> Agent 在执行系列追踪、标签推断、格式建议时应主动读取此文件。
> 每当博客内容发生重大变化（新增文章、完成系列、修改标签体系）时，更新此文件。
>
> 最后更新：2026-03-11

---

## 内容系列状态

### CMU 15-213 Labs `[7 / 8]`

课程主页：https://csapp.cs.cmu.edu/  
CMU 15-213 共 8 个 Lab，按实际完成时间排列：

| 序号 | Lab 名称        | 完成周期                | 状态      | 文件                           | slug                        |
| ---- | --------------- | ----------------------- | --------- | ------------------------------ | --------------------------- |
| 1    | DataLab         | 2025-07-31 ~ 2025-08-04 | ✅ 已发布 | `CMU-15213-DataLab.md`         | `cmu-15213-datalab`         |
| 2    | BombLab         | 2025-08-06 ~ 2025-08-10 | ✅ 已发布 | `CMU-15213-BombLab.md`         | `cmu-15213-bomblab`         |
| 3    | AttackLab       | 2025-08-13 ~ 2025-08-17 | ✅ 已发布 | `CMU-15213-AttackLab.md`       | `cmu-15213-attacklab`       |
| 4    | ArchitectureLab | 2025-08-18 ~ 2025-08-24 | ✅ 已发布 | `CMU-15213-ArchitectureLab.md` | `cmu-15213-architecturelab` |
| 5    | CacheLab        | 2025-09-01 ~ 2025-09-07 | ✅ 已发布 | `CMU-15213-CacheLab.md`        | `cmu-15213-cachelab`        |
| 6    | ShellLab        | 2025-09-08 ~ 2025-09-14 | ✅ 已发布 | `CMU-15213-ShellLab.md`        | `cmu-15213-shelllab`        |
| 7    | MallocLab       | 2025-09-15 ~ 2025-09-28 | ✅ 已发布 | `CMU-15213-MallocLab.md`       | `cmu-15213-malloclab`       |
| 8    | ProxyLab        | —                       | ❌ 未开始 | —                              | —                           |

---

### 群体人工智能 `[1 / ?]`

研究笔记系列，标题含 `Part1`，明确为未完成系列。

| 序号   | 主题                                                    | 状态      | 文件                            |
| ------ | ------------------------------------------------------- | --------- | ------------------------------- |
| Part 1 | PSO — 粒子群优化算法                                    | ✅ 已发布 | `PGStudy-Swarm-intelligence.md` |
| Part 2 | 待定（推测：遗传算法 GA / 蚁群算法 ACO / 人工蜂群 ABC） | ❓ 未发布 | —                               |

---

### Ascend C 算子开发 `[5 / 5]`

华为昇腾算子开发技术系列，全系列已完成。

| 序号   | 主题                            | 状态      | 文件                                   | slug                                |
| ------ | ------------------------------- | --------- | -------------------------------------- | ----------------------------------- |
| Part 1 | 基本概念（CANN 架构、编程模型） | ✅ 已发布 | `AscendC-part1-basic-concept.md`       | `ascendc-part1-basic-concept`       |
| Part 2 | Tiling 计算与调试               | ✅ 已发布 | `AscendC-part2-tiling-and-debug.md`    | `ascendc-part2-tiling-and-debug`    |
| Part 3 | 算子交付件与算子工程            | ✅ 已发布 | `AscendC-part3-operator-delivery.md`   | `ascendc-part3-operator-delivery`   |
| Part 4 | 算子调用与测试                  | ✅ 已发布 | `AscendC-part4-operator-invocation.md` | `ascendc-part4-operator-invocation` |
| Part 5 | PyTorch 算子调用与阶段总结      | ✅ 已发布 | `AscendC-part5-pytorch-summary.md`     | `ascendc-part5-pytorch-summary`     |

---

### 论文阅读 `[3 / ∞]`

开放性持续扩展系列，无固定篇数。

| 会议      | 论文                                                      | 状态      | 文件                      |
| --------- | --------------------------------------------------------- | --------- | ------------------------- |
| OSDI 2018 | Ray: A Distributed Framework for Emerging AI Applications | ✅ 已发布 | `OSDI18-Ray.md`           |
| SOSP 2024 | Colloid: Tiered Memory Management (Access Latency)        | ✅ 已发布 | `SOSP24-Colloid.md`       |
| OSDI 2024 | ServerlessLLM: Low-Latency Serverless Inference for LLMs  | ✅ 已发布 | `OSDI24-ServerlessLLM.md` |

---

### 独立文章（无系列归属）

| 文章                                     | 文件                                  | 备注                         |
| ---------------------------------------- | ------------------------------------- | ---------------------------- |
| 算法数论基础                             | `Algorithm-number-theory-base.md`     | 可发展为算法系列，目前仅一篇 |
| 使用 OneDrive 的三年经验与不得不知的警告 | `onedrive-experience-and-warnings.md` | 独立经验文章                 |

---

## 标签注册表

**规则**：为新文章推断 tags 时，必须执行以下决策流程：

1. **优先复用**：候选 tag 与注册表中某个标签**语义相同或高度相近**，直接使用注册表中的标准形式
2. **合并吸收**：候选 tag 是注册表某标签的子集或同义词（见「语义等价组」），使用标准标签替代
3. **新增注册**：候选 tag 确实代表全新概念，允许添加，但同时必须更新此注册表（在对应分类下追加）
4. **数量控制**：每篇文章建议 **2–5 个**标签，最多不超过 6 个；不堆砌标签

---

### 标准标签库（按类别）

#### 论文阅读类

| 标准标签     | 含义                             | 语义等价 / 禁用词（不得新建）                 |
| ------------ | -------------------------------- | --------------------------------------------- |
| `论文阅读`   | 论文笔记类文章入口标签           | paper reading、论文笔记、paper notes          |
| `OSDI`       | OSDI 会议                        | osdi、USENIX OSDI                             |
| `SOSP`       | SOSP 会议                        | sosp                                          |
| `分布式系统` | 分布式系统领域                   | distributed system、分布式、分布式计算        |
| `异构内存`   | 异构内存架构（DRAM + NVM / CXL） | heterogeneous memory、tiered memory、分层内存 |
| `内存延迟`   | 内存访问延迟优化                 | memory latency、访存延迟                      |
| `大模型推理` | LLM 模型在线推理                 | LLM inference、模型推理、inference            |
| `大模型应用` | LLM 应用框架、部署               | LLM application、大模型部署、LLM framework    |

#### 课程实验类

| 标准标签                | 含义                                                 | 语义等价 / 禁用词（不得新建）                                    |
| ----------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- |
| `CMU15213`              | CMU 15-213 课程（CS:APP）全系列 Lab 的唯一课程标识签 | CMU-lab、15213、cmu lab、CSAPP、csapp lab **（这些均为禁用词）** |
| `c`                     | C 语言                                               | C语言、C language、clang                                         |
| `汇编`                  | 汇编语言 / 汇编分析                                  | assembly、asm、汇编语言                                          |
| `反编译`                | 逆向 / 反汇编分析                                    | disassemble、reverse、逆向分析                                   |
| `x86-64`                | x86-64 指令集架构                                    | x86、x64、amd64                                                  |
| `指令集`                | 指令集架构（ISA）设计                                | ISA、instruction set                                             |
| `流水线处理器`          | 处理器流水线设计                                     | pipeline、CPU pipeline                                           |
| `Exploit String Attack` | 漏洞字符串注入攻击                                   | buffer overflow attack（仅在此上下文）                           |

#### 算法 / 数学 / AI 类

| 标准标签       | 含义                              | 语义等价 / 禁用词                |
| -------------- | --------------------------------- | -------------------------------- |
| `算法`         | 算法竞赛 / 基础算法               | algorithm、算法题                |
| `数论`         | 数论算法（GCD、素数、欧拉函数等） | number theory                    |
| `数学`         | 数学基础                          | math、数学基础                   |
| `机器学习`     | 机器学习方法                      | ML、machine learning             |
| `人工智能`     | AI 广义概念                       | AI、artificial intelligence      |
| `群体人工智能` | 群体智能（SI）                    | swarm intelligence、群体智能、SI |
| `PSO`          | 粒子群优化算法                    | particle swarm optimization      |

#### 开发类

| 标准标签   | 含义               | 语义等价 / 禁用词                        |
| ---------- | ------------------ | ---------------------------------------- |
| `Ascend`   | 华为昇腾硬件平台   | 昇腾、Ascend NPU、华为昇腾               |
| `LLM`      | 大语言模型（通用） | 大模型、大语言模型、large language model |
| `算子`     | 神经网络算子       | operator、op、kernel                     |
| `c++`      | C++ 语言           | C++语言、cpp、C plus plus                |
| `算子开发` | 算子开发工程实践   | operator development、kernel development |

#### 软件 / 工具类

| 标准标签    | 含义                | 语义等价 / 禁用词            |
| ----------- | ------------------- | ---------------------------- |
| `软件`      | 软件工具使用经验    | software、tool               |
| `云服务`    | 云存储 / 云平台服务 | cloud、cloud service、云存储 |
| `Microsoft` | 微软产品            | 微软、MS                     |
| `365`       | Microsoft 365 订阅  | Office 365、M365             |

---

## 已知格式问题（待修复）

_当前无已知格式问题。_

---

## 更新指引

当以下事件发生时，请更新此文件：

1. **新增博客文章** → 更新对应系列的状态表，若是新系列则新增章节
2. **完成系列中的某一篇** → 将 ❓ 改为 ✅，填入文件名和 slug
3. **添加新标签** → 在标签注册表对应分类下追加
4. **修复已知格式问题** → 从"已知格式问题"表中删除对应行
5. **用户明确要求更新** → 按用户指示修改任意内容
