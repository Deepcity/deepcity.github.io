---
title: PGStudy-Go语言入门Part
date: 2024-10-19 16:16:14
categories:
- 专题
- PGStudy
tags: [Go, Golang, 编程语言]
---
# Go 语言入门

Go拥有命令时语言的静态类型，编译与执行的很快，同时加入了对多核CPU的并发计算支持。

在Go中的开发主要有以下几点使得其有着比c/cpp更广泛的运用

1. 并发支持，其通过goroutine和channel 提供了对并发的强力支持
2. 简单性易用，相比c/cpp其语法更简单，学习曲线平缓
3. 标准库：其在网络和并发编程方面提供了广反的标准库
4. 垃圾回收：其相比c/cpp更不容易出现内存泄漏

该记录并不适用于无编程基础入门编程，而是对已有其他语言基础的Go入门，会掠过一些常见定义

<!--more-->

## 入门示例

```go
package main

import "fmt"

func main() {
	fmt.Println("Hello, 世界")
}
```

该块代码会打印

> Hello, 世界

## Go的包管理

1. import导入包

2. 包名与导入路径的最后一个元素一致。例如，`"math/rand"` 包中的源码均以 `package rand` 语句开始

3. 分组导入

   ```go
   import (
   	"fmt"
   	"math"
   )
   ```

   Go官方推荐使用该种方式导入包

4. 导出包名与非导出包名在命名格式上的区分

   导出报名的首字母通常大写，未导出的通常小写

5. Go中有一个特别的库，他并不是一个库，但却以库的形式导入，其作用是为了标记主函数所在的文件

   ```go
   package main
   ```

6. Go不允许调包但不使用

## Go的函数规范

1. Go的函数声明与定义一体，同一文件下，函数定义与调用顺序打乱不会报错

   定义规范如下

   ```go
   func function_name(var1 var1_type, var2 var2_type) return_type
   ```

   其中var1_type, var2_type, return_type为代指类型

2. 对多个相同类型的，有语法糖

   ```go
   func function_name(var1, var2 var1_var2_type) return_type
   ```

3. 函数的多返回值

   ```go
   func function_name(var1, var2 var1_var2_type) (return_type1, return_type2)
   ```

4. 语法糖，裸的返回值

   即命名返回值后将函数内同名的局部变量作为返回值返回

## 基础语法

1. var语句，用于声明一系列的变量如下

   ```go
   var　var1,var2,var3 var_type
   ```

   var语句可以出现在包或函数的任意层级

2. 变量声明的过程中可以包含初始值，每一个变量对应一个初始值

   ```go
   var var1,var2,var3 int = 1,2,3
   ```

3. 短变量声明

   在函数中`:=`运算符可以隐式确定变量类型

   如：

   ```go
   func main() {
   	var i, j int = 1, 2
   	k := 3
   	c, python, java := true, false, "no!"
   
   	fmt.Println(i, j, k, c, python, java)
   }
   ```

   **值得注意的是对非关键字开始的语句都不能直接使用在函数外**

4. Go的基本类型有如下几种

   ```go
   bool
   
   string
   
   int  int8  int16  int32  int64
   uint uint8 uint16 uint32 uint64 uintptr
   
   byte // uint8 的别名
   
   rune // int32 的别名
        // 表示一个 Unicode 码位
   
   float32 float64
   
   complex64 complex128
   ```

   基本等同于c\cpp但多出，且部分变量的命名规则也不尽相同

   ```go
   uintptr rune complex64 complex128
   ```

   值得注意的是，**类似java**，go语言并不是python那种直接贴类型的变量赋值而是通过math/big包实现的大整数运算，int类型一般默认是64位

5. 在Go中所有的不同类型变量相互赋值之间都需要进行显式的类型转换

6. **数据常量直接是高精度的值，一个未指定类型的常量由上下文来决定其类型。**

## 流程控制语句语法

### 循环

**Go中只有一种循环——for循环**,并不存在while循环

基本的for循环由三部分组成，他们由分号隔开：

```go
for i := 0; i < 10; i++ {}
```

1. 很奇葩，有点像c但没有括号，有点像py但没有:，**但{}是必须的**

2. 前置的与后置的可以去掉，甚至;也能去掉，甚至循环条件也可以去掉

   ```go
   # 去掉初始化与步进
   for ; i<10 ; {}
   
   # 去掉分号
   for i<10 {}
   
   # 去掉所有
   for {}
   ```

   因此Go中的for也可以等同于while

3. range遍历

   在go中,也可以通过range的形式遍历字符串，一个简单的样例如下所示

   ```
   for _,val := arr {fmt.Printf("%d\n", val)}
   ```

   

### 条件控制语句

1. if

   其格式与for相差无几

   ```go
   if x<0 {}
   ```

2. if 在条件语句前也可以执行一个简端语句，该语句的变量作用与仅在if之内

3. else的定义则与c接近

   ```go
   if v := math.Pow(x, n); v < lim {
   	return v
   } else {
   	fmt.Printf("%g >= %g\n", v, lim)
   }
   // can't use v here, though
   return lim
   ```

4. switch语法是编写一连串`if - else` 的简便方法。 它运行第一个case值 值等于条件表达式得字句

   ````go
   fmt.Print("Go 运行的系统环境：")
   switch os := runtime.GOOS; os {
   case "darwin":
   	fmt.Println("macOS.")
   case "linux":
   	fmt.Println("Linux.")
   default:
   	// freebsd, openbsd,
   	// plan9, windows...
   	fmt.Printf("%s.\n", os)
   }
   ````

5. Go中得Switch会在匹配成功时直接终止

6. 无条件得switch同switch true一样，这样得形式能将 if-then-else 写的更加清晰

   ```go
   switch {
   case t.Hour() < 12:
   	fmt.Println("早上好！")
   case t.Hour() < 17:
   	fmt.Println("下午好！")
   default:
   	fmt.Println("晚上好！")
   }
   ```

### defer推迟语句

这种语句实际上有非常简单得逻辑，但运用起来可能会变得很难，类似其他语言得函数栈一样，其维护了一个自身得函数栈，后进先出得推迟其所调用得函数推迟调用的函数其参数会立即求值，但直到外层函数返回前该函数都不会被调用。

eg：

```go
package main

import "fmt"

func main() {
	fmt.Println("counting")

	for i := 0; i < 10; i++ {
		defer fmt.Println(i)
	}

	fmt.Println("done")
}
```

> done
>
> 9
>
> 8
>
> 7
>
> …
>
> 0

## 指针与复杂结构

### 指针

- 定义方式

  ```go
  var p *int
  ```

  **Go中没有指针运算**

### 结构体

- 定义方式

```go
type Vertex struct {
    X int
    Y int
}
```

其初始化方式包括 `Vertex{var1, var2}`，使用方式`.`都与cpp很相似

- 语法糖

  1. 通过结构体指针进行的成员变量调用`(*p).var1` => `p.var1`

  2. `Name: `语法结构，通过该方式可以将变量指定的赋值，未指定的变量将被默认设为初始值

  3. 有一种常见的临时结构体的定义方式，它很好的展现了go对数组，结构体及其初始化的语法

     ```go
     s := []struct {
     		i int
     		b bool
     	}{
     		{2, true},
     		{3, false},
     		{5, true},
     		{7, true},
     		{11, false},
     		{13, true},
     	}
     ```

     

### 数组

- 简单定义

  `[n]T` 表示一个数组，它拥有`n`个类型为`T`的值

- 切片

  同python一致，其会选出一个半闭半开区间

  ```go
  a[low : high] /* 其切片下标为 low low+1 ... high-1 high */
  ```

  **切片仅描述了数组的一段，就像数组的引用，并没有自身的存储数据**

  ```go
  func main() {
  	names := [4]string{
  		"John",
  		"Paul",
  		"George",
  		"Ringo",
  	}
  	fmt.Println(names)
  
  	a := names[0:2]
  	b := names[1:3]
  	fmt.Println(a, b)
  
  	b[0] = "XXX"
  	fmt.Println(a, b)
  	fmt.Println(names)
  }
  ```

  在go-tourism中的这段代码非常好的展现了**切片仅是数组的引用这一个概念**

  1. 切片是对数组的引用

  2. 切片的下界默认是0，上界默认是该数组的大小

     ```go
     a[0:10] <=> a[:10] <=> a[0:] <=> a[:]
     ```

  3. 切片有两个重要参数 cap and len

     切片的长度就是它所包含的元素个数。

     切片的容量是从它的第一个元素开始数，到其底层数组元素末尾的个数。

     也就是说len是这个切片现在的大小，而cap指该切片所属数组从切片起始位置还有多少容量

     **切片截取后面的仍能通过扩展找回数据，但截取前面无法恢复，且扩展无法超过cap，超过就会报错**

     ```go
     s := []int{2, 3, 5, 7, 11, 13}
     printSlice(s)
     
     // 截取切片使其长度为 0
     s = s[:0]
     printSlice(s)
     
     // 扩展其长度
     s = s[:6]
     printSlice(s)
     
     // 舍弃前两个值
     s = s[2:]
     printSlice(s)
     
     s = s[0:]
     printSlice(s)
     ```

  4. 切片的0值为nil

  5. 切片可以通过内置函数make来创建

     ```go
     a := make([]int, 0, 5) /* 这里指定了3种参数，第一个是Type，第二个是指定len，第三个是指定cap */
     ```

  6. 切片之间可以有嵌套关系

  7. append()函数可以向切片中新添加值

     当 `s` 的底层数组太小，不足以容纳所有给定的值时，它就会分配一个更大的数组。 返回的切片会指向这个新分配的数组。

  8. for循环遍历切片是，每次都会返回两个值——第一个是下标，第二个是数组中的值

     有以下几种简单写法

     ```go
     for i, _ := range blank
     for _, i := range blank
     for i := range blank /*在这一种写法下，i仅仅被赋予下标值*/
     ```

### MAP Key2Value

- 定义

  ```go
  type Vertex struct {
  	Lat, Long float64
  }
  
  var m map[string]Vertex
  func main() {
  	m = make(map[string]Vertex)
  	m["Bell Labs"] = Vertex{
  		40.68433, -74.39967,
  	}
  	fmt.Println(m["Bell Labs"])
  }
  ```

  可见其定义与c/cpp还是有较大区别

- 语法糖

  若顶层类型仅仅知识一个类型名那么可以忽略它

  ```go
  var m = map[string]Vertex{
  	"Bell Labs": {40.68433, -74.39967},
  	"Google":    {37.42202, -122.08408},
  }
  ```

  可见此处的`:`后面并未见Vertex

- 修改映射

  在映射 `m` 中插入或修改元素：

  ```go
  m[key] = elem
  ```

  获取元素：

  ```go
  elem = m[key]
  ```

  删除元素：

  ```go
  delete(m, key)
  ```

  通过双赋值检测某个键是否存在：

  ```go
  elem, ok = m[key]
  ```

  若 `key` 在 `m` 中，`ok` 为 `true` ；否则，`ok` 为 `false`。

  若 `key` 不在映射中，则 `elem` 是该映射元素类型的零值

### 函数值

在go中函数也是一种值，函数值可以用作函数的参数或返回值，在go-tourism中的一个示例如下

```go
package main

import (
	"fmt"
	"math"
)

func compute(fn func(float64, float64) float64) float64 {
	return fn(3, 4)
}

func main() {
	hypot := func(x, y float64) float64 {
		return math.Sqrt(x*x + y*y)
	}
	fmt.Println(hypot(5, 12))

	fmt.Println(compute(hypot))
	fmt.Println(compute(math.Pow))
}
```

可见最重要的如何定义一个函数值的类型，即：传入参数类型，返回值类型，定义如下

```go
func(VAR_TYPE1, VAR_TYPE2) RET_TYPE
```

### 函数闭包

函数闭包是指一个函数与其外部环境（词法作用域）结合形成的一个整体。在 JavaScript 等编程语言中，闭包能够记住并访问其外部函数的作用域，即使外部函数已经返回。

闭包的关键特性包括：

1. **封闭数据**：闭包可以访问其外部函数中的变量，保护这些变量不被外部直接访问。
2. **持久化作用域**：即使外部函数已经执行完成，闭包依然能够访问其作用域中的变量。
3. **函数工厂**：闭包可以返回一个新的函数，该函数可以使用外部函数的参数。

一个简单的返回加法闭包函数的函数定义与使用

```go
package main

import "fmt"

func adder() func(int) int {
	sum := 0
	return func(x int) int {
		sum += x
		return sum
	}
}

func main() {
	pos, neg := adder(), adder()
	for i := 0; i < 10; i++ {
		fmt.Println(
			pos(i),
			neg(-2*i),
		)
	}
}

```

## 方法和接口与异常

### 方法

Go中是没有类的概念的，因此方法和接口对Go的重要性也就不言而喻了

方法就是一类带特殊的接收者参数的函数，方法是定义的目的一般为类型服务的，本质上就是一个带接收者参数的函数一个简单的示例如下

```go
package main

import (
	"fmt"
	"math"
)

type Vertex struct {
	X, Y float64
}

func (v Vertex) Abs() float64 {
	return math.Sqrt(v.X*v.X + v.Y*v.Y)
}

func main() {
	v := Vertex{3, 4}
	fmt.Println(v.Abs())
    fmt.Println(Abs(v)) // 输出并不会发生变化
}
```

1. 接收者的类型定义与方法声明必须在同一包内

2. 指针类型的接收者与值类型的接收者，这两者的区别就在于是否会对原始结构值产生修改，更加常用的是指针类型的接收者

   ```go
   func (v *Vertex) Scale(f float64) {
   	v.X = v.X * f
   	v.Y = v.Y * f
   }
   ```

   因为方法经常需要修改它的接收者

   **对于指针类型接收者来说，(&STRUCT_TYPE).MEASURE**这样的调用形式才是正确的，而在go中，简化为了指针类型接收者**既可以是值，又可以是指针**

   然而，对于一个函数来讲就不行。

### 接口

- 定义

  **接口类型** 的定义为一组方法签名。

- 理念

​	由接口类型定义的变量可以持有任意实现了接口定义方法的值并调用这些方法

- 隐式实现

  类型通过实现一个接口的所有方法来隐式的实现接口

- **接口值**

  在内部，接口值可以看做包含值和具体类型的元组：

  ```
  (value, type)
  ```

  接口值保存了一个具体底层类型的具体值。

- **空接口**

  空接口可用来保存任何类型的值（每种类型至少实现了0种方法）

  空接口被用来处理未知类型的值

  例子如下，一个经典的例子就是fmt的Printf函数

  ```go
  func main() {
  	var i interface{}
  	describe(i)
  
  	i = 42
  	describe(i)
  
  	i = "hello"
  	describe(i)
  }
  
  func describe(i interface{}) {
  	fmt.Printf("(%v, %T)\n", i, i)
  }
  ```

- 普遍的接口

  fmt包中有一个Stringer接口，其定义形同下

  ```go
  type Stringer interface {
      String() string
  }
  ```

  实现了该接口的类型将可以被一些方法如Println调用，一个例子如下

  ```go 
  type Person struct {
  	Name string
  	Age  int
  }
  
  func (p Person) String() string {
  	return fmt.Sprintf("%v (%v years)", p.Name, p.Age)
  }
  
  func main() {
  	a := Person{"Arthur Dent", 42}
  	z := Person{"Zaphod Beeblebrox", 9001}
  	fmt.Println(a, z)
  }
  ```

  如果尝试在String()方法中加点料，会惊奇的发现输出顺序和预想的不同

  ```go
  func (p Person) String() string {
  +++	fmt.Printf("Before test ...\n")
  	return fmt.Sprintf("%v (%v years)", p.Name, p.Age)
  }
  ```

  这是由于`Sprintf`并不是一个输出函数，而是将对应变量格式化一个字符串返回

  因此这里的输出函数会先Println一步输出

### 异常

- 类型断言

  类型断言是指对

  ```go
  t := i.(T)
  ```

  的使用t被赋值为T类型

  **这与c、cpp中的转换不同，对float64类型的int类型调用并不会导致float的转换而是返回int类型0值与false**，值得注意的是，这样的调用实际上是访问接口值底层具体值的方式，对于**不是接口值得值，并不能这样调用**

  其实际含义是**调用接口值底层具体值**

  ```go
  func main() {
  	var i interface{} = 2.25
  
  	s := i.(float64)
  	fmt.Println(s)
  
  	s, ok := i.(float64)
  	fmt.Println(s, ok)
  
  	f, ok := i.(int)
  	fmt.Println(f, ok)
  	
  	j := 2.25
  	f = j.(int)
  	fmt.Println(f)
  }
  
  ```

  >```
  >hello
  >hello true
  >0 false
  >panic: interface conversion: interface {} is string, not float64
  >
  >goroutine 1 [running]:
  >main.main()
  >	/tmp/sandbox1965247488/prog.go:17 +0x14f
  >```

  这里的`panic`就相当于RE

  >`panic` 是 Go 语言中的一个内置函数，用于引发运行时错误。调用 `panic` 会停止当前的函数执行，并开始逐层向上返回，直到找到一个处理 `panic` 的 `recover` 调用或程序终止。

  使用 `panic` 通常用于表示不可恢复的错误，比如访问数组越界、空指针解引用等。

- 类型选择

  ```go
  switch v := i.(type) {
  case T:
      // v 的类型为 T
  case S:
      // v 的类型为 S
  default:
      // 没有匹配，v 与 i 的类型相同
  }
  ```

  1. 这里的类型选择中的v会被直接赋值为接口之所存储类型的值
  2. `i.(type)` 只能被用于类型选择结构中，其只能与该结构搭配，否则会出选语法错误

  这里有一些fmt Printf 与 Println之间的区别与格式符的定义内容

  >`Printf` 和 `Println` 的主要区别在于格式化输出。`Printf` 允许使用格式化字符串来指定输出的格式，而 `Println` 则会将参数直接输出，并在末尾添加换行符。
  >
  >在 Go 中，相比于 C，常见的格式化输出符号包括：
  >
  >- `%v`：值的默认格式
  >- `%#v`：值的 Go 语法表示
  >- `%T`：值的类型
  >- `%t`：布尔值
  >- `%q`: 输出字符串的双引用格式，并对其中特殊字符进行转义
  >
  >其他常见的输出函数包括：
  >
  >- `Print`：直接输出，不添加换行
  >- `Errorf`：格式化错误消息
  >- `Fprintf`：将输出写入指定的 `io.Writer`（如文件）

- **错误**

  Go 程序使用 `error` 值来表示错误状态。

  与 `fmt.Stringer` 类似，`error` 类型是一个内建接口：

  ```go
  type error interface {
      Error() string
  }
  ```

  在gotourism的实例中，自建了一个MyError类并实现了error接口中的Error方式隐式实现了error接口，其中调用了time库中的Time类型与Now方法详细代码如下

  ```go
  package main
  
  import (
  	"fmt"
  	"time"
  )
  
  type MyError struct {
  	When time.Time
  	What string
  }
  
  func (e *MyError) Error() string {
  	return fmt.Sprintf("at %v, %s",
  		e.When, e.What)
  }
  
  func run() error {
  	return &MyError{
  		time.Now(),
  		"it didn't work",
  	}
  }
  
  func main() {
  	if err := run(); err != nil {
  		fmt.Println(err)
  	}
  }
  ```

  值得注意的是这里是强调了Error定义的规范性，实际上这里的it didn’t work，并不针对任何函数，硬要牵强附会的就是main函数中的if语句报的错，一个典型的异常定义在练习中定义sqrt的负数处理错误可以见到，其在sqrt处理负数时做出了异常处理（虽然仅仅只是指出错误）。

## IO

前面零零散散的提到了fmt中的Print、Printf、Println函数，其中Print，Println输出不格式化，Println换行，Printf输出格式化

在Go-Tourism最后几章提到了`io`包，该包包含了许多接口的实现，如`文件`、`网络链接`、`压缩`、`加密`等。

- Read - io.Reader

`io.Reader`接口中有一个Read方法：

```go
fun (T) Read(b []byte) (n int,err error)
```

`Read` 用数据填充给定的字节切片并返回填充的字节数和错误值。在遇到数据流的结尾时，它会返回一个 `io.EOF` 错误。

在Go-Tourism的例子中，提到了另一个包strings，其中的NewReader方法会返回一个实现了Reader接口中的Reader方法的strings.Reader类型的指针

具体代码如下

```go
package main

import (
	"fmt"
	"io"
	"strings"
)

func main() {
	r := strings.NewReader("Hello, Reader!")

	b := make([]byte, 8)
	for {
		n, err := r.Read(b)
		fmt.Printf("n = %v err = %v b = %v\n", n, err, b)
		fmt.Printf("b[:n] = %q\n", b[:n])
		if err == io.EOF {
			break
		}
	}
}

```

- image

  [`image`](https://go-zh.org/pkg/image/#Image) 包定义了 `Image` 接口：

  ```
  package image
  
  type Image interface {
      ColorModel() color.Model
      Bounds() Rectangle
      At(x, y int) color.Color
  }
  ```

  **注意:** `Bounds` 方法的返回值 `Rectangle` 实际上是一个 [`image.Rectangle`](https://go-zh.org/pkg/image/#Rectangle)，它在 `image` 包中声明。

  （请参阅[文档](https://go-zh.org/pkg/image/#Image)了解全部信息。）

  `color.Color` 和 `color.Model` 类型也是接口，但是通常因为直接使用预定义的实现 `image.RGBA` 和 `image.RGBAModel` 而被忽视了。这些接口和类型由 [`image/color`](https://go-zh.org/pkg/image/color/) 包定义。

  对图像的需求因人而异，这里仅限于生成一个“花里胡哨”的图像，见练习答案

## 泛型

- **范型参数**

- 可以使用类型参数编写 Go 函数来处理多种类型。 函数的类型参数出现在函数参数之前的方括号之间。

  ```
  func Index[T comparable](s []T, x T) int
  ```

  此声明意味着 `s` 是满足内置约束 `comparable` 的任何类型 `T` 的切片。 `x` 也是相同类型的值。

  `comparable` 是一个有用的约束，它能让我们对任意满足该类型的值使用 `==` 和 `!=` 运算符。在此示例中，我们使用它将值与所有切片元素进行比较，直到找到匹配项。 该 `Index` 函数适用于任何支持比较的类型。

  ```go
  // Index 返回 x 在 s 中的下标，未找到则返回 -1。
  func Index[T comparable](s []T, x T) int {
  	for i, v := range s {
  		// v 和 x 的类型为 T，它拥有 comparable 可比较的约束，
  		// 因此我们可以使用 ==。
  		if v == x {
  			return i
  		}
  	}
  	return -1
  }
  
  func main() {
  	// Index 可以在整数切片上使用
  	si := []int{10, 20, 15, -10}
  	fmt.Println(Index(si, 15))
  
  	// Index 也可以在字符串切片上使用
  	ss := []string{"foo", "bar", "baz"}
  	fmt.Println(Index(ss, "hello"))
  }
  ```

  > 2
  >
  > -1

  类似c++

- 泛型类型

  ```go
  // List 表示一个可以保存任何类型的值的单链表。
  type List[T any] struct {
  	next *List[T]
  	val  T
  }
  ```

## 并发

- Goroutine

  Goroutine是由Go运行时管理的轻量级线程

  ```go
  go f(x,y,z)
  ```

  会启动一个新的go协程运行

  Go 程在相同的地址空间中运行，因此在访问共享的内存时必须进行同步。[`sync`](https://go-zh.org/pkg/sync/) 包提供了这种能力，不过在 Go 中并不经常用到，因为还有其它的办法。

- chan信道

  定义方式

  ```go
  make(chan TYPE)
  ```

  这样就定义了一个类型为TYPE 的信道，信道在默认情况下在发送与接受操作在另一端准备好之前都会阻塞，其调用方式如下：

  ```go
  ch <- v    // 将 v 发送至信道 ch。
  v := <-ch  // 从 ch 接收值并赋予 v。
  ```

  GO-TOURISM中给出

  ```go
  func sum(s []int, c chan int) {
  	sum := 0
  	for _, v := range s {
  		sum += v
  	}
  	c <- sum // 发送 sum 到 c
  }
  
  func main() {
  	s := []int{7, 2, 8, -9, 4, 0}
  
  	c := make(chan int)
  	go sum(s[:len(s)/2], c)
  	go sum(s[len(s)/2:], c)
  	x, y := <-c, <-c // 从 c 接收
  
  	fmt.Println(x, y, x+y)
  }
  
  ```

  我们的预期是x为前半部分，y为后半部分，但实际可能不是这样

  因为**goruntine是并发执行的，并不保证他们的顺序是一定的（即按照代码顺序的）**，**信道本身是有序的，FIFO**

  信道是具有缓冲区的，如过超过缓冲会报错

  ```go
  all goroutines are asleep - deadlock!
  ```

  **range 和 close 与信道**

  发送者可通过 `close` 关闭一个信道来表示没有需要发送的值了。接收者可以通过为接收表达式分配第二个参数来测试信道是否被关闭：若没有值可以接收且信道已被关闭，那么在执行完

  ```
  v, ok := <-ch
  ```

  此时 `ok` 会被设置为 `false`。

  循环 `for i := range c` 会不断从信道接收值，直到它被关闭。

  **注意**： 只应由发送者关闭信道，而不应油接收者关闭。向一个已经关闭的信道发送数据会引发程序 panic。

  **还要注意**： 信道与文件不同，通常情况下无需关闭它们。只有在必须告诉接收者不再有需要发送的值时才有必要关闭，例如终止一个 `range` 循环。

  **select与信道**

  当 `select` 中的其它分支都没有准备好时，`default` 分支就会执行。

  为了在尝试发送或者接收时不发生阻塞，可使用 `default` 分支：

  两个例子如下：

  ```go
  func fibonacci(c, quit chan int) {
  	x, y := 0, 1
  	for {
  		select {
  		case c <- x:
  			x, y = y, x+y
  		case <-quit:
  			fmt.Println("quit")
  			return
  		}
  	}
  }
  
  func main() {
  	c := make(chan int)
  	quit := make(chan int)
  	go func() {
  		for i := 0; i < 10; i++ {
  			fmt.Println(<-c)
  		}
  		quit <- 0
  	}()
  	fibonacci(c, quit)
  }
  
  ```

  ```go
  func main() {
  	tick := time.Tick(100 * time.Millisecond)
  	boom := time.After(500 * time.Millisecond)
  	for {
  		select {
  		case <-tick:
  			fmt.Println("tick.")
  		case <-boom:
  			fmt.Println("BOOM!")
  			return
  		default:
  			fmt.Println("    .")
  			time.Sleep(50 * time.Millisecond)
  		}
  	}
  }
  
  ```

- **sync.Mutex**

  最后这个是一个互斥所得数据结构，其是一种数据类型，其具有两个方法，LockandUnlock，这两种方法在调用c得参数前使用可以保证一个类型是并发安全得

  ```go
  // SafeCounter 是并发安全的
  type SafeCounter struct {
  	mu sync.Mutex
  	v  map[string]int
  }
  ```

  在Go-Tourism给出的示例中有一个很有趣的方法

  ```go
  // Value 返回给定键的计数的当前值。
  func (c *SafeCounter) Value(key string) int {
  	c.mu.Lock()
  	// 锁定使得一次只有一个 Go 协程可以访问映射 c.v。
  	defer c.mu.Unlock()
  	return c.v[key]
  }
  ```

  该方法显然是要取得一个值，但c.v[lkey]对互斥数据的访问在直接return下不好处理，可以先用临时变量保存再return，但这样凭空多出了开销，于是使用defer推迟语句。

## GO-TOURISM练习个人答案

### 基础

- 循环与函数

  ```go
  package main
  
  import (
  	"fmt"
  )
  
  func Abs(x float64) float64 {
  	if x < 0 {return -x}
  	return x
  }
  
  func Sqrt(x float64) float64 {
  	z := 1.0
  	for Abs(z * z - x) > 1e-12{
  		z -= (z * z - x) / (2*z)
  		fmt.Println(z)
  	}
  	return z
  }
  
  func main() {
  	fmt.Println(Sqrt(2))
  }
  ```

- 切片

  ```go
  package main
  
  import "golang.org/x/tour/pic"
  // import "math"
  
  func Pic(dx, dy int) [][]uint8 {
  	var ret = make([][]uint8, dy)
  	for y := 0; y < dy; y++ {
  		ret[y] = make([]uint8, dx)
  		for x := 0; x < dx; x++ {
  			// ret[y][x] = uint8((x + y) / 2)
  			// ret[y][x] = uint8(x*y)
  			// ret[y][x] = uint8(x^y)
  			// ret[y][x] = uint8(float64(x) * math.Log(float64(y)))
  			ret[y][x] = uint8(x % (y+1) )
  		}
  	}
  	return ret
  }
  
  func main() {
  	pic.Show(Pic)
  }
  
  ```

- 映射

  ```go
  package main
  
  import (
  	"golang.org/x/tour/wc"
  	"strings"
  )
  
  func WordCount(s string) map[string]int {
  	var ret = make(map[string]int)
  	for _, word := range strings.Fields(s){
  		ret[word]++
  	}
  	return ret
  }
  
  func main() {
  	wc.Test(WordCount)
  }
  ```

- 斐波拉契闭包

  ```go
  package main
  
  import "fmt"
  
  // fibonacci 是返回一个「返回一个 int 的函数」的函数
  func fibonacci() func() int {
  	cur, las := 0, 1
  	return func() int {
  		cur, las = cur + las, cur
  		return cur
  	}
  }
  
  func main() {
  	f := fibonacci()
  	for i := 0; i < 10; i++ {
  		fmt.Println(f())
  	}
  }
  ```

### 方法和接口

- Stringer

  ```go
  package main
  
  import "fmt"
  
  type IPAddr [4]byte
  
  // TODO: 为 IPAddr 添加一个 "String() string" 方法。
  
  func (this IPAddr) String() string {
  	return fmt.Sprintf("%d.%d.%d.%d",this[0],this[1],this[2],this[3])
  }
  
  func main() {
  	hosts := map[string]IPAddr{
  		"loopback":  {127, 0, 0, 1},
  		"googleDNS": {8, 8, 8, 8},
  	}
  	for name, ip := range hosts {
  		fmt.Printf("%v: %v\n", name, ip)
  	}
  }
  ```

- 错误

  ```go
  package main
  
  import (
  	"fmt"
  )
  
  type ErrNegativeSqrt float64
  
  func (e ErrNegativeSqrt) Error() string {
  	return fmt.Sprintf("cannot Sqrt negative number: %f\n", e);
  }
  
  func Sqrt(x float64) (float64, error) {
  	if x < 0 {
  		return x, ErrNegativeSqrt(x)
  	}
  	z := 1.0
  	for Abs(z * z - x) > 1e-12{
  		z -= (z * z - x) / (2*z)
  		fmt.Println(z)
  	}
  	return z, nil
  }
  
  func Abs(x float64) float64 {
  	if x < 0 {return -x}
  	return x
  }
  
  func main() {
  	fmt.Println(Sqrt(2))
  	fmt.Println(Sqrt(-2))
  }
  ```

- Reader

  ```go
  package main
  
  import "golang.org/x/tour/reader"
  
  type MyReader struct{}
  
  // TODO: 为 MyReader 添加一个 Read([]byte) (int, error) 方法。
  
  func (this MyReader) Read(b []byte) (int,error){
  	for i := 0; i < len(b); i++ {
  		b[i] = 'A'
  	}
  	
  	return len(b),nil
  }
  
  func main() {
  	reader.Validate(MyReader{})
  }
  ```

- rot13Reader

  这一个练习有一些困难，询问了chatgpt后我得到了以下需要注意的点

  1.  切勿更改Read的返回值与形参类型，接口的函数签名更改导致很多错误，这是显而易见且相当重要的：(
  2.  要求中提到从另一个io.Reader中读取数据，实际上是从rot13Reader的底层（被包装）io.Reader中读取数据（而不是从形参读取（😓
  3.  因此必须要对实现的Read方法使用指针型的接受者
  4.  这里用到了rune，可以将其看作是int8的别名，它可以表示所有的uincode字符

  代码如下

  ```go
  package main
  
  import (
  	"io"
  	"os"
  	"strings"
  )
  
  // rot13Reader 实现了 io.Reader 接口
  type rot13Reader struct {
  	r io.Reader
  }
  
  // Read 实现了 io.Reader 接口
  func (r *rot13Reader) Read(p []byte) (n int, err error) {
  	n, err = r.r.Read(p) // 从底层 Reader 读取数据
  	if err != nil {
  		return n, err
  	}
  
  	// 创建字符映射
  	charMap := make(map[rune]rune)
  	original := "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  	replacement := "NOPQRSTUVWXYZABCDEFGHIJKLMnopqrstuvwxyzabcdefghijklm"
  	for i, r := range original {
  		charMap[r] = rune(replacement[i])
  	}
  
  	// 对读取的每个字节进行 ROT13 替换
  	for i := 0; i < n; i++ {
  		if mappedChar, ok := charMap[rune(p[i])]; ok {
  			p[i] = byte(mappedChar) // 替换为对应的字符
  		}
  	}
  
  	return n, nil
  }
  
  func main() {
  	s := strings.NewReader("Lbh penpxrq gur pbqr!")
  	r := rot13Reader{s}
  	io.Copy(os.Stdout, &r) // 输出: You cracked the code!
  }
  
  ```

- 图像

  ```go
  package main
  
  import (
  	"image"
  	"image/color"
  	"golang.org/x/tour/pic"
  )
  
  type Image struct {
  	w, h int
  }
  
  func (img Image) Bounds() image.Rectangle {
  	return image.Rect(0, 0, img.w, img.h)
  }
  
  func (img Image) ColorModel() color.Model {
  	return color.RGBAModel
  }
  
  func (img Image) At(x, y int) color.Color {
  	// 计算 RGBA 值 最后一位是不透明度，越低越透明
  	return color.RGBA{uint8(x % 256), uint8(y % 256), uint8(x * y) / 2, 255}
  }
  
  func main() {
  	m := Image{100, 100}
  	pic.ShowImage(m)
  }
  
  ```

- 二叉树同Pattern搜索

  ```go
  package main
  
  import (
  	"fmt"
  	"golang.org/x/tour/tree"
  )
  
  // Walk 遍历树 t，并将树中所有的值发送到信道 ch。
  func Walk(t *tree.Tree, ch chan int) {
  	if t != nil {
  		Walk(t.Left, ch)     // 递归遍历左子树
  		ch <- t.Value       // 发送当前节点的值
  		Walk(t.Right, ch)    // 递归遍历右子树
  	}
  }
  
  // Same 判断 t1 和 t2 是否包含相同的值。
  func Same(t1, t2 *tree.Tree) bool {
  	ch1 := make(chan int)
  	ch2 := make(chan int)
  
  	go func() {
  		Walk(t1, ch1)
  		close(ch1) // 关闭通道
  	}()
  	go func() {
  		Walk(t2, ch2)
  		close(ch2) // 关闭通道
  	}()
  
  	// 比较两个通道中的值
  	for v1 := range ch1 {
  		v2, ok := <-ch2
  		if !ok || v1 != v2 { // 如果通道关闭或值不相等，返回 false
  			return false
  		}
  	}
  	_, ok := <-ch2 // 检查第二个通道是否还有值
  	return !ok // 如果没有值，说明两个树相同
  }
  
  func main() {
  	t1 := tree.New(1)
  	t2 := tree.New(1)
  	t3 := tree.New(2)
  
  	fmt.Println(Same(t1, t2)) // 输出: true
  	fmt.Println(Same(t1, t3)) // 输出: false
  }
  ```

## 参考资料

1. [Learn Go in Y Minutes (learnxinyminutes.com)](https://learnxinyminutes.com/docs/zh-cn/go-cn/)
2. [Go语言评价探讨 (chatgpt.com)](https://chatgpt.com/c/670f7365-8cac-8010-84c8-c27a3d473925)
3. [Go 语言之旅 (go-zh.org)](https://tour.go-zh.org/welcome/1)
4. [Go by Example](https://gobyexample.com/)
5. [Effective Go - The Go Programming Language](https://go.dev/doc/effective_go)
6. chatgpt and kimi ai

