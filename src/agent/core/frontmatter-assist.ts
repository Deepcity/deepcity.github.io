// LLM-backed frontmatter assist.
//
// The rule-based generator in ./frontmatter-generator.ts can only splice
// together the first paragraphs of a post, which produces template filler
// ("... 的技术记录，补充文章目标、核心内容与结论摘要。"), sentences truncated
// mid-clause, and `tags: ["others"]`. Now that the review provider reads the
// full body, the same context can produce a real description and real tags.
//
// This runs only when a field actually needs filling, degrades to the
// rule-based output on any failure, and never overrides explicit user hints.
import {
  buildBodyForPrompt,
  requestGeminiJson,
  resolveGeminiConfig,
} from "../providers/gemini.js";
import { dedupeStrings, truncateText } from "../shared/utils.js";
import type {
  ContentSchemaRules,
  GlobalRules,
  PostSnapshot,
  RequestedProvider,
} from "../types.js";

export const FRONTMATTER_ASSIST_PROMPT_VERSION = "2026-09-22.1";

const MAX_TAGS = 5;
const MAX_DESCRIPTION_CHARS = 140;

const ASSIST_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    description: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
  required: ["description", "tags"],
};

export interface FrontmatterAssist {
  description?: string;
  tags?: string[];
  notes: string[];
}

export interface AssistableFields {
  description: boolean;
  tags: boolean;
}

function isMissing(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim() === "";
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return false;
}

// Mirrors the generator's own weak-value rules: a description shorter than 15
// characters, or tags that are missing / only the `others` placeholder.
function isWeakDescription(value: unknown): boolean {
  return typeof value !== "string" || value.trim().length < 15;
}

function isPlaceholderTags(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) {
    return true;
  }

  return value.every(tag => String(tag).trim().toLowerCase() === "others");
}

/**
 * Which fields a fresh generation pass would fill. Used to skip the LLM call
 * entirely for posts whose frontmatter is already complete.
 */
export function getAssistableFields(
  snapshot: PostSnapshot,
  schemaRules: ContentSchemaRules,
  hints: { structured?: Record<string, unknown> } = {}
): AssistableFields {
  const data = snapshot.document.data;
  const structured = hints.structured ?? {};
  const known = new Set([
    ...(schemaRules.required_fields ?? []),
    ...(schemaRules.optional_fields ?? []),
    "description",
    "tags",
  ]);

  return {
    description:
      known.has("description") &&
      isMissing(structured.description) &&
      isWeakDescription(data.description),
    tags:
      known.has("tags") &&
      isMissing(structured.tags) &&
      (isMissing(data.tags) || isPlaceholderTags(data.tags)),
  };
}

export function hasAssistableField(fields: AssistableFields): boolean {
  return fields.description || fields.tags;
}

function buildKnownTagVocabulary(globalRules: GlobalRules): string[] {
  return Object.keys(globalRules.tag_registry ?? {});
}

function buildAssistPrompt(
  snapshot: PostSnapshot,
  globalRules: GlobalRules,
  fields: AssistableFields,
  hintText: string
): string {
  const body = buildBodyForPrompt(snapshot.body ?? snapshot.document.body);
  const outline = snapshot.analysis.headings
    .map(
      heading =>
        `${"  ".repeat(Math.max(0, heading.depth - 2))}- ${heading.text}`
    )
    .join("\n");

  return [
    "## 任务",
    fields.description && fields.tags
      ? "为下面这篇博客生成 description 和 tags。"
      : fields.description
        ? "为下面这篇博客生成 description。"
        : "为下面这篇博客生成 tags。",
    "",
    "## 文章信息",
    `标题: ${snapshot.title}`,
    `post_id: ${snapshot.post_id}`,
    `作者补充提示: ${hintText.trim() || "(none)"}`,
    `站点既有标签库（优先复用，不要为了凑数硬套）: ${JSON.stringify(
      buildKnownTagVocabulary(globalRules)
    )}`,
    "",
    "## 正文大纲",
    outline || "(正文没有标题)",
    "",
    body.truncated
      ? `## 正文（已截断，省略中间约 ${body.omitted_chars} 个字符）`
      : "## 正文（完整）",
    "<<<BODY",
    body.text || "(empty)",
    "BODY>>>",
  ].join("\n");
}

function buildSystemInstruction(): string {
  return [
    "你在为一个中文技术博客补全 frontmatter。只输出一个 JSON 对象。",
    "",
    "description 要求：",
    "- 中文，一句话，60-140 字，必须是完整通顺的句子，不能截断。",
    "- 概括文章实际写了什么：研究/记录的对象、采用的方法或路径、得到的结论或收获。",
    "- 直接描述内容本身。禁止出现「本文」「这篇文章」「技术记录」「补充文章目标、核心内容与结论摘要」这类空话套话。",
    "- 只能依据正文写得出来的内容；正文是空的或只有标题时，如实说明它目前是占位稿。",
    "",
    "tags 要求：",
    "- 2 到 5 个，中文或英文皆可，每个都是名词性短语，不带标点。",
    "- 优先复用站点既有标签库里的标签（大小写与写法保持一致）。",
    "- 确实需要时可以新增标签，但必须是文章的核心主题，例如具体的会议名、系统名或技术领域。",
    "- 不要输出 `others` 这类占位标签，也不要输出与正文无关的标签。",
  ].join("\n");
}

function sanitizeTag(value: unknown): string {
  return String(value ?? "")
    .replace(/^[#\s]+|[\s,.;:!?，。；：！？]+$/gu, "")
    .trim();
}

function sanitizeTags(
  rawTags: unknown,
  globalRules: GlobalRules,
  notes: string[]
): string[] {
  if (!Array.isArray(rawTags)) {
    return [];
  }

  // Match the registry case-insensitively so the model's casing never forks
  // an existing tag into a near-duplicate.
  const registry = new Map(
    buildKnownTagVocabulary(globalRules).map(tag => [tag.toLowerCase(), tag])
  );
  const cleaned: string[] = [];

  for (const raw of rawTags) {
    const tag = sanitizeTag(raw);

    if (!tag || tag.length > 24 || tag.toLowerCase() === "others") {
      continue;
    }

    cleaned.push(registry.get(tag.toLowerCase()) ?? tag);
  }

  const deduped = dedupeStrings(cleaned).slice(0, MAX_TAGS);
  const invented = deduped.filter(tag => !registry.has(tag.toLowerCase()));

  if (invented.length > 0) {
    notes.push(
      `Frontmatter assist introduced tags outside the registry: ${invented.join(", ")}`
    );
  }

  return deduped;
}

function sanitizeDescription(rawDescription: unknown): string {
  const text = String(rawDescription ?? "")
    .replace(/\s+/gu, " ")
    .trim();

  if (!text) {
    return "";
  }

  return truncateText(text, MAX_DESCRIPTION_CHARS);
}

export function sanitizeFrontmatterAssist(
  payload: unknown,
  globalRules: GlobalRules,
  fields: AssistableFields
): FrontmatterAssist {
  const notes: string[] = [];
  const raw = (payload ?? {}) as { description?: unknown; tags?: unknown };
  const result: FrontmatterAssist = { notes };

  if (fields.description) {
    const description = sanitizeDescription(raw.description);

    if (description) {
      result.description = description;
    } else {
      notes.push("Frontmatter assist returned an empty description.");
    }
  }

  if (fields.tags) {
    const tags = sanitizeTags(raw.tags, globalRules, notes);

    if (tags.length > 0) {
      result.tags = tags;
    } else {
      notes.push("Frontmatter assist returned no usable tags.");
    }
  }

  return result;
}

export interface FrontmatterAssistOptions {
  provider?: RequestedProvider;
  model?: string;
  apiKey?: string;
  hintText?: string;
  timeoutMs?: number;
}

/**
 * Returns `null` when no LLM is available or nothing needs filling, so the
 * caller falls back to the rule-based generator unchanged.
 */
export async function requestFrontmatterAssist(
  snapshot: PostSnapshot,
  globalRules: GlobalRules,
  fields: AssistableFields,
  options: FrontmatterAssistOptions = {}
): Promise<FrontmatterAssist | null> {
  if (!hasAssistableField(fields)) {
    return null;
  }

  if (options.provider === "heuristic") {
    return null;
  }

  const gemini = resolveGeminiConfig(options);

  if (!gemini.available) {
    return {
      notes: [
        `Frontmatter assist unavailable (${gemini.unavailable_reason}); used rule-based description/tags.`,
      ],
    };
  }

  try {
    const payload = await requestGeminiJson({
      apiKey: gemini.apiKey,
      model: gemini.model,
      prompt: buildAssistPrompt(
        snapshot,
        globalRules,
        fields,
        options.hintText ?? ""
      ),
      systemInstruction: buildSystemInstruction(),
      generationConfig: { responseSchema: ASSIST_RESPONSE_SCHEMA },
      timeoutMs: options.timeoutMs,
    });
    const assist = sanitizeFrontmatterAssist(payload, globalRules, fields);
    const filled = [
      assist.description ? "description" : null,
      assist.tags ? "tags" : null,
    ].filter(Boolean);

    if (filled.length > 0) {
      assist.notes.unshift(
        `Frontmatter assist (${gemini.model}) generated: ${filled.join(", ")}.`
      );
    }

    return assist;
  } catch (error) {
    return {
      notes: [
        `Frontmatter assist failed: ${error instanceof Error ? error.message : String(error)}; used rule-based description/tags.`,
      ],
    };
  }
}
