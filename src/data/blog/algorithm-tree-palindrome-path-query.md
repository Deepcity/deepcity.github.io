---
title: "树上最短回文问题"
pubDatetime: 2024-08-14T19:39:46+08:00
description: "算法题解笔记，讨论树上路径回文判定问题，并从字符串回文、哈希、二分与马拉车算法引出解法思路。"
slug: "algorithm-tree-palindrome-path-query"
draft: false
tags:
  - "算法"
  - "图论"
  - "哈希算法"
  - "c++"
author: "Deepcity"
timezone: "Asia/Shanghai"
---

## 题意

给定一棵树，给出m个查询，要求判断每个查询给出的a,b之间的最短路顶点权值是否回文？

<!--more-->

## 题解

不想看回文的读者请跳转到“真的题解”

看到回文，回顾回文！下面以数组为例子，求最长回文字符串。

回文暴力：对于i,暴力向两边分奇偶扩展，找最长回文长度

回文小技巧：对每个字符中间以及开头结尾加一个useless字符，比如‘#’,即“a”变为“#a#”，“bb”变为“#b#b#”这样避免了奇偶判断，并且回文的左半边直接变成了原本回文字符串的长度，你也可以自己构造（ofcourse自己构造的更好，只要你知道特性即可。

回文哈希二分：对于i，从前从后hax，二分回文长度。

二分如下：

```cpp
ull get(ull h[], ull l, ull r)
{
    return h[r] - h[l - 1] * p[r - l + 1];
}

void slove(){
    p[0] = 1;
    for(int i=1;i<N;i++) p[i] = p[i-1] * P;
    int t =0;
    while(cin>>s,s!="END") {
        n = s.size();

        n *= 2;
        s.resize(n);
        for (int i = n; i; i -= 2)
        {
            s[i] = s[i / 2];
            s[i - 1] = '#';
        }
        s = '#' + s;
        n++;
        // cout<<n<<endl;
        // cout<<s<<nline;

        for(int i=0;i<n;i++)if(!i) ph[i] = s[i];else ph[i] = ph[i-1] * P + s[i];
        for(int i=n-1;~i;i--)if(i==n-1) rh[i] = s[i];else rh[i] = rh[i+1] * P + s[i];

        int ans = 1;
        for (int i = 1; i <= n; i ++ )
        {
            ull r = min(i - 1, n - i);
            if (ans >= r || get(ph, i - ans, i - 1) != get(rh, n - (i + ans) + 1, n - i)) continue;
            while (ans <= r && get(ph, i - ans, i - 1) == get(rh, n - (i + ans) + 1, n - i)) ans ++ ;
            ans -- ;
        }
        cout<<"Case " << ++t<<": "<<ans<<endl;
    }
}
```

题解要开始加速了！

首先意识到，重复的判断当前的i中心最大回文串是一种暴力的解法，因为解出的数据并未利用。可以理解的是对于以求出的回文长度，我们只需要判断是否存在更大的回文长度，这样可以优化二分，但并不完全。下面是直接优化$log_2n$的解法！

注意到（数学噩梦词），判断扩展的回文是O(1)，时间复杂度，回文长度只能更长而非更短。因此，最多判断n次回文。因此，记录回文长度并不断更新它即可！

```cpp
ull ans = 1;
for (int i = 1; i <= n; i ++ )
{
  ull r = min(i - 1, n - i);
  if (ans >= r || get(h1, i - ans, i - 1) != get(h2, n - (i + ans) + 1, n - i)) continue;
  while (ans <= r && get(h1, i - ans, i - 1) == get(h2, n - (i + ans) + 1, n - i)) ans ++ ;
  ans -- ;
}
```

最后一种回文做法总算是有名字了，即对朴素判断是否回文的非hax优化。通常叫它，马拉车算法。（ps：这个算法我陆陆续续看到过好多次，但是每一次都需要到看题解的地步，或许是我没有自己推导出来过，导致没记住。。。也许是因为很少有题目涉及他。。

简单说一说，该算法维护两个值：1. c 回文子串的中心位置 2. R 回文子串的最后位置。以及辅助数组w，记录以i为中心的最长回文长度。（注意我们添加的#会影响w，注意维护w的合法）

整个该算法的重点在于：“回文对称”！

![img](https://pic1.zhimg.com/v2-11f96d39d9648b7c146e49cdceb0854c_r.jpg)

即，当我们想知道i的回文长度，首先看i对当前R所代表的回文子串的镜像长度。

若i+w[i_mirror]大于等于R,则暴力扩展R,并更新c。

若i-w[i_mirror]>=0即i_mirror的回文子串碰到了边界，则中心扩展i

```cpp
// 马拉车算法
public String longestPalindrome2(String s) {
    String T = preProcess(s);
    int n = T.length();
    int[] P = new int[n];
    int C = 0, R = 0;
    for (int i = 1; i < n - 1; i++) {
        int i_mirror = 2 * C - i;
        if (R > i) {
            P[i] = Math.min(R - i, P[i_mirror]);// 防止超出 R
        } else {
            P[i] = 0;// 等于 R 的情况
        }

        // 碰到之前讲的三种情况时候，需要利用中心扩展法
        while (T.charAt(i + 1 + P[i]) == T.charAt(i - 1 - P[i])) {
            P[i]++;
        }

        // 判断是否需要更新 R
        if (i + P[i] > R) {
            C = i;
            R = i + P[i];
        }

    }
   \\代码source :https://zhuanlan.zhihu.com/p/70532099
```

## 真的题解

上面讲了一串，最后还得是哈！希！，字符串，哈！希！

最短路，那就求求lca，倍增ortarjanor重链刨分，你可以使用任何你想用的。

注意到对任意a,b找出字符串然后做字符串hax判断不现实（暴力找出字符串最大$$n^2$$）注意到，对整个路径的长度是很容易求出来的，因而，可以通过倍增找到中间字符直接计算hax子串。就是这么简单！小白月赛！淦！

但应该如何计算正逆序的hax值呢？显然对树的所有串建个hax会爆空间，但对多个串交织在一起该如何建立hax数组呢？笔者在这一刻小脑控制大脑，直接重工业ds，树链刨分在这一刻取得了他应有的荣光，将树问题转为了一个链式问题。

但实际上这么做虽然可行，但没有这个必要。直接hax减就好了。。。

```cpp
void add(int a,int b) {
    e[a].pb(b);
    e[b].pb(a);
}

int qmi(int a,int b,int mod){
    int res=1%mod;
    while(b){
        if(b&1) res=res*a%mod;
        a=a*a%mod;
        b>>=1;
    }
    return res;
}

void dfs1(int u = 1) {
    siz[u] = 1;
    int mx = 0;
    for(int& v: e[u]) {
        if(v==fa[u])continue;

        depth[v] = depth[u] + 1;
        ph[v]=(ph[u]*P%MOD+(s[v]-'a'+1))%MOD;
        rh[v]=(rh[u]+p[depth[v]-1]*(s[v]-'a'+1)% MOD)%MOD;

        f[v][0] = u;
        for(int i=1;i<=20;i++)
            f[v][i] = f[f[v][i-1]][i-1];
        dfs1(v);
        siz[u] += siz[v];
        if(siz[v] > mx) {
            mx = siz[v];hs[u] = v;
        }
    }
}

void dfs2(int u = 1, int t = 1) {
    len[t] ++;
    top[u] = t;
    if(siz[u] == 1) return ;
    dfs2(hs[u],t);

    for(int v: e[u]) {
        if(v!=hs[u]&&v!=fa[u]) {
            dfs2(v,v);
        }
    }
}

int lca(int a,int b) {
    while(top[a] != top[b]) {
        if(depth[top[a]] < depth[top[b]])swap(a,b);
        a = fa[top[a]];
    }
    if(depth[a] < depth[b]) swap(a,b);
    return b;
}

void slove(){
    p[0] = 1;
    for(int i=1;i<N;i++) p[i] = (p[i-1] * P) % MOD;
    cin>>n;
    cin>>s;
    s = ' ' + s;
    depth[1] = 1;
    for(int i=1;i<=n;i++) {
        cin>>fa[i];
        if(fa[i]) add(i,fa[i]);
        else fa[i] = -1;
    }


    ph[1]=s[1]-'a'+1,rh[1]=s[1]-'a'+1;
    dfs1();dfs2();

    cin>>m;
    while(m--) {
        int a,b;cin>>a>>b;
        if(depth[a] < depth[b]) swap(a,b);
        lc = lca(a,b);

        int f=lca(a,b);
        int p1=((rh[a]-rh[fa[f]]*qmi(p[depth[f]-1],MOD-2,MOD)%MOD)+MOD) %MOD;
        int p2=(ph[b]-ph[f]*p[depth[b]-depth[f]]%MOD+MOD)%MOD;
        int ans1=(p1*(p[depth[b]-depth[f]])%MOD+p2)%MOD;
        p1=(rh[b]-rh[fa[f]]+MOD)%MOD*qmi(p[depth[f]-1],MOD-2,MOD)%MOD;
        p2=(ph[a]-ph[f]*p[depth[a]-depth[f]]%MOD+MOD)%MOD;
        int ans2=(p1*(p[depth[a]-depth[f]])%MOD+p2)%MOD;
        cout<<(ans1==ans2?"YES\n":"NO\n");
        cout<<f<<endl;
        cout<<ans1<<' '<<ans2<<nline;
    }
}
```
