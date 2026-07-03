---
title: "MindSpore 专题：第四章、数据集"
pubDatetime: 2024-08-14T19:47:58+08:00
description: "MindSpore 入门系列第四章，以 MNIST 为例记录 mindspore.dataset 的加载、转换与批处理用法。"
slug: "mindspore-04-dataset"
draft: false
tags:
  - "机器学习"
  - "人工智能"
  - "MindSpore"
author: "Deepcity"
timezone: "Asia/Shanghai"
---

## 数据集

继续[第二章](/posts/mindspore-02-try-mindspore/)中的Mnist数据库为例，介绍使用mindspore.dataset进行加载的方法。

详情请见MNIST数据官方网站：[MNIST handwritten digit database, Yann LeCun, Corinna Cortes and Chris Burges](http://yann.lecun.com/exdb/mnist/)

<!--more-->

下面是简略介绍

|   数据集   |      MNIST中的文件名       |                          下载地址                           |  文件大小   |
| :--------: | :------------------------: | :---------------------------------------------------------: | :---------: |
| 训练集图像 | train-images-idx3-ubyte.gz | http://yann.lecun.com/exdb/mnist/train-images-idx3-ubyte.gz | 9912422字节 |
| 训练集标签 | train-labels-idx1-ubyte.gz | http://yann.lecun.com/exdb/mnist/train-labels-idx1-ubyte.gz |  28881字节  |
| 测试集图像 | t10k-images-idx3-ubyte.gz  | http://yann.lecun.com/exdb/mnist/t10k-images-idx3-ubyte.gz  | 1648877字节 |
| 测试集标签 | t10k-labels-idx1-ubyte.gz  | http://yann.lecun.com/exdb/mnist/t10k-labels-idx1-ubyte.gz  |  4542字节   |



### 数据库加载

*请注意：mindspore.dataset的接口仅支持解压后的数据文件*

```python
train_dataset = MnistDataset("MNIST_Data/train", shuffle=False)
print(type(train_dataset))
```

> <class 'mindspore.dataset.engine.datasets_vision.MnistDataset'>

### 数据库迭代

数据集加载后，一般以迭代方式获取数据，然后送入神经网络中进行训练。我们可以用[create_tuple_iterator](https://www.mindspore.cn/docs/zh-CN/r2.2/api_python/dataset/dataset_method/iterator/mindspore.dataset.Dataset.create_tuple_iterator.html)或[create_dict_iterator](https://www.mindspore.cn/docs/zh-CN/r2.2/api_python/dataset/dataset_method/iterator/mindspore.dataset.Dataset.create_dict_iterator.html)接口创建数据迭代器，迭代访问数据。访问的数据类型默认为`Tensor`；若设置`output_numpy=True`，访问的数据类型为`Numpy`。

下面定义一个可视化函数，迭代9张图片进行展示。

```python
def visualize(dataset):
    figure = plt.figure(figsize=(4, 4))
    cols, rows = 3, 3

    plt.subplots_adjust(wspace=0.5, hspace=0.5)

    for idx, (image, label) in enumerate(dataset.create_tuple_iterator()):
        figure.add_subplot(rows, cols, idx + 1)
        plt.title(int(label))
        plt.axis("off")
        plt.imshow(image.asnumpy().squeeze(), cmap="gray")
        if idx == cols * rows - 1:
            break
    plt.show()
```

在`for idx, (image, label) in enumerate(dataset.create_tuple_iterator()):`此处的循环中枚举了训练集的前9个图像`enumerate()`函数用于将一个可遍历的数据对象(如列表、元组或字符串)组合为一个索引序列，同时列出数据和数据下标，一般用在 for 循环当中。

在循环体中使用了plt类画图。

![image-20240606173353887](https://s2.loli.net/2024/06/06/36CU8spH9eSEkxl.png)

### 数据集常用操作

Pipeline的设计理念使得数据集的常用操作采用`dataset = dataset.operation()`的异步执行方式，执行操作返回新的Dataset，此时不执行具体操作，而是在Pipeline中加入节点，最终进行迭代时，并行执行整个Pipeline。

下面分别介绍几种常见的数据集操作。

### shuffle

数据集随机`shuffle`可以消除数据排列造成的分布不均问题

![op-shuffle](https://s2.loli.net/2024/06/06/M54ICySt9dzenva.png)

`mindspore.dataset`提供的数据集在加载时可配置`shuffle=True`，或使用如下操作

```python
train_dataset = train_dataset.shuffle(buffer_size=64)
visualize(train_dataset)
```

![image-20240606173414784](https://s2.loli.net/2024/06/06/yB76TmklvtYXIgE.png)

### map

`map`操作是数据预处理的关键操作，可以针对数据集指定列（column）添加数据变换（Transforms），将数据变换应用于该列数据的每个元素，并返回包含变换后元素的新数据集。

```python
image, label = next(train_dataset.create_tuple_iterator())
print("map前：")
print(image.shape, image.dtype)
train_dataset = train_dataset.map(vision.Rescale(1.0 / 255.0, 0), input_columns='image')
image, label = next(train_dataset.create_tuple_iterator())
print("map后：")
print(image.shape, image.dtype)
```

> ```
> map前：
> (28, 28, 1) UInt8
> map后：
> (28, 28, 1) Float32
> ```

### batch

将数据集打包为固定大小的`batch`是在有限硬件资源下使用梯度下降进行模型优化的折中方法，可以保证梯度下降的随机性和优化计算量。分块思想

一般我们会设置一个固定的batch size，将连续的数据分为若干批（batch）。

```python
# 一般设定固定batchSize
train_dataset = train_dataset.batch(batch_size=32)
# batch后的数据增加一维，大小为batch_size
image, label = next(train_dataset.create_tuple_iterator())
print(image.shape, image.dtype)
```

> (32, 28, 28, 1) Float32

### 自定义数据集

`mindspore.dataset`模块提供了一些常用的公开数据集和标准格式数据集的加载API。

对于MindSpore暂不支持直接加载的数据集，可以构造自定义数据加载类或自定义数据集生成函数的方式来生成数据集，然后通过`GeneratorDataset`接口实现自定义方式的数据集加载。

`GeneratorDataset`支持通过可随机访问数据集对象、可迭代数据集对象和生成器(generator)构造自定义数据集，下面分别对其进行介绍。

#### 可随机访问数据集

可随机访问数据集是实现了`__getitem__`和`__len__`方法的数据集，表示可以通过索引/键直接访问对应位置的数据样本。

1. 实现了` __init__`，`__getitem__ ` 和`__len__`
2. 当使用`dataset[idx]`访问这样的数据集时，可以读取dataset内容中第idx个样本或标签

```python
# Random-accessible object as input source
class RandomAccessDataset:
    def __init__(self):
        self._data = np.ones((5, 2))
        self._label = np.zeros((5, 1))

    def __getitem__(self, index):
        return self._data[index], self._label[index]

    def __len__(self):
        return len(self._data)


loader = RandomAccessDataset()
dataset = GeneratorDataset(source=loader, column_names=["data", "label"])

for data in dataset:
    print(data)

loader = [np.array(0), np.array(1), np.array(2)]
dataset = GeneratorDataset(source=loader, column_names=["data"])

for data in dataset:
    print(data)

```

> [Tensor(shape=[2], dtype=Float64, value= [ 1.00000000e+00,  1.00000000e+00]), Tensor(shape=[1], dtype=Float64, value= [ 0.00000000e+00])]
> [Tensor(shape=[2], dtype=Float64, value= [ 1.00000000e+00,  1.00000000e+00]), Tensor(shape=[1], dtype=Float64, value= [ 0.00000000e+00])]
> [Tensor(shape=[2], dtype=Float64, value= [ 1.00000000e+00,  1.00000000e+00]), Tensor(shape=[1], dtype=Float64, value= [ 0.00000000e+00])]
> [Tensor(shape=[2], dtype=Float64, value= [ 1.00000000e+00,  1.00000000e+00]), Tensor(shape=[1], dtype=Float64, value= [ 0.00000000e+00])]
> [Tensor(shape=[2], dtype=Float64, value= [ 1.00000000e+00,  1.00000000e+00]), Tensor(shape=[1], dtype=Float64, value= [ 0.00000000e+00])]

创建的过程非常简单，通过numpy的数据结构为底层，实现三个方法就好了，更简单的直接使用list，tuple也是可行的。

#### 可迭代数据集

可迭代的数据集是实现了`__iter__`和`__next__`方法的数据集，表示可以通过迭代的方式逐步获取数据样本。这种类型的数据集特别适用于随机访问成本太高或者不可行的情况。

例如，当使用`iter(dataset)`的形式访问数据集时，可以读取从数据库、远程服务器返回的数据流。

下面构造一个简单迭代器，并将其加载至`GeneratorDataset`。

```python
# Iterator as input source
class IterableDataset():
    def __init__(self, start, end):
        '''init the class object to hold the data'''
        self.start = start
        self.end = end

    def __next__(self):
        '''iter one data and return'''
        return next(self.data)

    def __iter__(self):
        '''reset the iter'''
        self.data = iter(range(self.start, self.end))
        return self


loader = IterableDataset(1, 5)
dataset = GeneratorDataset(source=loader, column_names=["data"])

for d in dataset:
    print(d)

```

> [Tensor(shape=[], dtype=Int32, value= 1)]
> [Tensor(shape=[], dtype=Int32, value= 2)]
> [Tensor(shape=[], dtype=Int32, value= 3)]
> [Tensor(shape=[], dtype=Int32, value= 4)]

同样的，实现方法即可

#### 生成器

生成器也属于可迭代的数据集类型，其直接依赖Python的生成器类型`generator`返回数据，直至生成器抛出`StopIteration`异常。

下面构造一个生成器，并将其加载至`GeneratorDataset`。

```python
# Generator
def my_generator(start, end):
    for i in range(start, end):
        yield i


# since a generator instance can be only iterated once, we need to wrap it by lambda to generate multiple instances
dataset = GeneratorDataset(source=lambda: my_generator(3, 6), column_names=["data"])

for d in dataset:
    print(d)
```

>[Tensor(shape=[], dtype=Int32, value= 3)]
>[Tensor(shape=[], dtype=Int32, value= 4)]
>[Tensor(shape=[], dtype=Int32, value= 5)]

这个更绝，仅用一个函数即可生成。（此处匿不匿名无关紧要）

## 常见问题

1. 找不到模块 matplotlib

```shell
pip install matplotlib
```
