// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  analyzePost,
  buildReviewKey,
  refreshSidecarKnowledge,
  resolveSkipReason,
} from "../src/agent/core/analyzer.js";
import { runChecks } from "../src/agent/core/checks.js";
import { generateFrontmatter } from "../src/agent/core/frontmatter-generator.js";
import { runSyncWorkflow } from "../src/agent/core/sync.js";
import { parseMarkdownDocument, stringifyMarkdownDocument } from "../src/agent/parsers/frontmatter.js";
import { analyzeMarkdownBody } from "../src/agent/parsers/markdown.js";
import { applyHomePanelGuide, buildHomePanelData } from "../src/agent/core/home-panel.js";
import { buildKnowledgeMap } from "../src/agent/core/knowledge.js";
import {
  buildMathRenderIssuesFromMetrics,
  canReuseVisualReview,
  collectStaticHtmlRoutes,
  filterStaticHtmlRoutes,
  applyLatexVisualSafeFixesToMarkdown,
  mergeVisualFindings,
  resolvePlaywrightProxyConfig,
  routeToVisualArtifactName,
  sanitizeVisualReview,
} from "../src/agent/core/visual-check.js";
import { inferCodeFenceLanguage } from "../src/agent/parsers/markdown.js";
import { inferAgentModelMeta } from "../src/agent/model-meta.js";
import {
  buildBodyForPrompt,
  extractJsonPayload,
  sanitizeReview,
  withRetry,
} from "../src/agent/providers/gemini.js";
import {
  getHomeSidecarPath,
  getRoutePathFromFile,
  getSidecarPathForPost,
} from "../src/agent/shared/pathing.js";
import { loadContentSchemaRules } from "../src/agent/parsers/schema.js";
import {
  getAssistableFields,
  hasAssistableField,
  sanitizeFrontmatterAssist,
} from "../src/agent/core/frontmatter-assist.js";
import { writeJsonIfChanged } from "../src/agent/shared/fs.js";

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

test("sync workflow auto-generates frontmatter and sidecar for a new post", async () => {
  const timestamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const filePath = path.join(
    process.cwd(),
    "src",
    "data",
    "blog",
    `agent-sync-${timestamp}.md`
  );
  const sidecarPath = getSidecarPathForPost(filePath);

  await fs.writeFile(
    filePath,
    `# Unified Agent Workflow

This draft explains how a blog agent can prepare frontmatter, review output and sidecar data in one pass.
`,
    "utf8"
  );

  try {
    const result = await runSyncWorkflow([filePath], {
      provider: "heuristic",
      frontmatterHintText: "偏向系统工程视角\ntags: Agent, MCP",
      buildHomePanel: false,
      refreshKnowledge: false,
      updateMemory: false,
    });
    const nextSource = await fs.readFile(filePath, "utf8");
    const document = parseMarkdownDocument(nextSource);
    const sidecar = JSON.parse(await fs.readFile(sidecarPath, "utf8"));

    assert.equal(result.postResults.length, 1);
    assert.equal(result.homePanelResult, null);
    assert.equal(document.hasFrontmatter, true);
    assert.equal(document.data.title, "Unified Agent Workflow");
    assert.ok(Array.isArray(document.data.tags));
    assert.ok(document.data.tags.includes("Agent"));
    assert.ok(document.data.tags.includes("MCP"));
    assert.equal(sidecar.post_id, `agent-sync-${timestamp}`);
    assert.match(sidecar.summary, /blog agent/u);
  } finally {
    await fs.rm(filePath, { force: true });
    await fs.rm(sidecarPath, { force: true });
  }
});

test("knowledge map applies series and post overrides", async () => {
  const map = await buildKnowledgeMap({
    postPaths: [
      path.join(process.cwd(), "src", "data", "blog", "AscendC-part4-operator-invocation.md"),
      path.join(process.cwd(), "src", "data", "blog", "AscendC-part5-pytorch-summary.md"),
    ],
    overrides: {
      version: 1,
      series: {
        ascendc: {
          id: "ascendc",
          label: "Ascend C 算子开发",
          order: [
            "AscendC-part4-operator-invocation",
            "AscendC-part5-pytorch-summary",
          ],
        },
      },
      posts: {
        "AscendC-part5-pytorch-summary": {
          role: "阶段总结",
          previous: ["AscendC-part4-operator-invocation"],
          next: [],
          topic_neighbors: [],
          reader_context: "这篇更适合作为系列收束篇。",
          position_summary: "这篇更适合作为系列收束篇。",
        },
      },
    },
  });
  const post = map.posts.find(
    item => item.post_id === "AscendC-part5-pytorch-summary"
  );

  assert.equal(map.issues.length, 0);
  assert.equal(post.role, "阶段总结");
  assert.deepEqual(post.previous_posts, ["AscendC-part4-operator-invocation"]);
  assert.equal(post.position_summary, "这篇更适合作为系列收束篇。");
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

test("gemini json extraction ignores trailing commentary", () => {
  const payload = extractJsonPayload(
    '```json\n{"summary":"ok","public_commentary":"brace { inside string }"}\n```\n额外说明：{not json}'
  );

  assert.equal(payload.summary, "ok");
  assert.equal(payload.public_commentary, "brace { inside string }");
});

test("visual check route discovery maps built html files to site routes", async () => {
  const root = path.join(
    process.cwd(),
    ".tmp",
    `visual-routes-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );

  await fs.mkdir(path.join(root, "about"), { recursive: true });
  await fs.mkdir(path.join(root, "posts", "agent-notes"), {
    recursive: true,
  });
  await fs.writeFile(path.join(root, "index.html"), "<html></html>", "utf8");
  await fs.writeFile(path.join(root, "404.html"), "<html></html>", "utf8");
  await fs.writeFile(
    path.join(root, "about", "index.html"),
    "<html></html>",
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "posts", "agent-notes", "index.html"),
    "<html></html>",
    "utf8"
  );

  try {
    const routes = await collectStaticHtmlRoutes(root);

    assert.deepEqual(
      routes.map(route => route.route_path),
      ["/", "/404", "/about", "/posts/agent-notes"]
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("visual check artifact names are stable ascii path keys", () => {
  assert.equal(routeToVisualArtifactName("/"), "index");
  assert.equal(routeToVisualArtifactName("/tags/c++"), "tags__c~2B~2B");
  assert.match(routeToVisualArtifactName("/tags/机器学习"), /^[\x00-\x7F]+$/u);
});

test("visual check route filter selects explicit routes", () => {
  const routes = [
    { route_path: "/", html_path: "dist/index.html" },
    { route_path: "/about", html_path: "dist/about/index.html" },
    {
      route_path: "/posts/image-heavy",
      html_path: "dist/posts/image-heavy/index.html",
    },
  ];

  assert.deepEqual(
    filterStaticHtmlRoutes(routes, "posts/image-heavy").map(
      route => route.route_path
    ),
    ["/posts/image-heavy"]
  );
  assert.deepEqual(
    filterStaticHtmlRoutes(routes, "/about,/").map(route => route.route_path),
    ["/", "/about"]
  );
  assert.throws(() => filterStaticHtmlRoutes(routes, "/missing"), /No static/);
});

test("visual check browser proxy keeps local static server bypassed", () => {
  const proxy = resolvePlaywrightProxyConfig({
    HTTPS_PROXY: "http://127.0.0.1:17899",
    NO_PROXY: "example.com",
  });

  assert.equal(proxy.server, "http://127.0.0.1:17899");
  assert.match(proxy.bypass, /example\.com/u);
  assert.match(proxy.bypass, /127\.0\.0\.1/u);
  assert.match(proxy.bypass, /localhost/u);
});

test("visual check reuses review only for unchanged screenshot context", () => {
  const currentPage = {
    route_path: "/posts/example",
    capture_ok: true,
    screenshot_sha256: "abc123",
    render_input_sha256: "input123",
    viewport: { width: 1440, height: 1200 },
  };
  const previousPage = {
    route_path: "/posts/example",
    screenshot_sha256: "abc123",
    render_input_sha256: "input123",
    viewport: { width: 1440, height: 1200 },
    review: { route_path: "/posts/example", issues: [] },
  };
  const previousManifest = {
    provider: "gemini",
    model: "gemini-test",
    visual_review_prompt_version: "visual-review-v1",
  };
  const gemini = { provider: "gemini", model: "gemini-test" };

  assert.equal(
    canReuseVisualReview(currentPage, previousPage, previousManifest, gemini),
    true
  );
  assert.equal(
    canReuseVisualReview(
      { ...currentPage, screenshot_sha256: "changed" },
      previousPage,
      previousManifest,
      gemini
    ),
    true
  );
  assert.equal(
    canReuseVisualReview(
      { ...currentPage, render_input_sha256: "changed" },
      previousPage,
      previousManifest,
      gemini
    ),
    false
  );
  assert.equal(
    canReuseVisualReview(currentPage, previousPage, previousManifest, {
      provider: "gemini",
      model: "other-model",
    }),
    false
  );
  assert.equal(
    canReuseVisualReview(
      {
        ...currentPage,
        hard_checks: [{ code: "math-render-error" }],
        local_findings_sha256: "local-changed",
      },
      {
        ...previousPage,
        hard_checks: [{ code: "math-render-error" }],
        local_findings_sha256: "local-old",
      },
      previousManifest,
      gemini
    ),
    false
  );
});

test("visual check reports KaTeX and raw LaTeX render failures", () => {
  const issues = buildMathRenderIssuesFromMetrics({
    katex_errors: [
      {
        text: "\\text{bad_formula}",
        title: "ParseError: KaTeX parse error",
        selector: "span.katex-error",
      },
    ],
    raw_latex_nodes: [
      {
        text: "\\begin{eqnarray} a&=&b \\end{eqnarray}",
        selector: "p",
      },
    ],
  });

  assert.equal(issues.length, 2);
  assert.equal(issues[0].code, "math-render-error");
  assert.equal(issues[0].severity, "error");
  assert.match(issues[0].message, /KaTeX/u);
  assert.match(issues[1].message, /LaTeX/u);
});

test("visual check merges local hard-check evidence into unified findings", () => {
  const findings = mergeVisualFindings(
    [
      {
        code: "math-render-error",
        severity: "warn",
        message: "KaTeX parse error is visible in the equation.",
        region: "10,20,100,40",
        selector_hint: "span.katex-error",
        confidence: 0.74,
        source: "gemini",
      },
    ],
    [
      {
        code: "math-render-error",
        severity: "error",
        message: "KaTeX parse error: Undefined control sequence: \\bad",
        region: "12,22,96,38",
        selector_hint: "span.katex-error",
        rect: { x: 12, y: 22, width: 96, height: 38 },
        latex_source: "\\bad",
      },
    ]
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "math-render-error");
  assert.equal(findings[0].severity, "error");
  assert.match(findings[0].source, /gemini\+local-check/u);
  assert.equal(findings[0].confidence >= 0.92, true);

  const localOnly = mergeVisualFindings([], [
    {
      code: "broken-image",
      severity: "error",
      message: "Image failed to load.",
      region: "hero",
      asset_hint: "/missing.webp",
    },
  ]);

  assert.equal(localOnly.length, 1);
  assert.equal(localOnly[0].source, "local-check");
});

test("visual latex safe fixes stay inside allowlisted render repairs", () => {
  const source = [
    "$$",
    "\\text{通过 mem_sbrk 申请空间}",
    "$$",
    "$$",
    "\\begin{eqnarray}",
    "loss_猫 &=&-0\\times log(0.1)\\\\",
    "\\end{eqnarray}",
    "$$",
    "$$\\begin{align} p(cat) & = 1 \\\\ p(dog) &= 0 \\end{align} $$",
    "",
  ].join("\n");

  const result = applyLatexVisualSafeFixesToMarkdown(source);

  assert.equal(result.fixes.length, 3);
  assert.match(result.content, /mem\\_sbrk/u);
  assert.match(result.content, /\\begin\{aligned\}/u);
  assert.doesNotMatch(result.content, /\\begin\{eqnarray\}/u);
  assert.doesNotMatch(result.content, /\\begin\{align\}/u);
  assert.match(result.content, /loss_\{\\text\{猫\}\}/u);
});

test("visual review sanitizer keeps bounded display issues", () => {
  const review = sanitizeVisualReview(
    {
      route_path: "/about",
      summary: "页面整体正常。",
      severity: "info",
      confidence: 0.91,
      issues: [
        {
          code: "visual-overlap",
          severity: "warn",
          message: "页脚文字与上一段内容距离过近。",
          region: "footer",
          selector_hint: "footer",
          confidence: 0.84,
        },
      ],
      action_items: ["检查页脚上边距。"],
      suggested_adjustments: ["为 footer 增加更稳定的 block spacing。"],
    },
    { route_path: "/fallback" }
  );

  assert.equal(review.route_path, "/about");
  assert.equal(review.severity, "warn");
  assert.equal(review.issues[0].code, "visual-overlap");
  assert.deepEqual(review.action_items, ["检查页脚上边距。"]);
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
    {
      post_id: "Draft-Agent-Experiment",
      title: "Draft Agent Experiment",
      description: "不应进入首页 Agent 导览。",
      excerpt: "草稿试验文章。",
      file_path: "src/data/blog/_agent-experiment/draft-agent-experiment.md",
      route_path: "/posts/draft-agent-experiment",
      pubDatetime: "2026-07-03T00:00:00Z",
      tags: ["Agent"],
      document: { data: { draft: true } },
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

test("gemini prompt body keeps head and tail when truncating", () => {
  const head = "开头".repeat(200);
  const tail = "结尾".repeat(200);
  const body = `${head}${"中间".repeat(2000)}${tail}`;
  const result = buildBodyForPrompt(body, 1000);

  assert.equal(result.truncated, true);
  assert.ok(result.text.startsWith("开头开头"));
  assert.ok(result.text.endsWith("结尾结尾"));
  assert.match(result.text, /省略了约 \d+ 个字符/u);
  assert.ok(result.omitted_chars > 0);

  const short = buildBodyForPrompt("短正文", 1000);
  assert.equal(short.truncated, false);
  assert.equal(short.text, "短正文");
});

test("gemini review sanitizer records invalid fields instead of silently coercing", () => {
  const review = sanitizeReview(
    {
      summary: "ok",
      public_commentary: "",
      severity: "critical",
      confidence: "high",
      related_post_ids: ["allowed-post", "made-up-post"],
    },
    {
      knowledge: {
        related_posts: [{ post_id: "allowed-post" }],
      },
    }
  );

  assert.equal(review.severity, "warn");
  assert.equal(review.confidence, 0.72);
  assert.deepEqual(review.related_post_ids, ["allowed-post"]);
  assert.equal(review.public_commentary, "ok");
  assert.ok(review.notes.some(note => note.includes("invalid severity")));
  assert.ok(review.notes.some(note => note.includes("non-numeric confidence")));
  assert.ok(review.notes.some(note => note.includes("made-up-post")));
  assert.ok(review.notes.some(note => note.includes("empty public_commentary")));
});

test("gemini retry backs off on retryable errors and gives up on others", async () => {
  let calls = 0;
  const result = await withRetry(
    async () => {
      calls += 1;

      if (calls < 3) {
        const error = new Error("Gemini request failed: 503");
        error.status = 503;
        throw error;
      }

      return "ok";
    },
    { retryAttempts: 3, retryBaseDelayMs: 0 }
  );

  assert.equal(result, "ok");
  assert.equal(calls, 3);

  let fatalCalls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        fatalCalls += 1;
        const error = new Error("Gemini request failed: 400 bad request");
        error.status = 400;
        throw error;
      },
      { retryAttempts: 3, retryBaseDelayMs: 0 }
    ),
    /400/u
  );
  assert.equal(fatalCalls, 1);

  let exhaustedCalls = 0;
  await assert.rejects(
    withRetry(
      async () => {
        exhaustedCalls += 1;
        const error = new Error("Gemini request timed out");
        error.name = "AbortError";
        throw error;
      },
      { retryAttempts: 2, retryBaseDelayMs: 0 }
    ),
    /after 2 attempt/u
  );
  assert.equal(exhaustedCalls, 2);
});

test("analyzer skip logic keys on model/prompt and never pins degraded reviews", () => {
  const snapshot = { source_hash: "abc" };
  const gemini = {
    name: "gemini",
    model: "gemini-3.8-flash",
    prompt_version: "v1",
  };
  const heuristic = {
    name: "heuristic",
    model: "heuristic-v1",
    prompt_version: "heuristic-v1",
  };
  const keyFor = provider =>
    buildReviewKey({
      sourceHash: snapshot.source_hash,
      provider: provider.name,
      model: provider.model,
      promptVersion: provider.prompt_version,
    });

  // Fresh, matching sidecar → skip.
  assert.match(
    resolveSkipReason({
      existingSidecar: {
        source_hash: "abc",
        provider: "gemini",
        degraded: false,
        review_key: keyFor(gemini),
      },
      snapshot,
      provider: gemini,
      requestedProvider: "auto",
      reviewKey: keyFor(gemini),
    }),
    /review_key unchanged/u
  );

  // Same source but model bumped → regenerate.
  assert.equal(
    resolveSkipReason({
      existingSidecar: {
        source_hash: "abc",
        provider: "gemini",
        degraded: false,
        review_key: keyFor({ ...gemini, model: "gemini-old" }),
      },
      snapshot,
      provider: gemini,
      requestedProvider: "auto",
      reviewKey: keyFor(gemini),
    }),
    null
  );

  // Legacy sidecar without review_key → regenerate.
  assert.equal(
    resolveSkipReason({
      existingSidecar: { source_hash: "abc", provider: "gemini" },
      snapshot,
      provider: gemini,
      requestedProvider: "auto",
      reviewKey: keyFor(gemini),
    }),
    null
  );

  // Degraded sidecar with matching key → retry when Gemini is available…
  assert.equal(
    resolveSkipReason({
      existingSidecar: {
        source_hash: "abc",
        provider: "heuristic",
        degraded: true,
        review_key: keyFor(gemini),
      },
      snapshot,
      provider: gemini,
      requestedProvider: "auto",
      reviewKey: keyFor(gemini),
    }),
    null
  );

  // …but kept when only heuristic is available.
  assert.match(
    resolveSkipReason({
      existingSidecar: {
        source_hash: "abc",
        provider: "heuristic",
        degraded: true,
        review_key: keyFor(heuristic),
      },
      snapshot,
      provider: heuristic,
      requestedProvider: "auto",
      reviewKey: keyFor(heuristic),
    }),
    /degraded review kept/u
  );

  // Auto mode fell back to heuristic: never overwrite a good Gemini sidecar.
  assert.match(
    resolveSkipReason({
      existingSidecar: {
        source_hash: "abc",
        provider: "gemini",
        degraded: false,
        review_key: keyFor(gemini),
      },
      snapshot,
      provider: heuristic,
      requestedProvider: "auto",
      reviewKey: keyFor(heuristic),
    }),
    /preserved/u
  );

  // Explicit --provider heuristic is allowed to overwrite.
  assert.equal(
    resolveSkipReason({
      existingSidecar: {
        source_hash: "abc",
        provider: "gemini",
        degraded: false,
        review_key: keyFor(gemini),
      },
      snapshot,
      provider: heuristic,
      requestedProvider: "heuristic",
      reviewKey: keyFor(heuristic),
    }),
    null
  );
});

test("analyzer refreshes knowledge fields in place without touching the review", () => {
  const sidecar = {
    post_id: "a",
    public_commentary: "keep me",
    generated_at: "2026-01-01T00:00:00.000Z",
    related_post_ids: ["c"],
    related_posts: [],
    knowledge_hash: "old",
  };
  const refreshed = refreshSidecarKnowledge(
    sidecar,
    { knowledge_hash: "new" },
    {
      memory_refs: ["topic:x"],
      series_id: "s",
      series_label: "S",
      role: "系列开篇",
      position_summary: "pos",
      related_posts: [
        { post_id: "b", title: "B", route_path: "/posts/b", relation: "前置阅读" },
        { post_id: "c", title: "C", route_path: "/posts/c", relation: "后续阅读" },
      ],
    }
  );

  assert.equal(refreshed.public_commentary, "keep me");
  assert.equal(refreshed.generated_at, "2026-01-01T00:00:00.000Z");
  assert.equal(refreshed.knowledge_hash, "new");
  assert.deepEqual(refreshed.knowledge_refs, ["topic:x"]);
  assert.deepEqual(
    refreshed.related_posts.map(post => post.post_id),
    ["c"]
  );
  assert.equal(refreshed.knowledge_position.role, "系列开篇");
  assert.ok(refreshed.knowledge_refreshed_at);
});

test("writeJsonIfChanged ignores timestamp churn", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "blog-agent-fs-"));
  const target = path.join(dir, "memory.json");

  try {
    assert.equal(
      await writeJsonIfChanged(target, { updated_at: "a", topics: [1] }),
      true
    );
    assert.equal(
      await writeJsonIfChanged(target, { updated_at: "b", topics: [1] }),
      false
    );
    assert.equal(
      await writeJsonIfChanged(target, { updated_at: "b", topics: [1, 2] }),
      true
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("knowledge map series detection is driven by global rules only", async () => {
  const map = await buildKnowledgeMap({
    postPaths: [],
    globalRules: {
      series_naming_rules: [
        {
          id: "labs",
          label: "Labs",
          id_pattern: "^Lab-",
          role_label: "实验记录",
          open_ended: true,
          known_post_ids: [],
        },
        {
          id: "papers",
          label: "Papers",
          id_pattern: "^(EuroSys|ISCA)\\d{2}-",
          tag_triggers: ["论文阅读"],
          role_label: "论文阅读",
          open_ended: true,
          known_post_ids: [],
        },
      ],
    },
    overrides: { version: 1, series: {}, posts: {} },
    snapshots: [
      createSnapshot(
        "Lab-1",
        `---
title: Lab 1
pubDatetime: 2026-01-01T00:00:00.000Z
tags: []
---

Body.
`
      ),
      createSnapshot(
        "Lab-2",
        `---
title: Lab 2
pubDatetime: 2026-01-02T00:00:00.000Z
tags: []
---

Body.
`
      ),
      createSnapshot(
        "EuroSys26-MAYA",
        `---
title: MAYA
pubDatetime: 2026-01-03T00:00:00.000Z
tags: []
---

Body.
`
      ),
      createSnapshot(
        "some-notes",
        `---
title: Notes
pubDatetime: 2026-01-04T00:00:00.000Z
tags:
  - "论文阅读"
---

Body.
`
      ),
    ],
  });
  const byId = new Map(map.posts.map(post => [post.post_id, post]));

  assert.equal(byId.get("Lab-1").series_id, "labs");
  assert.equal(byId.get("Lab-1").role, "系列开篇");
  assert.equal(byId.get("Lab-2").role, "实验记录");
  assert.equal(byId.get("EuroSys26-MAYA").series_id, "papers");
  assert.equal(byId.get("some-notes").series_id, "papers");
  assert.equal(byId.get("some-notes").role, "论文阅读");
});

test("home panel tracks come from global rules", () => {
  const sidecar = buildHomePanelData(
    [
      createSnapshot(
        "rust-notes",
        `---
title: Rust ownership notes
pubDatetime: 2026-01-01T00:00:00.000Z
description: Borrow checker walkthrough.
tags:
  - "Rust"
---

Body.
`
      ),
    ],
    {
      homeTracks: [
        {
          id: "rust",
          label: "Rust 学习",
          patterns: ["\\brust\\b"],
          tags: ["Rust"],
        },
      ],
    }
  );

  assert.deepEqual(sidecar.focus_topics, ["Rust 学习"]);
});

test("frontmatter assist only fires for fields that need filling", async () => {
  const schemaRules = await loadContentSchemaRules();
  const complete = createSnapshot(
    "assist-complete",
    `---
title: "Done"
pubDatetime: 2026-01-01T00:00:00.000Z
description: "A description that is comfortably long enough to stand on its own."
tags:
  - "Agent"
---

Body.
`
  );
  const bare = createSnapshot(
    "assist-bare",
    `## Heading

Body without frontmatter.
`
  );
  const placeholder = createSnapshot(
    "assist-placeholder",
    `---
title: "Placeholder tags"
pubDatetime: 2026-01-01T00:00:00.000Z
description: "A description that is comfortably long enough to stand on its own."
tags:
  - "others"
---

Body.
`
  );

  assert.deepEqual(getAssistableFields(complete, schemaRules), {
    description: false,
    tags: false,
  });
  assert.deepEqual(getAssistableFields(bare, schemaRules), {
    description: true,
    tags: true,
  });
  assert.deepEqual(getAssistableFields(placeholder, schemaRules), {
    description: false,
    tags: true,
  });

  // An explicit hint means the author already decided; don't spend a call.
  assert.deepEqual(
    getAssistableFields(bare, schemaRules, {
      structured: { description: "mine", tags: ["Agent"] },
    }),
    { description: false, tags: false }
  );

  assert.equal(hasAssistableField({ description: false, tags: false }), false);
  assert.equal(hasAssistableField({ description: false, tags: true }), true);
});

test("frontmatter assist sanitizer drops placeholder and malformed tags", () => {
  const globalRules = { tag_registry: { Agent: {}, "论文阅读": {} } };
  const assist = sanitizeFrontmatterAssist(
    {
      description:
        "  这是一段足够长的中文摘要，用来描述文章实际讲了什么内容。  ",
      tags: ["agent", "others", "  论文阅读 ", "", "GPU模拟器", "Agent"],
    },
    globalRules,
    { description: true, tags: true }
  );

  // Registry casing wins so `agent` does not fork into a near-duplicate tag.
  assert.deepEqual(assist.tags, ["Agent", "论文阅读", "GPU模拟器"]);
  assert.match(assist.description, /^这是一段足够长的中文摘要/u);
  assert.ok(assist.notes.some(note => note.includes("GPU模拟器")));

  const empty = sanitizeFrontmatterAssist(
    { description: "   ", tags: ["others"] },
    globalRules,
    { description: true, tags: true }
  );
  assert.equal(empty.description, undefined);
  assert.equal(empty.tags, undefined);
  assert.equal(empty.notes.length, 2);
});

test("frontmatter generator prefers assist over inferred tags but yields to hints", async () => {
  const schemaRules = await loadContentSchemaRules();
  const snapshot = createSnapshot(
    "assist-precedence",
    `## Intro

Agent runtimes often combine planning, retrieval and tool execution with MCP.
`
  );
  const assist = {
    description: "模型生成的摘要，应当优先于规则拼接的结果。",
    tags: ["GPU模拟器", "Accel-Sim"],
    notes: [],
  };

  const withAssist = generateFrontmatter(snapshot, schemaRules, TEST_GLOBAL_RULES, {
    assist,
  });
  assert.equal(withAssist.document.data.description, assist.description);
  assert.deepEqual(withAssist.document.data.tags, assist.tags);

  // An explicit hint still outranks the model, and is taken as the full list.
  const withHint = generateFrontmatter(snapshot, schemaRules, TEST_GLOBAL_RULES, {
    assist,
    hintText: "description: 作者手写的摘要。\ntags: Agent, MCP",
  });
  assert.equal(withHint.document.data.description, "作者手写的摘要。");
  assert.deepEqual(withHint.document.data.tags, ["Agent", "MCP"]);

  // Without an assist the rule-based path is unchanged.
  const withoutAssist = generateFrontmatter(
    snapshot,
    schemaRules,
    TEST_GLOBAL_RULES,
    {}
  );
  assert.notEqual(withoutAssist.document.data.description, assist.description);
});

test("read-only analysis never writes, even when knowledge drifted", async () => {
  const timestamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const postId = `agent-readonly-${timestamp}`;
  const filePath = path.join(process.cwd(), "src", "data", "blog", `${postId}.md`);
  const sidecarPath = getSidecarPathForPost(filePath);

  await fs.writeFile(
    filePath,
    `---
title: "Read only"
pubDatetime: 2026-01-01T00:00:00.000Z
description: "A description long enough to avoid triggering regeneration."
tags:
  - "Agent"
---

Body.
`,
    "utf8"
  );

  try {
    // First pass writes a sidecar normally.
    await analyzePost(filePath, {
      provider: "heuristic",
      updateMemory: false,
    });
    const before = await fs.readFile(sidecarPath, "utf8");

    // Now the knowledge map moved on. A writing run patches the sidecar...
    const knowledgeMap = { knowledge_hash: `moved-${timestamp}`, posts: [] };
    const written = await analyzePost(filePath, {
      provider: "heuristic",
      updateMemory: false,
      knowledgeMap,
    });
    assert.equal(written.knowledge_refreshed, true);
    assert.notEqual(await fs.readFile(sidecarPath, "utf8"), before);

    // ...but a read-only run only reports it.
    const reset = await fs.readFile(sidecarPath, "utf8");
    const readOnly = await analyzePost(filePath, {
      provider: "heuristic",
      updateMemory: false,
      regenerate: false,
      knowledgeMap: { knowledge_hash: `moved-again-${timestamp}`, posts: [] },
    });

    assert.equal(readOnly.knowledge_refreshed, false);
    assert.equal(readOnly.stale, true);
    assert.ok(readOnly.notes.some(note => note.includes("stale knowledge refs")));
    assert.equal(await fs.readFile(sidecarPath, "utf8"), reset);
  } finally {
    await fs.rm(filePath, { force: true });
    await fs.rm(sidecarPath, { force: true });
  }
});
