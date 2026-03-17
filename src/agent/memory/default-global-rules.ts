// @ts-nocheck
import { DEFAULT_MODEL } from "../shared/constants.js";

export const DEFAULT_GLOBAL_RULES = {
  version: 1,
  updated_at: "2026-03-16T00:00:00.000Z",
  prompt_version: "review-v1",
  provider_defaults: {
    preferred: "gemini",
    fallback: "heuristic",
    model: DEFAULT_MODEL,
  },
  site_path_policy: {
    filename_style: "lower-kebab-case",
    route_style: "lower-kebab-case",
    examples: {
      file_name: "api-agent-embedding-mcp-skills.md",
      route_path: "/posts/api-agent-embedding-mcp-skills",
    },
    rule:
      "所有文章文件名、slug 与站内文章链接统一使用小写字母和连字符的 kebab-case 形式。",
  },
  review_rubric: {
    structure: [
      "正文默认从 H2 开始，不应在正文中重复 H1",
      "标题层级应递进，不应从 H2 直接跳到 H4",
      "长文优先检查是否有清晰分段、代码示例与图示",
    ],
    technical: [
      "技术点评优先关注论证链条、概念解释、实现细节与实验依据",
      "当文章属于课程实验或论文阅读时，优先指出缺失的关键机制与复现实证",
      "对标签、slug、description 等软规则只给建议，不默认改写",
      "所有文章文件名、slug 与站内 route path 应统一为小写 kebab-case",
    ],
    severity_policy: {
      info: "体验性建议，不影响构建",
      warn: "结构或表达有明显改进空间",
      error: "硬校验失败或存在高置信格式错误",
    },
  },
  tag_registry: {
    论文阅读: {
      category: "paper",
      aliases: ["paper reading", "paper notes", "论文笔记"],
      keywords: ["论文", "paper", "osdi", "sosp", "nsdi"],
    },
    OSDI: {
      category: "paper",
      aliases: ["osdi", "USENIX OSDI"],
      keywords: ["osdi"],
    },
    SOSP: {
      category: "paper",
      aliases: ["sosp"],
      keywords: ["sosp"],
    },
    分布式系统: {
      category: "paper",
      aliases: ["distributed system", "distributed systems", "分布式"],
      keywords: ["distributed", "scheduler", "cluster", "分布式"],
    },
    异构内存: {
      category: "paper",
      aliases: ["heterogeneous memory", "tiered memory", "分层内存"],
      keywords: ["tiered memory", "heterogeneous memory", "cxl", "nvm"],
    },
    内存延迟: {
      category: "paper",
      aliases: ["memory latency", "访存延迟"],
      keywords: ["latency", "memory latency", "访存"],
    },
    大模型推理: {
      category: "paper",
      aliases: ["LLM inference", "模型推理", "inference"],
      keywords: ["inference", "serving", "serverlessllm", "推理"],
    },
    大模型应用: {
      category: "paper",
      aliases: ["LLM application", "大模型部署"],
      keywords: ["application", "deployment", "agentic"],
    },
    CMU15213: {
      category: "course",
      aliases: ["15213", "CMU-lab", "csapp", "CSAPP"],
      keywords: ["15-213", "15213", "csapp", "cmu"],
    },
    c: {
      category: "course",
      aliases: ["C语言", "C language", "clang"],
      keywords: ["#include", "printf", "malloc", "shell lab"],
    },
    "c++": {
      category: "development",
      aliases: ["cpp", "C++语言"],
      keywords: ["std::", "template", "vector<", "c++"],
    },
    汇编: {
      category: "course",
      aliases: ["assembly", "asm", "汇编语言"],
      keywords: ["assembly", "movq", "jmp", "寄存器", "汇编"],
    },
    反编译: {
      category: "course",
      aliases: ["disassemble", "reverse", "逆向分析"],
      keywords: ["objdump", "gdb", "反汇编", "逆向"],
    },
    "x86-64": {
      category: "course",
      aliases: ["x86", "x64", "amd64"],
      keywords: ["x86", "amd64", "x86-64"],
    },
    指令集: {
      category: "course",
      aliases: ["ISA", "instruction set"],
      keywords: ["isa", "指令集"],
    },
    流水线处理器: {
      category: "course",
      aliases: ["pipeline", "CPU pipeline"],
      keywords: ["pipeline", "processor", "处理器"],
    },
    "Exploit String Attack": {
      category: "course",
      aliases: ["buffer overflow attack"],
      keywords: ["exploit", "buffer overflow", "payload"],
    },
    算法: {
      category: "algorithm",
      aliases: ["algorithm", "算法题"],
      keywords: ["algorithm", "复杂度", "算法"],
    },
    数论: {
      category: "algorithm",
      aliases: ["number theory"],
      keywords: ["gcd", "prime", "euler", "数论", "素数"],
    },
    数学: {
      category: "algorithm",
      aliases: ["math", "数学基础"],
      keywords: ["数学", "theorem"],
    },
    机器学习: {
      category: "algorithm",
      aliases: ["ML", "machine learning"],
      keywords: ["loss", "训练", "机器学习"],
    },
    人工智能: {
      category: "algorithm",
      aliases: ["AI", "artificial intelligence"],
      keywords: ["ai", "artificial intelligence", "人工智能"],
    },
    群体人工智能: {
      category: "algorithm",
      aliases: ["swarm intelligence", "群体智能", "SI"],
      keywords: ["swarm", "群体智能", "粒子群", "蚁群"],
    },
    PSO: {
      category: "algorithm",
      aliases: ["particle swarm optimization"],
      keywords: ["pso", "particle swarm"],
    },
    进化算法: {
      category: "algorithm",
      aliases: ["evolutionary algorithm", "EA", "进化计算"],
      keywords: ["evolutionary algorithm", "ea", "进化"],
    },
    遗传算法: {
      category: "algorithm",
      aliases: ["genetic algorithm", "GA"],
      keywords: ["genetic algorithm", "ga", "遗传算法"],
    },
    Ascend: {
      category: "development",
      aliases: ["昇腾", "Ascend NPU", "华为昇腾"],
      keywords: ["ascend", "cann", "昇腾", "acl"],
    },
    LLM: {
      category: "development",
      aliases: ["大模型", "大语言模型", "large language model"],
      keywords: ["llm", "gemini", "gpt", "大模型", "transformer"],
    },
    Agent: {
      category: "development",
      aliases: ["API Agent", "智能体", "agentic system"],
      keywords: ["agent", "tool use", "orchestrator", "智能体"],
    },
    MCP: {
      category: "development",
      aliases: ["Model Context Protocol", "model context protocol"],
      keywords: ["mcp", "model context protocol"],
    },
    Embedding: {
      category: "development",
      aliases: ["embeddings", "向量化", "向量表示"],
      keywords: ["embedding", "vector", "向量"],
    },
    算子: {
      category: "development",
      aliases: ["operator", "op", "kernel"],
      keywords: ["operator", "kernel", "算子"],
    },
    算子开发: {
      category: "development",
      aliases: ["operator development", "kernel development"],
      keywords: ["算子开发", "operator development"],
    },
    软件: {
      category: "software",
      aliases: ["software", "tool"],
      keywords: ["软件", "tool", "usage"],
    },
    云服务: {
      category: "software",
      aliases: ["cloud", "cloud service", "云存储"],
      keywords: ["onedrive", "cloud", "云服务"],
    },
    Microsoft: {
      category: "software",
      aliases: ["微软", "MS"],
      keywords: ["microsoft", "onedrive", "office"],
    },
    365: {
      category: "software",
      aliases: ["Office 365", "M365"],
      keywords: ["365", "m365", "office 365"],
    },
  },
  series_naming_rules: [
    {
      id: "cmu-15213",
      label: "CMU 15-213 Labs",
      id_pattern: "^CMU-15213-",
      expected_total: 8,
      open_ended: false,
      known_post_ids: [
        "CMU-15213-DataLab",
        "CMU-15213-BombLab",
        "CMU-15213-AttackLab",
        "CMU-15213-ArchitectureLab",
        "CMU-15213-CacheLab",
        "CMU-15213-ShellLab",
        "CMU-15213-MallocLab",
        "CMU-15213-ProxyLab",
      ],
    },
    {
      id: "ascendc",
      label: "Ascend C 算子开发",
      id_pattern: "^AscendC-part\\d+-",
      expected_total: 5,
      open_ended: false,
      known_post_ids: [
        "AscendC-part1-basic-concept",
        "AscendC-part2-tiling-and-debug",
        "AscendC-part3-operator-delivery",
        "AscendC-part4-operator-invocation",
        "AscendC-part5-pytorch-summary",
      ],
    },
    {
      id: "pgstudy",
      label: "PGStudy",
      id_pattern: "^PGStudy-",
      expected_total: null,
      open_ended: true,
      known_post_ids: [],
    },
    {
      id: "paper-reading",
      label: "论文阅读",
      id_pattern: "^(OSDI|SOSP)\\d+-",
      expected_total: null,
      open_ended: true,
      known_post_ids: [],
    },
  ],
};
