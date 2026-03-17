// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { analyzePost } from "../src/agent/core/analyzer.js";
import { runChecks } from "../src/agent/core/checks.js";
import { generateFrontmatter } from "../src/agent/core/frontmatter-generator.js";
import { parseMarkdownDocument, stringifyMarkdownDocument } from "../src/agent/parsers/frontmatter.js";
import { analyzeMarkdownBody } from "../src/agent/parsers/markdown.js";
import { applyHomePanelGuide, buildHomePanelData } from "../src/agent/core/home-panel.js";
import { inferCodeFenceLanguage } from "../src/agent/parsers/markdown.js";
import { inferAgentModelMeta } from "../src/agent/model-meta.js";
import {
  getHomeSidecarPath,
  getRoutePathFromFile,
  getSidecarPathForPost,
} from "../src/agent/shared/pathing.js";
import { loadContentSchemaRules } from "../src/agent/parsers/schema.js";

function createSnapshot(postId, source) {
  const document = parseMarkdownDocument(source);
  const analysis = analyzeMarkdownBody(document.body);

  return {
    post_id: postId,
    title:
      typeof document.data.title === "string" && document.data.title.trim()
        ? document.data.title.trim()
        : postId,
    description:
      typeof document.data.description === "string"
        ? document.data.description.trim()
        : "",
    tags: Array.isArray(document.data.tags) ? document.data.tags.map(String) : [],
    file_path: `src/data/blog/${postId}.md`,
    route_path: `/posts/${postId.toLowerCase()}`,
    sidecar_path: `src/data/agent/posts/${postId}.json`,
    source_hash: "test",
    pubDatetime:
      typeof document.data.pubDatetime === "string"
        ? document.data.pubDatetime
        : null,
    document,
    analysis,
    raw: source,
    excerpt: analysis.firstParagraphs.join(" ").slice(0, 160),
  };
}

const TEST_GLOBAL_RULES = {
  tag_registry: {
    Agent: {
      aliases: ["智能体"],
      keywords: ["agent", "orchestrator", "智能体"],
    },
    MCP: {
      aliases: ["Model Context Protocol"],
      keywords: ["mcp", "model context protocol"],
    },
    Embedding: {
      aliases: ["embeddings"],
      keywords: ["embedding", "vector"],
    },
  },
};

test("frontmatter parse and stringify preserve basic fields", () => {
  const source = `---\ntitle: "Example"\npubDatetime: 2026-03-01T00:00:00Z\ntags:\n  - "LLM"\n  - "Agent"\n---\n\n## Intro\n`;
  const document = parseMarkdownDocument(source);

  assert.equal(document.data.title, "Example");
  assert.deepEqual(document.data.tags, ["LLM", "Agent"]);

  const nextSource = stringifyMarkdownDocument(document);
  assert.match(nextSource, /title: "Example"/u);
  assert.match(nextSource, /tags:\n  - "LLM"\n  - "Agent"/u);
});

test("schema loader reads real blog schema required fields", async () => {
  const schemaRules = await loadContentSchemaRules();

  assert.ok(schemaRules.required_fields.includes("title"));
  assert.ok(schemaRules.required_fields.includes("pubDatetime"));
  assert.ok(schemaRules.required_fields.includes("description"));
  assert.ok(!schemaRules.required_fields.includes("tags"));
});

test("sidecar path mirrors blog directory layout", () => {
  const filePath = path.join(
    process.cwd(),
    "src",
    "data",
    "blog",
    "nested",
    "example.md"
  );
  const sidecarPath = getSidecarPathForPost(filePath);

  assert.match(sidecarPath, /src\/data\/agent\/posts\/nested\/example\.json$/u);
});

test("home sidecar path uses the site directory", () => {
  const sidecarPath = getHomeSidecarPath();

  assert.match(sidecarPath, /src\/data\/agent\/site\/index\.json$/u);
});

test("agent route path canonicalizes post ids to lower kebab-case", () => {
  const filePath = path.join(
    process.cwd(),
    "src",
    "data",
    "blog",
    "API-Agent-Embedding-MCP-Skills.md"
  );

  assert.equal(
    getRoutePathFromFile(filePath),
    "/posts/api-agent-embedding-mcp-skills"
  );
});

test("frontmatter generator builds full frontmatter for markdown without frontmatter", async () => {
  const schemaRules = await loadContentSchemaRules();
  const snapshot = createSnapshot(
    "Agent-Runtime-Notes",
    `# Agent Runtime Notes

本文梳理一个工具型 Agent 的运行链路，包括规划、工具调用和失败回退。

## Execution Model

MCP lets the runtime connect tools, while the orchestrator decides how to plan and recover.
`
  );
  const result = generateFrontmatter(snapshot, schemaRules, TEST_GLOBAL_RULES, {
    hintText: "偏向系统工程视角\ntags: Agent, MCP",
  });

  assert.equal(result.document.hasFrontmatter, true);
  assert.equal(result.document.data.title, "Agent Runtime Notes");
  assert.equal(result.document.data.author, "Deepcity");
  assert.equal(result.document.data.draft, false);
  assert.equal(result.document.data.slug, "agent-runtime-notes");
  assert.equal(result.document.data.timezone, "Asia/Shanghai");
  assert.deepEqual(result.document.data.tags, ["Agent", "MCP"]);
  assert.match(result.document.data.description, /系统工程视角/u);
  assert.match(result.document.data.pubDatetime, /^\d{4}-\d{2}-\d{2}T/u);
  assert.match(
    result.source,
    /^---\ntitle: "Agent Runtime Notes"\npubDatetime: /u
  );
});

test("frontmatter generator fills partial frontmatter without overwriting explicit fields", async () => {
  const schemaRules = await loadContentSchemaRules();
  const snapshot = createSnapshot(
    "custom-agent-post",
    `---
title: "Custom Runtime Title"
tags:
  - "others"
---

## Intro

This post explains how an agent scheduler coordinates tools and MCP servers.
`
  );
  const result = generateFrontmatter(snapshot, schemaRules, TEST_GLOBAL_RULES, {
    hintText: "tags: Agent, MCP",
  });

  assert.equal(result.document.data.title, "Custom Runtime Title");
  assert.ok(!result.appliedFields.includes("title"));
  assert.ok(result.appliedFields.includes("description"));
  assert.ok(result.appliedFields.includes("pubDatetime"));
  assert.ok(result.appliedFields.includes("draft"));
  assert.ok(result.appliedFields.includes("tags"));
  assert.deepEqual(result.document.data.tags, ["Agent", "MCP"]);
});

test("frontmatter generator uses hints to steer description and tags", async () => {
  const schemaRules = await loadContentSchemaRules();
  const snapshot = createSnapshot(
    "agent-mcp-overview",
    `## Intro

Agent runtimes often combine planning, retrieval and tool execution.
`
  );
  const result = generateFrontmatter(snapshot, schemaRules, TEST_GLOBAL_RULES, {
    hintText: "偏向系统工程视角\n标签包含 Agent 和 MCP",
  });

  assert.match(result.document.data.description, /系统工程视角/u);
  assert.ok(result.document.data.tags.includes("Agent"));
  assert.ok(result.document.data.tags.includes("MCP"));
});

test("generated frontmatter satisfies required field checks", async () => {
  const schemaRules = await loadContentSchemaRules();
  const initialSnapshot = createSnapshot(
    "agent-check-pass",
    `# Agent Check Pass

This post documents an agent runtime and its MCP integration.
`
  );
  const generationResult = generateFrontmatter(
    initialSnapshot,
    schemaRules,
    TEST_GLOBAL_RULES,
    {
      hintText: "tags: Agent, MCP",
    }
  );
  const generatedSnapshot = {
    ...initialSnapshot,
    title: generationResult.document.data.title,
    description: generationResult.document.data.description,
    tags: generationResult.document.data.tags,
    pubDatetime: generationResult.document.data.pubDatetime,
    document: generationResult.document,
    raw: generationResult.source,
  };
  const checkResult = runChecks(
    generatedSnapshot,
    schemaRules,
    TEST_GLOBAL_RULES,
    {
      filePath: path.join(
        process.cwd(),
        "src",
        "data",
        "blog",
        "agent-check-pass.md"
      ),
    }
  );

  assert.equal(
    checkResult.issues.some(issue =>
      ["missing-frontmatter", "missing-required-title", "missing-required-pubDatetime", "missing-required-description"].includes(issue.code)
    ),
    false
  );
});

test("analyzer writes generated frontmatter when markdown had none", async () => {
  const timestamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const filePath = path.join(
    process.cwd(),
    "src",
    "data",
    "blog",
    `agent-frontmatter-${timestamp}.md`
  );
  const sidecarPath = getSidecarPathForPost(filePath);

  await fs.writeFile(
    filePath,
    `# Agent Runtime Notes

This post explains how an Agent coordinates MCP tools and embeddings in a single runtime.
`,
    "utf8"
  );

  try {
    const result = await analyzePost(filePath, {
      provider: "heuristic",
      generateFrontmatter: true,
      frontmatterHintText: "偏向系统工程视角\ntags: Agent, MCP",
      updateMemory: false,
    });
    const nextSource = await fs.readFile(filePath, "utf8");
    const document = parseMarkdownDocument(nextSource);

    assert.equal(document.hasFrontmatter, true);
    assert.equal(document.data.title, "Agent Runtime Notes");
    assert.ok(Array.isArray(document.data.tags));
    assert.ok(document.data.tags.includes("Agent"));
    assert.ok(document.data.tags.includes("MCP"));
    assert.ok(
      result.fixes_applied.some(message =>
        message.includes("生成完整 frontmatter")
      )
    );
  } finally {
    await fs.rm(filePath, { force: true });
    await fs.rm(sidecarPath, { force: true });
  }
});

test("code fence language inference catches common shell blocks", () => {
  const inferred = inferCodeFenceLanguage(["git status", "pnpm run build"]);

  assert.equal(inferred.language, "sh");
});

test("agent model meta recognizes major LLM families", () => {
  assert.equal(
    inferAgentModelMeta("openai", "gpt5.4").brand,
    "chatgpt"
  );
  assert.equal(
    inferAgentModelMeta("xai", "grok-4").brand,
    "grok"
  );
  assert.equal(
    inferAgentModelMeta("gemini", "gemini-3.1-pro").brand,
    "gemini"
  );
  assert.equal(
    inferAgentModelMeta("anthropic", "claude-opus4.6").brand,
    "claude"
  );
  assert.equal(
    inferAgentModelMeta("dashscope", "qwen-max").brand,
    "qwen"
  );
});

test("agent model meta marks heuristic reviews as non-llm", () => {
  const meta = inferAgentModelMeta("heuristic", "heuristic-v1");

  assert.equal(meta.brand, "heuristic");
  assert.equal(meta.isLlm, false);
});

test("home panel builder summarizes site themes and entry points", () => {
  const sidecar = buildHomePanelData([
    {
      post_id: "CMU-15213-ShellLab",
      title: "CMU 15-213 ShellLab",
      description: "记录 ShellLab 的实现与调试过程。",
      excerpt: "ShellLab 实验记录。",
      file_path: "src/data/blog/CMU-15213-ShellLab.md",
      route_path: "/posts/cmu-15213-shelllab",
      pubDatetime: "2026-03-12T00:00:00Z",
      tags: ["CMU15213"],
      document: { data: { featured: true } },
    },
    {
      post_id: "API-Agent-Embedding-MCP-Skills",
      title: "API Agent: Embedding, MCP, Skills",
      description: "梳理 Agent、MCP 与 Embedding 的关系。",
      excerpt: "Agent 工程综述。",
      file_path: "src/data/blog/API-Agent-Embedding-MCP-Skills.md",
      route_path: "/posts/api-agent-embedding-mcp-skills",
      pubDatetime: "2026-03-10T00:00:00Z",
      tags: ["Agent", "MCP", "LLM"],
      document: { data: { featured: false } },
    },
    {
      post_id: "AscendC-part1-basic-concept",
      title: "AscendC part1 basic concept",
      description: "Ascend C 算子开发入门。",
      excerpt: "Ascend C 基础概念。",
      file_path: "src/data/blog/AscendC-part1-basic-concept.md",
      route_path: "/posts/ascendc-part1-basic-concept",
      pubDatetime: "2026-03-08T00:00:00Z",
      tags: ["AscendC"],
      document: { data: { featured: false } },
    },
  ]);

  assert.equal(sidecar.page_id, "index");
  assert.equal(sidecar.content_stats.total_posts, 3);
  assert.ok(
    sidecar.focus_topics.some(topic => topic.includes("Agent / MCP / Embedding"))
  );
  assert.ok(
    sidecar.highlights.some(item => item.includes("sidecar JSON"))
  );
  assert.equal(sidecar.recommended_paths[0].href, "/posts/cmu-15213-shelllab");
});

test("home panel guide merge accepts Gemini output and sanitizes routes", () => {
  const baseSidecar = buildHomePanelData([
    {
      post_id: "API-Agent-Embedding-MCP-Skills",
      title: "API Agent: Embedding, MCP, Skills",
      description: "梳理 Agent、MCP 与 Embedding 的关系。",
      excerpt: "Agent 工程综述。",
      file_path: "src/data/blog/API-Agent-Embedding-MCP-Skills.md",
      route_path: "/posts/api-agent-embedding-mcp-skills",
      pubDatetime: "2026-03-10T00:00:00Z",
      tags: ["Agent", "MCP", "LLM"],
      document: { data: { featured: false } },
    },
  ]);

  const merged = applyHomePanelGuide(
    baseSidecar,
    {
      summary: "Gemini 首页摘要。",
      focus_topics: ["Agent / MCP / Embedding 工程", "额外主题"],
      highlights: ["Gemini 生成了一条亮点。"],
      recommended_paths: [
        {
          label: "Agent 主题入口",
          href: "/posts/api-agent-embedding-mcp-skills",
          description: "从 Agent 工程主题切入。",
        },
        {
          label: "非法路径",
          href: "/not-allowed",
          description: "不会被保留。",
        },
      ],
      confidence: 0.91,
    },
    {
      provider: "gemini",
      model: "gemini-3.1-pro",
      notes: ["Gemini homepage guide test"],
    }
  );

  assert.equal(merged.provider, "gemini");
  assert.equal(merged.model, "gemini-3.1-pro");
  assert.equal(merged.summary, "Gemini 首页摘要。");
  assert.deepEqual(merged.recommended_paths, [
    {
      label: "Agent 主题入口",
      href: "/posts/api-agent-embedding-mcp-skills",
      description: "从 Agent 工程主题切入。",
    },
  ]);
});
