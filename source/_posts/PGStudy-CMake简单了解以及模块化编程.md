---
title: PGStudy-CMake简单了解以及模块化编程
date: 2024-10-17 13:33:25
categories:
- 专题
- PGStudy
tags: [CMake, Shell, C/CPP]
---
# CMake

## 概念

Cmake是一个跨平台的编译工具，用简单的命令取代繁琐的Makefile文件编写

## Grammar Feature

1. 基本语法格式为：**指令(参数1, 参数2…)**
2. 指令是大小写无关的，参数，变量是大小写相关的
3. 变量使用`${}`方式取值，但在IF控制语句中直接使用变量名

## Cmake中重要指令与常用变量

<!--more-->

### 重要指令

- ==cmake_minimum_required== - 指定Cmake最小版本要求

  ```cmake
  # Cmake最小版本要求为3.22.0
  cmake_minimum_required(VERSION 3.22.0)
  ```

- ==project== -  定义工程名

  ```cmake
  # 指定工程名为Project_Name
  project(Project_Name)
  ```

- ==set== - 显示定义的变量

  ```cmake
  # 定义SRC变量，其值为sayhello.cpp hello.cpp
  set(SRC sayhello.cpp hello.cpp)
  ```

- ==include_directories== - 向工程添加多个特定的头文件搜索路径，相当于g++的-l参数

  ```cmake
  # 将/myinclude /include添加到头文件搜索路径
  include_directories(./myinclude ./include)
  ```

- ==link_directories== - 项工程添加多个特定的库文件搜索路径，相当于g++编译时的-L参数

  ```cmake
  # 将/mylib /lib 添加到库文件搜索路径
  link_directories(./mylib ./lib)
  ```

- ==add_library== - 生成库文件

  ```cmake
  # 通过SRC生成libhello.so共享库
  add_library(hello SHARED ${SRC})
  ```

- ==add_compaile_option== - 添加编译参数

  ```cmake
  #添加编译参数 -Wall -std=c++11 -O2
  add_compile_options(-Wall -std=c++11 -O2)
  ```

- ==add_executable== - 生成可执行文件

  ```cmake
  # 编译main.cpp 生成执行文件main
  add_executable(main main.cpp)
  ```

- ==target_link_libraries== - 为target添加所需要链接的共享库 –> 相当于g++编译时的-I参数

  ```cmake
  # 将hello动态库文件链接到可执行文件main
  target_link_libraries(main hello)
  ```

- ==add_subdirectory== - 向当前工程田间存放源文件的子目录，并可以指定中间二进制和目标二进制的存放位置

  ```cmake
  # 添加src子目录，src中需要有一个CMakeLists.txt
  add_subdirectory(src)
  ```

- ==aux_source_directory== - 发现一个目录下所有的源代码文件并将列表存储在一个变量中，这个指令临时被用来自动构建源文件列表

  ```cmake
  # 定义SRC变量，其值为当前目录下所有的源代码文件
  aux_source_directory(. SRC)
  # 编译SRC变量所代表的源代码文件，生成main可执行文件
  add_executable(main ${SRC})
  ```

### 常用参数

- ==CMAKE_C_FLAGS== gcc编译选项

- ==CMAKE_CXX_FLAGS== g++编译选项

  ```cmake
  # 在CMAKE_CXX_FLAG变量后追加std=c++11
  set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -std=c++11")
  ```

- ==CMAKE_BUILD_TYPE== 编译类型(DEBUG, RELEASE)

- ==CMAKE_BINARY_DIR== 指Cmake的build的生成二进制文件夹

- ==CMAKE_C_STANDARD== 指编译过程中C的标准

- ==CMAKE_CXX_STANDARD== 指编译过程过程中的CPP标准

## Cmake参数选项

### 添加编译参数与预处理指令

在makefile中，通过shell形式的configure与makefile的配合可以实现对可选模块与编译可选指令的支持，在Cmake中，通过option与一些其他命令同样可以做到对可选模块与编译指令的支持。

1. **添加编译参数：**
2. 使用`add_compile_options`命令。这个命令将添加到所有的目标上。例如：
   `cmake add_compile_options(-Wall)`
3. 使用`target_compile_options`命令。这个命令只会添加到指定的目标上。例如：
   `cmake target_compile_options(target PRIVATE -Wall)` - `set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ...")`是另一种常见的添加编译参数的方法。这种方法直接修改了CMake的全局变量，所以它会影响到所有的目标。
   例如，如果你想添加`-Wall`编译选项，你可以这样写： ```cmake set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wall") ``` 这行代码的意思是，将`-Wall`添加到`CMAKE_CXX_FLAGS`变量中。`CMAKE_CXX_FLAGS`变量包含了C++编译器的编译选项。 同样的，对于C编译器，你可以使用`CMAKE_C_FLAGS`： ```cmake set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} -Wall") ``` 这种方法的一个缺点是，它会影响到所有的目标，而不仅仅是一个特定的目标。如果你只想为一个特定的目标添加编译选项，你应该使用`target_compile_options`命令。
4. **添加预处理指令：**
5. 使用`add_definitions`命令。这个命令将添加到所有的目标上。例如：
   `cmake add_definitions(-DDEBUG)`
6. 使用`target_compile_definitions`命令。这个命令只会添加到指定的目标上。例如：
   `cmake target_compile_definitions(target PRIVATE DEBUG)`

在上述两个例子中，`DEBUG`是一个预处理指令，它会在编译时被定义。

注意，`PRIVATE`、`PUBLIC`、`INTERFACE`这些关键字的含义：

- `PRIVATE`：只有目标自己会使用这些编译参数。
- `PUBLIC`：目标自己和其他依赖这个目标的目标都会使用这些编译参数。
- `INTERFACE`：只有其他依赖这个目标的目标会使用这些编译参数。

下面将给出一个示例

```cmake
# CMakeList.txt
cmake_minimum_required(VERSION 3.22)
project(HBM-Test-C)

set(CMAKE_C_STANDARD 17)

set(SRC_FILES hbm-test.c
        src/hbm-test-bitmodifier.c
        src/hbm-test-bitmodifier.h
        )

# 可选模块
option(WITH_ENCODE_FILE "Compile with encode file support" OFF)

if(WITH_ENCODE_FILE)
    message(STATUS "Compiling with encode file support...")
    list(APPEND SRC_FILES src/hbm-test-file.c src/hbm-test-file.h)
    add_compile_definitions(ENABLE_ENCODE_FILE)
endif()

add_executable(HBM-Test-C ${SRC_FILES})

configure_file(./SimulationHBMFile.hex
        "${CMAKE_BINARY_DIR}/SimulationHBMFile.hex" COPYONLY)

```

```c
/*test.c*/
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>

#include "src/hbm-test-bitmodifier.h"

#ifdef ENABLE_ENCODE_FILE
#include "src/hbm-test-file.h"
#endif

int mem_block_test(uint64_t *buf, uint64_t count) {
    set_mem_all_one(buf, count);
    // set_mem_all_zero(buf, count);
    // set_mem_cross_col(buf, count, 0 );
    // set_mem_cross_row(buf, count, 0);
    // set_mem_x_shape(buf, count, 0);

    // fclose(file);

#ifdef ENABLE_ENCODE_FILE
    printf("HBM-Test-C: ENABLE_ENCODE_FILE\n");

    encode2file(buf,count,"SimulationHBMFile.hex");
#endif

    return 0;
}

int main() {
    uint64_t buf_size = 4 * 1024;
    uint64_t count = buf_size / sizeof(uint64_t);
    uint64_t *buf = (uint64_t *) malloc(buf_size); /*模拟HBM内存映射*/
    int ret = mem_block_test(buf, count);          /*执行压测接口*/
    if (ret != 0) printf("fail\n");          /*判断压测接口返回值*/
    else printf("success\n");

    free(buf);

    return 0;
}

```

这段代码解耦了对内存映射的赋值与文件的赋值，甚至解耦了对不同模块的编译，对小型项目具有一定的参考意义，在CMake中仍存在很多特性这里并未提及，并且这里的代码也并不规范（这可能导致预处理的作用范围扩展）。但对初学者很好理解cmake如何使项目模块化。下面是一些命令行代码。

```shell
# 处在项目文件CMakeLists.txt同级目录下
mkdir build
cd build
cmake .. -DWITH_ENCODE_FILE=$ENCODE_FILE
cmake --build .
./HBM-Test-C
```

如果希望用脚本进一步封装，一个我目前学习到的写法如下

```
# start.sh

# clean build dir
rm -rf build

# process option remaining for -*=* format options
ENCODE_FILE="OFF"
for option
do
  case "$option" in
    -*=*) value=`echo "$option" | sed -e 's/[-_a-zA-Z0-9]*=//'` ;;
       *) value=""
  esac
  case "$option" in
    --with-encode-file) ENCODE_FILE="ON"  ;;
    --help)               help=yes          ;;
  esac
done
if [ $help == "yes" ]
  then
    cat<<END
    --with-encode-file    Encode buf's data to SimulationHBMFile
    --help                Print help lists
END
    exit 1
fi

# create build and run code
mkdir build
cd build
cmake .. -DWITH_ENCODE_FILE=$ENCODE_FILE
cmake --build .
./HBM-Test-C
```

这里的代码为某个项目代码，并不能提供完整代码，请注意辨别，仅作示意。

以上

## 参考文献

1. [基于vscode与cmake实现c/c++开发 哔哩哔哩_bilibili](https://www.bilibili.com/video/BV1fy4y1b7TC?spm_id_from=333.788.videopod.episodes&vd_source=4196d3ab631b1a547985ce2b3f25d1ea&p=5)
2. [【Cmake 增加编译参数 】cmake增加编译参数和预处理指令的几种方法 - 知乎 (zhihu.com)](https://zhuanlan.zhihu.com/p/661281857)
3. chatgpt \ kimi ai (由作者prompt并审查正确性)