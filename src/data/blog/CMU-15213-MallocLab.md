---
title: "CMU-15213-MallocLab"
pubDatetime: 2025-09-28T20:00:00Z
description: "CMU 15-213 课程 Malloc Lab 实验记录，从隐式空闲链表到显式空闲链表实现动态内存分配器，最终得分 85/100。"
slug: "cmu-15213-malloclab"
draft: false
tags:
  - "CMU15213"
  - "c"
---

## Malloc Lab

## Declaration

本文使用了 AIGC 来提高效率，其中可能存在谬误，我已尽力检查并校对，但仍不保证完全准确，欢迎指正。

这个Lab的所有工作都在`mm.c`文件中完成，你需要实现一个动态内存分配器，包括四个函数`mm_init()`, `mm_malloc()`, `mm_free()`, `mm_realloc()`以及相关辅助函数。你需要确保你的实现既高效又能有效地利用内存。

## Steps

### Start Version

CSAPP实际上给出了一个基本可运行的版本，你可以参考它来实现初始化堆空间的功能。
```c
/* 
 * mm_init - initialize the malloc package.
 */
int mm_init(void)
{
    return 0;
}

/* 
 * mm_malloc - Allocate a block by incrementing the brk pointer.
 *     Always allocate a block whose size is a multiple of the alignment.
 */
void *mm_malloc(size_t size)
{
    int newsize = ALIGN(size + SIZE_T_SIZE);
    void *p = mem_sbrk(newsize);
    if (p == (void *)-1)
	return NULL;
    else {
        *(size_t *)p = size;
        return (void *)((char *)p + SIZE_T_SIZE);
    }
}

/*
 * mm_free - Freeing a block does nothing.
 */
void mm_free(void *ptr)
{
}

/*
 * mm_realloc - Implemented simply in terms of mm_malloc and mm_free
 */
void *mm_realloc(void *ptr, size_t size)
{
    void *oldptr = ptr;
    void *newptr;
    size_t copySize;
    
    newptr = mm_malloc(size);
    if (newptr == NULL)
      return NULL;
    copySize = *(size_t *)((char *)oldptr - SIZE_T_SIZE);
    if (size < copySize)
      copySize = size;
    memcpy(newptr, oldptr, copySize);
    mm_free(oldptr);
    return newptr;
}
```

实际上这里就只有对齐与堆空间的初始化，其他函数都没有实现任何功能。

#### 测试结果

```sh
(base) ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Malloc-Lab$ ./mdriver  -V -t traces/
Team Name:ateam
Member 1 :Harry Bovik:bovik@cs.cmu.edu
Using default tracefiles in traces/
Measuring performance with gettimeofday().

Testing mm malloc
Reading tracefile: amptjp-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: cccp-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: cp-decl-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: expr-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: coalescing-bal.rep
ERROR: mem_sbrk failed. Ran out of memory...
Checking mm_malloc for correctness, ERROR [trace 4, line 7673]: mm_malloc failed.
Reading tracefile: random-bal.rep
ERROR: mem_sbrk failed. Ran out of memory...
Checking mm_malloc for correctness, ERROR [trace 5, line 1662]: mm_malloc failed.
Reading tracefile: random2-bal.rep
ERROR: mem_sbrk failed. Ran out of memory...
Checking mm_malloc for correctness, ERROR [trace 6, line 1780]: mm_malloc failed.
Reading tracefile: binary-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: binary2-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: realloc-bal.rep
ERROR: mem_sbrk failed. Ran out of memory...
Checking mm_malloc for correctness, ERROR [trace 9, line 1705]: mm_realloc failed.
Reading tracefile: realloc2-bal.rep
ERROR: mem_sbrk failed. Ran out of memory...
Checking mm_malloc for correctness, ERROR [trace 10, line 6562]: mm_realloc failed.

Results for mm malloc:
trace  valid  util     ops      secs  Kops
 0       yes   23%    5694  0.000042134610
 1       yes   19%    5848  0.000040146566
 2       yes   30%    6648  0.000047140550
 3       yes   40%    5380  0.000035153276
 4        no     -       -         -     -
 5        no     -       -         -     -
 6        no     -       -         -     -
 7       yes   55%   12000  0.000093129590
 8       yes   51%   24000  0.000114209790
 9        no     -       -         -     -
10        no     -       -         -     -
Total            -       -         -     -
```

有些地方会出现valid无效的情况，这是因为整体的实现过程太过简单,没有考虑到内存的复用与释放。


- **util**指标的计算公式为：
$$
\text{util} = \frac{\text{测试过程中某个时刻用户实际请求的总 payload 大小最大值}}{\text{你向堆申请的总空间大小（通过 mem_sbrk）}}
$$

- **ops**指标表示在该 trace 中，malloc/free/realloc 操作的总次数。

- **secs**指标表示该 trace 中，所有 malloc/free/realloc 操作所花费的总时间，单位为秒。

- **Kops**指标表示每千次操作所花费的时间，计算公式为：
$$
Kops=\frac{secs}{ops}÷1000
$$

### Implicit Free List

```
| header (size + alloc_bit) | payload ...           | footer (size + alloc_bit) |
^                            ^
bp 指向这里                  HDRP(bp) / FTRP(bp)
```

常见宏定义

```c
#define WSIZE       4             // header/footer 是 4 字节
#define DSIZE       8             // 双字大小
#define CHUNKSIZE  (1<<12)        // 一次扩展堆的默认大小

#define MAX(x, y) ((x) > (y) ? (x) : (y))

// 把 size 和 alloc 位打包进一个字
#define PACK(size, alloc)  ((size) | (alloc))

// 从地址 p 中读写一个字
#define GET(p)       (*(unsigned int *)(p))
#define PUT(p, val)  (*(unsigned int *)(p) = (val))

// 从 header/footer 中取 size 和 alloc 位
#define GET_SIZE(p)  (GET(p) & ~0x7)
#define GET_ALLOC(p) (GET(p) & 0x1)

// 给定块指针 bp，计算 header 和 footer 指针
#define HDRP(bp) ((char *)(bp) - WSIZE)
#define FTRP(bp) ((char *)(bp) + GET_SIZE(HDRP(bp)) - DSIZE)

// 下一个、上一个块指针
#define NEXT_BLKP(bp) ((char *)(bp) + GET_SIZE(((char *)(bp) - WSIZE)))
#define PREV_BLKP(bp) ((char *)(bp) - GET_SIZE(((char *)(bp) - DSIZE)))
```

`mm_init`函数中需要初始化堆空间，创建初始空闲块和结尾块。

```c
static char *heap_listp = NULL;

int mm_init(void)
{
    // 申请 4 个字：填充 + 序言块头 + 序言块尾 + 结尾块头
    if ((heap_listp = mem_sbrk(4*WSIZE)) == (void *)-1)
        return -1;

    PUT(heap_listp, 0);                             // 对齐填充
    PUT(heap_listp + (1*WSIZE), PACK(DSIZE, 1));    // 序言块 header
    PUT(heap_listp + (2*WSIZE), PACK(DSIZE, 1));    // 序言块 footer
    PUT(heap_listp + (3*WSIZE), PACK(0, 1));        // 结尾块 header
    heap_listp += (2*WSIZE);                        // 指向序言块的 payload

    // 扩展一段空闲堆
    if (extend_heap(CHUNKSIZE/WSIZE) == NULL)
        return -1;
    return 0;
}
```

首先来写一些辅助函数`coalesce`，`extend_heap`，`place`，`find_fit`和`best_fit`。

```c
// 合并相邻空闲块
void *coalesce(void *bp)
{
    size_t prev_alloc = GET_ALLOC(FTRP(PREV_BLKP(bp)));
    size_t next_alloc = GET_ALLOC(HDRP(NEXT_BLKP(bp)));
    size_t size = GET_SIZE(HDRP(bp));

    if(prev_alloc && next_alloc){               // 情况1, 前后都分配
        return bp;
    }
    else if(prev_alloc && !next_alloc){         // 情况2, 后面空闲
        size += GET_SIZE(HDRP(NEXT_BLKP(bp)));
        PUT(HDRP(bp), PACK(size, 0));
        PUT(FTRP(bp), PACK(size, 0));
    }
    else if(!prev_alloc && next_alloc){         // 情况3, 前面空闲
        size += GET_SIZE(HDRP(PREV_BLKP(bp)));
        PUT(FTRP(bp), PACK(size, 0));
        PUT(HDRP(PREV_BLKP(bp)), PACK(size, 0));
        bp = PREV_BLKP(bp);
    }
    else{                                       // 情况4, 前后都空闲
        size += GET_SIZE(HDRP(PREV_BLKP(bp))) + GET_SIZE(FTRP(NEXT_BLKP(bp)));
        PUT(HDRP(PREV_BLKP(bp)), PACK(size, 0));
        PUT(FTRP(NEXT_BLKP(bp)), PACK(size, 0));
        bp = PREV_BLKP(bp);
    }
    return bp;
}

/*
 * 扩展heap, 传入的是字节数
*/
void *extend_heap(size_t words)
{
    /* bp总是指向有效载荷 */
    char *bp;
    size_t size;
    /* 根据传入字节数奇偶, 考虑对齐 */
    size = (words % 2) ? (words+1) * WSIZE : words * WSIZE;

    /* 分配 */
    if((long)(bp = mem_sbrk(size)) == -1)
        return NULL;

    /* 设置头部和脚部 */
    PUT(HDRP(bp), PACK(size, 0));           /* 空闲块头 */
    PUT(FTRP(bp), PACK(size, 0));           /* 空闲块脚 */
    PUT(HDRP(NEXT_BLKP(bp)), PACK(0, 1));   /* 片的新结尾块 */

    /* 判断相邻块是否是空闲块, 进行合并 */
    return coalesce(bp);
}

void place(void *bp, size_t asize)
{
    size_t csize = GET_SIZE(HDRP(bp));

    if((csize - asize) >= (2*DSIZE)){
        PUT(HDRP(bp), PACK(asize, 1));
        PUT(FTRP(bp), PACK(asize, 1));
        bp = NEXT_BLKP(bp);
        PUT(HDRP(bp), PACK(csize - asize, 0));
        PUT(FTRP(bp), PACK(csize - asize, 0));
    }
    else{
        PUT(HDRP(bp), PACK(csize, 1));
        PUT(FTRP(bp), PACK(csize, 1));
    }
}

void *find_fit(size_t asize)
{
    void *bp;

    for(bp = heap_listp; GET_SIZE(HDRP(bp)) > 0; bp = NEXT_BLKP(bp)){
        if(!GET_ALLOC(HDRP(bp)) && (asize <= GET_SIZE(HDRP(bp)))){
            return bp;
        }
    }
    return NULL;
}

void *best_fit(size_t asize){
    void *bp;
    void *best_bp = NULL;
    size_t min_size = 0;

    for(bp = heap_listp; GET_SIZE(HDRP(bp)) > 0; bp = NEXT_BLKP(bp)){
        if(!GET_ALLOC(HDRP(bp)) && (asize <= GET_SIZE(HDRP(bp)))){
            size_t curr_size = GET_SIZE(HDRP(bp));
            if(min_size == 0 || (curr_size < min_size)){
                min_size = curr_size;
                best_bp = bp;
            }
        }
    }
    return best_bp;
}
```

然后重构`mm_malloc`函数，使用最佳适配算法。

```c
/* 
 * mm_malloc - Allocate a block by incrementing the brk pointer.
 *     Always allocate a block whose size is a multiple of the alignment.
 */
void *mm_malloc(size_t size)
{
    size_t asize;       // 调整后的块大小
    size_t extendsize;  // 如果没有合适的块, 扩展堆的大小
    char *bp;

    // 忽略无效请求
    if(size == 0){
        return NULL;
    }

    // 调整块大小, 考虑对齐和头尾部开销
    if(size <= DSIZE){
        asize = 2*DSIZE;
    }
    else{
        asize = ALIGN(size + DSIZE);
    }

    // 寻找合适的空闲块
    if((bp = best_fit(asize)) != NULL){
        place(bp, asize);
        return bp;
    }

    // 没有合适的块, 扩展堆
    extendsize = MAX(asize, CHUNKSIZE);
    if((bp = extend_heap(extendsize/WSIZE)) == NULL){
        return NULL;
    }
    place(bp, asize);
    return bp;
}
```

然后是`mm_free`函数与`mm_init`函数。

```c
/* 
 * mm_init - initialize the malloc package.
 */
int mm_init(void)
{
    if((heap_listp = mem_sbrk(4*WSIZE)) == (void *)-1){
        return -1;
    }

    PUT(heap_listp, 0);                             // 对齐填充
    PUT(heap_listp + (1*WSIZE), PACK(DSIZE, 1));    // prologue header
    PUT(heap_listp + (2*WSIZE), PACK(DSIZE, 1));    // prologue footer
    PUT(heap_listp + (3*WSIZE), PACK(0, 1));        // epilogue header
    heap_listp += (2*WSIZE);                        // 指向第一个块的有效载荷

    // 扩展一段空闲堆
    if(extend_heap(CHUNKSIZE/WSIZE) == NULL){
        return -1;
    }

    return 0;
}

void mm_free(void *ptr)
{
    if(ptr == NULL)
        return;

    size_t size = GET_SIZE(HDRP(ptr));

    PUT(HDRP(ptr), PACK(size, 0));
    PUT(FTRP(ptr), PACK(size, 0));
    coalesce(ptr);
}

/*
 * mm_realloc - Implemented simply in terms of mm_malloc and mm_free
 */
void *mm_realloc(void *ptr, size_t size)
{
    if(size == 0){
        mm_free(ptr);
        return NULL;
    }

    if(ptr == NULL){
        return mm_malloc(size);
    }

    void *newptr = mm_malloc(size);
    if(newptr == NULL){
        return NULL;
    }

    size_t copySize = GET_SIZE(HDRP(ptr)) - DSIZE;
    if(size < copySize){
        copySize = size;
    }
    memcpy(newptr, ptr, copySize);
    mm_free(ptr);
    return newptr;
}

```

这里的`mm_free`函数比较简单，只需要将块标记为空闲并尝试合并。

### 测试结果可见

```sh
(base) ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Malloc-Lab$ ./mdriver -t traces/ -V
Team Name:ateam
Member 1 :Sun Gang:sungang@stu.xmu.edu.cn
Using default tracefiles in traces/
Measuring performance with gettimeofday().

Testing mm malloc
Reading tracefile: amptjp-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: cccp-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: cp-decl-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: expr-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: coalescing-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: random-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: random2-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: binary-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: binary2-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: realloc-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: realloc2-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.

Results for mm malloc:
trace  valid  util     ops      secs  Kops
 0       yes   99%    5694  0.008355   682
 1       yes   99%    5848  0.007686   761
 2       yes   99%    6648  0.012992   512
 3       yes  100%    5380  0.009526   565
 4       yes   66%   14400  0.000115125326
 5       yes   92%    4800  0.008235   583
 6       yes   92%    4800  0.007503   640
 7       yes   55%   12000  0.095922   125
 8       yes   51%   24000  0.320250    75
 9       yes   27%   14401  0.074907   192
10       yes   34%   14401  0.002641  5453
Total          74%  112372  0.548131   205

Perf index = 44 (util) + 14 (thru) = 58/100
```

```sh
(base) ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Malloc-Lab$ ./mdriver -t traces/ -V
Team Name:ateam
Member 1 :Sun Gang:sungang@stu.xmu.edu.cn
Using default tracefiles in traces/
Measuring performance with gettimeofday().

Testing mm malloc
Reading tracefile: amptjp-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: cccp-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: cp-decl-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: expr-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: coalescing-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: random-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: random2-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: binary-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: binary2-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: realloc-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: realloc2-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.

Results for mm malloc:
trace  valid  util     ops      secs  Kops
 0       yes   99%    5694  0.009309   612
 1       yes   99%    5848  0.008731   670
 2       yes   99%    6648  0.014572   456
 3       yes  100%    5380  0.010524   511
 4       yes   66%   14400  0.000123116599
 5       yes   96%    4800  0.016845   285
 6       yes   95%    4800  0.015909   302
 7       yes   55%   12000  0.097286   123
 8       yes   51%   24000  0.340311    71
 9       yes   31%   14401  0.075668   190
10       yes   30%   14401  0.002812  5121
Total          75%  112372  0.592091   190

Perf index = 45 (util) + 13 (thru) = 58/100
```

可见Implicit Free List的实现效果还是不错的,但是只有58分

## Explicit Free List

直接show code吧，这个courcse中已经写的相当详细了，具体的代码这里掠过

```c
/* single word (4) or double word (8) alignment */
#define ALIGNMENT 8
#define WSIZE 4
#define DSIZE 8

/* 
 * rounds up to the nearest multiple of ALIGNMENT
 * 工作原理是通过将数&~0x7(二进制为1111....1000)，则数二进制下最后 3 位的值被清除，
 * 数必定是8（二进制下位1000）的倍数. 这个操作一般是向下取8的倍数
*/
#define ALIGN(size) (((size) + (ALIGNMENT-1)) & ~0x7)

#define SIZE_T_SIZE (ALIGN(sizeof(size_t)))

/*Define the size of an application for heap expansion*/
#define CHUNKSIZE (1<<12)
/*
 * Access the content in p in the form of unsigned int *, 
 * because the p we get is initially in the form of void *,
 * and later we will need to use the value in p for calculations, so we need to convert it
 * So this is just a macro defined so that we don't keep writing type conversions repeatedly
*/
#define GET(p) (*(unsigned int *)(p))
#define PUT(p, val) (GET(p) = (val))
#define TOCH(p) ((char *)(p))
/*Get the content to fill in the header or footer*/
#define PACK(size, alloc) ((size) | (alloc))
/*传过来的p一般是经过bp处理后得到的指向头部或尾部的指针*/
#define GET_SIZE(p) (GET(p) & (~0x7))
#define GET_ALLOC(p) (GET(p) & (0x1))
/*获取头部指针,bp为当前块有效载荷的指针*/
#define HDRP(bp) (TOCH(bp) - WSIZE)
/*获取尾部指针,bp为当前块有效载荷的指针*/
#define FTRP(bp) (TOCH(bp) + GET_SIZE(HDRP(bp)) - DSIZE)
/*获取上一个块有效载荷的指针,bp为当前块有效载荷的指针*/
#define PREV_BLKP(bp) (TOCH(bp) - GET_SIZE(TOCH(bp) - DSIZE))
/*获取下一个块有效载荷的指针,bp为当前块有效载荷的指针*/
#define NEXT_BLKP(bp) (TOCH(bp) + GET_SIZE(HDRP(bp)))

/*用于获取地址指针指向的内容*/
#define GETP(p) (*(unsigned long *)p)
#define TOVOID(p) ((void *)p)
/*用于存放地址指针指向的内容*/
#define PUTP(p, val) ((GETP(p)) = (unsigned long)(val))
/*获取pred指针*/
#define PREDP(bp) (TOCH(bp))
/*获取succ指针, 一个指针指向的内容占8字节*/
#define SUCCP(bp) (TOCH(bp) + DSIZE)


/*beginning of free list*/
static void *freelt_hd;
/*tail of free list*/
static void *freelt_ft;

//int mm_check(void);


/*
//调试函数
static void printfBlock(void *bp)
{
    printf("空闲列表中的块%lx: SIZE:%d, ALLOC:%d, PRED:%lx, SUCC:%lx\n", (unsigned long)bp,
            GET_SIZE(HDRP(bp)), GET_ALLOC(HDRP(bp)), GETP(PREDP(bp)), GETP(SUCCP(bp)));
}
//调试函数
static void freelt_status()
{
    printf("最前后指针为%lx, %lx", (unsigned long)freelt_hd, (unsigned long)freelt_ft);
    if (freelt_hd == NULL || freelt_ft == NULL){
        printf("空闲列表为空\n");
        return ;
    }
    if (freelt_hd == freelt_ft){
        printf("空闲列表有一个块\n");
        printfBlock(freelt_hd);
        return;
    }
    int cnt = 0;
    printf("整个列表为:\n");
    for (void *i = freelt_hd; i != NULL; i = TOVOID(GETP(SUCCP(i)))){
        printf("%d :", cnt);
        printfBlock(i);
        cnt++;
    }
    printf("整个列表结束\n");
}
*/

/*将有效载荷指针bp代表的空闲块插入空闲列表*/
static void insert_freelt(void *bp)
{
    void *mv_hd;
    void *mv_ft;
    void *insert_ad;
    void *freelt_pred;
    void *freelt_next;
    size_t size;

    /*
     * 说明这个时候空闲列表为空
     * 我在unlock_freelt中保证了freelt_hd与freelt_ft一定同时为NULL或不为NULL
     */
    if (freelt_hd == NULL && freelt_ft == NULL){
        freelt_hd = bp;
        PUTP(PREDP(bp), NULL);
        freelt_ft = bp;
        PUTP(SUCCP(bp), NULL);
        return;
    }
    /*否则双向搜索要插入的空闲列表地方*/
    size = GET_SIZE(HDRP(bp));
    mv_hd = freelt_hd;
    mv_ft = freelt_ft;
    insert_ad = NULL;
    /*首先排除极端情况*/
    /*当前最小块都比当前块大则直接将块插入空闲列表的最前面*/
    if (GET_SIZE(HDRP(mv_hd)) >= size){
        PUTP(SUCCP(bp), freelt_hd);
        PUTP(PREDP(bp), NULL);
        /*bug5:注意以前在链表中的块也要链接*/
        PUTP(PREDP(freelt_hd), bp);
        freelt_hd = bp;
        return;
    }
    /*当前最大块都比当前块小则直接将块插入空闲列表的最后面*/
    if (GET_SIZE(HDRP(mv_ft)) <= size){
        PUTP(PREDP(bp), freelt_ft);
        PUTP(SUCCP(bp), NULL);
        /*bug5:注意以前在链表中的块也要链接*/
        PUTP(SUCCP(freelt_ft), bp);
        freelt_ft = bp;
        return;
    }
    /*上面对特殊情况的判断保证了，bp一定插入在空闲列表的中间部分*/
    for (; mv_hd != NULL && mv_ft != NULL;){
        /*说明要插入当前mv_hd的前面*/
        if (GET_SIZE(HDRP(mv_hd)) >= size){
            insert_ad = mv_hd;
            break;
        }
        /*说明要插入当前mv_ft的后面*/
        if (GET_SIZE(HDRP(mv_ft)) <= size){
            insert_ad = mv_ft;
            break;
        }
        mv_hd = TOVOID(GETP(SUCCP(mv_hd)));
        mv_ft = TOVOID(GETP(PREDP(mv_ft)));
    }
    if (insert_ad == mv_hd){
        /*bp插入在freelt_pred和freelt_next中间*/
        freelt_pred = TOVOID(GETP(PREDP(insert_ad)));
        freelt_next = insert_ad;
        PUTP(SUCCP(bp), freelt_next);
        PUTP(PREDP(bp), freelt_pred);
        PUTP(SUCCP(freelt_pred), bp);
        PUTP(PREDP(freelt_next), bp);
    } else if (insert_ad == mv_ft){
        /*bp插入在freelt_pred和freelt_next中间*/
        freelt_pred = insert_ad;
        freelt_next = TOVOID(GETP(SUCCP(insert_ad)));
        PUTP(SUCCP(bp), freelt_next);
        PUTP(PREDP(bp), freelt_pred);
        PUTP(SUCCP(freelt_pred), bp);
        PUTP(PREDP(freelt_next), bp);
    } else {
        /*不可达的状态*/
        exit(1);
    }
}

/*将bp从空闲列表中解开*/
static void unlock_freelt(void *bp)
{
    void *freelt_pred;
    void *freelt_next;

    /*freelt_pred是空闲列表中前一个块的有效载荷指针*/
    freelt_pred = TOVOID(GETP(PREDP(bp)));
    /*freelt_pred是空闲列表中后一个块的有效载荷指针*/
    freelt_next = TOVOID(GETP(SUCCP(bp)));
    /*bug2:注意这里这里两个指针是NULL的情况,为了提高空间的利用率，我这里没有给空闲列表分别在最前和最后加上哨兵*/
    if (freelt_pred != NULL)
        PUTP(SUCCP(freelt_pred), freelt_next);
    else 
        freelt_hd = freelt_next; //freelt_hd以前所指向的块被作为分配块了，所以要指向bp后面的块
    if (freelt_next != NULL)
        PUTP(PREDP(freelt_next), freelt_pred);
    else 
        freelt_ft = freelt_pred;
}


/*执行合并操作，传入的参数为当前块的有效载荷指针,返回合并后的块有效载荷指针*/
static void *coalesce(void *bp)
{
    size_t prev_alloc = GET_ALLOC(FTRP(PREV_BLKP(bp)));
    size_t next_alloc = GET_ALLOC(HDRP(NEXT_BLKP(bp)));
    size_t size = GET_SIZE(HDRP(bp));
    /*获取堆中的前一块的有效载荷地址指针*/
    void *prev_bp = PREV_BLKP(bp);
    /*获取堆中的后一块的有效载荷地址指针*/
    void *next_bp = NEXT_BLKP(bp);

    if (prev_alloc && next_alloc){
        ;
    } else if (prev_alloc && !next_alloc){
        /*先出来处理列表*/
        /*next_bp这个空闲块需要在空闲列表中解开*/
        unlock_freelt(next_bp);
        /*更改下前部和尾部*/
        size += GET_SIZE(HDRP(next_bp));
        PUT(HDRP(bp), PACK(size, 0));
        PUT(FTRP(next_bp), PACK(size, 0));
    } else if (!prev_alloc && next_alloc){
        /*先出来处理列表*/
        /*prev_bp这个空闲块需要在空闲列表中解开*/
        unlock_freelt(prev_bp);
        /*更改下前部和尾部*/
        size += GET_SIZE(HDRP(prev_bp));
        PUT(FTRP(bp), PACK(size, 0));
        PUT(HDRP(prev_bp), PACK(size, 0));
        /*同时合并后的空闲块有效载荷的地址也发生了变化*/
        bp = prev_bp;
    } else if (!prev_alloc && !next_alloc){
        /*prev_bp这个空闲块需要在空闲列表中解开*/
        unlock_freelt(prev_bp);
        /*next_bp这个空闲块需要在空闲列表中解开*/
        unlock_freelt(next_bp);
        /*更改下前部和尾部*/
        size += GET_SIZE(HDRP(prev_bp)) + GET_SIZE(HDRP(next_bp));
        PUT(HDRP(prev_bp), PACK(size, 0));
        PUT(FTRP(next_bp), PACK(size, 0));
        /*同时合并后的空闲块有效载荷的地址也发生了变化*/
        bp = prev_bp;
    }
    /*最后都要重新更新下空闲列表*/
    insert_freelt(bp);
    return bp;
}

/*参数为申请的字节个数*/
static void *extend_heap(size_t byteNum)
{
    size_t vaildNum = ALIGN(byteNum);
    void *tp;
    if ((tp = mem_sbrk(vaildNum)) == NULL)
        return NULL;
    /*
     * 新块添加头部和尾部
     * 需要注意的是size_t是long unsigned int 有64位，
     * 但是我们的GET(p)将p强制类型转换为unsigned int 为32位，所以不用担心内容超出
     * PUT(HDRP(tp), PACK(vaildNum, 0));覆盖了原来的结束块
    */
    PUT(HDRP(tp), PACK(vaildNum, 0));
    PUT(FTRP(tp), PACK(vaildNum, 0));
    /*添加新的结束块*/
    /*
     * bug1:PUT(NEXT_BLKP(HDRP(tp)), PACK(0, 1)); but the right way is follow:
     */
    PUT(HDRP(NEXT_BLKP(tp)), PACK(0, 1));
    /*在coalesce中会调用insert_freelt负责更新空闲列表*/
    return coalesce(tp);
}

/* 
 * mm_init - initialize the malloc package.
 * 常规操作，将填充块，序言块和结尾块添加上去。
 * 同时还要申请初始的堆空闲块
 * The return value should be -1 if there was a problem in performing the initialization, 0 otherwise.
 */
int mm_init(void)
{
    freelt_hd = NULL;
    freelt_ft = NULL;
    /*first apply for 4 word size*/
    void *tp = mem_sbrk(4*WSIZE);
    if (tp == (void *)-1)
        return -1;
    PUT(tp, 0);
    PUT(tp + (1*WSIZE), PACK(DSIZE, 1));
    PUT(tp + (2*WSIZE), PACK(DSIZE, 1));
    PUT(tp + (3*WSIZE), PACK(0, 1));
    
    if ((tp = extend_heap(CHUNKSIZE)) == NULL)
        return -1;
    return 0;
}

/*使用首次适配*/
static void *find_fit(size_t size){
    void *mv_hd = freelt_hd;
    void *mv_ft = freelt_ft;
    /*bug4: 可能空闲列表为空，这个时候freelt_hd == NULL,freelt_ft == NULL*/
    if (freelt_hd == NULL || freelt_ft == NULL)
        return NULL;
    /*特殊情况*/
    if (size <= GET_SIZE(HDRP(mv_hd))){
        return mv_hd;
    }
    if (size > GET_SIZE(HDRP(mv_ft))){
        return NULL;
    }
    for (;mv_hd != NULL && mv_ft != NULL;){
        if (GET_SIZE(HDRP(mv_hd)) >= size){
            return mv_hd;
        }
        if (GET_SIZE(HDRP(mv_ft)) == size){
            return mv_ft;
        }
        else if (GET_SIZE(HDRP(mv_ft)) < size){
            return TOVOID(GETP(SUCCP(mv_ft)));
        }
        mv_hd = TOVOID(GETP(SUCCP(mv_hd)));
        mv_ft = TOVOID(GETP(PREDP(mv_ft)));
    }
    return NULL;
}

/*将size大小的内容放到bp所指向的空闲块上*/
static void place(void *bp, size_t size)
{
    size_t csize = GET_SIZE(HDRP(bp));
    
    if ((csize - size) >= (3 * DSIZE)){
        /*
         * bug7: 要先对显式链表操作，否则会出现bug,因为我们的pred和succ在分配块中会被占据
         * 这个是因为我们的分配块最小是16字节，而空闲块最小要24字节。
         * 如果一个新申请的分配块正好16字节，他的尾部占据了我们空闲块以前的SUCC，
         * 导致如果再unlock_freelt那么SUCC被修改了是一个严重的问题！
         */
        /*对显式链表的操作*/
        /*bp在显式链表中要拆开了*/
        unlock_freelt(bp);
        /*对隐式链表的操作*/
        PUT(HDRP(bp), PACK(size, 1));
        PUT(FTRP(bp), PACK(size, 1));
        bp = NEXT_BLKP(bp);
        PUT(HDRP(bp), PACK(csize - size, 0));
        PUT(FTRP(bp), PACK(csize - size, 0));
        /*然后这个被分割出来的空闲块就要加入空闲列表了,在coalesce中会调用insert_freelt负责更新空闲列表*/
        coalesce(bp);
    } else {
        /*bug7: 要先对显式链表操作，否则会出现bug,因为我们的pred和succ在分配块中会被占据*/
        /*对显式链表的操作*/
        /*bp在显式链表中要拆开了*/
        unlock_freelt(bp);
        PUT(HDRP(bp), PACK(csize, 1));
        PUT(FTRP(bp), PACK(csize, 1));
    }
}
/* 
 * mm_malloc - Allocate a block by incrementing the brk pointer.
 *     Always allocate a block whose size is a multiple of the alignment.
 */
/*
 * 由于我使用了显示空闲链表，一个指针占用8字节，我有两个（pred,succ），同时还要加上头部和尾部（各4字节）. 
 * 所以空闲块的大小最小为24字节+8字节=32字节
 * 但是分配完后两个指针（pred,succ）就不要了，所以这个时候最小块大小为8字节+8字节=16字节
 * 
 * mm_malloc 函数返回一个指向至少 size 字节大小的分配块的指针。
 * 整个分配的块应该位于堆区域内，并且不应与任何其他已分配的块重叠。
 */
void *mm_malloc(size_t size)
{
    size_t asize;
    size_t extendsize;
    void *bp;

    if (size == 0)
        return NULL;
    if (size <= DSIZE)
        asize = 2 * DSIZE; /*bug6: 最小分配块大小为16字节*/
    else 
        asize = ALIGN(size + SIZE_T_SIZE); /*这里还要加上头部和尾部的总共8个字节*/
    if ((bp = find_fit(asize)) != NULL){
        place(bp, asize);
        return bp;
    }
    extendsize = asize >= CHUNKSIZE ? asize : CHUNKSIZE;
    if ((bp = extend_heap(extendsize)) == NULL)
        return NULL;
    place(bp, asize);
    return bp;
}

/*
 * mm_free - Freeing a block does nothing.
 */
void mm_free(void *ptr)
{
    size_t size = GET_SIZE(HDRP(ptr));

    PUT(HDRP(ptr), PACK(size, 0));
    PUT(FTRP(ptr), PACK(size, 0));
    /*在coalesce中会调用insert_freelt负责更新空闲列表*/
    coalesce(ptr);
}

/*
 * mm_realloc - Implemented simply in terms of mm_malloc and mm_free
 * mm realloc：mm realloc例程返回一个指向至少size字节大小的已分配区域的指针，具有以下约束条件。
 * 如果ptr为NULL，则调用等效于mm malloc(size);
 * 如果size等于零，则调用等效于mm free(ptr);
 * 如果ptr不为NULL，则必须由mm malloc或mm realloc的先前调用返回。
 * mm realloc调用将指向ptr的内存块（旧块）的大小更改为size字节，并返回新块的地址。
 * 请注意，新块的地址可能与旧块相同，也可能不同，这取决于您的实现、旧块中的内部碎片量以及realloc请求的大小。
 * 新块的内容与旧ptr块的内容相同，直到旧大小和新大小中的最小值。其他所有内容都未初始化。
 * 例如，如果旧块是8字节，新块是12字节，则新块的前8字节与旧块的前8字节相同，最后4字节未初始化。
 * 类似地，如果旧块是8字节，新块是4字节，则新块的内容与旧块的前4字节相同。
 */
void *mm_realloc(void *ptr, size_t size)
{
    /*新分配的块*/
    void *newptr;
    /*要换到其他空闲块上*/
    void *ctoptr;
    /*被分割变成新空闲块*/
    void *newfreeptr;
    void *nextptr;
    size_t next_alloc;
    size_t nsize;
    size_t asize;
    size_t extendsize;
    size_t lastsize;

    if (ptr != NULL && size == 0){
        mm_free(ptr);  
        return ptr;
    }
    if (ptr == NULL){
        newptr = mm_malloc(size);
        return newptr;
    }
    /*先来一个简单实现，remalloc全部由mm_malloc与free实现*/
    /*获取要改变的真正大小asize*/
    if (size <= DSIZE)
        asize = 2 * DSIZE;
    else 
        asize = ALIGN(size + SIZE_T_SIZE); /*这里还要加上头部和尾部的总共8个字节*/
    nsize = GET_SIZE(HDRP(ptr));
    /*然后与当前已经分配的大小进行对比*/
    /*bug8: 注意无符号与有符号比较的时候，有符号会被强行转换为无符号进行比较*/
    if ((int)(nsize - asize) == 0)
        return ptr;
    /*bug8: 注意无符号与有符号比较的时候，有符号会被强行转换为无符号进行比较*/
    if ((int)(nsize - asize) > 0){ //说明是要变小
        /*在空闲列表中找找是否有合适的, 提高空间利用率*/
        ctoptr = find_fit(asize);
        /*如果找不到，或者找到的空间利用率还不如当前的, 那么我就在原地分割或就这样*/
        if (ctoptr == NULL || ((GET_SIZE(HDRP(ctoptr)) - asize) >= (nsize - asize)) ){
            /*如果多出来的空间我可以形成一个空闲块,那么就分割，否则什么都不做*/
            if ((nsize - asize) >= (3 * DSIZE)){
                /*因为原先其本来就不在空闲列表中所以可以不用unlock_freelt操作*/
                PUT(HDRP(ptr), PACK(asize, 1));
                PUT(FTRP(ptr), PACK(asize, 1));
                /*获取要变成空闲块的有效载荷地址*/
                newfreeptr = NEXT_BLKP(ptr);
                PUT(HDRP(newfreeptr), PACK(nsize - asize, 0));
                PUT(FTRP(newfreeptr), PACK(nsize - asize, 0));
                /*然后尝试合并空闲列表, 并将空闲块加入空闲列表*/
                coalesce(newfreeptr);
                return ptr;
            } else {
                return ptr;
            }
        } else { //说明找到了更合适放在的空闲块
            place(ctoptr, asize);
            memcpy(ctoptr, ptr, asize - DSIZE);
            mm_free(ptr);
            return ctoptr;
        }
    }
    /*说明是要变大*/
    next_alloc = GET_ALLOC(HDRP(ptr));
    nextptr = NEXT_BLKP(ptr);
    /*看下相邻的下块是否为空闲的，而且大小要够*/
    if (!next_alloc && ((nsize + GET_SIZE(HDRP(nextptr))) >= asize)){
        lastsize = nsize + GET_SIZE(HDRP(nextptr)) - asize;
        /*说明可以进行分割*/
        if (lastsize >= (3 * DSIZE)){
            /*先释放掉要使用的空闲块*/
            unlock_freelt(nextptr);
            PUT(HDRP(ptr), PACK(asize, 1));
            PUT(FTRP(ptr), PACK(asize, 1));
            /*获取要变成空闲块的有效载荷地址*/
            nextptr = NEXT_BLKP(ptr);
            PUT(HDRP(nextptr), PACK(lastsize, 0));
            PUT(FTRP(nextptr), PACK(lastsize, 0));
            coalesce(nextptr);
            return ptr;
        } else { //不能进行分割的话只有将下一个空闲块的全部拿过来了
            /*先释放掉要使用的空闲块*/
            unlock_freelt(nextptr);
            PUT(HDRP(ptr), PACK(nsize + GET_SIZE(HDRP(nextptr)), 1));
            PUT(FTRP(ptr), PACK(nsize + GET_SIZE(HDRP(nextptr)), 1));
            return ptr;
        }
    } else { /*说明下一个块不是空闲块或者大小不太够, 没有办法了，只有查找下空闲列表*/
        ctoptr = find_fit(asize);
        if (ctoptr == NULL){ //说明我们要请求分配新的堆了
            extendsize = asize >= CHUNKSIZE ? asize : CHUNKSIZE;
            if ((ctoptr = extend_heap(extendsize)) == NULL)
                return NULL;
            place(ctoptr, asize);
            memcpy(ctoptr, ptr, asize - DSIZE);
            /*然后释放ptr*/
            mm_free(ptr);
            return ctoptr;
        } else { //说明找到合适的了
            place(ctoptr, asize);
            memcpy(ctoptr, ptr, asize - DSIZE);
            mm_free(ptr);
            return ctoptr;
        }
    }
}
```

#### 运行结果

```sh
(base) ubuntu@VM-0-8-ubuntu:~/learnning_project/CMU-15213/src/Malloc-Lab$ ./mdriver -t traces/ -V
Team Name:ateam
Member 1 :Sun Gang:sungang@stu.xmu.edu.cn
Using default tracefiles in traces/
Measuring performance with gettimeofday().

Testing mm malloc
Reading tracefile: amptjp-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: cccp-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: cp-decl-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: expr-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: coalescing-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: random-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: random2-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: binary-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: binary2-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: realloc-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.
Reading tracefile: realloc2-bal.rep
Checking mm_malloc for correctness, efficiency, and performance.

Results for mm malloc:
trace  valid  util     ops      secs  Kops
 0       yes   99%    5694  0.000171 33376
 1       yes   99%    5848  0.000202 28936
 2       yes   99%    6648  0.000251 26465
 3       yes   99%    5380  0.000178 30174
 4       yes   66%   14400  0.000199 72508
 5       yes   96%    4800  0.001567  3063
 6       yes   95%    4800  0.001525  3148
 7       yes   55%   12000  0.000197 61007
 8       yes   51%   24000  0.000344 69707
 9       yes   31%   14401  0.075686   190
10       yes   30%   14401  0.001858  7750
Total          75%  112372  0.082178  1367

Perf index = 45 (util) + 40 (thru) = 85/100
```

## REF

1. [(48 封私信 / 84 条消息) CSAPP | Lab8-Malloc Lab 深入解析 - 知乎](https://zhuanlan.zhihu.com/p/496366818)
2. [CSAPP Malloc Lab - 次林梦叶 - 博客园](https://www.cnblogs.com/cilinmengye/p/18093810)