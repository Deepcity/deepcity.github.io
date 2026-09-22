import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DEFAULT_MODEL } from "../shared/constants.js";
import { dedupeStrings, roundConfidence } from "../shared/utils.js";
import type {
  CheckSuggestions,
  HardCheckIssue,
  KnowledgePosition,
  MarkdownAnalysis,
  MemoryContext,
  RelatedPost,
  Review,
  ReviewProvider,
  RawJson,
  Severity,
} from "../types.js";

/** Everything a review provider is told about the post under review. */
export interface ReviewInput {
  post: {
    id: string;
    title: string;
    description: string;
    tags: string[];
    excerpt: string;
    body: string;
    agentExperiment: boolean;
    agentExperimentNote: string;
  };
  analysis: MarkdownAnalysis;
  issues: HardCheckIssue[];
  actionItems: string[];
  suggestions: CheckSuggestions;
  knowledge: (KnowledgePosition & { related_posts?: RelatedPost[] }) | null;
}

interface GeminiRequestOptions {
  apiKey?: string;
  model?: string;
  prompt?: string;
  parts?: unknown[];
  systemInstruction?: string;
  generationConfig?: Record<string, unknown>;
  timeoutMs?: number | string;
  preferCurl?: boolean;
  retryAttempts?: number | string;
  retryBaseDelayMs?: number | string;
  onRetry?: (event: { attempt: number; delay: number; error: unknown }) => void;
}

/** Errors carry an HTTP status / retryable hint across the transport layer. */
interface TransportError extends Error {
  status?: number;
  retryable?: boolean;
  attempts?: number;
}

// Bump whenever the review prompt / schema changes in a way that should
// invalidate existing sidecars. Included in the analyzer's review_key.
export const REVIEW_PROMPT_VERSION = "2026-09-22.1";

const DEFAULT_MAX_BODY_CHARS = 24000;
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1500;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const REVIEW_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    public_commentary: { type: "string" },
    related_post_ids: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    structural_review: { type: "string" },
    technical_review: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    action_items: { type: "array", items: { type: "string" } },
    severity: { type: "string", enum: ["info", "warn", "error"] },
    confidence: { type: "number" },
    memory_refs: { type: "array", items: { type: "string" } },
  },
  required: [
    "public_commentary",
    "related_post_ids",
    "summary",
    "structural_review",
    "technical_review",
    "strengths",
    "concerns",
    "action_items",
    "severity",
    "confidence",
    "memory_refs",
  ],
};

function findJsonObject(text: string): string | null {
  const start = text.indexOf("{");

  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

export function extractJsonPayload(text: string): RawJson {
  const normalized = text
    .trim()
    .replace(/^```(?:json)?\s*/iu, "")
    .replace(/```\s*$/u, "");

  try {
    return JSON.parse(normalized);
  } catch {
    const jsonObject = findJsonObject(normalized);

    if (!jsonObject) {
      throw new Error("Gemini response is not valid JSON");
    }

    return JSON.parse(jsonObject);
  }
}

function sanitizePublicCommentary(value: unknown): string {
  return String(value ?? "")
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<[^>]*>/gu, "")
    .trim()
    .slice(0, 900);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(String);
}

function sanitizeRelatedPostIds(
  rawReview: RawJson,
  input: Pick<ReviewInput, "knowledge">,
  notes: string[]
): string[] {
  const allowedIds = new Set(
    (input.knowledge?.related_posts ?? []).map(post => post.post_id)
  );
  const rawIds = [
    ...toStringArray(rawReview.related_post_ids),
    ...(Array.isArray(rawReview.related_posts)
      ? rawReview.related_posts
      : []
    ).map((item: RawJson) => (typeof item === "string" ? item : item?.post_id)),
  ];
  const deduped = dedupeStrings(rawIds.map(String));
  const rejected = deduped.filter(postId => !allowedIds.has(postId));

  if (rejected.length > 0) {
    notes.push(
      `Gemini proposed related_post_ids outside the allow-list and they were dropped: ${rejected.join(", ")}`
    );
  }

  return deduped.filter(postId => allowedIds.has(postId));
}

export function sanitizeReview(
  rawReview: RawJson,
  input: Pick<ReviewInput, "knowledge">
): Review {
  const notes: string[] = [];
  const summary = String(rawReview.summary ?? "").trim();
  const publicCommentary =
    sanitizePublicCommentary(rawReview.public_commentary) ||
    sanitizePublicCommentary(summary);

  if (!String(rawReview.public_commentary ?? "").trim()) {
    notes.push("Gemini returned an empty public_commentary; summary was used.");
  }

  let severity: Severity = rawReview.severity;

  if (!["info", "warn", "error"].includes(severity)) {
    notes.push(
      `Gemini returned invalid severity ${JSON.stringify(severity ?? null)}; defaulted to warn.`
    );
    severity = "warn";
  }

  const rawConfidence = Number(rawReview.confidence);
  let confidence = rawConfidence;

  if (!Number.isFinite(rawConfidence)) {
    notes.push("Gemini returned a non-numeric confidence; defaulted to 0.72.");
    confidence = 0.72;
  }

  return {
    public_commentary: publicCommentary,
    related_post_ids: sanitizeRelatedPostIds(rawReview, input, notes),
    summary,
    structural_review: String(rawReview.structural_review ?? "").trim(),
    technical_review: String(rawReview.technical_review ?? "").trim(),
    strengths: dedupeStrings(toStringArray(rawReview.strengths)).slice(0, 5),
    concerns: dedupeStrings(toStringArray(rawReview.concerns)).slice(0, 6),
    action_items: dedupeStrings(toStringArray(rawReview.action_items)).slice(
      0,
      6
    ),
    severity,
    confidence: roundConfidence(confidence),
    memory_refs: dedupeStrings(toStringArray(rawReview.memory_refs)).slice(
      0,
      8
    ),
    notes,
  };
}

function resolveMaxBodyChars(): number {
  const raw = Number(process.env.BLOG_AGENT_MAX_BODY_CHARS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_BODY_CHARS;
}

// Keeps the head (where the argument is set up) and the tail (where the
// conclusion lives) and tells the model exactly how much was dropped.
export function buildBodyForPrompt(
  body: string,
  maxChars = resolveMaxBodyChars()
): { text: string; truncated: boolean; omitted_chars: number } {
  const normalized = String(body ?? "")
    .replace(/\r\n?/gu, "\n")
    .trim();

  if (normalized.length <= maxChars) {
    return { text: normalized, truncated: false, omitted_chars: 0 };
  }

  const headLength = Math.floor(maxChars * 0.7);
  const tailLength = maxChars - headLength;
  const omitted = normalized.length - headLength - tailLength;

  return {
    text: [
      normalized.slice(0, headLength).trimEnd(),
      `\n\n[…… 正文中间省略了约 ${omitted} 个字符，以下是文章结尾部分 ……]\n\n`,
      normalized.slice(normalized.length - tailLength).trimStart(),
    ].join(""),
    truncated: true,
    omitted_chars: omitted,
  };
}

function buildOutline(headings: MarkdownAnalysis["headings"] = []): string {
  if (headings.length === 0) {
    return "(正文没有标题)";
  }

  return headings
    .map(
      heading =>
        `${"  ".repeat(Math.max(0, heading.depth - 2))}- ${heading.text}`
    )
    .join("\n");
}

function buildSystemInstruction(): string {
  return [
    "你是 Deepcity 博客的审稿 Agent，负责在构建期为每篇文章生成一份公开旁批和一份给作者看的审稿意见。",
    "你会拿到文章的完整正文（超长时会截断并明确标注）。所有评价都必须基于正文实际写了什么：",
    "- 引用具体章节或段落来支撑判断，不要泛泛而谈；",
    "- 不要评价正文里没有出现的内容，也不要把标题或 tags 暗示的内容当作正文已经写了；",
    "- 如果正文被截断，只针对你看到的部分下结论，并在 concerns 里说明哪些部分你没有看到。",
    "输出要求：只输出一个 JSON 对象，不要输出 Markdown 代码块或额外说明。",
    "字段说明：",
    "- public_commentary：给读者看的公开旁批，中文，2-4 段，总长约 300-700 字。可以尖锐但不要刻薄；优先结合文章在系列/知识网络中的位置、技术论证缺口、读者背景补充和一条轻微风趣旁批。只允许普通段落、短无序列表、加粗、斜体、行内代码；不要写标题、表格、代码块、图片、HTML 或 Markdown 链接。",
    "- summary：中文，120 字以内，概括文章实际讨论的内容。",
    "- structural_review：结构层面的评价（章节安排、论证顺序、详略），2-4 句。",
    "- technical_review：技术层面的评价（论证是否成立、关键机制是否讲清、有无明显错误或遗漏），3-6 句，必须落到具体章节。",
    "- strengths / concerns / action_items：字符串数组，每项一句话；concerns 应指出正文中具体位置。",
    "- severity：info / warn / error，error 只用于正文存在明确的技术错误或误导性结论。",
    "- confidence：0-1 之间的小数，表示你对本次评价的把握。",
    "- related_post_ids：只能从 allowed_related_posts 里的 post_id 选择，最多 3 个；不要虚构。",
    "- memory_refs：你实际参考过的 memory refs（形如 series:xxx / topic:xxx / issue:xxx）。",
  ].join("\n");
}

function buildPrompt(input: ReviewInput, context: MemoryContext): string {
  const knowledge = input.knowledge ?? null;
  const allowedRelatedPosts = (knowledge?.related_posts ?? []).map(post => ({
    post_id: post.post_id,
    title: post.title,
    relation: post.relation,
  }));
  const body = buildBodyForPrompt(input.post.body);
  const negativePatterns = (context.patterns ?? []).map(pattern => ({
    code: pattern.code,
    severity: pattern.severity,
    count: pattern.count,
    sample_message: pattern.sample_message,
  }));

  return [
    "## 文章元信息",
    `标题: ${input.post.title}`,
    `tags: ${input.post.tags.join(", ") || "(none)"}`,
    `description: ${input.post.description || "(none)"}`,
    `Agent 试验标识: ${input.post.agentExperiment ? input.post.agentExperimentNote || "这是用于调试新审稿架构的试验样本；评价时请明确区分真实内容问题与试验集迁移问题。" : "(none)"}`,
    `结构统计: headings=${input.analysis.headings.length}, code_fences=${input.analysis.codeFences.length}, images=${input.analysis.images.length}, links=${input.analysis.linkCount}, words=${input.analysis.wordCount}`,
    "",
    "## 本地硬校验结果",
    `问题: ${input.issues.map(issue => `${issue.severity}:${issue.message}`).join(" | ") || "(none)"}`,
    `已有 action items: ${input.actionItems.join(" | ") || "(none)"}`,
    "",
    "## 记忆与知识网络",
    `相关 memory refs: ${(context.refs ?? []).join(", ") || "(none)"}`,
    `相关 series memory: ${JSON.stringify(context.series ?? null)}`,
    `相关 topics memory: ${JSON.stringify(context.topics ?? [])}`,
    `本站其他文章近期常见问题（用于判断本文是否重复踩坑）: ${JSON.stringify(negativePatterns)}`,
    `知识网络位置: ${JSON.stringify(knowledge ?? null)}`,
    `allowed_related_posts: ${JSON.stringify(allowedRelatedPosts)}`,
    "",
    "## 正文大纲",
    buildOutline(input.analysis.headings),
    "",
    body.truncated
      ? `## 正文（已截断：原文 ${String(input.post.body ?? "").length} 字符，省略中间约 ${body.omitted_chars} 字符）`
      : "## 正文（完整）",
    "<<<BODY",
    body.text || "(empty)",
    "BODY>>>",
  ].join("\n");
}

function buildRequestPayload(
  parts: unknown[],
  generationConfig: Record<string, unknown> = {},
  systemInstruction?: string
): string {
  return JSON.stringify({
    ...(systemInstruction
      ? { systemInstruction: { parts: [{ text: systemInstruction }] } }
      : {}),
    generationConfig: {
      responseMimeType: "application/json",
      ...generationConfig,
    },
    contents: [
      {
        role: "user",
        parts,
      },
    ],
  });
}

function formatError(error: unknown): string {
  if (!error) {
    return "unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  const err = error as { message?: string; cause?: { message?: string } };
  const message = err.message ?? String(error);
  const cause = err.cause?.message;

  return cause && cause !== message ? `${message}; cause: ${cause}` : message;
}

function isTimeoutError(error: unknown): boolean {
  const err = error as { name?: string; message?: string } | null | undefined;
  const name = String(err?.name ?? "");
  const message = String(err?.message ?? error ?? "");

  return (
    name === "AbortError" || /timed out|timeout|aborted|abort/iu.test(message)
  );
}

function isRetryableError(error: RawJson): boolean {
  if (!error) {
    return false;
  }

  if (error.retryable === true) {
    return true;
  }

  if (typeof error.status === "number") {
    return RETRYABLE_STATUS.has(error.status);
  }

  if (isTimeoutError(error)) {
    return true;
  }

  const message = String(error?.message ?? "");
  const statusMatch = message.match(/\b(408|425|429|5\d{2})\b/u);

  if (statusMatch) {
    return true;
  }

  // Transport-level failures (DNS, reset, proxy hiccup).
  return /ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up|fetch failed|network/iu.test(
    message
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

function resolveRetryConfig(
  options: Pick<GeminiRequestOptions, "retryAttempts" | "retryBaseDelayMs">
): { attempts: number; baseDelayMs: number } {
  const attemptsRaw = Number(
    options.retryAttempts ?? process.env.BLOG_AGENT_GEMINI_RETRIES
  );
  const baseDelayRaw = Number(
    options.retryBaseDelayMs ?? process.env.BLOG_AGENT_GEMINI_RETRY_DELAY_MS
  );

  return {
    attempts:
      Number.isFinite(attemptsRaw) && attemptsRaw >= 1
        ? Math.floor(attemptsRaw)
        : DEFAULT_RETRY_ATTEMPTS,
    baseDelayMs:
      Number.isFinite(baseDelayRaw) && baseDelayRaw >= 0
        ? baseDelayRaw
        : DEFAULT_RETRY_BASE_DELAY_MS,
  };
}

export async function withRetry<T>(
  task: (attempt: number) => Promise<T>,
  options: Pick<
    GeminiRequestOptions,
    "retryAttempts" | "retryBaseDelayMs" | "onRetry"
  > = {}
): Promise<T> {
  const { attempts, baseDelayMs } = resolveRetryConfig(options);
  const failures: string[] = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      failures.push(`attempt ${attempt}: ${formatError(error)}`);

      if (attempt === attempts || !isRetryableError(error)) {
        const finalError: TransportError = new Error(
          attempts > 1 && failures.length > 1
            ? `Gemini request failed after ${failures.length} attempt(s): ${failures.join(" || ")}`
            : formatError(error)
        );
        finalError.cause = error;
        finalError.status = (error as TransportError)?.status;
        finalError.attempts = failures.length;
        throw finalError;
      }

      const delay =
        baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      options.onRetry?.({ attempt, delay, error });
      await sleep(delay);
    }
  }

  throw new Error("unreachable");
}

function hasProxyEnv(): boolean {
  return Boolean(
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    process.env.all_proxy
  );
}

export function resolveGeminiConfig(
  options: Pick<GeminiRequestOptions, "apiKey" | "model"> = {}
) {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  const model = options.model ?? process.env.BLOG_AGENT_MODEL ?? DEFAULT_MODEL;

  return {
    apiKey,
    model,
    available: Boolean(apiKey),
    unavailable_reason: apiKey ? null : "Missing GEMINI_API_KEY",
  };
}

async function requestOnce(
  url: string,
  apiKey: string,
  body: string,
  timeoutMs: number | string | undefined,
  preferCurl: boolean
): Promise<RawJson> {
  if (preferCurl) {
    try {
      return await requestWithCurl(url, apiKey, body, timeoutMs);
    } catch (curlError) {
      try {
        return await requestWithFetch(url, apiKey, body, timeoutMs);
      } catch (fetchError) {
        const error: TransportError = new Error(
          `Gemini request failed via curl (${formatError(curlError)}) and fetch (${formatError(fetchError)})`
        );
        error.status =
          (fetchError as TransportError).status ??
          (curlError as TransportError).status;
        error.retryable =
          isRetryableError(curlError) || isRetryableError(fetchError);
        throw error;
      }
    }
  }

  try {
    return await requestWithFetch(url, apiKey, body, timeoutMs);
  } catch (fetchError) {
    if (isTimeoutError(fetchError)) {
      const error: TransportError = new Error(
        `Gemini request timed out: ${formatError(fetchError)}`
      );
      error.retryable = true;
      throw error;
    }

    try {
      return await requestWithCurl(url, apiKey, body, timeoutMs);
    } catch (curlError) {
      const error: TransportError = new Error(
        `Gemini request failed via fetch (${formatError(fetchError)}) and curl (${formatError(curlError)})`
      );
      error.status =
        (fetchError as TransportError).status ??
        (curlError as TransportError).status;
      error.retryable =
        isRetryableError(fetchError) || isRetryableError(curlError);
      throw error;
    }
  }
}

export async function requestGeminiJson(
  options: GeminiRequestOptions = {}
): Promise<RawJson> {
  const gemini = resolveGeminiConfig(options);

  if (!gemini.apiKey) {
    throw new Error("GEMINI_API_KEY is required for Gemini provider");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${gemini.model}:generateContent`;
  const parts = options.parts ?? [{ text: String(options.prompt ?? "") }];
  const body = buildRequestPayload(
    parts,
    options.generationConfig,
    options.systemInstruction
  );
  const preferCurl = options.preferCurl ?? hasProxyEnv();

  const apiKey = gemini.apiKey;
  const payload = await withRetry(
    () => requestOnce(url, apiKey, body, options.timeoutMs, preferCurl),
    {
      retryAttempts: options.retryAttempts,
      retryBaseDelayMs: options.retryBaseDelayMs,
      onRetry: options.onRetry,
    }
  );

  const finishReason = payload.candidates?.[0]?.finishReason;
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text ?? "")
    .join("")
    .trim();

  if (!text) {
    const blocked = payload.promptFeedback?.blockReason;
    throw new Error(
      `Gemini returned an empty review${finishReason ? ` (finishReason=${finishReason})` : ""}${blocked ? ` (blockReason=${blocked})` : ""}`
    );
  }

  return extractJsonPayload(text);
}

export async function requestGeminiImageJson(
  options: GeminiRequestOptions & {
    images?: Array<{ imagePath?: string; mimeType?: string }>;
    imagePath?: string;
    mimeType?: string;
  } = {}
): Promise<RawJson> {
  const images = Array.isArray(options.images)
    ? options.images
    : [
        {
          imagePath: options.imagePath,
          mimeType: options.mimeType,
        },
      ];
  const normalizedImages = images
    .map(image => ({
      imagePath: String(image?.imagePath ?? ""),
      mimeType: image?.mimeType ?? "image/png",
    }))
    .filter(image => image.imagePath);

  if (normalizedImages.length === 0) {
    throw new Error("imagePath or images are required for Gemini image review");
  }

  const parts: unknown[] = [{ text: String(options.prompt ?? "") }];

  for (const image of normalizedImages) {
    const imageBytes = await fs.readFile(image.imagePath);
    parts.push({
      inline_data: {
        mime_type: image.mimeType,
        data: imageBytes.toString("base64"),
      },
    });
  }

  return requestGeminiJson({
    apiKey: options.apiKey,
    model: options.model,
    parts,
    generationConfig: options.generationConfig,
    timeoutMs: options.timeoutMs,
  });
}

function resolveTimeoutMs(timeoutMs?: number | string): number {
  return Number(timeoutMs ?? process.env.BLOG_AGENT_GEMINI_TIMEOUT_MS ?? 45000);
}

async function requestWithFetch(
  url: string,
  apiKey: string,
  body: string,
  timeoutMs?: number | string
): Promise<RawJson> {
  const controller = new AbortController();
  const timeout = resolveTimeoutMs(timeoutMs);
  const timeoutId =
    timeout > 0
      ? setTimeout(() => {
          controller.abort();
        }, timeout)
      : null;

  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body,
      signal: controller.signal,
    });
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim();
    const error: TransportError = new Error(
      `Gemini request failed: ${response.status}${detail ? ` ${detail.slice(0, 400)}` : ""}`
    );
    error.status = response.status;
    throw error;
  }

  return response.json();
}

// The API key is passed through a temporary header file (`--header @file`)
// instead of argv so it never shows up in `ps` output.
async function requestWithCurl(
  url: string,
  apiKey: string,
  body: string,
  timeoutMs?: number | string
): Promise<RawJson> {
  const timeout = resolveTimeoutMs(timeoutMs);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "blog-agent-"));
  const headerFile = path.join(tempDir, "headers");

  await fs.writeFile(
    headerFile,
    `Content-Type: application/json\nx-goog-api-key: ${apiKey}\n`,
    { encoding: "utf8", mode: 0o600 }
  );

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(
        "curl",
        [
          "--silent",
          "--show-error",
          "--fail-with-body",
          "--location",
          "--max-time",
          String(Math.max(1, Math.ceil(timeout / 1000))),
          "--request",
          "POST",
          "--header",
          `@${headerFile}`,
          "--data-binary",
          "@-",
          url,
        ],
        {
          stdio: ["pipe", "pipe", "pipe"],
        }
      );

      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeoutId =
        timeout > 0
          ? setTimeout(() => {
              settled = true;
              child.kill("SIGTERM");
              const error: TransportError = new Error(
                `Gemini curl request timed out after ${timeout}ms`
              );
              error.retryable = true;
              reject(error);
            }, timeout + 1000)
          : null;

      child.stdout.on("data", chunk => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", chunk => {
        stderr += chunk.toString();
      });

      child.on("error", error => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        reject(error);
      });

      child.on("close", code => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        if (code !== 0) {
          const statusMatch = stderr.match(/returned error: (\d{3})/u);
          const error: TransportError = new Error(
            stderr.trim() || stdout.trim() || `curl exited with code ${code}`
          );

          if (statusMatch) {
            error.status = Number(statusMatch[1]);
          }

          reject(error);
          return;
        }

        try {
          resolve(JSON.parse(stdout));
        } catch (error) {
          reject(
            new Error(
              `Gemini curl response is not valid JSON: ${formatError(error)}`
            )
          );
        }
      });

      child.stdin.end(body);
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

export function createGeminiProvider(
  options: Pick<GeminiRequestOptions, "apiKey" | "model"> = {}
): ReviewProvider {
  const gemini = resolveGeminiConfig(options);

  return {
    name: "gemini",
    model: gemini.model,
    prompt_version: REVIEW_PROMPT_VERSION,
    available: gemini.available,
    unavailable_reason: gemini.unavailable_reason,
    async generateReview(
      input: ReviewInput,
      context: MemoryContext
    ): Promise<Review> {
      const payload = await requestGeminiJson({
        apiKey: gemini.apiKey,
        model: gemini.model,
        prompt: buildPrompt(input, context),
        systemInstruction: buildSystemInstruction(),
        generationConfig: {
          responseSchema: REVIEW_RESPONSE_SCHEMA,
        },
      });

      return sanitizeReview(payload, input);
    },
    async generateFixes() {
      return { fixes: [] };
    },
  };
}
