---
title: "CMU-15213-ArchitectureLab"
pubDatetime: 2025-08-24T20:29:00Z
description: "CMU 15-213 课程 Architecture Lab 实验记录，基于 Y86-64 指令集实现流水线处理器的设计与优化。"
slug: "cmu-15213-architecturelab"
draft: false
tags:
  - "CMU15213"
  - "c"
  - "x86-64"
  - "指令集"
  - "流水线处理器"
---
# ArchitectureLab

## Declaration

本文使用了 AIGC 来提高效率，其中可能存在谬误，我已尽力检查并校对，但仍不保证完全准确，欢迎指正。

按照惯例看write-up和Lab handout当中的文件。

## Target

- 通过实现一个简化版的 x86-64（叫 Y86-64）的处理器，理解 流水线处理器设计 的基本原理。
- 在实验中，你会从 顺序执行 → 流水线执行 → 优化流水线（转发、stall、bubble 等） 一步步实现。

- Part A：编写和理解 Y86-64 程序（类似汇编），在仿真器 yas 和 yis 中运行。

- Part B：修改硬件实现（顺序 CPU → 流水线 CPU），主要修改 Verilog 或 HCL（硬件控制语言）代码。

- Part C：实现转发逻辑和 hazard 处理，让流水线正确执行各种指令。

- Bonus（可选）：增加新指令或优化执行。

## Keys

- 流水线五级结构：Fetch → Decode → Execute → Memory → Writeback。

- 数据冒险 (Data Hazard)：需要使用 数据转发 (Forwarding) 或 stall/bubble 来解决。

- 控制冒险 (Control Hazard)：分支预测失败时需要 flush 流水线。

- HCL（Hardware Control Language）：这是 lab 的核心工具，用来写 CPU 的电路行为。

## The Obscure Topic

**yas**: `Y86 assmbler` 编译器,把 `.ys` 汇编程序转成 `.yo` 机器码

**yis**: `Y86 instruction set simulator` 命令执行模拟器,执行 `.yo` 文件，模拟 CPU 执行过程

**misc**: `miscellaneous` 意味杂七杂八的，通常作为辅助工具，额外的脚本和小程序，非核心代码

**hcl**: `Hardware Control Language` 转换器，把你写的 .hcl 电路描述翻译成 C 程序，便于编译和仿真

**.hcl**: 它是一种简化的硬件描述语言，用来描述 Y86-64 CPU 的数据通路和控制逻辑。

```perl
pipe-full.hcl  --hcl2c-->  pipe-full.c  --gcc-->  pipe-full (可执行模拟器)
```

**.lex**: `Lex specification`（词法分析器描述文件），由 Flex 工具(见[前置软件](#makefile-problem)处安装)处理。`.lex` 文件用来定义如何把输入文本（比如汇编源代码、HCL 代码）**分解成一个个词法单元（token）**，供语法分析器使用。

**isa**: `Instruction Set Architecture implementation`（指令集实现）

  这是 Y86-64 的“指令集定义代码”，相当于解释器，规定了每条指令的含义和执行方式。

​  在 misc/ 目录下，它和 yis.c 配合使用。

  yis.c 是模拟器的框架，isa.c 提供了指令级别的具体实现。

  比如 isa.c 里会有类似：

 ```c
case I_ADDQ:
  val = get_reg(ra) + get_reg(rb);
  set_reg(rb, val);
  break;
 ```

**Y86指令集**: 为csapp自定义的一套指令集，具体在CS:APP（第三版）第四章 S4.1 - S4.2部分有阐述。包括

- 数据传送指令（`rrmovq`, `irmovq`, `mrmovq`, `rmmovq`）
- 算术/逻辑指令（`addq`, `subq`, `andq`, `xorq`）
- 跳转指令（`jmp`, `jle`, `jl`, `je`, `jne`, `jge`, `jg`）
- 条件传送指令（`cmovXX`）
- 调用/返回指令（`call`, `ret`）
- 栈操作（`pushq`, `popq`）
- 停止指令（`halt`, `nop`）

| 类别   | 指令示例              | 说明                             |
| ---- | ----------------- | ------------------------------ |
| 数据传送 | `rrmovq rA,rB`    | rB ← rA                        |
|      | `irmovq V,rB`     | rB ← V                         |
|      | `mrmovq D(rB),rA` | rA ← M\[rB+D]                  |
|      | `rmmovq rA,D(rB)` | M\[rB+D] ← rA                  |
| 算术逻辑 | `addq rA,rB`      | rB ← rB + rA                   |
|      | `subq rA,rB`      | rB ← rB - rA                   |
|      | `andq rA,rB`      | rB ← rB & rA                   |
|      | `xorq rA,rB`      | rB ← rB ^ rA                   |
| 跳转   | `jmp Dest`        | 无条件跳转                          |
|      | `je Dest`         | ZF=1 时跳转                       |
|      | `jne Dest`        | ZF=0 时跳转                       |
| 栈操作  | `pushq rA`        | %rsp ← %rsp - 8; M\[%rsp] ← rA |
|      | `popq rA`         | rA ← M\[%rsp]; %rsp ← %rsp + 8 |
| 调用   | `call Dest`       | pushq %rip; jmp Dest           |
|      | `ret`             | popq %rip                      |
| 特殊   | `halt`            | 停止执行                           |
|      | `nop`             | 空操作                            |

详细指令集查看`isa.c`与`isa.h`也有定义。但是注意，复杂的调用语句例如 `0x0(%rbp, %rsi, 1)` 的调用方法仍需要查看具体实现或直接进行尝试。

不建议在这个部分（指令集）花太多时间，实在不行就换一种实现方式

## Pre Experiments

通过一个程序调度了解`yas`，`yis`的实际使用。

```shell
cd ./misc
./yas ../y86-code/asum.ys # 编译
./yis ../y86-code/asum.yo # 执行
```

该程序的功能是累加array的数值。

输出如下

```shell
Stopped in 34 steps at PC = 0x13.  Status 'HLT', CC Z=1 S=0 O=0
Changes to registers:
%rax:   0x0000000000000000      0x0000abcdabcdabcd
%rsp:   0x0000000000000000      0x0000000000000200
%rdi:   0x0000000000000000      0x0000000000000038
%r8:    0x0000000000000000      0x0000000000000008
%r9:    0x0000000000000000      0x0000000000000001
%r10:   0x0000000000000000      0x0000a000a000a000

Changes to memory:
0x01f0: 0x0000000000000000      0x0000000000000055
0x01f8: 0x0000000000000000      0x0000000000000013
```

可见rax中的返回值为array数组的四个数据累和`0x0000abcdabcdabcd`。
同时给出的信息还有被更改的寄存器以及更改的内存。

`PC`: 该数值指出模拟器执行了多少条指令
`Status 'HLT'`: 表明程序因找到halt指令而终止，如果出错（例如非法指令，地址越界），这里会显示ADR、INS等错误状态
`CC Z=1 S=0 O=0`: 表明标志寄存器的状态，`CC`即 Condition Codes
`Changs`: 依照`<addr>: <start_val> <end_val>`的方式列出`registers`与`memory`的更改

> 下面的Changs to memory是程序对栈的更改

下面的任务中，凡是`ys`相关代码，都存放在`./y86-code`目录中

## Part A

> Your task is to write and simulate the following three Y86-64 programs. The required behavior of these programs is defined by the example C functions in examples.c. Be sure to put your name and ID in a comment at the beginning of each program. You can test your programs by first assemblying them with the program YAS and then running them with the instruction set simulator YIS.
>
>In all of your Y86-64 functions, you should follow the x86-64 conventions for passing function arguments, using registers, and using the stack. This includes saving and restoring any callee-save registers that you use.

这一部分的内容主要在`./sim/misc`中进行，c语言逻辑存放在 `examples.c` 文件中。

- 编写 Y86-64 汇编程序，并使用 yas（Y86 assembler）和 yis（Y86 instruction set simulator）进行汇编和运行。

- 熟悉 Y86-64 指令集，理解它和 x86-64 的关系。

- 最终任务：写出几个小程序，完成给定的功能（比如算阶乘、数组操作、递归调用等）。

### sum.ys 迭代求和链表元素

简单编写一份汇编代码

```assembly
# Execution begins at address 0
 .pos 0 
 irmovq stack,%rsp
 call main
 halt

# Sample linked list
 .align 8
 ele1:
  .quad 0x00a
  .quad ele2
 ele2:
  .quad 0x0b0
  .quad ele3
 ele3:
  .quad 0xc00
  .quad 0

main: irmovq ele1,%rdi
 call rsum_list
 ret

# long rsum_list(list_ptr ls)
# start in %rdi, end in $0
sum_list: irmovq $0,%rax   # val=0
 jmp test          # Goto test
loop:  mrmovq (%rdi), %rsi  # Get ls->val
  addq %rsi, %rax      # val += ls->val
  mrmovq 8(%rdi), %rdi   # ls = ls->next
test: 
 andq %rdi, %rdi      # Set CC
 jne  loop        # Stop when next=0
 ret
 
# Stack starts here and grows to lower addresses
 .pos 0x200
stack:

```

需要注意的是

- 这里的数据存储的order，可见地址位应该是存放在高32位的，这也就是说8(%rdi)才是next
- 这里的8(%rdi)也可以改成 0x8(%rdi)

当编译时可能会遇到报错，与gcc的编译报错类似，会提示在哪一行出现的错误和可能的原因

```shell
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/misc$ ./yas ../y86-code/sum.ys 
Error on line 30: Missing Colon
Line 30, Byte 0x0085:   xor 1(%rdi) 1(rdi)                              # Set CC
Error on line 37: Missing end-of-line on final line

Line 37, Byte 0x0200:   .pos 0x200
```

### rsum.ys 反向遍历求和链表元素

```assembly
# Execution begins at address 0
 .pos 0 
 irmovq stack,%rsp
 call main
 halt

# Sample linked list
 .align 8
 ele1:
  .quad 0x00a
  .quad ele2
 ele2:
  .quad 0x0b0
  .quad ele3
 ele3:
  .quad 0xc00
  .quad 0

main: irmovq ele1,%rdi
 call rsum_list
 ret

# long rsum_list(list_ptr ls)
# start in %rdi, end in $0
rsum_list: andq %rdi,%rdi # Set CC if(ls)
 je end         # End recursion
 mrmovq (%rdi),%rsi      # rest=ls->val
 pushq %rsi       # Storage rest
 mrmovq 8(%rdi),%rdi   # ls = ls->next
 call rsum_list     # call rsum_list
 popq %rsi       # Get rest
 addq %rsi,%rax     # return val + rest
 ret
end: xorq %rax,%rax    # return 0
 ret
 
# Stack starts here and grows to lower addresses
 .pos 0x200
stack:

```

需要注意的点如下：

1. 这里的递归调用与c中的递归调用存在一些逻辑上的区别,在c中ls这个参数在一个rsum_list调用中式不会被改变的，而在这个程序中，则在每个rsum_list中都被改变了
2. y86的语法，如果希望使用`D(r)`的语法只能通过`mrmovX`或`rmmovX`。

更符合原著的方式如下

```assembly
# Execution begins at address 0
 .pos 0 
 irmovq stack,%rsp
 call main
 halt

# Sample linked list
 .align 8
 ele1:
  .quad 0x00a
  .quad ele2
 ele2:
  .quad 0x0b0
  .quad ele3
 ele3:
  .quad 0xc00
  .quad 0

main: irmovq ele1,%rdi
 call rsum_list
 ret

# long rsum_list(list_ptr ls)
# start in %rdi, end in $0
rsum_list: andq %rdi,%rdi # Set CC if(ls)
 je end         # End recursion
 # mrmovq (%rdi),%rsi      # rest=ls->val
 # pushq %rsi       # Storage rest
 pushq %rdi
 mrmovq 8(%rdi),%rdi   # ls = ls->next
 call rsum_list     # call rsum_list
 # popq %rsi       # Get rest
 popq %rdi
 # addq %rsi,%rax     # return val + rest
 mrmovq (%rdi),%rsi
 addq %rsi,%rax
 ret
end: xorq %rax,%rax    # return 0
 ret
 
# Stack starts here and grows to lower addresses
 .pos 0x200
stack:

```

可以参考一下[REF](#ref) 2中的代码

看一下下面这一份的输出，正确的

```shell
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/y86-code$ ../misc/yis ./rsum.yo
Stopped in 37 steps at PC = 0x13.  Status 'HLT', CC Z=0 S=0 O=0
Changes to registers:
%rax:   0x0000000000000000      0x0000000000000cba
%rsp:   0x0000000000000000      0x0000000000000200
%rsi:   0x0000000000000000      0x000000000000000a
%rdi:   0x0000000000000000      0x0000000000000018

Changes to memory:
0x01c0: 0x0000000000000000      0x000000000000007c
0x01c8: 0x0000000000000000      0x0000000000000038
0x01d0: 0x0000000000000000      0x000000000000007c
0x01d8: 0x0000000000000000      0x0000000000000028
0x01e0: 0x0000000000000000      0x000000000000007c
0x01e8: 0x0000000000000000      0x0000000000000018
0x01f0: 0x0000000000000000      0x000000000000005b
0x01f8: 0x0000000000000000      0x0000000000000013
```

### copy.ys 复制long数组，并返回所有数值的异或和

直接给出正确的代码与输出

```assembly
# Execution begins at address 0
 .pos 0 
 irmovq stack,%rsp
 call main
 halt

.align 8
# Source block
src:
 .quad 0x00a
 .quad 0x0b0
 .quad 0xc00
# Destination block
dest:
 .quad 0x111
 .quad 0x222
 .quad 0x333

main: irmovq src,%rdi
 irmovq dest,%rsi
 irmovq $3,%rdx
 call copy_block
 ret

# long copy_block(long* src, long dest, long len)
# start in rdi with length rdx
copy_block: irmovq $0,%rax # result = 0
 andq %rdx,%rdx      # Set CC
 irmovq $1,%rcx       # Constant 1
 irmovq $8,%rbp      # Constant 8
 jmp  test
loop: mrmovq (%rdi),%r8   # val = *src 
 addq %rbp,%rdi   # src++
 rmmovq %r8,(%rsi)     # dest = val
 addq %rbp,%rsi   # dest++
 xorq %r8,%rax       # result ^= val
 subq %rcx,%rdx       # len--. Set CC
test: jne loop       # Stop when len == 0
 ret

# Stack starts here and grows to lower addresses
.pos 0x200
stack:

```

```shell
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/y86-code$ ../misc/yis ./copy.yo
Stopped in 36 steps at PC = 0x13.  Status 'HLT', CC Z=1 S=0 O=0
Changes to registers:
%rax:   0x0000000000000000      0x0000000000000cba
%rcx:   0x0000000000000000      0x0000000000000001
%rsp:   0x0000000000000000      0x0000000000000200
%rbp:   0x0000000000000000      0x0000000000000008
%rsi:   0x0000000000000000      0x0000000000000048
%rdi:   0x0000000000000000      0x0000000000000030
%r8:    0x0000000000000000      0x0000000000000c00

Changes to memory:
0x0030: 0x0000000000000111      0x000000000000000a
0x0038: 0x0000000000000222      0x00000000000000b0
0x0040: 0x0000000000000333      0x0000000000000c00
0x01f0: 0x0000000000000000      0x000000000000006f
0x01f8: 0x0000000000000000      0x0000000000000013
```

当我编写汇编代码时犯了一个错误，使用mrmovq 0x8(%rdi), %rdi代替了addq %rbp,%rdi（irmovq $8,%rbp）。但前者时取出0x8(%rdi)地址处的值将其放在rdi中，而后者则是正确的。

如果用c来表述`ptr = ptr->next`是前者，而`ptr++`是后者

## Part B

![sim](https://s2.loli.net/2025/10/11/1pZlFVSqyL3O4zg.png)

> You will be working in directory sim/seq in this part.
> Your task in Part B is to extend the SEQ processor to support the iaddq, described in Homework problems 4.51 and 4.52. To add this instructions, you will modify the file seq-full.hcl, which implements the version of SEQ described in the CS:APP3e textbook. In addition, it contains declarations of some constants that you will need for your solution.

这里需要我们在SEQ处理器上完成`iaddq`指令，主要修改hcl文件中的控制逻辑，涉及“CS:APP”中的部分内容。在国内常规学校开设的课程中，多多少少会涉及到PC等寄存器和处理器框架，这里还是建议读一下“CS:APP”，如果只想了解lab如何完成，请往下看。

下面是逐级复杂的三张相互关联的图

SEQ的抽象视图如下所示

![SEQ](https://s2.loli.net/2025/09/27/1sYpTiumqnoDZF8.png)

SEQ的顺序硬件实现如下所示

![SEQ的顺序硬件实现](https://s2.loli.net/2025/09/27/A8PWBUQwTgtk95J.png)

这里的简化CPU架构图如下图所示

![CPU Architecture](https://s2.loli.net/2025/09/27/jbWuU4BYyg8LTvh.png)

通常一个指令的执行分为以下**五个阶段**。

1. 取址（Fetch）：根据PC的值读入指令字节。每一条指令长短不一，但都规范化为几个结构（在Y86中 RISA架构处理器）

2. 译码（Decode）：在这个阶段，处理器解码指令以确定其操作类型以及操作数的来源。译码的目的是解析指令的各个字段，比如操作码、寄存器操作数等，确保处理器能够理解并准备好执行指令。

3. 执行（Execute）：在这个阶段，处理器执行指令的运算部分。对于算术运算，执行阶段会使用算术逻辑单元（ALU）进行计算；对于跳转指令，计算新的程序计数器值。

4. 访存（Memory Access）：如果指令需要访问内存（如加载或存储指令），则在这个阶段处理内存操作。对于 load 指令，数据从内存加载到寄存器；对于 store 指令，数据从寄存器写入内存。

5. 写回（Writeback）：在写回阶段，执行结果被写回到寄存器或内存。比如，在计算完成后，将计算结果写回寄存器。

这里的五个阶段与MIPS（Microprocessor without Interlocked Pipeline Stages） 是一种基于 RISC（精简指令集计算机） 设计的处理器架构的五个流程保持一致，但在一些地方，会省略掉`Memory Access`的过程，将其并入Execute。

如果你对**现代微处理器**的机制并不熟悉，例如不理解ILP，分支预测等，建议阅读<https://www.lighterra.com/papers/modernmicroprocessors/>

> 这里插叙一下`clock`与`pipeline parallel`的机制
>
> ![img](https://s2.loli.net/2025/09/27/AJy8am4MXcRHKDE.png)
>
> ![img](https://s2.loli.net/2025/09/27/JkTI6NgZG7USVWY.png)
>
> Now the processor is completing 1 instruction every cycle (CPI = 1). This is a four-fold speedup without changing the clock speed at all.
>
> From the hardware point of view, each pipeline stage consists of some combinatorial logic and possibly access to a register set and/or some form of high-speed cache memory. The pipeline stages are separated by latches. A common clock signal synchronizes the latches between each stage, so that all the latches capture the results produced by the pipeline stages at the same time. In effect, the clock "pumps" instructions down the pipeline.\
>
> 实际上，时钟将指令“泵入”管道。
>
> 通过更加细化不同执行阶段
>
> ![img](https://s2.loli.net/2025/09/27/gIJ3HwzkFBrf1qD.png)
>
> 实际上可以构建更高的`clock speeds`但是这样降低对数据、控制依赖指令的兼容程度并会增大指令延迟
>
> 在superscalar处理器上，instruction flow belike
>
> ![img](https://s2.loli.net/2025/09/27/gkwimpjxCAobKXQ.png)
>
> 今天的所有处理器几乎都集成了上面两种技术，得到的instruction flow belike,现在简单的将`superpipeline`和`superscalar`称为`superscalar`
>
> ![img](https://s2.loli.net/2025/09/27/tk2QfYmZyzeA4p9.png)

对于一条指令而言，通用执行数据流图如下所示：

![opt](https://s2.loli.net/2025/09/27/dZfxvXYDnCJuS7B.png)

可以推测出iaddq的指令流程应该如下所示

``` text
#  iaddq V,rB
#phaseFetch
# icode:ifun <-- M1[PC]
# rB <-- M1[PC+1]
# valC <-- M8[PC+2]
# valP <-- PC+10
#phaseDecode
# valB <-- R[rB]
#phaseExecute
# valE <-- valC+valB
# set CC
#phaseMemory
# 
#phaseWriteBack
# R[rB] <-- valE
#phaseUpdatePC
# PC <-- valP
```

接下来所有工具文件以及修改的源代码文件都在**lab文件`Architecture-Lab/sim/seq`**文件夹中。

在修改完`seq-full.hcl`文件后，我们需要在目录`Architecture-Lab/sim/seq`下使用其中的makefile文件编译该新的处理器模拟程序，其中模拟程序可以选择tty模式和gui模式，gui模式为makefile文件设置的默认模式，gui模式可以进行单步调试，但需要先安装tty等依赖包，所以我选的是tty模式，可以直接编译该程序而不需要安装依赖包。
改为tty模式的操作就是打开makefile文件并注释掉其中的GUIMODE、TKLIBS和TKINC变量。
在终端程序的`Architecture-Lab/sim/seq`目录下输入指令make VERSION=full来编译新的处理器模拟程序。

编译出了新的处理器模拟程序后，我们需要两轮的漏洞测试（不会测试新加的指令），测试新加的指令会不会使其处理器模拟程序产生漏洞，在终端程序的`Architecture-Lab/sim/seq`目录下先后输入指令`./ssim -t ../y86-code/asumi.yo`和`cd ../y86-code; make testssim`来进行小型和大型漏洞测试。
漏洞测试都通过后就可以测试新加指令的逻辑问题了，在终端程序的`Architecture-Lab/sim/seq`目录下先后输入指令`cd ../ptest; make SIM=../seq/ssim TFLAGS=-i`来进行。
只有这三个测试全部通过才算完成该关。

接下来修改`seq-full.hcl`文件，初见这个文件好像很复杂，实际上理解了程序在处理器中执行的四个基本过程、寄存器与内存之间的交互根据注释还是能够理解整个文件的。

```hcl
## Your task is to implement the iaddq instruction
## The file contains a declaration of the icodes
## for iaddq (IIADDQ)
## Your job is to add the rest of the logic to make it work
```

从这个文件开头的注释中我们可以发现，所有的命令例如`addq`,`mrmovq`...在hcl都有一个由全大写字母组成的类宏定义名称，通过该名称指代我们涉及的命令。

跳过一些不允许我们更改的hcl代码。然后会注意到这样的一个开头

```hcl
####################################################################
#    Control Signal Definitions.                                   #
####################################################################

################ Fetch Stage     ###################################
```

可以发现`Control Signal Definitions`正是定义命令的区域，其中`Fetch Stage`正是命令定义的第一个阶段。然后转移注意力到第一个定义。

```hcl
# Determine instruction code
word icode = [
 imem_error: INOP;
 1: imem_icode;  # Default: get from instruction memory
];

# Determine instruction function
word ifun = [
 imem_error: FNONE;
 1: imem_ifun;  # Default: get from instruction memory
];
```

一个列表一样的结构分割了一些命令，典型的是icode中的INOP，在书中有提到1在hcl中是默认值。可以注意到imem_code, imem_ifun应是直接从指令内存中提取的变量，INOP由于是空指令不执行任何命令被放在了imem_error位置，而ifun则是FNONE类似一个空指令的表达。

```hcl
bool instr_valid = icode in 
 { INOP, IHALT, IRRMOVQ, IIRMOVQ, IRMMOVQ, IMRMOVQ,
        IOPQ, IJXX, ICALL, IRET, IPUSHQ, IPOPQ, IIADDQ };

# Does fetched instruction require a regid byte?
bool need_regids =
 icode in { IRRMOVQ, IOPQ, IPUSHQ, IPOPQ, 
       IIRMOVQ, IRMMOVQ, IMRMOVQ, IIADDQ };

# Does fetched instruction require a constant word?
bool need_valC =
 icode in { IIRMOVQ, IRMMOVQ, IMRMOVQ, IJXX, ICALL, IIADDQ };

```

这里通过类似python中集合的操作在指定bool值，此时可以加上IIADDQ。

...

---

在照猫画虎的根据`iaddq`的指令流程设计完所有阶段后即可开始测试，这里贴一段原文

![test](https://s2.loli.net/2025/10/10/iVRMwxhl7O9Kvjg.png)

在这里有两条指令可能由于年代原因出现错误，分别关于`tk`\\`tcl`, `gui forwarding`

```sh
make VERSION=full
./sim -g ../y86-code/asumi.yo
```

其中，根据[GUI问题部分](#gui-forwarding-problem)，解决一些问题后，应该在`./sim -g ../y86-code/asumi.yo`命令下可见如下界面

![gui](https://s2.loli.net/2025/10/10/MUbyQrIG3jCs9za.png)

网络上很多blog都没有给出这个界面，感觉可能是因为他们一遍就过了，没有用到调试或者懒得讲图形化界面。

根据这里的可视化样例重新理解一下整个`sequence`流程。

首先回顾一下这里的asumi.yo，整个程序非常简单就是使用iaddq重构了数组求和的算法。

然后看一下另外一个比较复杂的模型界面

![seq-gui](https://s2.loli.net/2025/10/10/c61dSMzalIEVhtw.png)

在这个界面中模拟了程序在五个阶段中的运行过程。几个控制按钮基本对应gdb的控制风格，主要用step单步运行就好了。

![asumi](https://s2.loli.net/2025/10/10/rWKGO7g1FbRSdoB.png)

一般不会有什么问题。这里简单看一下，如果有错误，进行修改。

然后通过`(cd ../y86-code/; make testssim)`命令进行一个简单正确性测试测试。
出现下面的终端输出就是正常运行了。

```sh
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/seq$ (cd ../y86-code/; make testssim)
Makefile:42: warning: ignoring prerequisites on suffix rule definition
Makefile:45: warning: ignoring prerequisites on suffix rule definition
Makefile:48: warning: ignoring prerequisites on suffix rule definition
Makefile:51: warning: ignoring prerequisites on suffix rule definition
../seq/ssim -t asum.yo > asum.seq
../seq/ssim -t asumr.yo > asumr.seq
../seq/ssim -t cjr.yo > cjr.seq
../seq/ssim -t j-cc.yo > j-cc.seq
../seq/ssim -t poptest.yo > poptest.seq
../seq/ssim -t pushquestion.yo > pushquestion.seq
../seq/ssim -t pushtest.yo > pushtest.seq
../seq/ssim -t prog1.yo > prog1.seq
../seq/ssim -t prog2.yo > prog2.seq
../seq/ssim -t prog3.yo > prog3.seq
../seq/ssim -t prog4.yo > prog4.seq
../seq/ssim -t prog5.yo > prog5.seq
../seq/ssim -t prog6.yo > prog6.seq
../seq/ssim -t prog7.yo > prog7.seq
../seq/ssim -t prog8.yo > prog8.seq
../seq/ssim -t ret-hazard.yo > ret-hazard.seq
grep "ISA Check" *.seq
asum.seq:ISA Check Succeeds
asumr.seq:ISA Check Succeeds
cjr.seq:ISA Check Succeeds
j-cc.seq:ISA Check Succeeds
poptest.seq:ISA Check Succeeds
prog1.seq:ISA Check Succeeds
prog2.seq:ISA Check Succeeds
prog3.seq:ISA Check Succeeds
prog4.seq:ISA Check Succeeds
prog5.seq:ISA Check Succeeds
prog6.seq:ISA Check Succeeds
prog7.seq:ISA Check Succeeds
prog8.seq:ISA Check Succeeds
pushquestion.seq:ISA Check Succeeds
pushtest.seq:ISA Check Succeeds
ret-hazard.seq:ISA Check Succeeds
rm asum.seq asumr.seq cjr.seq j-cc.seq poptest.seq pushquestion.seq pushtest.seq prog1.seq prog2.seq prog3.seq prog4.seq prog5.seq prog6.seq prog7.seq prog8.seq ret-hazard.seq
```

再通过`(cd ../ptest; make SIM=../seq/ssim)`进行回归测试，测试在添加`iaddq`时，其他指令是否会受它的影响。

```sh
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/seq$ (cd ../ptest; make SIM=../seq/ssim)
./optest.pl -s ../seq/ssim 
Simulating with ../seq/ssim
  All 49 ISA Checks Succeed
./jtest.pl -s ../seq/ssim 
Simulating with ../seq/ssim
  All 64 ISA Checks Succeed
./ctest.pl -s ../seq/ssim 
Simulating with ../seq/ssim
  All 22 ISA Checks Succeed
./htest.pl -s ../seq/ssim 
Simulating with ../seq/ssim
  All 600 ISA Checks Succeed
```

```sh
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/seq$ (cd ../ptest; make SIM=../seq/ssim TFLAGS=-i)
./optest.pl -s ../seq/ssim -i
Simulating with ../seq/ssim
  All 58 ISA Checks Succeed
./jtest.pl -s ../seq/ssim -i
Simulating with ../seq/ssim
  All 96 ISA Checks Succeed
./ctest.pl -s ../seq/ssim -i
Simulating with ../seq/ssim
  All 22 ISA Checks Succeed
./htest.pl -s ../seq/ssim -i
Simulating with ../seq/ssim
  All 756 ISA Checks Succeed
```

做到这里PartB也就结束了，接下来是比较困难的PartC

### Part B 一些附图

![寄存器编码](https://s2.loli.net/2025/09/05/CQciPtuRYyqwxb4.png)
![指令类别](https://s2.loli.net/2025/09/05/4oZQvaKGPj3RA6m.png)
![指令字节码](https://s2.loli.net/2025/09/05/WUGHaL32rOwBeV5.png)

## Part C

**注意这部分的代码中`ncopy.c`文件中有一处错误，len应该在任何循环分支中都--，缩进是对的**

这一部分需要在`sim/pipe`文件夹中做修改。

整个任务描述比较复杂，面向结果的话，我们需要提升 `benchmark.pl` 测试的分数，并且同时保证 `correctness.pl` 的正确性。
在benchmark中，分数计算以一个重要指标CPE计算，该值是`cycles per element` 指平均复制一个元素需要的时钟周期，例如对于N个元素需要N个始终周期的话，该值就是$C/N$，对于一次 63 element的复制操作花费了 897 个cycles，即CPE值为14.24，而该值对`Score`的折算需要用一个公式表示

![score](https://s2.loli.net/2025/10/11/QYpdvCM4FJtAETZ.png)

我们可以修改所有文件，除了注释的地方，尤其需要提高注意力的是`ncopy.ys`、`pipe-full.hcl`文件。==有关整体的`coding rules`建议看一看handout中的描述，网上blog大多都不全==。

首先我们用

```sh
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/pipe$ (cd ../ptest; make SIM=../pipe/psim)
./optest.pl -s ../pipe/psim
Simulating with ../pipe/psim
  All 49 ISA Checks Succeed
./jtest.pl -s ../pipe/psim
Simulating with ../pipe/psim
  All 64 ISA Checks Succeed
./ctest.pl -s ../pipe/psim
Simulating with ../pipe/psim
  All 22 ISA Checks Succeed
./htest.pl -s ../pipe/psim
Simulating with ../pipe/psim
  All 600 ISA Checks Succeed
```

这个可以用于测试所有除`iaddq`以外的命令，这里是完全正确没有任何错误的，这和我们的预期是一致的，因为我们没有修改任何代码。

首先我们需要在psim这一个模拟器中也加上`iaddq`指令，并使用

```sh
# 使用benchmark测试代码测试包括iaddq指令在内的所有指令
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/pipe$ (cd ../ptest; make SIM=../pipe/psim TFLAGS=-i)
./optest.pl -s ../pipe/psim -i
Simulating with ../pipe/psim
Test op-iaddq-256-rdx failed
Test op-iaddq-32-rdx failed
Test op-iaddq-4-rdx failed
Test op-iaddq-256-rbx failed
Test op-iaddq-32-rbx failed
Test op-iaddq-4-rbx failed
Test op-iaddq-256-rsp failed
Test op-iaddq-32-rsp failed
Test op-iaddq-4-rsp failed
  9/58 ISA Checks Failed
./jtest.pl -s ../pipe/psim -i
Simulating with ../pipe/psim
Test ji-jmp-32-32 failed
Test ji-jmp-32-64 failed
Test ji-jmp-64-32 failed
Test ji-jmp-64-64 failed
Test ji-jle-32-32 failed
Test ji-jle-32-64 failed
Test ji-jle-64-32 failed
Test ji-jle-64-64 failed
Test ji-jl-32-32 failed
Test ji-jl-32-64 failed
Test ji-jl-64-32 failed
Test ji-jl-64-64 failed
Test ji-je-32-32 failed
Test ji-je-32-64 failed
Test ji-je-64-32 failed
Test ji-je-64-64 failed
Test ji-jne-32-32 failed
Test ji-jne-32-64 failed
Test ji-jne-64-32 failed
Test ji-jne-64-64 failed
Test ji-jge-32-32 failed
Test ji-jge-32-64 failed
Test ji-jge-64-32 failed
Test ji-jge-64-64 failed
Test ji-jg-32-32 failed
Test ji-jg-32-64 failed
Test ji-jg-64-32 failed
Test ji-jg-64-64 failed
Test ji-call-32-32 failed
Test ji-call-32-64 failed
Test ji-call-64-32 failed
Test ji-call-64-64 failed
  32/96 ISA Checks Failed
./ctest.pl -s ../pipe/psim -i
Simulating with ../pipe/psim
  All 22 ISA Checks Succeed
./htest.pl -s ../pipe/psim -i
Simulating with ../pipe/psim
  All 756 ISA Checks Succeed

```

这里完全不对原文件进行修改下，在Ubuntu24系统下的测试结果，和很多网上的blog相反的是，这里也有`All 756 ISA Check Success`，但是我并没有写iaddq，因此单纯看这个无疑是错误的。同时我们也会注意到有jtest中的很多错误，这里可能与iaddq有关，但网上也有人不去管这部分测试，截至目前，不去理会。

接下来修改pipe-full.hcl，在进行如下修改后

```hcl
# Is instruction valid?
bool instr_valid = f_icode in 
 { INOP, IHALT, IRRMOVQ, IIRMOVQ, IRMMOVQ, IMRMOVQ,
   IOPQ, IJXX, ICALL, IRET, IPUSHQ, IPOPQ, IIADDQ };
   
# Does fetched instruction require a regid byte?
bool need_regids =
 f_icode in { IRRMOVQ, IOPQ, IPUSHQ, IPOPQ, 
       IIRMOVQ, IRMMOVQ, IMRMOVQ, IIADDQ };


# Does fetched instruction require a constant word?
bool need_valC =
 f_icode in { IIRMOVQ, IRMMOVQ, IMRMOVQ, IJXX, ICALL, IIADDQ };

## What register should be used as the B source?
word d_srcB = [
 D_icode in { IOPQ, IRMMOVQ, IMRMOVQ, IIADDQ } : D_rB;
 D_icode in { IPUSHQ, IPOPQ, ICALL, IRET } : RRSP;
 1 : RNONE;  # Don't need register
];

## What register should be used as the E destination?
word d_dstE = [
 D_icode in { IRRMOVQ, IIRMOVQ, IOPQ, IIADDQ} : D_rB;
 D_icode in { IPUSHQ, IPOPQ, ICALL, IRET } : RRSP;
 1 : RNONE;  # Don't write any register
];

## Select input A to ALU
word aluA = [
 E_icode in { IRRMOVQ, IOPQ } : E_valA;
 E_icode in { IIRMOVQ, IRMMOVQ, IMRMOVQ, IIADDQ } : E_valC;
 E_icode in { ICALL, IPUSHQ } : -8;
 E_icode in { IRET, IPOPQ } : 8;
 # Other instructions don't need ALU
];

## Select input B to ALU
word aluB = [
 E_icode in { IRMMOVQ, IMRMOVQ, IOPQ, ICALL, 
       IPUSHQ, IRET, IPOPQ, IIADDQ } : E_valB;
 E_icode in { IRRMOVQ, IIRMOVQ } : 0;
 # Other instructions don't need ALU
];
```

获得了如下结果

```sh
./optest.pl -s ../pipe/psim -i
Simulating with ../pipe/psim
Test op-iaddq-256-rdx failed
Test op-iaddq-4-rdx failed
Test op-iaddq-256-rbx failed
Test op-iaddq-4-rbx failed
Test op-iaddq-256-rsp failed
Test op-iaddq-4-rsp failed
  6/58 ISA Checks Failed
./jtest.pl -s ../pipe/psim -i
Simulating with ../pipe/psim
Test ji-jle-64-32 failed
Test ji-jl-32-64 failed
Test ji-je-32-64 failed
Test ji-je-64-32 failed
Test ji-jne-32-64 failed
Test ji-jne-64-32 failed
Test ji-jge-32-64 failed
Test ji-jg-64-32 failed
  8/96 ISA Checks Failed
./ctest.pl -s ../pipe/psim -i
Simulating with ../pipe/psim
  All 22 ISA Checks Succeed
./htest.pl -s ../pipe/psim -i
Simulating with ../pipe/psim
  All 756 ISA Checks Succeed
```

注意到并没有任何变化，在我的简单尝试下，更改hcl至完全不可能正确的代码下，结果也没有任何改变。而且进行不带TFLAG的测试仍然正确。查询网上blog，甚至有明显错误的hcl代码，并且这个错误也普遍存在

很奇怪的现象。让我们仔细看看，这个pl实际上就是一个批处理，调用同目录下的tester.pm模块。可见该模块使用yas编译，psim模拟运行。尝试对op-iaddq-4-rbx直接进行手动调试得结果如下。

```sh
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/ptest$ ../pipe/psim op-iaddq-4-rbx.yo
Y86-64 Processor: pipe-full.hcl
26 bytes of code read

Cycle 0. CC=Z=1 S=0 O=0, Stat=AOK
F: predPC = 0x0
D: instr = nop, rA = ----, rB = ----, valC = 0x0, valP = 0x0, Stat = BUB
E: instr = nop, valC = 0x0, valA = 0x0, valB = 0x0
   srcA = ----, srcB = ----, dstE = ----, dstM = ----, Stat = BUB
M: instr = nop, Cnd = 0, valE = 0x0, valA = 0x0
   dstE = ----, dstM = ----, Stat = BUB
W: instr = nop, valE = 0x0, valM = 0x0, dstE = ----, dstM = ----, Stat = BUB
        Fetch: f_pc = 0x0, imem_instr = irmovq, f_instr = irmovq
        Execute: ALU: + 0x0 0x0 --> 0x0

Cycle 1. CC=Z=1 S=0 O=0, Stat=AOK
F: predPC = 0xa
D: instr = irmovq, rA = ----, rB = %rbx, valC = 0x4, valP = 0xa, Stat = AOK
E: instr = nop, valC = 0x0, valA = 0x0, valB = 0x0
   srcA = ----, srcB = ----, dstE = ----, dstM = ----, Stat = BUB
M: instr = nop, Cnd = 1, valE = 0x0, valA = 0x0
   dstE = ----, dstM = ----, Stat = BUB
W: instr = nop, valE = 0x0, valM = 0x0, dstE = ----, dstM = ----, Stat = BUB
        Fetch: f_pc = 0xa, imem_instr = nop, f_instr = nop
        Execute: ALU: + 0x0 0x0 --> 0x0

#  .......


12 instructions executed
Status = HLT
Condition Codes: Z=1 S=0 O=0
Changed Register State:
%rbx:   0x0000000000000000      0xffffffffffffffe4
Changed Memory State:
CPI: 8 cycles/8 instructions = 1.00
```

这里是正确的。一定程度上验证了我们的iaddq是有效的，并且测试程序也是有逻辑的。接下来测试一个失败的案例`op-iaddq-4-rdx`,最后的结果如下图

```sh
Cycle 11. CC=Z=1 S=0 O=0, Stat=AOK
F: predPC = 0x1d
D: instr = halt, rA = ----, rB = ----, valC = 0x0, valP = 0x1d, Stat = HLT
E: instr = halt, valC = 0x0, valA = 0x0, valB = 0x0
   srcA = ----, srcB = ----, dstE = ----, dstM = ----, Stat = HLT
M: instr = nop, Cnd = 0, valE = 0x0, valA = 0x0
   dstE = ----, dstM = ----, Stat = BUB
W: instr = halt, valE = 0x0, valM = 0x0, dstE = ----, dstM = ----, Stat = HLT
        Fetch: f_pc = 0x1d, imem_instr = halt, f_instr = halt
        Execute: ALU: + 0x0 0x0 --> 0x0
12 instructions executed
Status = HLT
Condition Codes: Z=1 S=0 O=0
Changed Register State:
%rdx:   0x0000000000000000      0xffffffffffffffe4
Changed Memory State:
CPI: 8 cycles/8 instructions = 1.00
```

通过yis，验证一下结果是否正确

```sh
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/ptest$ ../misc/yis op-iaddq-4-rdx.yo
Stopped in 8 steps at PC = 0x19.  Status 'HLT', CC Z=0 S=1 O=0
Changes to registers:
%rdx:   0x0000000000000000      0xffffffffffffffe4

Changes to memory:
```

可见这里是这里的结果是对的，Z，S的标志位是存在问题的，这里错误的设置了Z标志位，而没有设置S标志位，这说明标志位的设定并不是我们想象中自动设定的。需要反过去看看pipe-full代码。

```hcl
## Should the condition codes be updated?
bool set_cc = E_icode == IOPQ &&
 # State changes only during normal operation
 !m_stat in { SADR, SINS, SHLT } && !W_stat in { SADR, SINS, SHLT };
```

可见我们应该在这一段代码中做一些变化，因为IOPQ实际上并没有包含IIADDQ，尝试将其做出以下修改

```hcl
## Should the condition codes be updated?
bool set_cc = E_icode in { IOPQ, IIADDQ} &&
 # State changes only during normal operation
 !m_stat in { SADR, SINS, SHLT } && !W_stat in { SADR, SINS, SHLT };
```

可见

```sh
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/pipe$ (cd ../ptest; make SIM=../pipe/psim TFLAGS=-i)
./optest.pl -s ../pipe/psim -i
Simulating with ../pipe/psim
  All 58 ISA Checks Succeed
./jtest.pl -s ../pipe/psim -i
Simulating with ../pipe/psim
  All 96 ISA Checks Succeed
./ctest.pl -s ../pipe/psim -i
Simulating with ../pipe/psim
  All 22 ISA Checks Succeed
./htest.pl -s ../pipe/psim -i
Simulating with ../pipe/psim
  All 756 ISA Checks Succeed
```

直接完全正确！
~~只能说不能轻易相信blog~~。

然后介绍以下整个实验的组成。

- `ncopy`: 数组赋值的逻辑代码。
- `*driver`": 带有不同数组数据的驱动文件，使用ncopy 根据不同的前缀决定数组的大小。
- `*.pl`: 包括`correntness.pl`与`benchmark.pl`正确性与性能测试。
- `sim\ptest\`: 有关pipe-full.hcl的基准测试程序。

**接下来就应该尝试对性能的优化**，首先用iaddq直接修改源代码`ncopy.ys`，修改ncopy段代码位如下所示

```assmebly
Loop: mrmovq (%rdi), %r10 # read val from src...
 rmmovq %r10, (%rsi) # ...and store it to dst
 andq %r10, %r10  # val <= 0?
 jle Npos  # if so, goto Npos:
 iaddq $1, %rax  # count++
Npos: irmovq $1, %r10
 iaddq $-1, %rdx  # len--
 iaddq $8, %rdi  # src++
 iaddq $8, %rsi  # dst++
 andq %rdx,%rdx  # len > 0?
 jg Loop   # if so, goto Loop:
```

```sh
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/pipe$ ./correctness.pl
Simulating with instruction set simulator yis
        ncopy
0       OK
1       OK
# ......
68/68 pass correctness test
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/pipe$ ./benchmark.pl
        ncopy
0       13
1       28      28.00
2       42      21.00
3       53      17.67
4       67      16.75
5       78      15.60
6       92      15.33
7       103     14.71
8       117     14.62
9       128     14.22
10      142     14.20
11      153     13.91
12      167     13.92
13      178     13.69
14      192     13.71
15      203     13.53
16      217     13.56
17      228     13.41
18      242     13.44
19      253     13.32
20      267     13.35
21      278     13.24
22      292     13.27
23      303     13.17
24      317     13.21
25      328     13.12
26      342     13.15
27      353     13.07
28      367     13.11
29      378     13.03
30      392     13.07
31      403     13.00
32      417     13.03
33      428     12.97
34      442     13.00
35      453     12.94
36      467     12.97
37      478     12.92
38      492     12.95
39      503     12.90
40      517     12.93
41      528     12.88
42      542     12.90
43      553     12.86
44      567     12.89
45      578     12.84
46      592     12.87
47      603     12.83
48      617     12.85
49      628     12.82
50      642     12.84
51      653     12.80
52      667     12.83
53      678     12.79
54      692     12.81
55      703     12.78
56      717     12.80
57      728     12.77
58      742     12.79
59      753     12.76
60      767     12.78
61      778     12.75
62      792     12.77
63      803     12.75
64      817     12.77
Average CPE     13.70
Score   0.0/60.0
```

好消息，改对了，坏消息，效率**仍然是零蛋**。让人怀疑是否有提升，测试原版。

```sh
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/pipe$ ./benchmark.pl
        ncopy
0       13
1       29      29.00
2       45      22.50
3       57      19.00
4       73      18.25
5       85      17.00
6       101     16.83
7       113     16.14
8       129     16.12
9       141     15.67
10      157     15.70
11      169     15.36
12      185     15.42
13      197     15.15
14      213     15.21
15      225     15.00
16      241     15.06
17      253     14.88
18      269     14.94
19      281     14.79
20      297     14.85
21      309     14.71
22      325     14.77
23      337     14.65
24      353     14.71
25      365     14.60
26      381     14.65
27      393     14.56
28      409     14.61
29      421     14.52
30      437     14.57
31      449     14.48
32      465     14.53
33      477     14.45
34      493     14.50
35      505     14.43
36      521     14.47
37      533     14.41
38      549     14.45
39      561     14.38
40      577     14.43
41      589     14.37
42      605     14.40
43      617     14.35
44      633     14.39
45      645     14.33
46      661     14.37
47      673     14.32
48      689     14.35
49      701     14.31
50      717     14.34
51      729     14.29
52      745     14.33
53      757     14.28
54      773     14.31
55      785     14.27
56      801     14.30
57      813     14.26
58      829     14.29
59      841     14.25
60      857     14.28
61      869     14.25
62      885     14.27
63      897     14.24
64      913     14.27
Average CPE     15.18
Score   0.0/60.0
```

可见CPE确实有两个点的提升。但是由于分数的计算规则，仍然是零分。忍不了了，局部性原理，分支预测，流水线优化，全部启动启动启动！

注意到，在下面的运行过程中，程序做了一个错误的预测

![predic_miss](https://s2.loli.net/2025/10/12/Ko1lq3XsarxECg4.png)

这里的长度是4，但是程序认为应该根据jle的值跳转到Done,显然这样的判断大部分情况下都是错误的。

![BUB](https://s2.loli.net/2025/10/12/qvhMJw5ueciFUZB.png)

出现了一些预测错误的惩罚。由此可以联想到，在对正整数的计数上也会出现这样的预测错误带来的惩罚。从《90分钟现代微处理器》以及CS：APP中我们了解到，这些问题可以由带谓词的操作处理（Opperation with Predication）。但很可惜这里没有提前定义，但也没有命令禁止这样的操作

这里需要看一下CSAPP第5章相关内容。

同时建议看一下.pl文件的处理流程，通过对这些文件的分析，我们可以找到一种针对特定大小数据的性能分析方式

```sh
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/pipe$ ./gen-driver.pl -n 16 -f ncopy.ys > driver.ys
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/pipe$ ../misc/yas driver.ys
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/pipe$ ./psim -v 0 driver.yo
CPI: 123 cycles/100 instructions = 1.23
```

这就是benchmark.pl的基本运行流程，这里使用的数据量大小是16，而CPI则是123cycles/100即1.23，总cycle则是123，由于数据量是16，这里的CPE则是$123/16=7.69$。这个较低的数值是因为在这个测试中我已经使用了4阶的循环展开。对CPE的性能提升（相对于iaddq）则是$(13.56 - 7.69) / 13.56 * 100\% = 43.29 \%$。

这个提升来自ref6，最终benchmark得分是48.6。继续优化的话这种方式的极限是ref7中的方法，考虑循环展开与消除分支预测惩罚。最终受`./check-len.pl < ncopy.yo`这个输出必须小于1000byte的限制，得分是Ave CPE 7.6。得分58.1，与满分CPE相差0.1。

这种方式整体上是在用 代码复杂度 做 时间 的 trade-off。通过循环展开和特殊优化避免分支预测失败的方式优化代码。本质上属于针对特定运行模式的特定函数优化。

两个blog都指出对控制流的优化。因此这里尝试一下。

> 为什么这里的得分是定值的？
>
> 很多人认为运行过程应该是像”跑分一样“随机的，但这里的模拟过程实际上是机械的，也就是说benchmark在常规计算机上不稳定的得分在这里是不成立的。

首先对这个最好的做一下分析整理

```assmebly
# You can modify this portion
# Loop header
    #xorq   %rax,%rax
    iaddq   $-10, %rdx
    jl      Root            # len < 10

Loop1:

    mrmovq  (%rdi), %r8     # src[0] -> r8
    mrmovq  8(%rdi), %r9    # src[1] -> r9
    andq    %r8, %r8        # r8 set Z,S
    rmmovq  %r8, (%rsi)     # r8 -> dst[0]
    rmmovq  %r9, 8(%rsi)    # r9 -> dst[1]    
    jle     Loop2           # 判断 r8是否<= 0
    iaddq   $1, %rax        # count++
Loop2:
    andq    %r9, %r9        # r9 set Z,S
    jle     Loop3           # 判断 r9
    iaddq   $1, %rax        # count ++
Loop3:
    mrmovq  16(%rdi), %r8   # src[2] -> r8
    mrmovq  24(%rdi), %r9   # src[3] -> r9
    andq    %r8, %r8        # r8 set Z,S
    rmmovq  %r8, 16(%rsi)   # ..
    rmmovq  %r9, 24(%rsi)   # ..
    jle     Loop4           # r8
    iaddq   $1, %rax        # ..
Loop4:
    andq    %r9, %r9        # r9 set Z,S
    jle     Loop5           # ..
    iaddq   $1, %rax        # ..
Loop5:
    mrmovq  32(%rdi), %r8   # src[4]
    mrmovq  40(%rdi), %r9   # src[5]
    andq    %r8, %r8        # r8 set CC
    rmmovq  %r8, 32(%rsi)   # dst[4]
    rmmovq  %r9, 40(%rsi)   # dst[5]
    jle     Loop6           # ..
    iaddq   $1, %rax        # count++
Loop6:
    andq    %r9, %r9        # r9 set CC
    jle     Loop7           # ..
    iaddq   $1, %rax        # count ++
Loop7:
    mrmovq  48(%rdi), %r8   # src[6]
    mrmovq  56(%rdi), %r9   # src[7]
    andq    %r8, %r8        # r8 set CC
    rmmovq  %r8, 48(%rsi)   # dst[6]
    rmmovq  %r9, 56(%rsi)   # dst[7]
    jle     Loop8           # ..
    iaddq   $1, %rax        # count++
Loop8:
    andq    %r9, %r9        # r9 set CC
    jle     Loop9           # ..
    iaddq   $1, %rax        # count ++

Loop9:
    mrmovq  64(%rdi), %r8   # src[8]
    mrmovq  72(%rdi), %r9   # src[9]
    andq    %r8, %r8        # r8 set CC
    rmmovq  %r8, 64(%rsi)   # dst[8]
    rmmovq  %r9, 72(%rsi)   # dst[9]
    jle     Loop10          # ..
    iaddq   $1, %rax        # count ++
Loop10:
    andq    %r9, %r9        # r9 set CC
    jle     Update          # 这里跳转到Loop结束
    iaddq   $1, %rax        # count ++

Update:
    iaddq   $80, %rdi       # 更新下标
    iaddq   $80, %rsi       # 更新下标

Test1:
    iaddq   $-10, %rdx  # len - 8   # 判断10的循环
    jge     Loop1                   # 跳转到Loop


# len in [0, 1, ..., 9]
Root:                       # 处理所有长度小于10，这里用到了二分跳转, 不过没有进行到底
    iaddq   $6, %rdx        # len - 4   
    jl      Left            # len < 4
    jg      Right           # len > 4   
    je      R4              # len = 4

# len in [0, 1, 2, 3]
Left:
    iaddq   $1, %rdx    # len - 3
    je      R3              # len = 3
    iaddq   $1, %rdx    # len - 2
    je      R2              # len = 2
    iaddq   $1, %rdx    # len - 1
    je      R1              # len = 1
    ret


# len in [5, 6, 7, 8, 9]
Right:
    iaddq   $-2, %rdx   # len - 6
    jl      R5              # len = 5
    je      R6              # len = 6
    iaddq   $-1, %rdx   # len - 7
    je      R7              # len = 7
    iaddq   $-1, %rdx   # len - 8
    je      R8              # len = 8



R9:
    mrmovq  64(%rdi), %r8
    andq    %r8, %r8
    rmmovq  %r8, 64(%rsi)
R8:
    mrmovq  56(%rdi), %r8
    jle     R81
    iaddq   $1, %rax
R81:
    rmmovq  %r8, 56(%rsi)
    andq    %r8, %r8
R7:
    mrmovq  48(%rdi), %r8
    jle     R71
    iaddq   $1, %rax
R71:
    rmmovq  %r8, 48(%rsi)
    andq    %r8, %r8
R6:
    mrmovq  40(%rdi), %r8
    jle     R61
    iaddq   $1, %rax
R61:
    rmmovq  %r8, 40(%rsi)   
    andq    %r8, %r8
R5:
    mrmovq  32(%rdi), %r8
    jle     R51
    iaddq   $1, %rax
R51:
    rmmovq  %r8, 32(%rsi)
    andq    %r8, %r8
R4:
    mrmovq  24(%rdi), %r8
    jle     R41
    iaddq   $1, %rax
R41:
    rmmovq  %r8, 24(%rsi)
    andq    %r8, %r8
R3:
    mrmovq  16(%rdi), %r8
    jle     R31
    iaddq   $1, %rax
R31:
    rmmovq  %r8, 16(%rsi)
    andq    %r8, %r8
R2:
    mrmovq  8(%rdi), %r8
    jle     R21
    iaddq   $1, %rax
R21:
    rmmovq  %r8, 8(%rsi)
    andq    %r8, %r8
R1:
    mrmovq  (%rdi), %r8
    jle     R11
    iaddq   $1, %rax
R11:
    andq    %r8, %r8
    rmmovq  %r8, (%rsi)
    jle     Done
    iaddq   $1, %rax
```

这里使用两个寄存器r8,r9，实现了2*5=10阶的循环展开。最后二分了一下处理尾端数组。

**这里为什么要是用两个寄存器进行循环展开？**

这是一个很重要的问题，因为即使使用一个寄存器

```assmebly
LoopN:
mrmovq  (%rdi), %r8
rmmovq  %r8, (%rsi)
andq    %r8, %r8
jle     Npos_LoopN+1
iaddq   $1, %rax
```

这样也是可以循环展开的，让我们从流水线对依赖的需求考虑。

这里的

```assmebly
mrmovq  (%rdi), %r8
rmmovq  %r8, (%rsi)
```

显然在r8上存在，E->D的一个数据冒险，需要一个bubble。

通过多用一个寄存器就可以解决这个问题，当然，也有其他的方式：

```assmebly
LoopN:
mrmovq  (%rdi), %r8
andq    %r8, %r8
rmmovq  %r8, (%rsi)
jle     Npos_LoopN+1
iaddq   $1, %rax
```

这样的结构似乎也可以，但这里其实andq也依赖于r8

**这里为什么是十路循环展开**

由于上面的双寄存器策略，我们仅仅只考虑偶数个数的循环展开。以下是2,4,6,8,10测试数据。

```sh
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/pipe$ ./benchmark.pl -f ncopy_2.ys
        ncopy_2
0       26
1       29      29.00
2       32      16.00
3       32      10.67
4       43      10.75
5       46      9.20
6       56      9.33
7       64      9.14
8       75      9.38
9       81      9.00
10      94      9.40
11      100     9.09
12      109     9.08
13      115     8.85
14      124     8.86
15      130     8.67
16      139     8.69
17      145     8.53
18      154     8.56
19      160     8.42
20      169     8.45
21      175     8.33
22      184     8.36
23      190     8.26
24      199     8.29
25      205     8.20
26      214     8.23
27      220     8.15
28      229     8.18
29      235     8.10
30      244     8.13
31      250     8.06
32      259     8.09
33      265     8.03
34      274     8.06
35      280     8.00
36      289     8.03
37      295     7.97
38      304     8.00
39      310     7.95
40      319     7.97
41      325     7.93
42      334     7.95
43      340     7.91
44      349     7.93
45      355     7.89
46      364     7.91
47      370     7.87
48      379     7.90
49      385     7.86
50      394     7.88
51      400     7.84
52      409     7.87
53      415     7.83
54      424     7.85
55      430     7.82
56      439     7.84
57      445     7.81
58      454     7.83
59      460     7.80
60      469     7.82
61      475     7.79
62      484     7.81
63      490     7.78
64      499     7.80
Average CPE     8.75
Score   35.0/60.0
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/pipe$ ./benchmark.pl -f ncopy_4.ys
        ncopy_4
0       26
1       29      29.00
2       32      16.00
3       32      10.67
4       43      10.75
5       46      9.20
6       56      9.33
7       64      9.14
8       75      9.38
9       81      9.00
10      86      8.60
11      94      8.55
12      105     8.75
13      111     8.54
14      112     8.00
15      120     8.00
16      131     8.19
17      137     8.06
18      138     7.67
19      146     7.68
20      157     7.85
21      163     7.76
22      164     7.45
23      172     7.48
24      183     7.62
25      189     7.56
26      190     7.31
27      198     7.33
28      209     7.46
29      215     7.41
30      216     7.20
31      224     7.23
32      235     7.34
33      241     7.30
34      242     7.12
35      250     7.14
36      261     7.25
37      267     7.22
38      268     7.05
39      276     7.08
40      287     7.17
41      293     7.15
42      294     7.00
43      302     7.02
44      313     7.11
45      319     7.09
46      320     6.96
47      328     6.98
48      339     7.06
49      345     7.04
50      346     6.92
51      354     6.94
52      365     7.02
53      371     7.00
54      372     6.89
55      380     6.91
56      391     6.98
57      397     6.96
58      398     6.86
59      406     6.88
60      417     6.95
61      423     6.93
62      424     6.84
63      432     6.86
64      443     6.92
Average CPE     8.06
Score   48.7/60.0
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/pipe$ ./benchmark.pl -f ncopy_6.ys
        ncopy_6
0       26
1       29      29.00
2       32      16.00
3       32      10.67
4       43      10.75
5       46      9.20
6       56      9.33
7       64      9.14
8       75      9.38
9       81      9.00
10      84      8.40
11      87      7.91
12      97      8.08
13      105     8.08
14      116     8.29
15      122     8.13
16      121     7.56
17      124     7.29
18      134     7.44
19      142     7.47
20      153     7.65
21      159     7.57
22      158     7.18
23      161     7.00
24      171     7.12
25      179     7.16
26      190     7.31
27      196     7.26
28      195     6.96
29      198     6.83
30      208     6.93
31      216     6.97
32      227     7.09
33      233     7.06
34      232     6.82
35      235     6.71
36      245     6.81
37      253     6.84
38      264     6.95
39      270     6.92
40      269     6.72
41      272     6.63
42      282     6.71
43      290     6.74
44      301     6.84
45      307     6.82
46      306     6.65
47      309     6.57
48      319     6.65
49      327     6.67
50      338     6.76
51      344     6.75
52      343     6.60
53      346     6.53
54      356     6.59
55      364     6.62
56      375     6.70
57      381     6.68
58      380     6.55
59      383     6.49
60      393     6.55
61      401     6.57
62      412     6.65
63      418     6.63
64      417     6.52
Average CPE     7.79
Score   54.2/60.0
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/pipe$ ./benchmark.pl -f ncopy_8.ys
        ncopy_8
0       26
1       29      29.00
2       32      16.00
3       32      10.67
4       43      10.75
5       46      9.20
6       56      9.33
7       64      9.14
8       75      9.38
9       81      9.00
10      84      8.40
11      84      7.64
12      95      7.92
13      98      7.54
14      108     7.71
15      116     7.73
16      127     7.94
17      133     7.82
18      132     7.33
19      132     6.95
20      143     7.15
21      146     6.95
22      156     7.09
23      164     7.13
24      175     7.29
25      181     7.24
26      180     6.92
27      180     6.67
28      191     6.82
29      194     6.69
30      204     6.80
31      212     6.84
32      223     6.97
33      229     6.94
34      228     6.71
35      228     6.51
36      239     6.64
37      242     6.54
38      252     6.63
39      260     6.67
40      271     6.78
41      277     6.76
42      276     6.57
43      276     6.42
44      287     6.52
45      290     6.44
46      300     6.52
47      308     6.55
48      319     6.65
49      325     6.63
50      324     6.48
51      324     6.35
52      335     6.44
53      338     6.38
54      348     6.44
55      356     6.47
56      367     6.55
57      373     6.54
58      372     6.41
59      372     6.31
60      383     6.38
61      386     6.33
62      396     6.39
63      404     6.41
64      415     6.48
Average CPE     7.64
Score   57.2/60.0
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Architecture-Lab/sim/pipe$ ./benchmark.pl -f ncopy_10.ys
        ncopy_10
0       26
1       29      29.00
2       32      16.00
3       32      10.67
4       43      10.75
5       46      9.20
6       56      9.33
7       64      9.14
8       75      9.38
9       81      9.00
10      89      8.90
11      92      8.36
12      95      7.92
13      95      7.31
14      106     7.57
15      109     7.27
16      119     7.44
17      127     7.47
18      138     7.67
19      144     7.58
20      148     7.40
21      151     7.19
22      154     7.00
23      154     6.70
24      165     6.88
25      168     6.72
26      178     6.85
27      186     6.89
28      197     7.04
29      203     7.00
30      207     6.90
31      210     6.77
32      213     6.66
33      213     6.45
34      224     6.59
35      227     6.49
36      237     6.58
37      245     6.62
38      256     6.74
39      262     6.72
40      266     6.65
41      269     6.56
42      272     6.48
43      272     6.33
44      283     6.43
45      286     6.36
46      296     6.43
47      304     6.47
48      315     6.56
49      321     6.55
50      325     6.50
51      328     6.43
52      331     6.37
53      331     6.25
54      342     6.33
55      345     6.27
56      355     6.34
57      363     6.37
58      374     6.45
59      380     6.44
60      384     6.40
61      387     6.34
62      390     6.29
63      390     6.19
64      401     6.27
Average CPE     7.60
Score   58.1/60.0
```

这里给出我的.pl生成程序

```perl
#!/usr/bin/perl
use strict;
use warnings;

my @unrolls = (2,4,6,8,10);  # 支持循环展开路数
my $template_file = "ncopy.ys";  # 原始模板文件
my $outfile_prefix = "ncopy_";

# 读取模板
open my $tmpl_fh, "<", $template_file or die $!;
my @template = <$tmpl_fh>;
close $tmpl_fh;

# 找到 Loop1 起点和 Update 结束行号
my ($loop_start, $loop_end);
for my $i (0..$#template) {
    $loop_start = $i if $template[$i] =~ /^# Loop header/;
    $loop_end   = $i if $template[$i] =~ /^Root:/;
}
die "未找到 xor/Root 标签" unless defined $loop_start && defined $loop_end;

# 尾部模板（Test1 后到文件末尾）
my @tail_template = @template[$loop_end..$#template];

foreach my $n (@unrolls) {
    my $outfile = "${outfile_prefix}${n}.ys";
    open my $out_fh, ">", $outfile or die $!;

    # 输出 Loop1 前的内容
    for my $i (0..$loop_start-1) {
        print $out_fh $template[$i];
    }

    # 生成 Loop 展开
    my $loop_idx = 1;
    my $offset = 0;

    print $out_fh <<"HEAD";

    #xorq   %rax,%rax
    iaddq   \$-10, %rdx
    jl      Root            # len < 10
HEAD

    while ($offset < $n*8) {
        my $r8_offset = $offset;
        my $r9_offset = $offset + 8;

        print $out_fh <<"LOOP";

Loop$loop_idx:
    mrmovq  $r8_offset(%rdi), %r8
    mrmovq  $r9_offset(%rdi), %r9
    andq    %r8, %r8
    rmmovq  %r8, $r8_offset(%rsi)
    rmmovq  %r9, $r9_offset(%rsi)
    jle     Loop${loop_idx}1
    iaddq   \$1, %rax
Loop${loop_idx}1:
    andq    %r9, %r9
    jle     Loop${loop_idx}2
    iaddq   \$1, %rax
Loop${loop_idx}2:

LOOP

        $offset += 16;
        $loop_idx++;
    }

    # 添加 Update 和 Test1
    my $update_bytes = $n*8;  # 每次循环处理 n*2 个元素，每个元素 8 字节
    print $out_fh <<"UPDATE";
Update:
    iaddq   \$$update_bytes, %rdi
    iaddq   \$$update_bytes, %rsi

Test1:
    iaddq   \$-$n, %rdx
    jge     Loop1
UPDATE

    # 输出尾部模板
    print $out_fh @tail_template;

    close $out_fh;
    print "生成 $outfile 完成\n";
}

```

读者可以自己运行试一试。总之在这里循环展的越开对CPE的优势越大。另外，在很多blog中有对多路展开对性能期望影响的定量分析。这里需要提醒读者，不同循环展开的性能区分与很多因素，例如尾数处理，hcl的控制流机制相关。不同人的结论所适用的范围不同，总的来说，如果不限制文件大小，展开还是由于凭空减少了迭代计算要更优的。

如果特例化到这个场景下，由于测试数据仅有1-64，因此纠结这个也没意义。

这个时候如果我们回头看看小于10的所有情况
**loop4**
```sh
        ncopy_loop4
0       15
1       24      24.00
2       34      17.00
3       41      13.67
4       45      11.25
5       54      10.80
6       64      10.67
7       71      10.14
8       71      8.88
9       80      8.89
10      90      9.00
```
**loop10**
```sh
        ncopy_10
0       26
1       29      29.00
2       32      16.00
3       32      10.67
4       43      10.75
5       46      9.20
6       56      9.33
7       64      9.14
8       75      9.38
9       81      9.00
10      89      8.90
```

这里虽然在1的时候略逊一筹，低了5个CPE，但是根本无伤大雅，因为，在这个10展开的尾数处理中通过二分确定长度的方式，根本上减少了一个长度值的维护。即使在1的性能上有损失，也是值得的。加个特判的trade-off是不值得的。

***某种程度上可以说这份代码已经是除修改pipe-full以外的最优解。***

最后在ref8加一个对pipe-full.hcl下手的blog。

这里的话需要修改pipe-full.hcl中的forwarding算法，从E->D添加一个旁路，效果与双寄存器是一致的。但最后满分修改了预测策略，修改为了不跳转，结合特殊的展开拉低整体CPE。

总的来说，取得满分需要对pipe-full进行修改。**~~无脑完成4.57加载转发旁路也可以，因为最后余数处理总会遇到，这里我就修改成满分版本了~~**

## Appendix

### Makefile Problem

必要软件如下

```shell
sudo apt install tcl tcl-dev tk tk-dev
sudo apt install flex
sudo apt install bison
```

若仍然出现如下报错

```shell
(cd misc; make all)
make[1]: Entering directory '/home/ubuntu/learnning_project/CMU-15213/src/Architecture-Lab/sim/misc'
gcc -Wall -O1 -g -c yis.c
gcc -Wall -O1 -g -c isa.c
gcc -Wall -O1 -g yis.o isa.o -o yis
gcc -Wall -O1 -g -c yas.c
flex yas-grammar.lex
mv lex.yy.c yas-grammar.c
gcc -O1 -c yas-grammar.c
gcc -Wall -O1 -g yas-grammar.o yas.o isa.o -lfl -o yas
/usr/bin/ld: yas.o:/home/ubuntu/learnning_project/CMU-15213/src/Architecture-Lab/sim/misc/yas.h:13: multiple definition of `lineno'; yas-grammar.o:(.bss+0x0): first defined here
collect2: error: ld returned 1 exit status
make[1]: *** [Makefile:32: yas] Error 1
make[1]: Leaving directory '/home/ubuntu/learnning_project/CMU-15213/src/Architecture-Lab/sim/misc'
make: *** [Makefile:26: all] Error 2
```

lineno 这个符号被定义了两次：

一次在 yas-grammar.o（flex 自动生成的词法分析器代码）里

一次在你项目里的 yas.o（通过 yas.h 引入）

这时，在所有子文件夹的Makefile中加入一个FLAGS即可

```Makefile
CFLAGS=-Wall -O1 -g -fcommon
LCFLAGS=-O1 -fcommon # 没有这一项就不加
```

探索原因为：

CMU 15213 Architecture Lab 的源代码是十几年前写的（大概 GCC 4.x 时代）。

当时 GCC 默认是 -fcommon 模式 → 意味着如果你在多个 .c 文件里写了 int lineno;，它们会被放到 “common symbol” 里，链接时会自动合并为一个，不会报错。

但 从 GCC 10 开始默认改为 -fno-common，这就变成了现在报错的情况。

现代GCC更加严格

### GUI Forwarding Problem

linux中GUI对可视化系统（如windows）的转发通常涉及一些库（如tk,tcl)，以及一些协议（如X11)。
这里以MobaXterm终端转发Ubuntu24.04为例。

由于tcl，tk在Ubuntu18中进行过一次更新，从8.5升级到了8.6，因此，原本的Makefile是无法直接被使用的

```sh
# 在/sim/seq中执行下面这一条指令时会出现报错
make VERSION=full
```

这时需要修改Makefile文件对应位置，并修改部分被弃用的函数代码

```makefile
# Modify the following line so that gcc can find the tcl.h and tk.h
# header files on your system. Comment this out if you don't have
# Tcl/Tk.

TKINC=-isystem /usr/include/tcl8.6

# Modify these two lines to choose your compiler and compile time
# flags.

CC=gcc
CFLAGS=-Wall -O2 -fcommon -DUSE_INTERP_RESULT
```

在这段位置修改`sim/seq/Makefile`文件, 这里值得注意的是这里修改了`CFLAGS`,添加了`-DUSE_INTERP_RESULT`选项，在所有有修改8.6的位置都应该添加这个选项，切勿删除原有的 -fcommon

```c
// 因为tcl8.6,tk8.6在sunos上编译时会定义这个函数，而matherr在math.h中被声明为weak符号
// 但在C17标准中，matherr已被弃用且不再推荐使用，因此这里注释掉相关代码以避免冲突
// extern int matherr();
// int *tclDummyMathPtr = (int *) matherr;
```

并在源代码中注释掉所有用到matherr这个函数定义的地方,涉及两个源代码`psim.c`以及`ssim.c`。

通过这两种方式，`make VERSION=full`应该可以正常编译了，但是当尝试使用mobaXterm进行转发GUI时可能还是会出现一些问题，有关安全性验证。这里给出我用的命令以及chat的记录

```sh
# 注意在MobaXterm中手动启用X11转发

# 查看当前设置
grep -i 'X11Forwarding\|X11UseLocalhost' /etc/ssh/sshd_config || true

# 如需启用（会覆盖注释/多个条目），运行：
sudo sed -i 's/^#\?\s*X11Forwarding.*/X11Forwarding yes/' /etc/ssh/sshd_config
sudo sed -i 's/^#\?\s*X11UseLocalhost.*/X11UseLocalhost yes/' /etc/ssh/sshd_config

# 重启 sshd（注意：会断开当前 SSH 会话）
sudo systemctl restart sshd
# 手动强制重启终端
```

[chat回复](https://chatgpt.com/share/68e900b9-341c-8010-83c7-723566e9c8c5)

## REF

1. <https://csapp.cs.cmu.edu/3e/archlab.pdf>
2. <https://zhuanlan.zhihu.com/p/480380496>
3. <https://bobokick.github.io/showPage/CSAPP_Labs/4_ArchitectureLab/readme.html>
4. <https://jarenl.com/index.php/2025/02/24/csapp_chp4/>
5. <https://www.lighterra.com/papers/modernmicroprocessors/>
6. <https://zhuanlan.zhihu.com/p/36793761>
7. <https://zhuanlan.zhihu.com/p/641239498>
8. [CSDN 满分](https://blog.csdn.net/jokerMingge/article/details/128377723#:~:text=%E6%9C%AC%E6%96%87%E8%AF%A6%E7%BB%86%E4%BB%8B%E7%BB%8D%E4%BA%86CSAPP%EE%80%80%20Architecture%EE%80%80%EE%80%81%20Lab%EE%80%81%E4%B8%AD%E5%85%B3%E4%BA%8EY86-64%E5%A4%84%E7%90%86%E5%99%A8%E5%AE%9E%E7%8E%B0%E7%9A%84%E5%AE%9E%E9%AA%8C%EF%BC%8C%E5%8C%85%E6%8B%AC%E7%BC%96%E5%86%99%E6%B1%87%E7%BC%96%E4%BB%A3%E7%A0%81%E3%80%81%E6%89%A9%E5%B1%95SEQ%E6%A8%A1%E6%8B%9F%E5%99%A8%E6%8C%87%E4%BB%A4%E3%80%81%E5%A4%84%E7%90%86%E5%99%A8%E4%BC%98%E5%8C%96%E4%B8%8E%E8%AE%BE%E8%AE%A1%EF%BC%8C%E5%B8%AE%E5%8A%A9%E8%AF%BB%E8%80%85%E7%90%86%E8%A7%A3%E5%A4%84%E7%90%86%E5%99%A8%E6%9E%B6%E6%9E%84%E5%92%8C%E8%BD%AF%E7%A1%AC%E4%BB%B6%E4%BA%A4%E4%BA%92%E3%80%82)
9. <https://dreamanddead.github.io/CSAPP-3e-Solutions/>
10. <https://www.cnblogs.com/albert8216/articles/17643426.html>