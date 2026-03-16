// @ts-nocheck
import path from "node:path";

export const REPO_ROOT = process.cwd();
export const BLOG_ROOT = path.join(REPO_ROOT, "src", "data", "blog");
export const AGENT_ROOT = path.join(REPO_ROOT, "src", "data", "agent");
export const SIDECAR_ROOT = path.join(AGENT_ROOT, "posts");
export const MEMORY_ROOT = path.join(AGENT_ROOT, "memory");

export const BLOG_PATH = "src/data/blog";
export const AGENT_DATA_DIR = "src/data/agent";
export const AGENT_POSTS_DIR = "src/data/agent/posts";
export const AGENT_MEMORY_DIR = "src/data/agent/memory";

export const GLOBAL_RULES_PATH = path.join(MEMORY_ROOT, "global.json");
export const SERIES_MEMORY_PATH = path.join(MEMORY_ROOT, "series.json");
export const TOPIC_MEMORY_PATH = path.join(MEMORY_ROOT, "topics.json");
export const NEGATIVE_MEMORY_PATH = path.join(
  MEMORY_ROOT,
  "negative-patterns.json"
);
export const CONTENT_SCHEMA_PATH = path.join(
  REPO_ROOT,
  "src",
  "content.config.ts"
);
export const LEGACY_MEMORY_PATH = path.join(
  REPO_ROOT,
  ".github",
  "agents",
  "blog-memory.md"
);
export const LEGACY_RULES_PATH = path.join(
  REPO_ROOT,
  ".github",
  "instructions",
  "blog-format.instructions.md"
);

export const FRONTMATTER_FIELD_ORDER = [
  "title",
  "pubDatetime",
  "modDatetime",
  "description",
  "slug",
  "draft",
  "featured",
  "tags",
  "author",
  "ogImage",
  "canonicalURL",
  "hideEditPost",
  "timezone",
];
export const PREFERRED_FRONTMATTER_ORDER = FRONTMATTER_FIELD_ORDER;
export const SEVERITY_ORDER = ["info", "warn", "error"];

export const SAFE_FIX_CODES = new Set([
  "missing-draft",
  "empty-image-alt",
  "missing-code-language",
]);

export const DEFAULT_MODEL = "gemini-3.1-pro-preview";
export const DEFAULT_PROVIDER = "auto";
export const DEFAULT_RUN_MODE = "cli";
