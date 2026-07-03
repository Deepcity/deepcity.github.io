---
title: "MindSpore 专题：第一章、安装"
pubDatetime: 2024-08-14T19:47:58+08:00
description: "MindSpore 入门系列第一章，记录 Ubuntu 虚拟机环境、VMware Tools 修复与 MindSpore 安装过程。"
slug: "mindspore-01-install"
draft: false
tags:
  - "机器学习"
  - "人工智能"
  - "MindSpore"
author: "Deepcity"
timezone: "Asia/Shanghai"
---

## Ubuntu系统安装

### 环境

 VMware Workstation 17Pro

1. 原有的系统为Ubuntu22.04因此下载Ubuntu18.04 镜像光盘文件
   -  通过cat /proc/version文件查看当前的系统版本

<!--more-->

![image-20240604174857507](https://s2.loli.net/2024/06/04/9tNsqxUkrJFHQOc.png)

2. 下载Ubuntu18.04系统光盘https://releases.ubuntu.com/18.04/ubuntu-18.04.6-desktop-amd64.iso

3. VMware简易安装后对18旧版本遇到的问题的解决方案
   1. 旧版本屏幕无法适应屏幕，想到vmwaretools的问题，检查该部分发现并未自动安装

通过重新启动挂载\VMware\VMware Workstation目录下linux.iso文件出现

![image-20240604182654391](https://s2.loli.net/2024/06/06/IWioHYeLj9JgMtb.png)

安装该软件

![image-20240604182901358](https://s2.loli.net/2024/06/04/vIXUHlWVx2sb1co.png)

```shell
sudo perl vmware-install.pl
```

通过在解压的目录下运行该脚本文件安装vmware-tools

![image-20240604183315457](https://s2.loli.net/2024/06/04/pJI4WAgKdYmvPES.png)

在经过一系列configure后安装完成

由此问题解决

2. update apt-get

```shell
sudo update apt-get
```



![image-20240604184437693](https://s2.loli.net/2024/06/04/9cXhEq3V2DMiWNx.png)

3. 修复vmware剪贴板不共享的问题

```shell
sudo apt-get install open-vm-tools-desktop
```

​	安装该软件一路回车即可

## 尝试自动脚本安装

由于vmware对nvdia的支持补全，此处采用版本如下

![image-20240604183528425](https://s2.loli.net/2024/06/04/5e3IG9tuAPdfjKr.png)

进入默认源码目录进行操作

![image-20240604183616489](https://s2.loli.net/2024/06/04/K8tqnFmeQuOMiZc.png)

![image-20240604185144770](https://s2.loli.net/2024/06/04/d1YgnqUjbWJfXLH.png)

由于系统全新，设定一下系统密码并切换到root用户

![image-20240604185341858](https://s2.loli.net/2024/06/04/KQiWzJtOUsS2mnT.png)

根据官网下载

![image-20240604185417980](https://s2.loli.net/2024/06/04/g3BCMVGQHDzjAUL.png)

根据官网命令执行脚本

![MindSpore安装成功](https://s2.loli.net/2024/06/05/xBlJgjPwU3krsqa.png)

可见安装成功

## Windows中安装MindSpore以及杂项

1. 相似的安装程序，记得更改选定的官方安装脚本
2. Windows一般位于C:\Users\%USERNAME%\pip 目录下存在配置文件，可通过更改该配置文件修改镜像，在使用镜像中启用代理可能会导致满屏的飘红报错
3. 对于MindSpore的前置软件安装而言，最重要易错的为Python的版本，建议多通过

```shell
python --version
```
4. 查看当前版本，及时正确配置环境变量
