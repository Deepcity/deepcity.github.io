---
title: "API Agent: Embedding, MCP, Skills"
pubDatetime: 2026-03-07T00:00:00Z
modDatetime: 2026-03-15T00:00:00Z
description: "基于 Gemini API Cookbook 的 Agent 实操笔记，梳理 Embedding、Function Calling、MCP、Skills 与编排层关系。"
slug: "api-agent-embedding-mcp-skills"
draft: false
tags:
  - "LLM"
  - "Agent"
  - "MCP"
  - "Embedding"
---

## 前言

写于2026年3月7日，一个疯狂的AI基建时代。写下这篇记录时，Claude opus 4.6, GPT 5.4刚刚推出，国内Qwen 3.5核心团队离职，FARS刚刚产出140+篇论文。出于研究生的研究热枕与对AI智能替代的担忧写下这篇基于官方cookbook的国内API Agent实操。

## Setup

Google Gemini API

Windows 11 with WSL2 Ubuntu 24.04.3 LTS

Google Colab as scripts

## Quick Starts

### Quick API Chat

```py
from google import genai
from google.colab import userdata

GOOGLE_API_KEY = userdata.get('GOOGLE_API_KEY')
client = genai.Client(api_key=GOOGLE_API_KEY)

MODEL_ID = "gemini-3.1-flash-lite-preview"

from IPython.display import Markdown

response = client.models.generate_content(
    model=MODEL_ID,
    contents="Please give me python code to sort a list."
)

display(Markdown(response.text))
```

只需要设置GOOGLE_API_KEY环境变量即可通过这个API、代码构成一次对话请求。（almost no cost）。

> 通过这样的方式也可以调整system_instruction，以及Configure model parameters。
>
> 有一个精确成本的技巧，`count_tokens`，会输出提示词的输入token数量。
>
> 现代模型（202603），都已经是思考模型，对google来讲是2.5后的所有模型。值得注意的是GPT Instant也是思考模型。
>
> 对于这部分模型，`include_thoughts=True` 控制是否检查模型的思考过程。`thinking_budget`可以控制思考多少，但仅在部分模型例如flash,flash-lite上可用。
>
> eg:
>
> ```py
> prompt = "A man moves his car to an hotel and tells the owner he’s bankrupt. Why?"
> 
> response = client.models.generate_content(
> model=MODEL_ID,
> contents=prompt,
> config=types.GenerateContentConfig(
>  thinking_config=types.ThinkingConfig(
>    include_thoughts=True
>    thinking_budget=1000
>  )
> )
> )
> 
> for part in response.parts:
> if not part.text:
>  continue
> if part.thought:
>  display(Markdown("### Thought summary:"))
>  display(Markdown(part.text))
>  print()
> else:
>  display(Markdown("### Answer:"))
>  display(Markdown(part.text))
>  print()
> 
> print(f"We used {response.usage_metadata.thoughts_token_count} tokens for the thinking phase and {response.usage_metadata.prompt_token_count} for the output.")
> ```

### Quick Agent

基本概念

正如Zhihu网友对Agent的清晰描述（很多人当时都在贬低Agent架构中不智能的部分会限制整体系统智能的上限），Agent整体是一个由智能体以及代码脚本构成的一个复杂状态机，通过互联网基础服务（例如Google Search API, Places API）构成的Task Bot。

![Agent 系统中 LLM、工具运行时与约束层的关系示意图](https://files.seeusercontent.com/2026/03/14/fAe8/20260314154349.png)

一般过程如下

- **LLM**：负责理解意图、选择动作、填参数、整合结果
- **Tool Runtime / Orchestrator**：负责真正执行动作
- **Schema / Policy**：负责约束和纠错

所以一个 agent 系统不是“LLM 单独工作”，而是：

> **LLM 负责认知与决策，程序系统负责执行与校验。**

User - [prompt] -> LLM - [Function call] -> schema -> tool runtime / Orchestrator -> [return] -> LLM -> User

这里的return和用户的prompt在LLM中的差别非常小。

#### Copilot Agent

[deepcity.github.io/.github at main · Deepcity/deepcity.github.io](https://github.com/Deepcity/deepcity.github.io/tree/main/.github)

Copilot的Agent几乎是最原始的Agent，在撰写这篇blog的过程中Copilot Edu已经不包含GPT5.4，Cluade Sonnet 与 Opus，因此这里的例子仅供了解Agent的基本原理。

```text
.github/
├── README.md                          # 目录结构说明
├── CODE_OF_CONDUCT.md                 # 社区行为准则
├── CONTRIBUTING.md                    # 贡献指南
├── FUNDING.yml                        # 赞助/资金配置
├── PULL_REQUEST_TEMPLATE.md           # Pull Request 模板
├── ISSUE_TEMPLATE/                    # Issue 模板目录
│   ├── config.yml                     # Issue 模板全局配置
│   ├── ✨-feature-request.md          # 功能请求模板
│   ├── 🐞-bug-report.md               # Bug 报告模板
│   └── 📝-documentation-improvement.md # 文档改进建议模板
├── agents/                            # GitHub Copilot 自定义 Agent 配置
│   ├── blog-lint.agent.md             # 博客文章格式检查 Agent
│   └── blog-memory.md                 # 博客知识库/记忆文件
└── instructions/                      # GitHub Copilot 自定义指令
    ├── blog-format.instructions.md    # 博客 Markdown 格式规范指令
    └── frontend-style.instructions.md # 前端样式约定指令
```

##### 根级文件

| 文件                       | 说明                                                         |
| -------------------------- | ------------------------------------------------------------ |
| `CODE_OF_CONDUCT.md`       | 基于 [Contributor Covenant v2.0](https://www.contributor-covenant.org/version/2/0/code_of_conduct.html) 的社区行为准则，规定了可接受与不可接受的行为，以及违规处理流程（纠正 → 警告 → 临时封禁 → 永久封禁）。 |
| `CONTRIBUTING.md`          | 面向贡献者的指南，涵盖提 Issue、提交 PR、修改博客内容、参与讨论和 Code Review 等贡献方式。 |
| `FUNDING.yml`              | 配置 GitHub 赞助按钮，当前文件中填写的是 GitHub Sponsors 和 Buy Me a Coffee 的赞助账号，可按需修改为项目实际维护者的账号。 |
| `PULL_REQUEST_TEMPLATE.md` | 新建 Pull Request 时自动填充的描述模板，包含变更描述、变更类型勾选项（Bug Fix / New Feature / Docs / Others）及合并前检查清单。 |

##### `ISSUE_TEMPLATE/` — Issue 模板

| 文件                             | 说明                                                         |
| -------------------------------- | ------------------------------------------------------------ |
| `config.yml`                     | 禁用空白 Issue（`blank_issues_enabled: false`），并将用户引导至 AstroPaper Discussions 提问。 |
| `✨-feature-request.md`           | **功能请求**模板，引导用户描述痛点、期望解决方案及备选方案，标签自动设为 `enhancement`。 |
| `🐞-bug-report.md`                | **Bug 报告**模板，引导用户提供复现步骤、预期行为、截图及补充信息，标签自动设为 `bug`。 |
| `📝-documentation-improvement.md` | **文档改进**模板，引导用户描述文档问题和建议修改内容，标签自动设为 `documentation`。 |

---

##### `agents/` — GitHub Copilot 自定义 Agent

| 文件                 | 说明                                                         |
| -------------------- | ------------------------------------------------------------ |
| `blog-lint.agent.md` | 定义一个专门用于博客文章格式检查的 Copilot Agent，可自动校验 frontmatter、标签、Markdown 规范等。 |
| `blog-memory.md`     | 存储博客相关的上下文记忆（如已有标签体系、文章约定等），供 Agent 在后续任务中复用。 |

---

##### `instructions/` — GitHub Copilot 自定义指令

| 文件                             | 适用范围                                               | 说明                                                         |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| `blog-format.instructions.md`    | `src/data/blog/**`                                     | 博客文章 frontmatter Schema、标签体系、Markdown 正文规范及 Slug 命名约定。 |
| `frontend-style.instructions.md` | `src/styles/**`、`src/components/**`、`src/layouts/**` | 前端样式约定，包括 CSS 变量主题系统、Tailwind v4 映射、暗色模式、排版规则和布局约定。 |

---

```text
用户输入
    │
    ▼
Copilot 根据 description 字段匹配并激活 Blog Lint Agent
    │
    ▼
Agent 读取 blog-memory.md + src/content.config.ts
    │
    ▼
┌───────────────────────────────────┐
│  根据模式执行任务                  │
│  • 格式检查  • 批量扫描            │
│  • 自动修复  • 系列追踪            │
└───────────────────────────────────┘
    │
    ▼
输出中文报告（或直接修改文件）
    │
    ▼
若内容变化 → 更新 blog-memory.md（持久化状态）
```

这里实际上只是自动增加了上下文，利用大模型深度推理（Think）去分支任务。并且文档归档的页十分不规范，暴露的问题如下：

1. 每个文档的职责不明确，导致大量token浪费，难以维护
2. 文档更新过于随机，完全交由Copilot自身的Schema / Policy处理，

To summarized: 这里实现的不是完整的Agent，而是Agent的“小脑”，仅仅存放了部分Instruction, Skill, Memory，根本没有搭建honk等体系，也没有实现整体Agent的自更新。

#### Gemini-Tuxun-Agent

通过claude4.6 vibe coding的Gemini图寻Agent

[Deepcity/Gemini-Tuxun-Agent: Gemini with gog For tuxun.fun](https://github.com/Deepcity/Gemini-Tuxun-Agent)

这个Agent勉强有一些架构设计，下面贴一下agnet.py，仅供参考

```py
#!/usr/bin/env python3
"""Gemini Tuxun GeoGuessr Agent — 主入口."""

import argparse
import json
import pathlib
import re
import sys

from google import genai
from google.genai import types

import config
from prompts import SYSTEM_PROMPT, USER_PROMPT_TEMPLATE, REFLECTION_PROMPT
from tools.google_maps import ALL_TOOLS, TOOL_DISPATCH

# ── 图片加载 ───────────────────────────────────────────────────────────────

SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"}


def load_images(path: str) -> list[types.Part]:
    """从文件或文件夹加载图片，返回 Gemini Part 列表."""
    p = pathlib.Path(path)
    if p.is_file():
        files = [p]
    elif p.is_dir():
        files = sorted(
            f for f in p.iterdir() if f.suffix.lower() in SUPPORTED_EXTENSIONS
        )
    else:
        sys.exit(f"路径不存在: {path}")

    if not files:
        sys.exit(f"未找到支持的图片文件: {path}")

    parts = []
    for f in files:
        mime = f"image/{f.suffix.lstrip('.').lower()}"
        if mime == "image/jpg":
            mime = "image/jpeg"
        parts.append(types.Part.from_bytes(data=f.read_bytes(), mime_type=mime))
        print(f"  已加载图片: {f.name}")
    return parts


# ── 工具调用分发 ──────────────────────────────────────────────────────────

def dispatch_tool_call(function_call: types.FunctionCall) -> types.Part:
    """执行单个工具调用并返回 FunctionResponse Part."""
    name = function_call.name
    args = dict(function_call.args) if function_call.args else {}
    print(f"  🔧 调用工具: {name}({args})")

    func = TOOL_DISPATCH.get(name)
    if func is None:
        result = {"error": f"未知工具: {name}"}
    else:
        try:
            result = func(**args)
        except Exception as e:
            result = {"error": f"工具调用失败: {e}"}

    print(f"  📎 结果: {json.dumps(result, ensure_ascii=False)[:200]}")
    return types.Part.from_function_response(name=name, response=result)


# ── 提取最终 JSON ─────────────────────────────────────────────────────────

def extract_json_result(text: str) -> dict | None:
    """尝试从模型回复中提取 JSON 结果."""
    # 匹配 ```json ... ``` 代码块
    m = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    # 匹配裸 JSON
    m = re.search(r'\{\s*"lat"\s*:', text)
    if m:
        start = m.start()
        depth = 0
        for i, ch in enumerate(text[start:], start):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start : i + 1])
                    except json.JSONDecodeError:
                        break
    return None


# ── Agent 主循环 ──────────────────────────────────────────────────────────

def run_agent(image_path: str, hint: str = "") -> dict:
    """运行 Agent：图片分析 → 工具验证循环 → 输出坐标."""

    client = genai.Client(api_key=config.GEMINI_API_KEY)

    # 加载图片
    print(f"\n{'='*60}")
    print("📷 加载图片...")
    image_parts = load_images(image_path)

    # 构建初始用户消息
    hint_text = f"提示信息：{hint}" if hint else "无额外提示。"
    user_text = USER_PROMPT_TEMPLATE.format(hint=hint_text)

    contents: list[types.Content] = [
        types.Content(
            role="user",
            parts=image_parts + [types.Part.from_text(text=user_text)],
        )
    ]

    generate_config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        tools=ALL_TOOLS,
        temperature=0.2,
    )

    print(f"\n{'='*60}")
    print("🧠 Agent 开始分析...")
    print(f"{'='*60}\n")

    final_result = None

    for round_num in range(1, config.MAX_TOOL_ROUNDS + 1):
        print(f"── 第 {round_num} 轮 ──")

        response = client.models.generate_content(
            model=config.MODEL_NAME,
            contents=contents,
            config=generate_config,
        )

        # 收集模型回复中的所有 parts
        model_parts = []
        tool_calls = []

        for candidate in response.candidates:
            for part in candidate.content.parts:
                model_parts.append(part)
                if part.function_call:
                    tool_calls.append(part.function_call)
                if part.text:
                    print(part.text)

        # 将模型回复加入历史
        contents.append(types.Content(role="model", parts=model_parts))

        # 如果有工具调用，执行并继续循环
        if tool_calls:
            tool_response_parts = [
                dispatch_tool_call(fc) for fc in tool_calls
            ]
            contents.append(
                types.Content(role="user", parts=tool_response_parts)
            )
            continue

        # 没有工具调用 — 尝试提取结果
        full_text = response.text or ""
        result = extract_json_result(full_text)

        if result and result.get("lat") is not None:
            confidence = result.get("confidence", 0)
            # 低置信度 → 触发自我反思
            if confidence < config.CONFIDENCE_THRESHOLD and round_num < config.MAX_TOOL_ROUNDS:
                print(f"\n⚠️ 置信度 {confidence} < {config.CONFIDENCE_THRESHOLD}，触发自我反思...\n")
                contents.append(
                    types.Content(
                        role="user",
                        parts=[types.Part.from_text(text=REFLECTION_PROMPT)],
                    )
                )
                continue
            final_result = result
            break
        else:
            # 模型没输出 JSON 也没调用工具 — 提示输出
            if round_num < config.MAX_TOOL_ROUNDS:
                contents.append(
                    types.Content(
                        role="user",
                        parts=[
                            types.Part.from_text(
                                text="请根据以上分析，输出最终的 JSON 结果（包含 lat, lng, country, region, detail, confidence, reasoning）。"
                            )
                        ],
                    )
                )
                continue
            break

    # 循环结束仍无结果 — 追加一次最终生成调用
    if final_result is None:
        print("── 最终总结轮 ──")
        contents.append(
            types.Content(
                role="user",
                parts=[
                    types.Part.from_text(
                        text="请根据以上所有分析和工具验证结果，直接输出最终的 JSON 结果（包含 lat, lng, country, region, detail, confidence, reasoning）。不要再调用任何工具。"
                    )
                ],
            )
        )
        response = client.models.generate_content(
            model=config.MODEL_NAME,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.2,
            ),
        )
        if response.text:
            print(response.text)
            final_result = extract_json_result(response.text)

    if final_result is None:
        print("\n❌ Agent 未能输出有效结果。")
        final_result = {"error": "未能生成有效的坐标结果"}

    print(f"\n{'='*60}")
    print("🎯 最终结果:")
    print(json.dumps(final_result, ensure_ascii=False, indent=2))
    print(f"{'='*60}\n")
    return final_result


# ── CLI 入口 ──────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Gemini Tuxun GeoGuessr Agent — 街景截图地理定位"
    )
    parser.add_argument(
        "image_path",
        help="图片文件路径或包含多张图片的文件夹路径",
    )
    parser.add_argument(
        "--hint",
        default="",
        help='额外提示信息，例如 "在国内" 或 "东南亚"',
    )
    parser.add_argument(
        "--output",
        "-o",
        default="",
        help="输出 JSON 结果到文件（可选）",
    )
    args = parser.parse_args()

    result = run_agent(args.image_path, args.hint)

    if args.output:
        out_path = pathlib.Path(args.output)
        out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"结果已保存到: {out_path}")


if __name__ == "__main__":
    main()

```

这个脚本基本上就是一个与LLM交互的中间层。

## Get Started: Basic Knowledge

### SDK（Software Development Kit）Details

这里采用 Google Gen AI SDK，相对应的有Claude SDK等。

> The **[Google Gen AI SDK](https://github.com/googleapis/python-genai)** provides a unified interface to [Gemini models](https://ai.google.dev/gemini-api/docs/models) through both the [Gemini Developer API](https://ai.google.dev/gemini-api/docs) and the Gemini API on [Vertex AI](https://cloud.google.com/vertex-ai/generative-ai/docs/overview). With a few exceptions, code that runs on one platform will run on both. This notebook uses the Developer API.

直接可以通过`pip`安装

```bash
%pip install -U -q 'google-genai>=1.51.0' # 1.51 is needed for Gemini 3 pro thinking levels support
```

#### Multi-turn chat

Basic Setting

```py
system_instruction = """
  You are an expert software developer and a helpful coding assistant.
  You are able to generate high-quality code in any programming language.
"""

chat_config = types.GenerateContentConfig(
    system_instruction=system_instruction,
)

chat = client.chats.create(
    model=MODEL_ID,
    config=chat_config,
)

response = chat.send_message("Write a function that checks if a year is a leap year.")

Markdown(response.text)
```

#### Save and resume a chat

Python SDK 中的大多数对象都实现为 Pydantic 模型。由于 Pydantic 具有用于序列化和反序列化对象的多项功能，因此您可以使用它们进行持久化

> [Models - Pydantic Validation](https://docs.pydantic.dev/latest/concepts/models/)

```py
# Convert the JSON back to the Pydantic schema.
history = history_adapter.validate_json(json_history)

# Now load a new chat session using the JSON history.
new_chat = client.chats.create(
    model=MODEL_ID,
    config=chat_config,
    history=history,
)

response = new_chat.send_message("What was the name of the function again?")
Markdown(response.text)
```

#### Structure Output

格式化输出，这部分一版用于自动化，子代理等部分

```py
from pydantic import BaseModel
import json

class Recipe(BaseModel):
    recipe_name: str
    recipe_description: str
    recipe_ingredients: list[str]

response = client.models.generate_content(
    model=MODEL_ID,
    contents="Provide a popular cookie recipe and its ingredients.",
    config=types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=Recipe,
    ),
)

print(json.dumps(json.loads(response.text), indent=4))
```

#### Generate content stream

内容流，这部分一般与直接交互的部分相关

```py
for chunk in client.models.generate_content_stream(
    model=MODEL_ID,
    contents="Tell me a story about a lonely robot who finds friendship in a most unexpected place."
):
  print(chunk.text, end="")
```

#### Send asynchronous requests

如题，仅仅只是异步方法。

### Grounding

#### Online Search(Google for gemini)

直接在config中增加tools即可

```py
from IPython.display import Markdown, HTML, display

response = client.models.generate_content(
    model=MODEL_ID,
    contents="Who's the current Magic the gathering world champion?",
    config={"tools": [{"google_search": {}}]},
)

# print the response
display(Markdown(f"**Response**:\n {response.text}"))
# print the search details
print(f"Search Query: {response.candidates[0].grounding_metadata.web_search_queries}")
# urls used for grounding
print(f"Search Pages: {', '.join([site.web.title for site in response.candidates[0].grounding_metadata.grounding_chunks])}")

display(HTML(response.candidates[0].grounding_metadata.search_entry_point.rendered_content))
```

#### Google Maps

```py
from google import genai
from google.genai import types
from google.colab import userdata
from IPython.display import Markdown

# 初始化客户端
GOOGLE_API_KEY = userdata.get('GOOGLE_API_KEY')
client = genai.Client(api_key=GOOGLE_API_KEY)
MODEL_ID = "gemini-2.5-flash" # 使用 latest 后缀确保指向有效模型

response = client.models.generate_content(
    model=MODEL_ID,
    contents="Do any cafes around here do a good flat white? I will walk up to 20 minutes away",
    config=types.GenerateContentConfig(
        tools=[types.Tool(google_maps=types.GoogleMaps())],
        tool_config=types.ToolConfig(
            retrieval_config=types.RetrievalConfig(
                lat_lng=types.LatLng(latitude=40.7680797, longitude=-73.9818957) # Columbus Circle in New York
            )
        ),
    ),
)
display(Markdown(f"### Response\n {response.text}"))
```

这里只能用2.5，最新的模型好像不支持map grounding.

#### URL Context

对于Google来说，Youtube的视频内容可以被接入大模型，多模态理解总结。

```py
response = client.models.generate_content(
    model=MODEL_ID,
    contents= types.Content(
        parts=[
            types.Part(text="Summarize this video of Google I/O 2025."),
            types.Part(
                file_data=types.FileData(file_uri='https://www.youtube.com/watch?v=LxvErFkBXPk')
            )
        ]
    )
)

display(Markdown(response.text))
```

同样的网站内容也是ok的

```py
prompt = """
  Compare recipes from https://www.food.com/recipe/homemade-cream-of-broccoli-soup-271210
  and from https://www.allrecipes.com/recipe/13313/best-cream-of-broccoli-soup/,
  list the key differences between them.
"""

tools = []
tools.append(types.Tool(url_context=types.UrlContext))

client = genai.Client(api_key=GEMINI_API_KEY)
config = types.GenerateContentConfig(
    tools=tools,
)

response = client.models.generate_content(
      contents=[prompt],
      model=MODEL_ID,
      config=config
)

display(Markdown(response.text))
```

### Function calling

Function Call概念与Skill，MCP，Tools概念紧密相连，在当下2026.03，这个概念十分重要，因此这里单独列出。

在Google的cookbook的定义中这个概念是：

> [Function calling](https://ai.google.dev/gemini-api/docs/function-calling) lets you provide a set of tools that it can use to respond to the user's prompt. You create a description of a function in your code, then pass that description to a language model in a request. The response from the model includes:
>
> - The name of a function that matches the description.
> - The arguments to call it with.

Google就这一个功能给出了cookbook单独的一页[cookbook/quickstarts/Function_calling.ipynb at 74f3def60c36464a6d7e6a6c039c882436831480 · google-gemini/cookbook](https://github.com/google-gemini/cookbook/blob/74f3def60c36464a6d7e6a6c039c882436831480/quickstarts/Function_calling.ipynb)

一个简单的例子如下

```py
get_destination = types.FunctionDeclaration(
    name="get_destination",
    description="Get the destination that the user wants to go to",
    parameters={
        "type": "OBJECT",
        "properties": {
            "destination": {
                "type": "STRING",
                "description": "Destination that the user wants to go to",
            },
        },
    },
)

destination_tool = types.Tool(
    function_declarations=[get_destination],
)

response = client.models.generate_content(
    model=MODEL_ID,
    contents="I'd like to travel to Paris.",
    config=types.GenerateContentConfig(
        tools=[destination_tool],
        ),
)

response.candidates[0].content.parts[0].function_call
```

基本上这个程序的输出如下

```shell
FunctionCall(
  args={
    'destination': 'Paris'
  },
  id='nn5oo26g',
  name='get_destination'
)
```

#### Function calling with MCP

Google在这里可以强调这里可以使用MCP，这里没有给出例子，但我这里给出一个MCP调用，以下是我用到的MCP。

> 写到这里发现没有给出MCP的定义，Skill与Tools都很好理解，但MCP（Model Context Protocol）?
>
> The Model Context Protocol is an open source project run by Anthropic, PBC. and open to contributions from the entire community.
>
> The MCP protocol currently defines two standard transport mechanisms for client-server communication:
>
> - stdio, communication over standard in and standard out
> - streamable HTTP
>
> 这里不过多赘述

这个MCP来自微软[MCP beginning](https://github.com/microsoft/mcp-for-beginners?tab=readme-ov-file)中的一个链接到的[mcp python SDK](https://github.com/modelcontextprotocol/python-sdk)

终端命令如下

```shell
uv init mcp-server-demo
cd mcp-server-demo
uv add "mcp[cli]"
pip install "mcp[cli]"
uv run --with mcp examples/snippets/servers/fastmcp_quickstart.py
```

`examples/snippets/servers/fastmcp_quickstart.py`文件内容如下：

```python
"""
FastMCP quickstart example.

Run from the repository root:
    uv run examples/snippets/servers/fastmcp_quickstart.py
"""

from mcp.server.fastmcp import FastMCP

# Create an MCP server
mcp = FastMCP("Demo", json_response=True)


# Add an addition tool
@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two numbers"""
    return a + b


# Add a dynamic greeting resource
@mcp.resource("greeting://{name}")
def get_greeting(name: str) -> str:
    """Get a personalized greeting"""
    return f"Hello, {name}!"


# Add a prompt
@mcp.prompt()
def greet_user(name: str, style: str = "friendly") -> str:
    """Generate a greeting prompt"""
    styles = {
        "friendly": "Please write a warm, friendly greeting",
        "formal": "Please write a formal, professional greeting",
        "casual": "Please write a casual, relaxed greeting",
    }

    return f"{styles.get(style, styles['friendly'])} for someone named {name}."


# Run with streamable HTTP transport
if __name__ == "__main__":
    mcp.run(transport="streamable-http")
```

通过**MCP Inspector**访问mcp服务方式如下：

```shell
npx -y @modelcontextprotocol/inspector
```

值得注意的是这里通过`Via Proxy`才能正常链接，原因可以自行询问AI，比较复杂。

![MCP Inspector 通过代理访问本地 MCP 服务的界面](https://files.seeusercontent.com/2026/03/14/sl8C/20260314154122.png)

效果类似上图

这里基本上可以访问所有mcp中的组件，例如Resources、Prompt、以及Tools等。用于调试MCP。

```py
import asyncio
import os

from google import genai
from google.genai import types
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

async def main():
    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])

    async with streamable_http_client("http://127.0.0.1:8000/mcp") as (read, write, _):
        async with ClientSession(read, write) as session:
            await session.initialize()

            tools = await session.list_tools()
            print("MCP tools:", [t.name for t in tools.tools])

            response = await client.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents="请调用 add 工具计算 9.9 + 9.11，只返回结果。",
                config=types.GenerateContentConfig(
                    tools=[session],
                    temperature=0,
                ),
            )

            print(response.text)

if __name__ == "__main__":
    asyncio.run(main())
```

在mcp服务启动时直接调用这份脚本即可调用add tool

> MCP tools: ['add']
> add 工具只接受整数，无法计算 9.9 + 9.11。

当然可以更改contents，改成整数就正确了。这里演示一个错的可以观察大模型如何处理。

在**MCP Inspector**中查看tools Output schema可见

```json
{
  "type": "object",
  "properties": {
    "result": {
      "title": "Result",
      "type": "integer"
    }
  },
  "required": [
    "result"
  ],
  "title": "addOutput"
}
```

输入a: 1, b: 1可见输出为

```json
{
  "result": 2
}
```

当输出与大模型相同的参数，返回的是

```json
Error executing tool add: 2 validation errors for addArguments
a
  Input should be a valid integer, got a number with a fractional part [type=int_from_float, input_value=9.9, input_type=float]
    For further information visit https://errors.pydantic.dev/2.12/v/int_from_float
b
  Input should be a valid integer, got a number with a fractional part [type=int_from_float, input_value=9.11, input_type=float]
    For further information visit https://errors.pydantic.dev/2.12/v/int_from_float
```

可见大模型在其中的角色。而MCP不仅仅在于对大模型已有能力的精确重放，而且在于扩展大模型的智能边界。不过涉及到的MCP更为复杂。

> 现在2026.03逐渐有人认为Tools（Grounding），RAG，MCP等都是一种Skill，大模型的能力不仅取决于Foundation Model更取决于Agentic System。AKA. “Models VS Systems”
>
> ***到底是处在那个职位的人能力更强还是那个职位的资源造就了那个人？***时间会给出答案。

虽然这里主要使用gemini，但值得注意的是Claude在这方面属于首创，Claude的MCP能力毫无疑问的更强。

更多function call详见[cookbook/quickstarts/Function_calling.ipynb at 74f3def60c36464a6d7e6a6c039c882436831480 · google-gemini/cookbook](https://github.com/google-gemini/cookbook/blob/74f3def60c36464a6d7e6a6c039c882436831480/quickstarts/Function_calling.ipynb)

### Code execution

```py
from IPython.display import Image, Markdown, Code, HTML

response = client.models.generate_content(
    model=MODEL_ID,
    contents="Generate and run a script to count how many letter r there are in the word strawberry",
    config = types.GenerateContentConfig(
        tools=[types.Tool(code_execution=types.ToolCodeExecution)]
    )
)

for part in response.candidates[0].content.parts:
  if part.text is not None:
    display(Markdown(part.text))
  if part.executable_code is not None:
    code_html = f'{part.executable_code.code}'
    display(HTML(code_html))
  if part.code_execution_result is not None:
    display(Markdown(part.code_execution_result.output))
  if part.inline_data is not None:
    display(Image(data=part.inline_data.data, format="png"))
  display(Markdown("---"))
```

以下是输出内容

```shell
word = "strawberry"
count = word.lower().count('r')
print(f"The word is: {word}")
print(f"The number of 'r's is: {count}")

The word is: strawberry
The number of 'r's is: 3

There are 3 letter "r"s in the word "strawberry".
Here is the script used to verify this:
word = "strawberry"
count = word.lower().count('r')
print(f"The word is: {word}")
print(f"The number of 'r's is: {count}")
Output:

The word is: strawberry
The number of 'r's is: 3
```

![Gemini Code Execution 返回脚本执行结果的界面截图](https://files.seeusercontent.com/2026/03/14/7gFr/20260314162006.png)

### Use context caching

包含好几个步骤

```py
import requests
import pathlib

system_instruction = """
  You are an expert researcher who has years of experience in conducting systematic literature surveys and meta-analyses of different topics.
  You pride yourself on incredible accuracy and attention to detail. You always stick to the facts in the sources provided, and never make up new facts.
  Now look at the research paper below, and answer the following questions in 1-2 sentences.
"""

urls = [
    'https://storage.googleapis.com/cloud-samples-data/generative-ai/pdf/2312.11805v3.pdf',
    "https://storage.googleapis.com/cloud-samples-data/generative-ai/pdf/2403.05530.pdf",
]

# Download files
pdf_bytes = requests.get(urls[0]).content
pdf_path = pathlib.Path('2312.11805v3.pdf')
pdf_path.write_bytes(pdf_bytes)

pdf_bytes = requests.get(urls[1]).content
pdf_path = pathlib.Path('2403.05530.pdf')
pdf_path.write_bytes(pdf_bytes)

# Upload the PDFs using the File API
uploaded_pdfs = []
uploaded_pdfs.append(client.files.upload(file='2312.11805v3.pdf'))
uploaded_pdfs.append(client.files.upload(file='2403.05530.pdf'))
```

初始化环境，注意这里的client是这样一个东西

| client | Client |      | <google.genai.client.Client object at 0x79f047b276b0> |
| ------ | ------ | ---- | ----------------------------------------------------- |

```py
# Create a cache with a 60 minute TTL
cached_content = client.caches.create(
    model=MODEL_ID,
    config=types.CreateCachedContentConfig(
      display_name='research papers', # used to identify the cache
      system_instruction=system_instruction,
      contents=uploaded_pdfs,
      ttl="3600s",
  )
)

cached_content
```

缓存内容，这里设置了60分钟的时间限制，输出是

> ```shell
> CachedContent(
>   create_time=datetime.datetime(2026, 3, 14, 8, 22, 46, 913869, tzinfo=TzInfo(0)),
>   display_name='research papers',
>   expire_time=datetime.datetime(2026, 3, 14, 9, 22, 45, 707549, tzinfo=TzInfo(0)),
>   model='models/gemini-3.1-flash-lite-preview',
>   name='cachedContents/b90juwfvlg3kdar3w6qe2ok1ahnjnchw2wma5x4r',
>   update_time=datetime.datetime(2026, 3, 14, 8, 22, 46, 913869, tzinfo=TzInfo(0)),
>   usage_metadata=CachedContentUsageMetadata(
>     total_token_count=93601
>   )
> )
> ```

如果要打印可用的缓存，如下：

```py
for cache in client.caches.list():
  print(cache)
```

从大模型中使用缓存，如下：

```py
response = client.models.generate_content(
  model=MODEL_ID,
  contents="What is the research goal shared by these research papers?",
  config=types.GenerateContentConfig(cached_content=cached_content.name)
)

Markdown(response.text)
```

删除缓存，如下

```py
result = client.caches.delete(name=cached_content.name)
```

### Get embeddings

快速使用一下

```py
EMBEDDING_MODEL_ID = "gemini-embedding-2-preview" # @param ["gemini-embedding-001", "gemini-embedding-2-preview"] {"allow-input":true, isTemplate: true}
response = client.models.embed_content(
    model=EMBEDDING_MODEL_ID,
    contents=[
        "How do I get a driver's license/learner's permit?",
        "How do I renew my driver's license?",
        "How do I change my address on my driver's license?"
        ],
)

print(response.embeddings)
```

输出：

```py
[ContentEmbedding(
  values=[
    -0.0051073395,
    -0.008700113,
    0.012337968,
    0.015490749,
    0.013524115,
    <... 3067 more items ...>,
  ]
), ContentEmbedding(
  values=[
    0.0047399383,
    -0.02839862,
    0.0027905644,
    -0.00028191903,
    0.00090539997,
    <... 3067 more items ...>,
  ]
), ContentEmbedding(
  values=[
    -0.00050140853,
    -0.015329912,
    0.008328494,
    0.0022835443,
    -0.0013814081,
    <... 3067 more items ...>,
  ]
)]
```

### Multimodel embeddings

```shell
wget -O cat.png https://storage.googleapis.com/generativeai-downloads/cookbook/image_out/cat.png -q
```

![用于多模态 embedding 示例的一张猫图片](https://files.seeusercontent.com/2026/03/14/7kTi/20260314163127.png)

这只猫大概长这样，通过下面代码embedding后：

```py
MULTIMODAL_EMBEDDING_MODEL_ID = "gemini-embedding-2-preview"

with open('cat.png', 'rb') as f:
    image_bytes = f.read()

result = client.models.embed_content(
    model=MULTIMODAL_EMBEDDING_MODEL_ID,
    contents=[
        types.Part.from_bytes(
            data=image_bytes,
            mime_type='image/png',
        ),
    ]
)

print(result.embeddings)
```

长这样：

```shell
[ContentEmbedding(
  values=[
    -0.03043109,
    0.0007975412,
    -0.008700044,
    -0.018453216,
    0.00257871,
    <... 3067 more items ...>,
  ]
)]
```

### Other

剩下的基本讲了一下thought level的概念以及thought signatures的概念，基本上就是让模型思考多长，以及将思考加入上下文避免重复思考。

这里有一个有意思的点，Google（Maybe其他人）最近发了一篇文章，基本是说超长的思考并不能使问题得到有效的解决，应该关注有效的思考，具体方法是关注神经网络激活模式与推理进程之间的关系。

## Q&As

Q：在Function Call与大模型之间的中间层其实较难理解，理性的想，大模型的输出应该是不确定的，怎样判断大模型需要调用tools，或者说，大模型是怎样调度程序的？

A: **计算机的大多数问题都可以通过加一个中间层解决。**这里也是一样的，只是在大模型和Skill之间加了一层编排器（orchestrator / runtime / agent loop）。

**大模型本身并不真的“执行工具”**，大模型本质上只会做一件事：

**根据上下文，生成最可能的下一段输出。**

当你给它加上 function calling 能力后，它依然没有突然变成操作系统或解释器。它只是学会了输出一种**特殊格式**，例如：

- 普通自然语言回答
- 或者一个结构化的“我要调用某个工具”的请求

例如前面对于json格式数据的输出。

当模型输出了一个工具调用请求后，外面的宿主程序会做这些事：

1. 检查这是不是一个合法的 tool call
2. 检查参数是否符合 schema
3. 真正执行对应函数 / API / MCP tool
4. 把执行结果再喂回模型
5. 让模型继续决定下一步

也就是说，实际过程更像：

**模型提议 → 中间层校验 → 外部程序执行 → 结果回填 → 模型继续推理**

---

这里由引入了一个问题：模型怎么“知道”什么时候该调用工具？

在 function calling 场景下，它会受到非常强的约束，主要来自四种东西：

1. 系统提示词 / 开发者提示词
2. 工具描述（tool schema）
3. 输出格式约束
4. 多轮闭环

但实际上这里有对大模型做限制吗，或者说我们有实际给出硬性条件，让它在回答与调用Skill之间二选一吗？

并不行。

实际上这里没有给定大模型任何限制，无论是人还是程序与大模型交互的方式都只有一种，至少目前只有一种——增加上下文。

我们所做的所有操作都只是不断填补大模型的上下文，期望大模型做出正确的选择

为了一个合法的Function call所做的事情包括

1. 及其明确的RULEs，涉及某类诉求，例如查询气温，必须调用天气API
2. 用 schema 验证参数，并且往大模型的上下文填充要求，或干脆拒绝执行
3. 强制 tool choice。与第三个类似，但此时大模型所作的回应进一步被Schema / Policy拒绝
4. 直接降低temperature& top-p

---

Q： 抛开剂量谈毒性是无稽之谈，这样的架构似乎可能会导致大模型永远被Schema/Policy堵死。毕竟这些中间层并没有大模型的智慧。大模型对于Structure Ouput有多少指令遵循？当大模型对输出残生幻觉时应该怎么规范？

A: **格式遵从** ≠ **schema 遵从** ≠ **语义正确**

例如模型输出了合法 JSON，但缺字段；或者字段齐全但值语义上错了；又或者工具参数结构对了，但调用了不该调用的工具。这几类失败在工程上对应完全不同的解决方案。

OpenAI 现在把 `json_object` 明确归为“较旧的 JSON 输出方式”，推荐优先用 `json_schema`；其 Structured Outputs 目标是让结果遵从给定 JSON Schema。Anthropic 也把“普通一致性技巧”和“保证 schema 的 structured outputs / strict tool use”明确区分开来。

对于这个问题，我们通常观察**四个指标**：

**语法合法率**
 输出能否被解析为目标格式。
 例如 JSON 能否 `json.loads()` 成功。

**Schema 遵从率**
 解析成功后，是否通过 JSON Schema 校验。
 这是最核心的“Structured Output 遵从概率”。

**一次成功率 First-pass success**
 不做 repair / retry 时，首次就合法且通过 schema 的比例。
 这个指标最贴近真实生产系统成本。

**任务正确率 Task correctness**
 即使结构正确，字段内容是否语义正确。
 JSONSchemaBench 也把评估拆成效率、coverage、quality 三类，并专门强调“结构合规”和“下游任务质量”要分开看。

如果想要测试现在AI的这四个指标，可以让AI vibe coding一个实验，也可以直接通过Gemini API运行下面的实验：

[Deepcity/gemini_structured_output_benchmark: Structured Output envoluation with Gemini](https://github.com/Deepcity/gemini_structured_output_benchmark)

对于Gemini-2.5-flash这个Schema、First-Pass、Final成功率结果大概是

![Gemini 2.5 Flash 在结构化输出评测中的合规率图表](https://files.seeusercontent.com/2026/03/15/gYi6/20260315144507.png)

对于Gemini-3.1-pro-preview这个结果是

![Gemini 3.1 Pro Preview 在结构化输出评测中的合规率图表](https://files.seeusercontent.com/2026/03/15/Cq8l/20260315151958.png)

有些难以理解为什么通过后面几种方式的成功率反而比2.5要更低，可能是由于缓存、上下文导致的？这里就不仔细看原因了，我查看了一下这次运行的结果，有部分error_type为none，不知道输出中如何被Policy判断为错了，有些则确实存在很明显的错误。

## REFs

1. [google-gemini/cookbook: 使用 Gemini API 的示例和指南 --- google-gemini/cookbook: Examples and guides for using the Gemini API](https://github.com/google-gemini/cookbook/tree/main)
2. [Gemini models 文档](https://ai.google.dev/gemini-api/docs/models/gemini)
3. [Google AI Studio](https://aistudio.google.com/)
4. [提示设计策略  | Gemini API  | Google AI for Developers](https://ai.google.dev/gemini-api/docs/prompting-strategies?hl=zh-cn#model-parameters)
5. [Foundation model - Wikipedia](https://en.wikipedia.org/wiki/Foundation_model)
6. [Model Context Protocol - Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol)
7. [microsoft/mcp-for-beginners: This open-source curriculum introduces the fundamentals of Model Context Protocol (MCP) through real-world, cross-language examples in .NET, Java, TypeScript, JavaScript, Rust and Python. Designed for developers, it focuses on practical techniques for building modular, scalable, and secure AI workflows from session setup to service orchestration.](https://github.com/microsoft/mcp-for-beginners?tab=readme-ov-file)

