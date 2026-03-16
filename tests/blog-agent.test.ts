// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseMarkdownDocument, stringifyMarkdownDocument } from "../src/agent/frontmatter.js";
import { applyHomePanelGuide, buildHomePanelData } from "../src/agent/home-panel.js";
import { inferCodeFenceLanguage } from "../src/agent/markdown.js";
import { inferAgentModelMeta } from "../src/agent/model-meta.js";
import {
  getHomeSidecarPath,
  getRoutePathFromFile,
  getSidecarPathForPost,
} from "../src/agent/pathing.js";
import { loadContentSchemaRules } from "../src/agent/schema.js";

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
