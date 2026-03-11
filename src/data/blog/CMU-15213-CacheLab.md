---
title: "CMU-15213-CacheLab"
pubDatetime: 2025-09-07T20:00:00Z
description: "CMU 15-213 课程 Cache Lab 实验记录，实现缓存模拟器与矩阵转置优化，深入理解缓存命中率与分块策略。"
slug: "cmu-15213-cachelab"
draft: false
tags:
  - "CMU15213"
  - "c"
  - "x86-64"
---

## CacheLab

## Declaration

本文使用了 AIGC 来提高效率，其中可能存在谬误，我已尽力检查并校对，但仍不保证完全准确，欢迎指正。

按照惯例看write-up和Lab handout当中的文件。

## Part A

修改csim.c，通过对 `make && ./test-csim`,满分是27分

csim应该实现的功能是模拟缓存的行为，根据trace文件中的指令，模拟缓存的命中、不命中、替换等行为。并以valgrind来作为生成trace文件的工具作为输入。

这里CSAPP提供了一个csim的参考，这里是输出的帮助信息

```sh
(base) ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Cache-Lab$ ./csim-ref -h
Usage: ./csim-ref [-hv] -s <num> -E <num> -b <num> -t <file>
Options:
  -h         Print this help message.
  -v         Optional verbose flag.
  -s <num>   Number of set index bits.
  -E <num>   Number of lines per set.
  -b <num>   Number of block offset bits.
  -t <file>  Trace file.

Examples:
  linux>  ./csim-ref -s 4 -E 1 -b 4 -t traces/yi.trace
  linux>  ./csim-ref -v -s 8 -E 2 -b 4 -t traces/yi.trace
```

运行一个trace文件，得到的输出结果如下所示， --verbose模式

```sh
(base) ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Cache-Lab$ ./csim-ref -v -s 4 -E 1 -b 4 -t traces/yi.trace
L 10,1 miss 
M 20,1 miss hit 
L 22,1 hit 
S 18,1 hit 
L 110,1 miss eviction 
L 210,1 miss eviction 
M 12,1 miss eviction hit 
hits:4 misses:5 evictions:3
```

这里的M是 Modify， load after read， 表示修改了缓存中的数据
所以这里会有一个miss, hit
而且这里漏了一个Instruction load， 表示加载了指令

需要遵守一些编码准则

1. 在发生eviction时使用LRU策略
2. 不需要管I
3. 计算hits, misses, evictions
4. Cache Simulator 并不是一个真实的缓存，只是一个模拟器，用来模拟缓存的输出
5. 模拟器必须对 s, E, b 参数做正确的处理，这要求对空间进行申请，使用malloc, free进行空间管理
6. 需要处理命令行参数， 使用[getopt（3） - Linux 手册页 --- getopt(3) - Linux manual page](https://man7.org/linux/man-pages/man3/getopt.3.html)
7. 通过下面的这个命令来运行简短的测试

```sh
(base) ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Cache-Lab$ ./csim-ref -v -s 4 -E 1 -b 4 -t traces/yi.trace
```

简单的代码编写
```sh
(base) ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Cache-Lab$ ./csim-ref -v -s 4 -E 1 -b 4 -t traces/yi.trace
L 10,1 miss 
M 20,1 miss hit 
L 22,1 hit 
S 18,1 hit 
L 110,1 miss eviction 
L 210,1 miss eviction 
M 12,1 miss eviction hit 
hits:4 misses:5 evictions:3
(base) ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Cache-Lab$ ./csim -v -s 4 -E 1 -b 4 -t traces/yi.trace
L 10,1 miss
M 20,1 miss hit
L 22,1 hit
S 18,1 hit
L 110,1 miss eviction
L 210,1 miss eviction
M 12,1 miss eviction hit
hits:5 misses:4 evictions:3
```

发现有些不一样，开个小玩笑，这里其实是Hits 和 Misses 反了一下
```sh
(base) ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Cache-Lab$ ./test-csim 
                        Your simulator     Reference simulator
Points (s,E,b)    Hits  Misses  Evicts    Hits  Misses  Evicts
     1 (1,1,1)       8       9       6       9       8       6  traces/yi2.trace
     1 (4,2,4)       5       4       2       4       5       2  traces/yi.trace
     1 (2,1,4)       3       2       1       2       3       1  traces/dave.trace
     1 (2,1,3)      71     167      67     167      71      67  traces/trans.trace
     1 (2,2,3)      37     201      29     201      37      29  traces/trans.trace
     1 (2,4,3)      26     212      10     212      26      10  traces/trans.trace
     1 (5,1,5)       7     231       0     231       7       0  traces/trans.trace
     2 (5,1,5)   21775  265189   21743  265189   21775   21743  traces/long.trace
     9

TEST_CSIM_RESULTS=9
```

```sh
(base) ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Cache-Lab$ make && ./test-csim 
gcc -g -Wall -Werror -std=c99 -m64 -o csim csim.c cachelab.c -lm 
# Generate a handin tar file each time you compile
tar -cvf ubuntu-handin.tar  csim.c trans.c 
csim.c
trans.c
                        Your simulator     Reference simulator
Points (s,E,b)    Hits  Misses  Evicts    Hits  Misses  Evicts
     3 (1,1,1)       9       8       6       9       8       6  traces/yi2.trace
     3 (4,2,4)       4       5       2       4       5       2  traces/yi.trace
     3 (2,1,4)       2       3       1       2       3       1  traces/dave.trace
     3 (2,1,3)     167      71      67     167      71      67  traces/trans.trace
     3 (2,2,3)     201      37      29     201      37      29  traces/trans.trace
     3 (2,4,3)     212      26      10     212      26      10  traces/trans.trace
     3 (5,1,5)     231       7       0     231       7       0  traces/trans.trace
     6 (5,1,5)  265189   21775   21743  265189   21775   21743  traces/long.trace
    27

TEST_CSIM_RESULTS=27
```

## Part B

在PartB中需要修改tran.c文件，实现尽可能快的矩阵转置函数，满分是 26 == 8 + 8 + 10分

满分依据是分别在32*32,64\*64,61\*67下运行， hit:miss分别大于 1:300, 1:1300, 1:1200

给出的 tran.c 的初始文件如下

```c
/* 
 * trans.c - Matrix transpose B = A^T
 *
 * Each transpose function must have a prototype of the form:
 * void trans(int M, int N, int A[N][M], int B[M][N]);
 *
 * A transpose function is evaluated by counting the number of misses
 * on a 1KB direct mapped cache with a block size of 32 bytes.
 */ 
#include <stdio.h>
#include "cachelab.h"

int is_transpose(int M, int N, int A[N][M], int B[M][N]);

/* 
 * transpose_submit - This is the solution transpose function that you
 *     will be graded on for Part B of the assignment. Do not change
 *     the description string "Transpose submission", as the driver
 *     searches for that string to identify the transpose function to
 *     be graded. 
 */
char transpose_submit_desc[] = "Transpose submission";
void transpose_submit(int M, int N, int A[N][M], int B[M][N])
{
}

/* 
 * You can define additional transpose functions below. We've defined
 * a simple one below to help you get started. 
 */ 

/* 
 * trans - A simple baseline transpose function, not optimized for the cache.
 */
char trans_desc[] = "Simple row-wise scan transpose";
void trans(int M, int N, int A[N][M], int B[M][N])
{
    int i, j, tmp;

    for (i = 0; i < N; i++) {
        for (j = 0; j < M; j++) {
            tmp = A[i][j];
            B[j][i] = tmp;
        }
    }    

}

/*
 * registerFunctions - This function registers your transpose
 *     functions with the driver.  At runtime, the driver will
 *     evaluate each of the registered functions and summarize their
 *     performance. This is a handy way to experiment with different
 *     transpose strategies.
 */
void registerFunctions()
{
    /* Register your solution function */
    registerTransFunction(transpose_submit, transpose_submit_desc); 

    /* Register any additional transpose functions */
    registerTransFunction(trans, trans_desc); 

}

/* 
 * is_transpose - This helper function checks if B is the transpose of
 *     A. You can check the correctness of your transpose by calling
 *     it before returning from the transpose function.
 */
int is_transpose(int M, int N, int A[N][M], int B[M][N])
{
    int i, j;

    for (i = 0; i < N; i++) {
        for (j = 0; j < M; ++j) {
            if (A[i][j] != B[j][i]) {
                return 0;
            }
        }
    }
    return 1;
}
```

CSAPP给定了一些编码规则，这里挑一些特别要注意的
1.在每个转置函数中，代码只允许使用最多12个本地int类型的变量
2. 不能使用任何技巧将多个值存储在同个变量中规避规则
3. 不允许递归
4. 如果选择使用辅助函数，则辅助函数和主函数都不能违反规则1
5. 转置函数只能使用A和B数组作为输入输出，且不能改变A
6. malloc以及数组不能被使用

这里同样给出了一个示例，trans，将其复制到transpose_submit

测试结果如下

```sh
(base) ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Cache-Lab$ make && ./test-trans -M 32 -N 32
gcc -g -Wall -Werror -std=c99 -m64 -O0 -c trans.c
gcc -g -Wall -Werror -std=c99 -m64 -o test-trans test-trans.c cachelab.c trans.o 
gcc -g -Wall -Werror -std=c99 -m64 -O0 -o tracegen tracegen.c trans.o cachelab.c
# Generate a handin tar file each time you compile
tar -cvf ubuntu-handin.tar  csim.c trans.c 
csim.c
trans.c

Function 0 (1 total)
Step 1: Validating and generating memory traces
Step 2: Evaluating performance (s=5, E=1, b=5)
func 0 (Transpose submission): hits:869, misses:1184, evictions:1152

Summary for official submission (func 0): correctness=1 misses=1184

TEST_TRANS_RESULTS=1:1184
```

可见在32*32下，hit:miss为 1:1184，离我们的要求差的很远，但是可以注意到s,E,b,的值分别为5，1，5，我们运用一些技巧对代码进行优化


```c
(base) ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Cache-Lab$ ./test-trans -M 32 -N 32

Function 0 (1 total)
Step 1: Validating and generating memory traces
Step 2: Evaluating performance (s=5, E=1, b=5)
func 0 (Transpose submission): hits:1765, misses:288, evictions:256

Summary for official submission (func 0): correctness=1 misses=288

TEST_TRANS_RESULTS=1:288
(base) ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Cache-Lab$ ./test-trans -M 64 -N 64

Function 0 (1 total)
Step 1: Validating and generating memory traces
Step 2: Evaluating performance (s=5, E=1, b=5)
func 0 (Transpose submission): hits:9017, misses:1228, evictions:1196

Summary for official submission (func 0): correctness=1 misses=1228

TEST_TRANS_RESULTS=1:1228
(base) ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Cache-Lab$ ./test-trans -M 61 -N 67

Function 0 (1 total)
Step 1: Validating and generating memory traces
Step 2: Evaluating performance (s=5, E=1, b=5)
func 0 (Transpose submission): hits:6193, misses:1986, evictions:1954

Summary for official submission (func 0): correctness=1 misses=1986

TEST_TRANS_RESULTS=1:1986
```

简单聊一聊这里的技巧，首先，在32*32下，我们将矩阵分成8\*8的块，对每个块进行转置，这样可以减少miss的次数。其次我们采用对角线优化，即将矩阵的主对角线元素转置延后，再将其他元素转置，这样可以减少miss的次数。

> **为何要优化对角线**
>
> 1. **行主序存储 + 转置=远距访问**
>     朴素转置要读 `A[i][j]`、写 `B[j][i]`，两处地址相距很远，几乎没有空间局部性 → 大量缓存未命中。
> 2. **对角（i==j）与“组冲突”(conflict misses)**
>     对角附近的地址常映射到**同一缓存集合**（尤其是直映/低相联缓存、尺寸是2的幂时最明显），源和目的会**互相顶掉**，出现抖动。
> 3. **写分配（write-allocate）成本**
>     直接对远处元素零散写入，会先把整条cache line读入（RFO），放大带宽消耗。
>
> **优化原理与做法**
>
> 1. **块化（tiling / blocking）**
>     把矩阵分成 `BxB` 小块，使一次只在缓存中放两块：源块与目标块。
>    - 读源块 → 连续（stride-1）访问，命中率高
>    - 写目标块 → 连续写，减少RFO
>    - 经验：选 `B` 使 `2 * B * B * elem_size` ≲ `0.6~0.8 * L1`
>       例：L1=32KB、double(8B)，选 `B=32`（两块≈16KB）常见而稳妥。
> 2. **非对角块：成对处理**
>     当块坐标 `(ib, jb)` 与 `(jb, ib)` 不同：
>    - 同时把这两块装入缓存，成对交换/复制，连续读写，重用度高。
> 3. **对角块：单独路径（“对角线优化”的核心）**
>    - **先读入临时缓冲/寄存器**，在**缓存内部完成转置**，再一次性写回（避免源、目的同组互顶）。
>    - 或者对角块按行顺序原地转置，但用**小寄存器tile**逐行/逐子块交换，减少同组冲突。
> 4. **预取与对齐**
>    - 对块首地址按cache line对齐，顺序访问让硬件预取器有效。
>    - 可显式预取下一行/下一块首地址。
> 5. **并行时避开伪共享**
>    - 线程按块分配（而不是按行/列交错），保证每个线程写入的cache line互不重叠。

并且采用了使用局部变量缓存的方式进行读写，完成避免抖动的高效转置

## REF

1. [CSAPP: Cachelab全注释+思路和建议 - 知乎](https://zhuanlan.zhihu.com/p/456858668)
