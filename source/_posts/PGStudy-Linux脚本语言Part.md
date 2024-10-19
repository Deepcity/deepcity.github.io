---
title: PGStudy-Linux脚本语言Part
date: 2024-10-14 12:41:37
categories:
- 专题
- PGStudy
tags:  [Linux, 脚本]
---

# Shell Script

## Useful Features

1. 对赋值变量时，需要不留空格

2. 脚本中的代码每一行或分号隔开均当作单独的命令执行（控制语句除外）

   这导致一种很常见的用法即. /source_path/file 直接运行文件

3. script是运行时检查的，因此即使存在语法错误，script文件也可能是可以运行的，并且不会在错误时停止

4. #!/bin/sh通常指定脚本所用shell名称，类似的有#!/bin/bash…，该行也叫shebang行

## 默认变量\常用变量命名规范

<!--more-->

1. ？该变量表示上一个运行程序的返回值

2. $ - 该变量表示脚本的运行PID

3. \# - 该变量表示传递给脚本的参数数量， <=>等同于argc
4. @ - 该变量表示所有传递给脚本的参数
5. 1,2,3… - 表示将传递给脚本的参数分离到不同的变量中去，值得注意的是当参数大小大于10时，需要${10}这样的形式调度，常见的stdout（1），stderr（2）
6. PWD - 表示pwd命令的输出内容

## 语法相关

1. echo ‘$variable’是错误的，并不会输出value of variable,而是‘\$variable’，正确的使用方式是”\$variable”，同样正确的写法还有”\${variable}”

2. 变量赋值时等号两边不能加` `，否则脚本会解析为命令

3. {…}的用法

   ```shell
   echo {a...z} # => a b c d e f g h i j k l m n o p q r s t u v w x y z
   echo {$from...$to}
   ```

   会输出所有the range from the start value to the end value

4. 通过`(command)`可以执行`command`并将输出转化为一个匿名变量

   通过``的的方式可替代$()，但不能嵌套，因此并不推荐这样做

   ```shell
   echo $(pwd) # => 输出当前路径
   echo $PWD # 与上一行输出相同
   ```

   通过`$(())`可以运行表达式并将结果转化为一个变量

   ```shell
   echo $(( 10 + 5 )) # => 15
   ```

5. 读入语法为调用read命令

   ```shell
   # Reading a value from input:
   echo "What's your name?"
   read name
   # Note that we didn't need to declare a new variable.
   echo "Hello, $name!"
   ```

6. 在对变量本身操作或判断时不需要使用$，而读取值时需要

7. **进程替换Process Subsititution**

   对一个简单的进程替换示例如下

   ```shell
   echo <(echo "#helloworld")
   ```

   1. `<(echo "#helloworld")`：这部分是一个进程替换。它创建了一个临时的文件描述符，相当于一个临时文件，其中包含了`echo "#helloworld"`命令的输出。在这个例子中，输出就是字符串`#helloworld`。
   2. `echo`：这是Linux系统中的一个命令，用于在终端打印字符串。

   所以，整个命令`echo <(echo "#helloworld")`的含义是：首先执行`echo "#helloworld"`命令，将输出存储在一个临时文件中，然后`echo`命令读取这个临时文件的文件描述符，并将其打印到终端。

   而cat则会输出`#helloworld`

## 流程控制相关

### 条件控制语句

#### 语法

简单的条件控制语句示例如下

```shell
read name 
if [[ "$name" != "$USER" ]]; then # 这里的""可以去除
    echo "Your name isn't your username"
else
    echo "Your name is your username"
fi
```

可见

1. 条件控制语句中的条件判断由`[[]]`限定范围
2. 条件后有`;` `then`表示条件描述完毕，也可以不要`;`，转而吧then新开一行
3. 与python不一样，这里的缩进是任意的
4. 结尾的`fi`是必要的,表示条件控制块结束
5. 这里非常需要**注意的是` `的使用**，这里的`if`,`[[]]` `$name` `$USER`之间都一定需要空格

#### 运算符

一些运算符与条件控制语句的组合操作

```shell
read ags
read name
if [[$name == "Steve"]] && [[$age -eq 15]]; then
    echo "This will run if $name is Steve AND $age is 15"
fi

if [[$name == "Daniya"]] || [[$name == "Zach"]]; then
    echo "This will run if $name is Daniya OR $name is Zach"
fi
```

补充一些比较运算符如下：

```shell
# -ne - not equal
# -lt - less than
# -gt - greater than
# -le - less than or equal to
# -ge - greater than or equal to
```

有一个特殊运算符`=~`，该运算符将字符串与正则表达式作比较

一个简单的示例如下：

```shell
read email
if [[ $email =~ [a-z]+@[a-z]{2,}\.(com|net|org) ]]
then
    echo "Valid email!"
fi
```

这个正则表达的含义为`@`前必须有至少一个英文字母`@`后至少有两个，`.`后为com or net or org。

#### 简化版条件语句

```shell
echo "Always executed" || echo "Only executed if first command fails"
# => Always executed
echo "Always executed" && echo "Only executed if first command does NOT fail"
# => Always executed
# => Only executed if first command does NOT fail
```

以上是一个条件控制语句的简单示例

### case语句

该语句相当于switch…case..，一个基本的用法如下

```shell
case "$Variable" in # 这里的"依旧可以省略
    # List patterns for the conditions you want to meet
    0) echo "There is a zero.";;
    1) echo "There is a one.";;
    *) echo "It is not null.";;  # match everything
esac
```

值得注意的语法如下

1. 代替 case value: 的是`value)`
2. 每个case后都需要两个`;;`
3. esac作为标记结尾

### 循环语句

#### for循环

```shell
for Variable in {1..3}
do
    echo "$Variable"
done
```

这样的语句十分类似python，但不同的是

1. `do`和`done`无法省略用于标志循环体内的逻辑代码

传统的for循环如下

```shell
for ((a=1; a <= 3; a++))
do
    echo $a
done
```

与一些特殊类型——如文件、正则表达、命令、的输出进行交互

```shell
for Variable in file1 file2
do
    cat "$Variable"
done

for Output in $(ls)
do
    cat "$Output"
done

for Output in ./*.markdown
do
    cat "$Output"
done
```

#### while循环

```shell
while [ true ]
do
    echo "loop body here..."
    break
done
```

1. 循环体与条件退出的语法与for、if中的形式相似
2. 同样存在continue、break

## 字符串相关

1. ${variable:`a`:`b`}表示截取子字符串起始`a`长度`b`下标下的值（由0开始）
2. ${variable/`string`/`string1`}表示更换第一个string为string1
3. ${variable:-`a`}表示最后`a`位截取
4. ${ #variable}表示获取variable长度
5. ${!other_variable}表示获取other_variable值变量名得变量值

## 初始化相关

1. ${foo:-“DefaultValueIfFooIsMissingOrEmpty”}默认空字符或0时返回DefaultValueIfFooIsMissingOrEmpty

## 数组相关

### 定义

```shell
array=(one two three four five six)
```

定义了一个六个元素得数组

### 下标索引

```shell
echo "${array[0]}"
echo "${array[@]}"
echo "${#array[@]}"
echo "${#array[2]}"
echo "${array[@]:3:2}"
for item in "${array[@]}"; do
    echo "$item"
done
```

>one
>
>one two three four five six
>
>6
>
>5
>
>four five
>
>one two three four five six

基本用法类似字符串以及常规高级语言

不同点在于**表示所有数组时为@**

## 函数定义

一个简单的函数定义如下

```shell
function foo ()
{
    echo "Arguments work just like script arguments: $@"
    echo "And: $1 $2..."
    echo "This is a function"
    returnValue=0    # Variable values can be returned
    return $returnValue
}
# Call the function `foo` with two arguments, arg1 and arg2:
foo arg1 arg2
# => Arguments work just like script arguments: arg1 arg2
# => And: arg1 arg2...
# => This is a function
# Return values can be obtained with $?
```

## 文件相关

### 文件IO

常用写入文件示例

```python
cat > hello.py << EOF
#!/usr/bin/env python
from __future__ import print_function
import sys
print("#stdout", file=sys.stdout)
print("#stderr", file=sys.stderr)
for line in sys.stdin:
print(line, file=sys.stdout)
EOF
```

该操作将脚本后的内容读入EOF前将内容写进hello.py

## 参考资料

1. [鸟哥的Linux私房菜：基础学习篇 第四版 | 鸟哥的 Linux 私房菜：基础学习篇 第四版 (gitbooks.io)](https://wizardforcel.gitbooks.io/vbird-linux-basic-4e/content/)
2. [Shell - CSBasicKnowledge (cs-baoyan.github.io)](https://cs-baoyan.github.io/CSBasicKnowledge/useful/shell.html)
3. [Bash scripting cheatsheet (devhints.io)](https://devhints.io/bash)
4. [Learn X in Y Minutes: Scenic Programming Language Tours](https://learnxinyminutes.com/docs/bash/)