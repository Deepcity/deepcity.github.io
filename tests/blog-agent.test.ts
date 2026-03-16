// @ts-nocheck
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseMarkdownDocument, stringifyMarkdownDocument } from "../src/agent/frontmatter.js";
import { inferCodeFenceLanguage } from "../src/agent/markdown.js";
import { inferAgentModelMeta } from "../src/agent/model-meta.js";
import { getSidecarPathForPost } from "../src/agent/pathing.js";
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
