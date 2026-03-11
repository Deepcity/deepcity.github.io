---
title: "Ascend C 算子开发 Part5 PyTorch 算子调用与阶段总结"
pubDatetime: 2025-09-12T20:00:00Z
description: "Ascend C 算子开发第五部分，介绍 PTA 适配框架（torch-npu）与 PyTorch 算子集成方式，并对全系列进行阶段性总结。"
slug: "ascendc-part5-pytorch-summary"
draft: false
tags:
  - "Ascend"
  - "c++"
  - "算子开发"
  - "LLM"
---

## Ascend C算子开发 Part5 Pytorch算子调用与阶段总结

## PTA 适配框架

简单的讲，pytorch为底层硬件接口提供了一套中间层（Pytorch Adapter）用于分发不同的计算任务给不同的算子。Ascend C对这套机制进行了适配（**就是torch-npu**，详见REF3）。

对于自定义算子而言，也需要适配PTA，需要做以下工作（torch_npu v1.11.0）。

- 注册PTA自定义算子接口
- 编写PTA自定义算子适配文件

- 编译torch_npu的whl包

![PTA framework](https://s2.loli.net/2025/10/19/TcSwMgxLUItZWhA.png)

## 算子注册分发

在`npu_native_functions.yaml`文件中给出定义。路径为`torch_npu/csrc/aten/npu_native_functions.yaml`。该文件对算子进行结构化解析从而实现自动化注册和Python接口绑定。

![opp reg distribution](https://s2.loli.net/2025/10/19/WA7F9aXNZq6QUJo.png)


## 适配插件开发

目的主要是为了适配pytorch中算子API的调用参数和属性的格式转换，总共分为以下四步。

1. 创建适配插件文件，`torch_npu/csrc/aten/ops/op_api`目录下，大驼峰命名风格（<算子名> + <KernelNpu>.cpp，如AddCustomKernelNpu.cpp）
2. 引入依赖头文件：适配Ascend AI处理器的pytorch源代码，在`torch_npu/csrc/framework/utils`中提供了常用工具
3. 实现算子适配主题函数：实现算子适配主题函数，根据Ascend C算子原型构造得到对应的input、output、attr。
4. 重编译Pytorch框架或插件

![plug](https://s2.loli.net/2025/10/19/H2fDGh91aon6dPM.png)

## 测试文件开发

基本就是使用torch_npu.testing.testcase中提供的TestCase,runtests等。

这里有一个数据格式的转换，将`x`与`y`从cpu状态转化为npu，最后也需要转为cpu格式，避免与golden的对比不一致。

![test dev](https://s2.loli.net/2025/10/19/Jg6B52QrA7uGaF8.png)

## Additional Summary

- 从核函数中传入的Tiling指针，需要用`GET_TILING_DATA`宏函数进行解析

- 通过`GetBlockNum()`进行获取参与并行计算的核数信息

- 动态shape和固定shape只有Tiling函数有差异，核函数是没有差异的

- 将静态Shape修改为动态Shape的算子需要修改
  - 输入数据与真值数据的生成文件
  - Ascend C算子的核函数实现文件
  - 应用程序入口文件的main.cpp，主要修改Tiiling相关
  
- 用于判断是否处于CPU模式的宏是`__CCE_KT_TEST__`

- 使用NPU仿真实验蛀牙是为了得到数据的计算模拟与指令时序仿真

- host侧实现文件<KERNEL_NAME>.cpp不会通过ADD_OP接口完成算子的原型注册

- shape推导是根据算子的输入张量描述、算子逻辑以及算子属性推导出的算子的输出张量描述，包括张量的Shape、数据类型以及数据排布格式等信息

- 对于非对齐shape，在tiling的实现上与对齐Shape会有些差异

- 在生成的自定义算子工程中`msopgen`，通过配置文件`CmakePreSets.cmake`文件指定文件目录以及相关配置

- msopgen工具中，需要先后指定 i|c|lan|out 对应 <算子原型定义>|<使用core型号如：ai_core-ascend910>|<使用语言>|<输出名称>

- 在自定义算子编译完成后，生成的run包在build_out目录下

- 默认场景下，ASCEND_CANN_PACKAGE_PATH/opp/vendors会是算子的部署目录，可以通过./custom_opp_xx.run --install-path指定部署目录

- 自定义算子的编译分为二进制编译以及源码编译，通过算子工程中的build.sh脚本完成

- 单算子API执行需要算子二进制码部署，模型执行需要算子源码部署，API执行不需要加载om模型

- Shape推导是算子模型执行必须的，而不是算子API执行必须的

- 单算子API执行需要

  1. 初始化AscendCL
  2. 计算workspace并执行算子
  3. AscendCL去初始化

- 单算子模型执行需要

  1. 初始化AscendCL
  2. 加载算子模型文件
  3. AscendCL去初始化

- UT会报告代码覆盖率报告，而ST会报告性能相关的很多信息（如流水线）

- pyTorch框架通过aclnn接口调用自定义算子的二进制文件，目录在$ASCEND_OPP_PATH/vendors/customize/op_api/lib

- 一个npu_native_functions.yaml文件中的自定义算子AddCustom的注册代码如下

  ```yaml
  custom: -func: npu_add_custom(Tensor x, Tensor y) -> Tensor
  ```

## 阶段结语

基本上到这里，AscendC的基本概念就介绍完了，涵盖从算子基础到算子进阶的所有内容，不过相对于完善的算子开发来说，这些仅仅只是入门，更准确地说，这里大部分的内容都是Ascend的内容，学完这些并不代表可以独立的进行算子开发，调优到部署，但也不至于再在算子开发中不知所云。

前路漫漫，希望各位能有所收获。

## REF

1. Huawei w3
2. Huawei ilearning
3. [pytorch: Ascend Extension for PyTorch](https://gitee.com/ascend/pytorch)

