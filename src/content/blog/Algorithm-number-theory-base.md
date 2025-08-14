---
title: 算法数论基础
date: 2024-08-24 16:38:26
categories:
- 算法
- 数学
- 数论
tags: [数论, 算法]
---

# 算法数论基础

## 前言：需要用到的偏僻语法知识

### c++随机数函数

[如何优雅的用 C++生成随机数 - 知乎 (zhihu.com)](https://zhuanlan.zhihu.com/p/442008589)

头文件：c: cstdlib c++: random

`cstdlib` 中的 rand（）和 srand（）函数是 C 语言使用的随机数生成方法，通过 ***线性同余法*** 计算。

> srand 常用时间作为种子

C++标准建议使用 `random` 代替它们。

### 随机数生成引擎 **Random number engines**

`random` 提供了三种引擎，使用哪种需要权衡：

- linear_congruential_engine（线性同余法）：速度比较快，储存很少的中间变量。
- mersenne_twister_engine：比较慢，占用存储空间较大，但是在参数设置合理的情况下，可生成最长的不重复序列，且具有良好的频谱特征。
- subtract_with_carry_engine：速度最快，占用存储空间较大，频谱特性有时不佳。

### 预定义算法

算法包括 minstd_rand0、minstd_rand、mt19937、mt19937_64、ranlux24_base、ranlux48_base 等。

以下是费马小定理素性检验的随机数实际应用

```c++
#include<iostream>
#include<algorithm>
#include<random>

typedef long long ll;
using namespace std;

mt19937 eng(time(nullptr));

int randint(int a, int b)
{
	uniform_int_distribution<int> dis(a, b);
	return dis(eng);
}

int quickPow(int x, int n, int p)
{
	int res = 1;
	while (n)
	{
		if (n & 1)res = (ll)res * x%p;
		x = (ll)x * x%p;
		n >>= 1;
	}
	return res;
}

bool isPrime(int x)
{
	if (x < 3)return x == 2;
	for (int i = 0; i < 12; i++)
	{
		int a = randint(2, x - 1);
		if (quickPow(a, x - 1, x) != 1)
			return false;
	}
	return true;
}

int main()
{
	if (isPrime(9997579))puts("YES");
	else puts("NO");
	return 0;
}
```

---

**以下代码中将不会给出例如：randint, quickpow 的代码（图个方便）**

## GCD 与 LCD 以及其衍生的素数判定问题

## GCD 的数学推导

### 取模运算

amodp 表示 a 除以 p 的余数

**模 ｐ 加法** $(a+b)mod\ p = (amodp+bmodp)\ mod\ p$

**模 p 减法** $(a-b)mod\ p = (amodp-bmodp + p)\ mod\ p$

注意在这里有个很容易犯得错误，在数学中，我们称mod是不会结果为负数得，但在计算机中，对负数进行去摸结果仍是负数。

> 例如：
>
> 对-1进行取模，结果为n-1，而在计算机中，结果仍为-1

**模 p 乘法** $(a*b)mod\ p = (amodp*bmodp)mod\ p$

**幂模 p** $(a^b)modp=((amodp)^b)modp$

  模运算满足结合律、交换律和分配律。$a=b(mod\ n)$ 表示 $ a$ 和 $b$ 模 $n$ 同余，即 $a$ 和 $b$ 除以 $n$ 的余数相等。

### 最大公约数

gcd 即最大公约数 lcm 即最小公倍数

  ## gcd 的具体实现与算法优化

![image-20220508102231840](https://s2.loli.net/2024/08/24/hjFAPLWQ98seZr5.png)

**gcd 的基础实现**

```c++
int gcd(int a, int b)
{
    return b ? gcd(b, a % b) : a;
}
```

**gcd 的运算符优化**

```
int gcd(int a, int b) {
    // make sure a >= b.
    if (a < b) {
        std::swap(a, b);
    }

    if (b == 0) {
        return a;
    }

    bool a_isodd = a & 1;
    bool b_isodd = b & 1;

    if (a_isodd && b_isodd) {
        return gcd((a - b) >> 1, b);
    } else if (a_isodd && !b_isodd) {
        return gcd(a, b >> 1);
    } else if (!a_isodd && b_isodd) {
        return gcd(a >> 1, b);
    }

    // both a and b are even numbers.
    return gcd(a >> 1, b >> 1) << 1;
}
```

## 素数检验算法

### 纯暴力 O( n )

```c++
bool isprime(int x)
{
	for(int i=2;i<=x/i;i++)
		if(x%i==0)return false;
	return true;
}
```

### 费马素性检验

那么反过来呢？如果存在某个 $a^{p-1}\equiv 1(mod\ p)$，是否就能判定 $p$ 是素数呢？**并不行**，例如 $2^{341-1}\equiv 1 (mod341)$，但 $341$ 是合数，满足该同余等式的合数被称为 **费马伪素数**。

幸好，一个合数是费马伪素数的概率并不是很高。所以我们可以多测试几个 $a$。只要存在某个 $a^{p-1}\not \equiv 1 (mod\ p)$，即可说明 $p$ 不是素数。而如果多组测试下来 $a^{p-1}\equiv 1$ 都成立，那它就 **很可能** 是素数了。

```c++
bool isPrime(int x)
{
	if (x < 3)return x == 2;
	for (int i = 0; i < 12; i++)
	{
		int a = randint(2, x - 1);
		if (quickPow(a, x - 1, x) != 1)
			return false;
	}
	return true;
}
```

### 米勒-拉宾素性检验

对于待检验的数为偶数，可直接判断其为非素数，而奇数则可写成 $a^{x-1}$ 表示为 $a^{2^rd}$ 当考虑 x 为奇数时，$a^d,a^{2d},...,a^{2^rd}$ 这样一串数字的性质。

我们已经知道对奇素数 $x$，$a^{2^rd} \equiv 1 (mod\ x)$ （a 是 x 的倍数的情况下特判)，也就是说这串数字以 1 结尾，由于 x 是奇素数，且 $1^{\frac{x-1}{2}} \equiv 1 (mod\ x)$

## 素数筛

###　暴力判断

### 埃氏筛法

### 欧拉筛法

上面得三种筛法都是十分简单而且基础得。这里就不多阐述了。

### 不能秒杀的题

[1293 夏洛特和他的女朋友](https://www.acwing.com/problem/content/1295/)

看到这道题，最先开始的想法，对每个数与其质因子连一条线，对建出来的图，做染色，保证每一条边的两个端点是不同颜色

但这并非正解，对于每一条边，其两端的链接必定是一个合数和一个素数，因此该图为一个二分图

![image-20220519164522508](https://s2.loli.net/2024/08/24/zKgVIluDya9mUxJ.png)

剩下的很简单，n <3时ans=1，n> = 3 时 ans = 2；

```c++
#include<iostream>
#include<cstring>
#include<algorithm>

using namespace std;

const int N = 1000006;
int prime[N], countNum;
bool st[N];
int n;

void oula(int n)
{
    for (int i = 2; i <= N; i++)
    {
        if (!st[i])prime[countNum++] = i;
        for (int j = 0; prime[j] * i <= n; j++)
        {
            st[i * prime[j]] = true;
            if (i % prime[j] == 0)break;
        }
    }
}

int main()
{
    oula(N);
    cin>>n;
    if(n<3){
        puts("1");
        for(int i=1;i<=n;i++)printf("1 ");
    }
    else{
        puts("2");
        for(int i = 2;i <= n + 1;i++)
            if(st[i]) printf("2 ");
            else printf("1 ");
    }
    return 0;
}
```

## 素数筛思想的实际应用

对于每个区间内的所有数，合数必有一个 sqrt（a）的因子，故可通过预处理出 5*10^4 内的所有素数，再通过筛查质因子处理出每一个合数

[196 质数距离](https://www.acwing.com/problem/content/198/)

```c++
#include<iostream>
#include<cstring>
using namespace std;

typedef long long ll;
const int N = 1000010;
int l, r;
int prime[N], countNum;
bool st[N];

void init(int n)
{
    memset(st, 0, sizeof st);
    countNum = 0;
    for (int i = 2; i <= n; i++)
    {
        if (!st[i])prime[countNum++] = i;
        for (int j = 0; prime[j] * i <= n; i++)
        {
            st[prime[j] * i] = true;
            if (i % prime[j] == 0)break;
        }
    }
}

int main()
{
    while (cin >> l >> r)
    {
        init(50000);

        memset(st, 0, sizeof st);
        for (int i = 0; i < countNum; i++)
        {
            ll p = prime[i];
            for (ll j = max(p * 2, (l + p - 1) / p * p); j <= r; j += p)
                st[j - l] = true;
        }
        countNum = 0;
        for (int i = 0; i <= r - l; i++)
        {
            if (!st[i] && i + l >= 2)
                prime[countNum++] = i + l;
        }

        if (countNum < 2)puts("There are no adjacent primes.");
        else {
            int minp = 0, maxp = 0;
            for (int i = 0; i < countNum - 1; i++)
            {
                int d = prime[i + 1] - prime[i];
                if (d < prime[minp + 1] - prime[minp])minp = i;
                if (d > prime[maxp + 1] - prime[maxp])maxp = i;
            }
            printf("%d,%d are closest, %d,%d are most distant.\n",
                prime[minp], prime[minp + 1], prime[maxp], prime[maxp + 1]);
        }
    }
}
```

## 分解质因数

[197 阶乘分解](https://www.acwing.com/problem/content/199/)

最先开始想的是对于每一个 n 以内的数都枚举一下，记录其对各个质数的约数，但这样就会有 1e6*1e5（1e6 以内的素数个数）的时间复杂度，仍然超限，因此，转换一下思路，枚举素数，对每个该素数的倍数加入 s 值，即：
$$
s = n/p + n/p^2 + n/p^3 + n/p^4...
$$

```c++
#include<iostream>
using namespace std;

typedef long long ll;
const int N = 1000006;
int n;
int prime[N],countNum;
bool st[N];

void init(int n)
{
    for(int i=2;i<=n;i++){
        if(!st[i])prime[countNum++]=i;
        for(int j=0;prime[j]*i<=n;j++)
        {
            st[i*prime[j]]=true;
            if(i%prime[j]==0)break;
        }
    }
    return ;
}

int main()
{
    cin>>n;
    init(1000000);
    
    for(int i=0;i<countNum;i++)
    {
        if(n<prime[i])break;
        ll p=prime[i],s=0;
        while(n>=p)s+=n/p,p*=prime[i];
        printf("%d %d\n",prime[i],s);
    }
    return 0;
}
```

### 约数之和

约数定理 n 的 $(a_1+1)(a_2+1)...(a_k+1)$ 个正约数之和为 $(p_1^0+p_1^1+...p_1^{a1})(p_2^0+p_2^1+...+p_2^{a2})...(p_k^0+p_k^1+..+p_k^{ak})$

[AcWing 97. 约数之和（算法提高课） - AcWing](https://www.acwing.com/activity/content/problem/content/8046/)

```
#include <cstdio>

const int mod = 9901;

int qmi(int a, int k)
{
    int res = 1;
    a %= mod;
    while (k)
    {
        if (k & 1) res = res * a % mod;
        a = a * a % mod;
        k >>= 1;
    }
    return res;
}

int sum(int p, int k)
{
    if (k == 1) return 1;
    if (k % 2 == 0) return (1 + qmi(p, k / 2)) * sum(p, k / 2) % mod;
    return (sum(p, k - 1) + qmi(p, k - 1)) % mod;
}

int main()
{
    int a, b;
    scanf("%d%d", &a, &b);

    int ans = 1;
    for (int i = 2; i * i <= a; i ++ )
        if (a % i == 0)
        {
            int s = 0;
            while (a % i == 0)
            {
                a /= i, s ++ ;
            }
            ans = ans * sum(i, b * s + 1) % mod;
        }

    if (a > 1) ans = ans * sum(a, b + 1) % mod;
    if (a == 0) ans = 0;

    printf("%d\n", ans);

    return 0;
}
```

## 约数个数

暴力求约数个数

### 求给定元素集中每一个数字的约数个数

利用筛法思想，对于每一个数字枚举他的倍数

[1291 轻拍牛头](https://www.acwing.com/problem/content/1293/)

```c++
#include<iostream>
#include<cstring>
#include<algorithm>
#include<cstdio>

using namespace std;

const int N = 1000010;
int a[N],cnt[N],s[N];

int main()
{
    int n;
    cin>>n;
    for(int i=1;i<=n;i++){
        cin>>a[i];
        cnt[a[i]]++;
    } 
    for(int i=1;i<N;i++)
    for(int j=i;j<N;j+=i)
    {
        s[j]+=cnt[i];
    }
    for(int i=1;i<=n;i++) cout<<s[a[i]]-1<<endl;
    return 0;
}
```

## 阶乘、平方的质数个数

[1294 樱花](https://www.acwing.com/problem/content/1296/)

$1/x+1/y=1/n!$ => $y=n!+n!^2/(x-n!)$

因为 x, y 为正整数，因此要求的个数等价于 $n!^2$ 的约数个数

```c++
#include<iostream>
#include<cstring>
#include<algorithm>
#include<cstdio>

using namespace std;

typedef long long ll;
const int N = 1000010;
int prime[N],countNum;
bool st[N];

void init(int n)
{
    for(int i=2;i<=n;i++)
    {
        if(!st[i])prime[countNum++]=i;
        for(int j=0;prime[j]*i<=n;j++)
        {
            st[i*prime[j]]=true;
            if(i%prime[j]==0)break;
        }
    }
}

int main()
{
    int mod=1e9+7;
    int n;
    cin>>n;
    init(n);
    
    ll ans=1;
    for(int i=0;i<countNum;i++)
    {
        // cout<<prime[i]<<endl;
        int j=n;
        int s=0;
        while(j)s+=j/prime[i],j/=prime[i];
        ans=(ans*(2*s+1))%mod;
    }
    cout<<ans<<endl;
}
```



## 暴力枚举求最多约数个数的数（一定范围内最大）

dfs 搜索

- 确定需要的质数数（2...23 共九个质数限定 1e9 内的约数最多的数）
- 确定需要的最大 α（30，确定 2e9 次方的数）

注意可行性剪枝

[198 反素数](https://www.acwing.com/problem/content/200/)

```c++
#include<iostream>
#include<cstring>
#include<cstdio>
#include<algorithm>

using namespace std;

int primes[9]={2,3,5,7,11,13,17,19,23};
int maxs,number,n;

void dfs(int u,int last,int p,int s)
{
    if(s > maxs||s == maxs&&p<number)
    {
        maxs=s;
        number=p;
    }
    if(u==9)return ;
    for(int i=1;i<=last;i++)
    {
        if(1ll*p*primes[u]>n)break;
        p*=primes[u];
        dfs(u+1,i,p,s*(i+1));
    }
}


int main()
{
    cin>>n;
    
    dfs(0,30,1,1);//初始最大的α为30
    
    cout<<number<<endl;
    return 0;
}
```

### 分解质因数优化暴力枚举约数

[198 反素数](https://www.acwing.com/problem/content/200/)

**2e9 次方以内的数的最多约数的数共有 1600 左右的约数数量**

```c++
#include<iostream>
#include<cstring>
#include<algorithm>

#define x first
#define y second

using namespace std;

typedef long long ll;
typedef pair<int, int> PII;
const int N = 50010;
int prime[N],countNum;
bool st[N];
PII factor[N];
int dividor[N];
int fcnt,dcnt;

int gcd(int a,int b){return b?gcd(b,a%b):a;}

void init(int n)
{
    
    for(int i=2;i<=n;i++)
    {
        if(!st[i])prime[countNum++]=i;
        for(int j=0;prime[j]*i<=n;j++)
        {
            st[i*prime[j]]=true;
            if(i%prime[j]==0)break;
        }
    }
    return;
}

void dfs(int u,int p)
{
    if(u==fcnt)
    {
        dividor[dcnt++]=p;
        return;
    }
    for(int i=0;i<=factor[u].y;i++){
        dfs(u+1,p);
        p*=factor[u].x;
    }
    return;
}

int main()
{
    init(N - 1);

    int n;
    cin >> n;
    while (n -- )
    {
        int a, b, c, d;
        cin >> a >> b >> c >> d;

        fcnt = 0;
        int t = d;
        for (int i = 0; prime[i] <= t / prime[i]; i ++ )
        {
            int p = prime[i];
            if (t % p == 0)
            {
                int s = 0;
                while (t % p == 0) t /= p, s ++ ;
                factor[fcnt ++ ] = {p, s};
            }
        }

        if (t > 1) factor[fcnt ++ ] = {t, 1};

        dcnt = 0;
        dfs(0, 1);

        int res = 0;
        for (int i = 0; i < dcnt; i ++ )
        {
            int x = dividor[i];
            if (gcd(a, x) == b && (ll)c * x / gcd(c, x) == d) res ++ ;
        }

        cout << res << endl;
    }

    return 0;
}

```

## 欧拉函数

### 欧拉函数概念

1-N 中与 N 互质的数的个数被称为欧拉函数记为 $φ(n)$

由容斥原理推出的公式：$φ(n)=N(1-\frac{1}{p_1})(1-\frac{1}{p_2})...(1-\frac{1}{p_k})$

容斥原理证明公式

对于 1-N 当中的每一个数（假设 1-N 中有三个 N 的质因子分别设为 $p_1p_2p_3$）

$$
φ(N)=N-N/p_1-N/p_2-N/p_3+N/（p_1p_2)+N/(p_2p_3)+N/(p_3p_1)-N/(p_1p_2p_3)
$$
化简即可推出上面的公式

递推式：$φ(ab)=\frac{φ(a)φ(b)gcd(a,b)}{φ(gcd(a,b))}$

### 欧拉函数的题目

[203 可见的点](https://www.acwing.com/problem/content/203/)

**思维+欧拉函数**

对于每一个被光照到的点，其 x, y 必然满足以下条件

1. x, y 为整数
2. (x, y)是直线 y = kx 在第一象限以原点为端点的射线上的第一个整点
3. 即 x, y 为互质的数

**证明**

若 x, y 为非互质的数则存在这么一个整数点(x/d, y/d)使得其与(x, y)处于同一直线且位于(x, y)的左下方

```c++
#include<iostream>
#include<cstring>
#include<cstdio>
#include<algorithm>

using namespace std;

typedef long long ll;
const int N = 1010;
int primes[N],countNum;
bool st[N];
int eular[N];

void initEular(int n)
{
    eular[1]=1;
    for(int i=2;i<=n;i++)
    {
        if(!st[i]){
            primes[countNum++]=i;
            eular[i]=i-1;
        }
        for(int j=0;primes[j]*i<=n;j++)
        {
            st[i*primes[j]]=true;
            if(i%primes[j]==0)
            {
                eular[primes[j]*i]=eular[i]*primes[j];
                break;
            }
            eular[primes[j]*i]=eular[i]*(primes[j]-1);
        }
    }
}

int main()
{
    initEular(N-1);
    
    int _;
    cin>>_;
    int T=0;
    while(_--)
    {
        int n;
        cin>>n;
        ll sum=1;
        for(int i=1;i<=n;i++) sum+=eular[i]*2;
        cout<<++T<<' '<<n<<' '<<sum<<endl;
    }
}
```

[220 最大公约数](https://www.acwing.com/problem/content/222/)

```c++
#include<iostream>
#include<cstring>
#include<cstdio>
#include<algorithm>

using namespace std;

typedef long long ll;
const int N = 1e7+10;
int primes[N],countNum;
bool st[N];
ll phi[N],s[N];

void eular(int n)
{
    for(int i=2;i<=n;i++)
    {
        if(!st[i]){
            primes[countNum++]=i;
            phi[i]=i-1;
        }
        for(int j=0;primes[j]*i<=n;j++)
        {
            st[i*primes[j]]=true;
            if(i%primes[j]==0)
            {
                phi[i*primes[j]]=phi[i]*primes[j];
                break;
            }phi[i*primes[j]]=phi[i]*(primes[j]-1);
        }
    }
    
    for(int i=1;i<=n;i++)s[i]=s[i-1]+phi[i];
}

int main()
{
    int n;
    cin>>n;
    eular(n);
    
    ll ans=0;
    for(int i=0;i<countNum;i++ [数论，算法]g)
    {
        int p=primes[i];
        ans+=s[n/p]*2+1;
    }
    cout<<ans<<endl;
}		
```

## 同余

### 扩展欧几里得算法（裴蜀定理）

#### 概念与推导

$(a,b)=d => a * x +b * y = d$   $(b,a mod b)$

**假定** $y * b + x * (a mod b) =d$

$y*b+x(a-\lfloor\frac{a}{b}\rfloor*b)=d$

$y*b+a*x-\lfloor\frac{a}{b}\rfloor*b*x=d$

$a*x + b*(y-\lfloor\frac{a}{b}\rfloor*x)=d$

$=> x'=x\quad y'=y-\lfloor\frac{a}{b}\rfloor*x$

#### 拓展

对于 $(a,b)=d$

对于该方程的一组解

$a*x_0+b*y_0=d$

有以下结论:
$$
x=x_0+k*(\frac{a}{d})\quad y=y_0-k*(\frac{b}{d})
$$
为该同余方程的通解

这种变形实际上也是一种十分常见得数学变形方式，在数学上叫做零和变形。

### 同余方程

[203 同余方程](https://www.acwing.com/problem/content/205/)
$ax≡1(modb)$

=> $ax-by=1$

且 x 一定为正值（数学中的取模不会取到正值）

```c++
#include<iostream>
using namespace std;

int exgcd(int a,int b,int& x,int& y)
{
    if(!b){
        x=1,y=0;
        return a;
    }
    int d=exgcd(b,a%b,y,x);
    y-=(a/b)*x;
    return d;
}

int main()
{
    int a,b,x,y;
    cin>>a>>b;
    exgcd(a,b,x,y);
    cout<<(x%b+b)%b<<endl;
}
```

### 青蛙的约会

[222 青蛙的约会](https://www.acwing.com/problem/content/224/)

A 追 B (b-a) , 每跳一次 A 追 B(m-n)米 

$(m-n)x=b-a+yL$

=> $(m-n)x=b-a+yL$
 [数论，算法]g
=> $(m-n)x-yL=b-a$

```c++
#include<iostream>
#include<cstdio>
#include<cstring>

using namespace std;

typedef long long ll;

ll exgcd(ll a,ll b,ll& x,ll& y){
    if(!b)
    {
        x=1,y=0;
        return a;
    }
    ll d=exgcd(b,a%b,y,x);
    y-=a/b*x;
    return d;
}

int main()
{
    ll a,b,m,n,L;
    cin>>a>>b>>m>>n>>L;
    ll x,y;
    ll d = exgcd(m-n,L,x,y);
    if((b-a)%d!=0)puts("Impossible");
    else {
        x*=(b-a)/d;
        ll t=abs(L/d);
        cout<<(x%t+t)%t<<endl;
    }
    return 0;
}
```

### 最幸运的数字
[202 最幸运的数字](https://www.acwing.com/problem/content/204/)

对于一串 8，用一个公式表示这个数字

8888..8(x 个 8) => 8 * 1111..1 => 8 * 9999..9/9 => 8 * (10^x-1)/9

也可以用公比为 10，初项为 8 的等比数列求和思量

考量题目

对于一个 888..8 的约数 L|8*(10^x-1)/9 <=> (9L/d)|(10 ^ x-1)

<=> 10^x^= 1(mod C) C = 9L/d

eular 定理：对于 α^phi(n)^= 1(mod n) (α, n)= 1

根据 eular 与 10^x^ = 1(mod C)

枚举 phi(c)的约数，最小的 10^i%c == 1 即为答案

```c++
#include<iostream>
#include<cstring>
#include<iostream>

using namespace std;

typedef long long ll;

ll gcd(ll a,ll b){return b?gcd(b,a%b):a;}

ll slow_mul(ll a,ll b,ll p)
{
    ll res=0;
    while(b)
    {
        if(b&1)res=(res+a)%p;
        a=(a+a)%p;
        b>>=1;
     [数论，算法]g}
    return res;
}

ll qmi(ll a,ll b,ll c)
{
    ll res=1;
    while(b)
    {
        if(b&1)res=slow_mul(res,a,c);
        a=slow_mul(a,a,c);
        b>>=1;
    }
    return res%c;
}

ll get_eular(ll a)
{
    ll res=a;
    for(ll i=2;i<=a/i;i++)
    {
        if(a%i==0)
        {
            while(a%i==0)a/=i;
            res=res/i*(i-1);
        }
    }
    if(a>1) res=res/a*(a-1);
    return res;
}

typedef long long ll;

int main()
{
    int T=1;
    ll L;
    while(cin>>L,L)
    {
        int d=1;
        d=gcd(L,8) [数论，算法]g;

        ll c= 9*L/d;

        // cout<<c<<endl;

        ll phi = get_eular(c);

        // cout<<phi<<endl;

        ll ans=1e18;

        if(gcd(c,10)!=1)ans=0;

        for(ll i=1;i<=phi/i;i++)
        {
            if(phi%i==0)
            {
                if((qmi(10,i,c))==1)ans=min(ans,i);
                if((qmi(10,phi/i,c))==1)ans=min(ans,phi/i);
            }
        }

        printf("Case %d: %lld\n",T++,ans);
    }
}
```

### 曹冲养猪

**中国剩余定理**

$$\begin{cases}x=a_1(mod\quad m_1)\\x=a_2(mod\quad m_2)\\x=a_3(mod\quad m_3)\\...\\x=a_n(mod\quad m_n)\end{cases}$$

设 $M=m_1m_2m_3...m_n$
 [数论，算法]g
令 $M_i=M/m_i$    $t_i$ 是 $M_i$ 关于 M 的逆元 

$M_it_i=1(mod\quad m_i)$

$x=\sum a_iM_it_i$

==构造解，硬记，比较难==

```c++
#include<iostream>
#include<cstring>
#include<cstdio>
#include<algorithm>

using namespace std;

typedef long long ll;

const int N = 20;
ll a[N],b[N];

ll exgcd(ll a,ll b,ll& x,ll& y)
{
    if(!b)
    {
        x=1,y=0;
        return a;
    }
    int d=exgcd(b,a%b,y,x);
    y-=a/b*x;
    return d;
}

int main()
{
    int n;
    cin>>n;
    ll M=1;
    for(int i=1;i<=n;i++){
        cin>>a[i]>>b[i] [数论，算法]g;
        M*=a[i];
    }
    ll ans=0;
    for(int i=1;i<=n;i++)
    {
        ll mi=M/a[i];
        ll ti,x;
        exgcd(mi,a[i],ti,x);
        ans+=b[i]*mi*ti;
    }
    cout<<(ans%M+M)%M<<endl;
    return 0;
}
```

## 矩阵乘法

### 求斐波那契数列的和

fn+1 = fn+fn-1;

sn = f1+f2+f3+f4...+fn

sn+1 = f1+f2+f3+f4+...+fn+1

$s_{n+1}-s_n=f_{n+1}$

构造一个矩阵 Fn = fn, fn+1, sn

Fn ={fn, fn+1, sn}*

{ {0,1,0}

  {1,1,1}

  {0,0,1}}= Fn+1 ={fn+1，fn+2，sn+1};

```#include<iostream>
#include<iostream>
#include<vector [数论，算法]g>
#include<cstring>
#include<cstdio>
#include<algorithm>

using namespace std;

const int N = 3;
int n, m;

void mul(int c[], int a[], int b[][N])
{
    int t[N]={0};
    for (int i = 0; i < N; i++)
    {
        for (int j = 0; j < N; j++)
        {
            t[i] = (t[i] + 1ll * a[j] * b[j][i]) % m;
        }
    }
    memcpy(c, t, sizeof t);
}

void mul(int c[][N], int a[][N], int b[][N])
{
    int t[N][N]={0};
    for (int i = 0; i < N; i++)
    {
        for (int j = 0; j < N; j++)
        {
            for (int k = 0; k < N; k++)
            {
                t[i][j] = (t[i][j] + 1ll * a[i][k] * b[k][j]) % m;
            }
        }
    }
    memcpy(c, t, sizeof t);
}

int main()
 [数论，算法]g{
    cin >> n >> m;
    int F1[N] = { 1,1,1 };
    int A[N][N] = {
        {0,1,0},
        {1,1,1},
        {0,0,1}
    };

n--;
    while (n)
    {
        /*for(int i=0;i<N;i++){
        for(int j=0;j<N;j++)
        cout<<A[i][j]<<' ';
        puts("");
        }
        for(int i=0;i<N;i++)cout<<F1[i]<<' ';
        puts("");*/
        if (n & 1)mul(F1, F1, A);
        mul(A, A, A);
        n >>= 1;
    }

    cout << F1[2] << endl;
}
```

### 求一个关于斐波那契数列的特殊数列和

 T(n)=(f1+2f2+3f3+…+nfn)modm

nsn-tn =(n-1)f1+(n-2)f2+...+fn-1

(n+1)sn+1-tn+1 = nf1+(n-1)f2+...+fn

(n+1)sn+1-tn+1-(nsn-tn)= sn

那么我们设 pn = sn-tn

Fn ={fn, fn+1, sn, pn} [数论，算法]g*

{

{0,1,0,0},

{1,1,1,0},

{0,0,1,1},

{0,0,0,1}

};= Fn+1 ={fn+1.fn+2, sn+1, sn+2}

ps: 为了简化代码，我们将初始的 F1 扩展为二维矩阵

```c++
#include<iostream>
#include<cstring>
#include<algorithm>

using namespace std;

const int N = 4;
int n,m;

inline void mul(int c[][N],int a[][N],int b[][N])
{
    int t[N][N]={0};
    for(int i=0;i<N;i++)
    {
        for(int j=0;j<N;j++)
        {
            for(int k=0;k<N;k++)
            {
                t[i][j]=(t[i][j]+1ll*a[i][k]*b[k][j])%m;
            }
        }
    }
    memcpy(c,t,sizeof t);
 [数论，算法]g}

int main()
{
    cin>>n>>m;
    int F1[N][N]={1,1,1,0};
    int A[N][N]={
        {0,1,0,0},
        {1,1,1,0},
        {0,0,1,1},
        {0,0,0,1}
    };
    
    int k=n-1;
    while(k)
    {
        if(k&1)mul(F1,F1,A);
        mul(A,A,A);
        k>>=1;
    }
    
    cout<<(1ll*F1[0][2]*n-F1[0][3]+m)%m<<endl;
    return 0;
}
```



## 组合数学

这里给出一下一个非常常用的全排列函数：

next_permutation()

这个函数也十分便于记忆，permutation即`排列`的意思。

### 总结

**I**

利用 Cab = Ca-1b+Ca-1b-1 的组合数学规律 dp 出二位数组保存结果

**II**

利用除以一个数等于乘以一个数的逆元的形式预处理出阶乘，o1 的时间内得到特定结果

## 多重集合的全排列

多重集合的定义：**多重集合不要求元素不能重复**

### 多重集合表示：

M ={k1⋅a1, k2⋅a2, ⋯, kn⋅an}M ={k1⋅a1, k2⋅a2, ⋯, kn⋅an}(其中每个 ai 代表是不同的元素，每个元素 ai 有 ki 个，ki 可以是有限数，也可以是 ∞。)(其中每个 ai 代表是不同的元素，每个元素 ai 有 ki 个，ki 可以是有限数，也可以是 ∞。)

### 多重集的排列:

- 多重集合 M ={k1⋅a1, k2⋅a2, ⋯, kn⋅an}的 r 排列数为 kr 多重集合 M ={k1⋅a1, k2⋅a2, ⋯, kn⋅an}的 r 排列数为 $k^r$
- 多重集合 M ={k1⋅a1, k2⋅a2, ⋯, kn⋅an}的全排列数为：$\frac{(k1+k2+⋯+kn)!}{k1!k2!⋯kn!}$

## 数学知识

### 排列

### 错排公式

### 错排问题

**错排问题** 考虑一个有 n 个元素的排列，若一个排列中所有的元素都不在自己原来的位置上，那么这样的排列就称为原排列的一个错排。 n 个元素的错排数记为 D(n)。研究一个排列错排个数的问题，叫做错排问题或称为更列问题。

### 错排公式的递推

对于 $D(n) $，考虑第 $n$ 个位置，它可以与 $n-1$ 前的任意位置交换 $((n-1)D(n-1))$，在考虑编号为 k 的位置，这是有两种情况

（1）将它放到 $n$，那么，对于剩下的 n-1 个元素，由于第 k 个元素放到了位置 n，剩下 n-2 个元素就有 $D(n-2)$ 种方法，此时放置方法有 $D(n-2)$ 种。

（2）将它不放到 n，那么，剩下 n-2 个元素就有 D(n-2)种方法，此时放置方法有 $((n-2)*D(n-2))$ 种。

**递推关系式：D(n) = (n-1) [D(n-2) + D(n-1)] (n >= 3)**

特别的 $D(1)=0,D(2)=1$;

其实到这里就结束了，通过递推关系式可以计算机直接算出 $D(n)$

但是下面还是给出错排公式的推导

以上是必须要会的内容，最好是尝试自己在没有辅助材料的情况下过一遍。（这种方法又称费曼学习法）

### 错排公式的推导
 [数论，算法]g
假设 $D(k) = k! N(k), k = 1, 2, …, n,$ 且有 $N(1) = 0, N(2) = 1/2.$ 当 $n ≥ 3$ 时，$n!\cdot N(n) = (n-1) (n-1)! N(n-1) + (n-1)! N(n-2)$

即有公式

$$N(n) = (n-1) N(n-1) + N(n-2)$$

于是有 $$N(n) - N(n-1) = - [N(n-1) - N(n-2)] / n = (-1/n) [-1/(n-1)] [-1/(n-2)]…(-1/3) [N(2) - N(1)] = (-1)^n / n!$$

因此

$N(n-1) - N(n-2) = (-1)^{(n-1)} / (n-1)!$,

$$N(2) - N(1) = (-1)^2 / 2!$$

相加，可得

$$N(n) = (-1)^2/2! + … + (-1)^(n-1) / (n-1)! + (-1)^n/n!$$

因此

$$D(n) = n! [(-1)^2/2! + … + (-1)^(n-1)/(n-1)! + (-1)^n/n!]$$

$$D(n) = ∑_{k=2}^{n} (-1)^k * n! / k!$$

此即错排公式。

#### 另一种方式的推导——容斥原理

正整数 1, 2, 3, ……, n 的全排列有 n! 种，其中第 k 位是 k 的排列有 (n-1)! 种; 当 k 分别取 1, 2, 3, ……, n 时，共有 n*(n-1)! 种排列是至少放对了一个的，由于所求的是错排的种数，所以应当减去这些排列; 但是此时把同时有两个数错排的排列多排除了一次，应补上; 在补上时，把同时有三个数不错排的排列多补上了一次，应排除;……; 继续这一过程，得到错排的排列种数为

D(n) = n! - n!/1! + n!/2! - n!/3! + … + (-1)^n *n!/n! = ∑(k = 2~n) (-1)^k * n! / k!,

即 D(n) = n! [1/0! - 1/1! + 1/2! - 1/3! + 1/4! + ... + (-1)^n/n!].

## 线性代数

### 线性基

#### 有关线性基的一些概念

##### 张成的概念

设 ，所有这样的子集 的异或和组成的集合称为集合 的 **张成**，记作 。即，在 中选出任意多个数，其异或和的所有可能的结果组成的集合。

##### 线性相关

对于一个集合 ，如果存在一个元素 ，使得， 在去除这个元素后得到的集合 的张成 中包含 ，则称集合 **线性相关**。

更形象地，可以表示为，存在一个元素 ，可以用其它若干个元素异或起来得到。

相对的，如果不存在这样的元素 ，则称集合 **线性无关**。

一个显然的结论是，对于这个线性相关的集合 ，去除这个元素后，集合的张成不变。

#### 概念与性质

线性基是向量空间的一组基，通常用来解决有关异或的题目，通俗的讲法就是由一个集合构造出来的另一个集合，它有以下几个性质

1. 线性基的元素能相互异或得到原集合的所有相互异或得到的值
2. 线性基是满足性质 1 的最小的集合
3. 线性基没有异或和为 0 的子集
4. 线性基种的每个元素的异或方案唯一，也就是说，线性基中的异或组合异或出的数都是不一样的
5. 线性基中的每个元素的二级制最高位互不相同

#### 线性基的构造方法

对原集合的每一个数 p 转化为二进制，从高位向低位扫，对于第 x 位为 1 的，如果 $a_x$ 不存在，那么令 $a_x = p$ 并结束扫描，如果存在，令 $p_i=p_ixor a_x$

code:

```c++
inline void insert(long long x) {
  for (int i = 55; i + 1; i--) {
    if (!(x >> i))  // x的第i位是0
      continue;
    if (!p[i]) {
      p[i] = x;
      break;
    }
    x ^= p[i];
  }
}
```

#### 查询原集合内任意几个元素 xor 的最大值

将线性基从高位向低位扫，若 xor 上当前扫到的 $a_x$ 答案变大，就把答案异或上 $a_x$

#### 第 k 大的子集合异或和

[HDU 3949](https://vjudge.csgrandeur.cn/problem/HDU-3949)

要求我们查询一个数组能异或出来的第 k 大的值

构造一个特殊的线性基，使得每一个线性基中的值都只有一位是 1

如 a1:0001000 a2:0000010 a3:00000001

从小到大存入一个容器中，再枚举查询的第 k 大的 k 值某一位上是否为 1，如果是 1，则将 ans 异或上对应下标的线性基数组中的值

注意如果线性基的大小与原数组的大小不一样，说明原数组是线性相关的，此时则需要将 k-1，在进行查询（0 是最小的）

```c++
#include<iostream>
#include<cstring>
#include<cstdio>
#include<queue>
#include<map>
#include<set>
#include<vector>
#include<algorithm>
#include<string>
#include<bitset>
#include<cmath>
#include<array>
#include<atomic>
#include<sstream>
#include<stack>
#include<iomanip>
//#include<bits/stdc++.h>

#define int ll
#define pb push_back
#define endl '\n'
#define x first
#define y second
#define Endl endl
#define pre(i,a,b) for(int i=a;i<=b;i++)
#define rep(i,b,a) for(int i=b;i>=a;i--)
#define si(x) scanf("%d", &x);
#define sl(x) scanf("%lld", &x);
#define ss(x) scanf("%s", x);
#define YES {puts("YES");return;}
#define NO {puts("NO"); return;}
#define all(x) x.begin(),x.end()

using namespace std;

typedef long long ll;
typedef unsigned long long ull;
typedef pair<int, int> PII;
typedef pair<int, PII> PIII;
typedef pair<char, int> PCI;
typedef pair<int, char> PIC;
typedef pair<double, double> PDD;
typedef pair<ll, ll> PLL;
const int N = 200010, M = 2 * N, B = N, MOD = 1000000007;
const int INF = 0x3f3f3f3f;
const ll LLINF = 0x3f3f3f3f3f3f3f3f;

int dx[4] = { -1,0,1,0 }, dy[4] = { 0,1,0,-1 };
int n, m, k;
ll a[N], p[N], q[N];

ll gcd(ll a, ll b) { return b ? gcd(b, a % b) : a; }
ll lowbit(ll x) { return x & -x; }
ll qmi(ll a, ll b, ll mod) {
    ll res = 1;
    while (b) {
        if (b & 1) res = res * a % mod;
        a = a * a % mod;
        b >>= 1;
    }
    return res;
}

inline void init() {}

void insert(ll x)
{
    rep(i, 63, 0)
    {
        if (!(x >> i))continue;
        if (!p[i]) {
            p[i] = x;
            break;
        }
        x ^= p[i];
    }
}

void slove()
{
    memset(p, 0, sizeof p);
    static int T = 0;
    cin >> n;
    pre(i, 1, n) {
        cin >> a[i];
        insert(a[i]);
    }

    rep(i, 63 - 1, 0)
    {
        pre(j, i + 1, 63 - 1)
        {
            if (p[j] >> i & 1)
            {
                p[j] ^= p[i];
            }
        }
    }

    vector<ll> ves;
    pre(i, 0, 63)
    {
        if (p[i])ves.push_back(p[i]);
    }

    cin >> m;
    pre(i, 1, m) cin >> q[i];
    printf("Case #%d:\n", ++T);
    pre(i, 1, m)
    {
        ll res = 0;
        if (n != ves.size())q[i]--;
        pre(j, 0, 63)
        {
            if (q[i] >> j & 1) {
                if (j >= ves.size()) {
                    res = -1;
                    break;
                }
                res ^= ves[j];
            }
        }
        cout << res << Endl;
    }
}

signed main()
{
    int _;
    si(_);
    //_ = 1;
    init();
    while (_--)
    {
        slove();
    }
    return 0;
}

```

#### 最大路径异或和

[P4151 [WC2011\]最大 XOR 和路径 - 洛谷 | 计算机科学教育新生态 (luogu.com.cn)](https://www.luogu.com.cn/problem/P4151)

求从 1 到 n 的最大路径异或和，首先在纸上作图，发现，来回的走一条路径是等价于没有走过的，因此，我们可以从图上的任一点到达另一点后走回来是等价于停留在原地的，因此我们可以将 1-n 的路径拓展到所有的点上而保持值不变，通过观察，我们可以发现，环可以为我们的路径权值提供贡献值，因为它们是可以在（扩展到全图后的路径）路径中走奇数遍的。

因此，我们 dfs 对环建立线性基，刚开始随机选取一条 1-n 的路径，与线性基异或取最大值（注意，因为 ans 刚开始并不是 0，因此每次选取需要 max）

```c++
#include<iostream>
#include<cstring>
#include<cstdio>
#include<queue>
#include<map>
#include<set>
#include<vector>
#include<algorithm>
#include<string>
#include<bitset>
#include<cmath>
#include<array>
#include<atomic>
#include<sstream>
#include<stack>
#include<iomanip>
//#include<bits/stdc++.h>

#define int ll
#define pb push_back
#define endl '\n'
#define x first
#define y second
#define Endl endl
#define pre(i,a,b) for(int i=a;i<=b;i++)
#define rep(i,b,a) for(int i=b;i>=a;i--)
#define si(x) scanf("%d", &x);
#define sl(x) scanf("%lld", &x);
#define ss(x) scanf("%s", x);
#define YES {puts("YES");return;}
#define NO {puts("NO"); return;}
#define all(x) x.begin(),x.end()

using namespace std;

typedef long long ll;
typedef unsigned long long ull;
typedef pair<int, int> PII;
typedef pair<int, PII> PIII;
typedef pair<char, int> PCI;
typedef pair<int, char> PIC;
typedef pair<double, double> PDD;
typedef pair<ll, ll> PLL;
const int N = 200010, M = 2 * N, B = N, MOD = 1000000007;
const int INF = 0x3f3f3f3f;
const ll LLINF = 0x3f3f3f3f3f3f3f3f;

int dx[4] = { -1,0,1,0 }, dy[4] = { 0,1,0,-1 };
int n, m, k;
int h[N], ne[M], e[M], idx;
ll w[M], p[N], verval[N];
ll ans;

ll gcd(ll a, ll b) { return b ? gcd(b, a % b) : a; }
ll lowbit(ll x) { return x & -x; }
ll qmi(ll a, ll b, ll mod) {
    ll res = 1;
    while (b) {
        if (b & 1) res = res * a % mod;
        a = a * a % mod;
        b >>= 1;
    }
    return res;
}

inline void init() {}

void add(int a, int b, int c)
{
    e[idx] = b, w[idx] = c, ne[idx] = h[a], h[a] = idx++;
}

inline void insert(ll x)
{
    rep(i, 63, 0)
    {
        if (!(x >> i & 1))continue;
        if (!p[i]) {
            p[i] = x;
            break;
        }
        x ^= p[i];
    }
}

void dfs(int u, ll val)
{
    verval[u] = val;

    for (int i = h[u]; ~i; i = ne[i])
    {
        int j = e[i];
        if (verval[j] != -1)
        {
            insert(val ^ verval[j] ^ w[i]);
            continue;
        }
        dfs(j, val ^ w[i]);
    }
    return;
}

void slove()
{
    memset(verval, -1, sizeof verval);
    memset(h, -1, sizeof h);
    cin >> n >> m; 
    int a, b, c;
    pre(i, 1, m)
    {
        cin >> a >> b >> c;
        add(a, b, c); add(b, a, c);
    }

    dfs(1, 0);

    ll t = ans= verval[n];
    rep(i, 63, 0)
    {
        ans = max(ans, ans ^ p[i]);
    }
    cout << ans << endl;
}

signed main()
{
    int _;
    //si(_);
    _ = 1;
    init();
    while (_--)
    {
        slove();
    }
    return 0;
}

```

#### 线性无关的特性，线性基的大小

https://vjudge.csgrandeur.cn/problem/CodeForces-1101G

该题要求将一个数组分成若干个段，保证段本身，段与段之间的异或都不为 0 的最大段数量

由于段与段之间的异或和不为 0，因此，可判断，各段的异或值是线性无关的，且根据题目要求各段的异或值是不为 0 的，因此，数组中线性相关的值必须放在同一段里另外加任意值。

应该敏锐的察觉到，上述特性与线性基的特性高度重合，因此，题目所求的值即位线性基的大小

```c++
#include<iostream>
#include<cstring>
#include<cstdio>
#include<queue>
#include<map>
#include<set>
#include<vector>
#include<algorithm>
#include<string>
#include<bitset>
#include<cmath>
#include<array>
#include<atomic>
#include<sstream>
#include<stack>
#include<iomanip>
//#include<bits/stdc++.h>

//#define int ll
#define pb push_back
#define endl '\n'
#define x first
#define y second
#define Endl endl
#define pre(i,a,b) for(int i=a;i<=b;i++)
#define rep(i,b,a) for(int i=b;i>=a;i--)
#define si(x) scanf("%d", &x);
#define sl(x) scanf("%lld", &x);
#define ss(x) scanf("%s", x);
#define YES {puts("YES");return;}
#define NO {puts("NO"); return;}
#define all(x) x.begin(),x.end()

using namespace std;

typedef long long ll;
typedef unsigned long long ull;
typedef pair<int, int> PII;
typedef pair<int, PII> PIII;
typedef pair<char, int> PCI;
typedef pair<int, char> PIC;
typedef pair<double, double> PDD;
typedef pair<ll, ll> PLL;
const int N = 200010, M = 2 * N, B = N, MOD = 998244353;
const int INF = 0x3f3f3f3f;
const ll LLINF = 0x3f3f3f3f3f3f3f3f;

int dx[4] = { -1,0,1,0 }, dy[4] = { 0,1,0,-1 };
int n, m, k;
int a[N], p[35];

ll gcd(ll a, ll b) { return b ? gcd(b, a % b) : a; }
ll lowbit(ll x) { return x & -x; }
ll qmi(ll a, ll b, ll mod) {
    ll res = 1;
    while (b) {
        if (b & 1) res = res * a % mod;
        a = a * a % mod;
        b >>= 1;
    }
    return res;
}

inline void init() {}

bool insert(int x) {
    bool res = false;
    rep(i, 30, 0)
    {
        if (((x >> i) & 1)==0)continue;
        if (p[i]==0) {
            p[i] = x; res = true;
            break;
        }
        x ^= p[i];
    }
    return res;
}

void slove()
{
    cin >> n;
    pre(i, 1, n)cin >> a[i];

    int t=0;
    pre(i, 1, n) {
        insert(a[i]);
        t ^= a[i];
    }
    if (!t) { cout << -1 << endl; return; }
    else {
        int cnt = 0;
        pre(i, 0, 30)if (p[i])cnt++;
        cout << cnt << Endl;
    }
}

signed main()
{
    int _;
    //si(_);
    _ = 1;
    init();
    while (_--)
    {
        slove();
    }
    return 0;
}
```

# 常见数学模型的特殊性质

## 斐波那契数列

**$\sum{_i^k}F[i]+1=F[k+2]$**

如果 k 为奇数

$F[k]=F[1]+\sum{_{i=1}^{k/2}}F[2*i]$

如果 k 为偶数

$F[k]=\sum{_{i=1}^{k/2}}F[2*i-1]$

