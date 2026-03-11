---
title: "Ascend C 算子开发 Part3 算子交付件与算子工程"
pubDatetime: 2025-08-28T20:00:00Z
description: "Ascend C 算子开发第三部分，介绍 HOST/DEVICE 交付件结构、编译工作流与算子工程组织方式。"
slug: "ascendc-part3-operator-delivery"
draft: false
tags:
  - "Ascend"
  - "c++"
  - "算子开发"
---

## Ascend C 算子开发 Part3 算子交付件与算子工程

## Ascend 算子交付件

算子交付件主要分为 HOST 交付件与 DEVICE 交付件，两者通过不同编译器编译（C/CPP、毕昇），编译成的二进制分别会被不同侧调用执行。

![AscendC算子交付件](https://s2.loli.net/2025/10/18/4hYUMsAzwnayIHG.png)

### HOST 交付件

主要包括：

- Tiling 结构体的定义与注册

![KERNEL_TAIL](https://s2.loli.net/2025/10/18/NMr6SI92GRtWOqH.png)

通过易用的宏定义与注册方式为用户快速生成结构体。

通过宏定义主要完成了以下几件事

- 自动生成 tiling 结构体的定义
- 通过 `REGISTER_TILING_DATA_CLASS` 注册 tiling 结构体的类
- 通过封装宏函数将 `GET_TILING_DAT`、`COVERT_TILING_DATA` 和 `INIT_TILING_DATA` 等基本的函数封装在宏定义里可以直接在核函数中调

![host侧算子交付件](https://s2.loli.net/2025/10/18/PxziJtkGTLe3bK7.png)

这里的算子交付件 `<KERNEL_NAME>.cpp`，上半部分是定义：处理 Tiling 以及 Shape 的推导，下半部分是注册，处理参数的性质与数据类型，设定能够在那些 Aicore 上跑，并注册 OpType。

> 并且这里有一个 SetTilingKey 的函数，这里是由于不同 Shape 对应的不同 Tiling 策略，不同的 Tiling 策略对应的可能又是不同的算子执行策略，因此这里插一个 FLAG。主要为了性能以及精度做的优化

### KERNEL 侧交付件（DEVICE）

这里由于上面的宏定义替代，对 Tiling 的处理方式简化了很多

![Kernel侧算子交付件](https://s2.loli.net/2025/10/18/BWlIOGhXezkYMmJ.png)

### 其他交付件（非对齐 Shape）

通过一堆宏定义，定义出 `set_formerNum`、`set_tailNum`、`set_formerLength`、`set_tailLength` 以及 `alignNum` 等函数。并对 shape 进行处理。

![其他交付件](https://s2.loli.net/2025/10/18/6I8DKyWBMTEQ3ux.png)

## AscendC 自定义算子工程

自定义算子工程是一个包含用户编写的，包含 host 侧与 kernel 侧算子实现文件的，用于编译和安装的自定义算子 run 包的工程框架。

下面的图中加粗的文件是较常关心的文件

![自定义算子工程](https://s2.loli.net/2025/10/18/jzLhoN7etySKBFY.png)

### 自定义算子工程创建

通过自定义算子工程生成工具 msopgen，基于算子原型定义输出算子工程，包括（但具体的逻辑实现当然还是得自己写）：

- HOST 侧代码实现文件
- 算子 kernel 侧实现文件
- 算子适配插件
- 工程编译配置工具

```sh
#eg
msopgen gen -i add_custom.json -c ai_core-ascend910 -lan cpp -out AddCustom
```

详见 REF3

> 其中可以发现对于json文件的编写，其中的内容与HOST侧的算子注册部分有大量的相似之处

![自定义算子工程创建](https://s2.loli.net/2025/10/18/CteSKxfdkroQjEy.png)

### 自定义算子工程编译部署

最主要的是在`<ASCEND_CANN_PACKAGE_PATH>/opp/vendors/customize/op_impl/ai_core/tbe`目录下会有一些目录，包含AscendC算子源码，以及编译好的文件以及host侧编译好的tiling文件`op_tiling`。另外在op_host侧定义了原型库的定义与注册，`op_proto`会生成相应的proto_api与工程。

![自定义算子工程编译部署](https://s2.loli.net/2025/10/18/KhcPDrXzBWYkifN.png)

## REF

1. Huawei w3
2. Huawei ilearning
3. <https://www.hiascend.com/document/detail/zh/canncommercial/80RC3/devaids/opdev/optool/atlasopdev_16_0018.html>
