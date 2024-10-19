---
title: PGStudy-Linux脚本语言Part2
date: 2024-10-16 20:40:38
categories:
- 专题
- PGStudy
tags:  [Linux, 脚本, c]
---
# Shell Script

在Part1基本讲述了对Script的语法结构，但LinuxScript并不单纯只是Script本身，而是与其“梦幻联动”的Linux命令，高级语言，软件结构设计。因此在ShellScript的学习中注定是间断的，学习不同知识点的过程。这里对Part1中的点做一些实验与解答

## QA

### Q: Part1中提到了对其他文件的调用，那么在文件中调用其他脚本变量是否是共享的

A: 很多时候是共享的，也需要他们共享，但取决于需求，调用文件的shell有时不受影响，见下一个QA。以下操作默认使用./script_filename调用脚本

 创建两个脚本文件script1 script2，分别写入以下内容

<!--more-->

```shell
#/bin/bash

my_var=data
./script2

echo $my_var
```

```shell
#/bin/bash

echo $my_var

my_var=data_modified
```

可见输出

>  
>
>  data

可见变量并不传递

问问chatgpt如何解释

> 在Linux中，脚本文件通常不共享变量。每个脚本文件在执行时都有自己的命名空间，这意味着变量是局部的，仅在定义它们的脚本中可用。如果你发现一个脚本能够访问另一个脚本的变量，可能是由于以下原因之一：
>
> 1. **环境变量**：如果变量被设置为环境变量，那么它在所有子进程中都是可见的。例如，如果你在一个脚本中使用`export VAR=value`，那么这个变量`VAR`将被设置为环境变量，任何从该脚本启动的子进程（包括其他脚本）都能访问它。
> 2. **命令行参数**：一个脚本可以通过命令行参数将数据传递给另一个脚本。例如，脚本A可以通过`./scriptB.sh "$VAR"`将变量`VAR`的值传递给脚本B。
> 3. **输入重定向**：一个脚本可以将输出重定向到另一个脚本的输入中，这样第二个脚本就可以读取第一个脚本的输出作为输入数据。
> 4. **文件**：一个脚本可以将变量写入文件，然后另一个脚本可以从同一个文件中读取这个变量。
> 5. **命名管道（FIFO）或套接字**：脚本可以使用命名管道或套接字进行进程间通信。
> 6. **数据库或共享内存**：更复杂的脚本可能会使用数据库或共享内存来存储和访问数据。
> 7. **函数调用**：如果两个脚本是同一个脚本文件的一部分，或者一个脚本调用了另一个脚本的函数，那么它们可以共享局部变量。
> 8. **导出和导入**：在某些情况下，脚本可能会使用特定的命令来导出和导入变量，例如使用`source`或`.`命令来执行另一个脚本，这样被执行脚本中的变量就会在调用它的脚本中可用。

gpt回答的很严谨

### Q: 使用 `./script` 和 `. script` 调用脚本文件有区别吗？

A: 是有区别的，实际上. 与 source命令是等同的，而./ 反而是完全不同的

1. **使用 `. script`**：
   - 当你使用 `. script`时，你实际上是在当前 shell 中执行该脚本。这意味着新脚本会在当前 shell 的上下文中运行，它将继承当前 shell 的所有环境变量和 shell 变量。
   - 任何在新脚本中定义或修改的变量都会反映在当前 shell 中，因为它们共享同一个命名空间。
   - 这种方式类似于 C 语言中的 `source` 函数，它允许新脚本中的更改（如变量赋值）影响到调用它的 shell 环境。
2. **使用 `./script`**：
   - 当你使用 `./script`时，shell 会创建一个新的子 shell 来执行该脚本。这意味着新脚本会在一个子 shell 的上下文中运行，它将继承当前 shell 的环境变量，但不会继承 shell 变量。
   - 任何在新脚本中定义或修改的 shell 变量都不会反映在当前 shell 中，因为它们在子 shell 的命名空间中。
   - 这种方式类似于在一个新的 shell 实例中执行脚本，它不会影响调用它的 shell 环境的变量。

### Q: 在Part1中使用了很多(),{},’’,””,$这样的特殊符号，能讲一讲这些符号的特殊含义吗？

A: 有一个问题在于，为什么需要用“$variable\_name”而不是直接\$variable_name，这个原因实际上和Linux的命令有关，我们来试一下以下情况：

```shell
# 假设变量包含空格
file_name="my file.txt"

# 加引号的情况
> "$file_name" echo $file_name  # 输出为：my file.txt

# 不加引号的情况
command > $file_name echo $file_name  # 输出为：my file.tx
```

这种情况下第五行就会报错，而且仅仅输出一行字符串，这种情况称为参数扩展

1. **单引号 (`'`)**：

   - 用于定义字符串常量。在单引号中，所有的字符都被视为字面量，即使是通常有特殊含义的字符（如 `$`、```、`\` 等）也不会被解释。
   - 例子：`'Kimi says: "Hello, World!"'`

2. **双引号 (`"`)**：

   - 用于定义字符串变量。在双引号中，某些特殊字符（如 `$`、```、`\`、`!` 等）会被解释为特殊字符，允许变量替换和命令替换。
   - 例子：`"Kimi says: $GREETING"`
   - 注意：双引号允许转义字符（如 `\t` 表示制表符），但不会转义 `$`、``` 等特殊字符。

3. **花括号 (`{}`)**：

   - 用于命令替换。花括号允许命令的输出替换为花括号内的内容。

     例子：`echo Hello {World,Moonshot} AI` 会输出 `Hello World, Moonshot AI`。

   - 花括号也用于定义变量名的范围，当变量名包含特殊字符或以数字开头时。

     例子：`declare -A arr={a..3}` 创建一个关联数组，其索引从 `a` 到 `c`。

4. **圆括号 (`()`)**：

   - 用于数学运算和子 shell 的定义。

   - 在数学运算中，圆括号用于改变运算的优先级。

     例子：`(( 3 + 2 * 5 ))` 会先计算 `2 * 5`，然后再加上 `3`。

   - 在定义子 shell 时，圆括号允许命令在子 shell 中执行，这意味着它们不会影响当前 shell 的环境。

     例子：`(echo "Hello")` 会在子 shell 中执行 `echo` 命令。

以上是一些基本情况，但是仍然有很复杂的情况是难以理解的，如下

1. **在`“”`中的`‘’`**

   在单独使用`‘$var_name’`时，整体是当作字符串输出的，而不会替换变量，但是当我们使用嵌套结构的时候就会发现

   ```shell
   opt=prefix=/root
   echo '$opt'
   str1="opt '$opt'" ## 这里会替换为值
   echo "$str1"
   ```

   这样的代码回事的$opt调用它的值

### Q: Part1中简单提到了重定向，有更多例子吗？

A: 

1. `>`与`>>`的区别

   前者重写文件，后者追加文件

2. `2>`是什么？

   这是一个很简单理解的符号，2一般代表异常输出流，因此这里的2>代表异常输出流重定向

3. `>`与`2>`的合并用法

   ```shell
   command > file.txt 2>&1  # 将标准输出和错误都保存到file.txt中
   ```

4. 一种多行重定向的方法

   **`<<`**：从命令行或脚本中读取多行输入，直到指定的结束标记

   ```shell
   cat << EOF
   This is a multi-line input.
   It ends when "EOF" is encountered.
   EOF
   ```

### Q: 学了这么多脚本命令，如何写一个带参脚本？

A: 首先来看看前面提到的相关知识

1. 1，2，3，4属于位置参数变量，他们根据位置来确定传入参数

   一个简单的示例如下

   ```shell
   #!/bin/bash
   echo "First parameter: $1"
   echo "Second parameter: $2"
   ```

   >#./script.sh arg1 arg2
   >
   >First parameter: arg1
   >Second parameter: arg2

2. @,*都表示所有参数，前面的为独立的参数变量，后面的为整体的参数变量

   如下面这个例子

   ```shell
   #!/bin/bash
   echo "Using \"\$@\":"
   for arg in "$@"; do
       echo "$arg"
   done
   
   echo "Using \"\$*\":"
   for arg in "$*"; do
       echo "$arg"
   done
   ```

   **值得注意的是这里如果不用“”将@\*括起来就会发生参数扩展，导致两者输出一样 **

3. #,0这两个参数分别代表参数的个数以及脚本的名字

下面是一些额外的知识点

- 对脚本中的选项处理有一种常见的方法

  ```shell
  for option
  do
      ...
  done
  ```

  这种形式会将脚本参数一个一个赋值给option

  以下是一个简单的脚本示例

  ```shell
  for option
  do
      echo "$option"
  done
  ```

- 对经典option的探究——以nginx为例

  在nginx中有很多经典的代码思维，这里以nginx最先调用的option文件为例

  其在设置了许多变量后处理了参数选项，其中一部分代码如下

  ```shell
  for option
  do
      opt="$opt `echo $option | sed -e \"s/\(--[^=]*=\)\(.* .*\)/\1'\2'/\"`"
  
      case "$option" in
          -*=*) value=`echo "$option" | sed -e 's/[-_a-zA-Z0-9]*=//'` ;;
             *) value="" ;;
      esac
      case "$option" in
      ...
      
   done
  ```

  可见其主要由三部分构成，运用了很多正则表达式

  这里提一下sed命令：

  ![sed](https://s2.loli.net/2024/10/16/TAdUEBNMyGPm3ps.png)

  这里仅仅用到了sed的-e参数，通过脚本来处理输入的文本文件，这里还用到了另一种技术，管道pipeline，这里就不多赘述，对于所使用的正则表达式，可以不用学，gpt很好生成。

  这里的

  ```shell
  opt="$opt `echo $option | sed -e \"s/\(--[^=]*=\)\(.* .*\)/\1'\2'/\"`"
  ```

  即捕获命令中—arg-name=arg-value，并在arg_value中含有空格时也能保持参数的完整，并将其通过`‘--arg-name=arg-value’`的形式保存为列表通过

  ```c
  #define NGX_CONFIGURE " --add-module=./src/prefixfilter"
  ```

  的形式输出到c的头文件中与c语言交互

  ```shell
  case "$option" in
          -*=*) value=`echo "$option" | sed -e 's/[-_a-zA-Z0-9]*=//'` ;;
             *) value="" ;;
  esac
  ```

  这一部分将option提出value，并在后面

  ```shell
   --prefix=)                       NGX_PREFIX="!"            	;;
  ```

  这样赋值变量

准备结束，开始写一个自己的命令吧（与c语言交互

```shell
#!/bin/bash

opt=""
name=""
for option
do
    opt="$opt $(echo $option | sed -e "s/\(--[^=]*=\)\(.* .*\)/\1'\2'/")"

    case "$option" in
        -*=*) value=$(echo "$option" | sed -e 's/[-_a-zA-Z0-9]*=//') ;;
           *) value="" ;;
    esac

    case "$option" in
        --with-respect=*) with_respect=$value ;;
        --name=*)         name=$value ;;
    esac
done

TEST_H="./test.h"

echo "#define ARGS \"${opt[0]}\"" > $TEST_H
echo "#define NAME \"$name\"" >> $TEST_H
echo "#define WITH_RESPECT \"$with_respect\"" >> $TEST_H

gcc test.c -o test && ./test
```

```c
/*test.h*/
```

```c
/*test.c*/
#include <stdio.h>
#include "test.h"

int main(int args, char* argv)
{

	printf("Program running with ——");
	printf(ARGS);
	printf("\n");
	if(WITH_RESPECT=="yes")
		printf("Dear ");

	printf(NAME);
	printf("\n");
}
```

从这里也能看出来c中有种说明式头文件是从何儿来了，😀：）

这是一个非常简单且拙劣的脚本，nginx部分可供参考，但对于作者自己构建的代码，实际上可以通过更简单的，比如直接调用c的main传参实现，这里为讲述脚本与c之间的参数传递。以上

## 参考文献

1. [Bash Reference Manual (gnu.org)](https://www.gnu.org/savannah-checkouts/gnu/bash/manual/bash.html)
2. Kimi ai 、chatgpt（由作者prompt，并审查正确性）