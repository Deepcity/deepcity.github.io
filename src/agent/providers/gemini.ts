// @ts-nocheck
import fs from "node:fs/promises";
import { spawn } from "node:child_process";
import { DEFAULT_MODEL } from "../shared/constants.js";
import { dedupeStrings, roundConfidence } from "../shared/utils.js";

function findJsonObject(text) {
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

export function extractJsonPayload(text) {
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

function sanitizePublicCommentary(value) {
  return String(value ?? "")
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/^#{1,6}\s+/gmu, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/<[^>]*>/gu, "")
    .trim()
    .slice(0, 900);
}

function toStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(String);
}

function sanitizeRelatedPostIds(rawReview, input) {
  const allowedIds = new Set(
    (input.knowledge?.related_posts ?? []).map(post => post.post_id)
  );
  const rawIds = [
    ...toStringArray(rawReview.related_post_ids),
    ...(Array.isArray(rawReview.related_posts)
      ? rawReview.related_posts
      : []
    ).map(item => (typeof item === "string" ? item : item?.post_id)),
  ];

  return dedupeStrings(rawIds.map(String)).filter(postId =>
    allowedIds.has(postId)
  );
}

function sanitizeReview(rawReview, input) {
  const summary = String(rawReview.summary ?? "").trim();
  const publicCommentary =
    sanitizePublicCommentary(rawReview.public_commentary) ||
    sanitizePublicCommentary(summary);

  return {
    public_commentary: publicCommentary,
    related_post_ids: sanitizeRelatedPostIds(rawReview, input),
    summary,
    structural_review: String(rawReview.structural_review ?? "").trim(),
    technical_review: String(rawReview.technical_review ?? "").trim(),
    strengths: dedupeStrings(toStringArray(rawReview.strengths)).slice(0, 5),
    concerns: dedupeStrings(toStringArray(rawReview.concerns)).slice(0, 6),
    action_items: dedupeStrings(toStringArray(rawReview.action_items)).slice(
      0,
      6
    ),
    severity: ["info", "warn", "error"].includes(rawReview.severity)
      ? rawReview.severity
      : "warn",
    confidence: roundConfidence(Number(rawReview.confidence ?? 0.72)),
    memory_refs: dedupeStrings(toStringArray(rawReview.memory_refs)).slice(
      0,
      8
    ),
  };
}

function buildPrompt(input, context) {
  const knowledge = input.knowledge ?? null;
  const allowedRelatedPosts = (knowledge?.related_posts ?? []).map(post => ({
    post_id: post.post_id,
    title: post.title,
    relation: post.relation,
  }));

  return [
    "你是 Deepcity 博客的审稿 Agent。",
    "请只输出一个 JSON 对象，不要输出 Markdown。",
    "必须包含字段：public_commentary、related_post_ids、summary、structural_review、technical_review、strengths、concerns、action_items、severity、confidence、memory_refs。",
    "public_commentary 是给读者看的公开旁批，使用中文，2-4 段，总长约 300-700 字。",
    "public_commentary 可以尖锐但不要刻薄；优先结合文章在系列/知识网络中的位置、技术论证缺口、读者背景补充和一条轻微风趣旁批。",
    "public_commentary 只允许普通段落、短无序列表、加粗、斜体、行内代码；不要写标题、表格、代码块、图片、HTML 或 Markdown 链接。",
    "related_post_ids 只能从 allowed_related_posts 里的 post_id 选择，最多 3 个；不要虚构文章或路径。",
    "summary 用中文，控制在 120 字以内。",
    "strengths、concerns、action_items 都是字符串数组，每项一句话。",
    "",
    `文章标题: ${input.post.title}`,
    `文章 tags: ${input.post.tags.join(", ") || "(none)"}`,
    `文章摘要: ${input.post.description || "(none)"}`,
    `Agent 试验标识: ${input.post.agentExperiment ? input.post.agentExperimentNote || "这是用于调试新审稿架构的试验样本；评价时请明确区分真实内容问题与试验集迁移问题。" : "(none)"}`,
    `结构统计: headings=${input.analysis.headings.length}, code_fences=${input.analysis.codeFences.length}, images=${input.analysis.images.length}, links=${input.analysis.linkCount}`,
    `硬校验问题: ${input.issues.map(issue => `${issue.severity}:${issue.message}`).join(" | ") || "(none)"}`,
    `已有 action items: ${input.actionItems.join(" | ") || "(none)"}`,
    `相关 memory refs: ${(context.refs ?? []).join(", ") || "(none)"}`,
    `相关 series memory: ${JSON.stringify(context.series ?? null)}`,
    `相关 topics memory: ${JSON.stringify(context.topics ?? [])}`,
    `知识网络位置: ${JSON.stringify(knowledge ?? null)}`,
    `allowed_related_posts: ${JSON.stringify(allowedRelatedPosts)}`,
    "",
    "正文摘要片段：",
    input.post.excerpt || "(empty)",
  ].join("\n");
}

function buildRequestPayload(parts, generationConfig = {}) {
  return JSON.stringify({
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

function buildTextRequestPayload(prompt) {
  return buildRequestPayload([{ text: prompt }]);
}

function formatError(error) {
  if (!error) {
    return "unknown error";
  }

  if (typeof error === "string") {
    return error;
  }

  const message = error.message ?? String(error);
  const cause = error.cause?.message;

  return cause && cause !== message ? `${message}; cause: ${cause}` : message;
}

function isTimeoutError(error) {
  const name = String(error?.name ?? "");
  const message = String(error?.message ?? error ?? "");

  return (
    name === "AbortError" || /timed out|timeout|aborted|abort/iu.test(message)
  );
}

function hasProxyEnv() {
  return Boolean(
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy ||
    process.env.all_proxy
  );
}

export function resolveGeminiConfig(options = {}) {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  const model = options.model ?? process.env.BLOG_AGENT_MODEL ?? DEFAULT_MODEL;

  return {
    apiKey,
    model,
    available: Boolean(apiKey),
    unavailable_reason: apiKey ? null : "Missing GEMINI_API_KEY",
  };
}

export async function requestGeminiJson(options = {}) {
  const gemini = resolveGeminiConfig(options);

  if (!gemini.apiKey) {
    throw new Error("GEMINI_API_KEY is required for Gemini provider");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${gemini.model}:generateContent?key=${gemini.apiKey}`;
  const body = options.parts
    ? buildRequestPayload(options.parts, options.generationConfig)
    : buildTextRequestPayload(String(options.prompt ?? ""));
  let payload;
  const preferCurl = options.preferCurl ?? hasProxyEnv();

  if (preferCurl) {
    try {
      payload = await requestWithCurl(url, body, options.timeoutMs);
    } catch (curlError) {
      try {
        payload = await requestWithFetch(url, body, options.timeoutMs);
      } catch (fetchError) {
        throw new Error(
          `Gemini request failed via curl (${formatError(curlError)}) and fetch (${formatError(fetchError)})`
        );
      }
    }
  } else {
    try {
      payload = await requestWithFetch(url, body, options.timeoutMs);
    } catch (fetchError) {
      if (isTimeoutError(fetchError)) {
        throw new Error(`Gemini request timed out: ${formatError(fetchError)}`);
      }

      try {
        payload = await requestWithCurl(url, body, options.timeoutMs);
      } catch (curlError) {
        throw new Error(
          `Gemini request failed via fetch (${formatError(fetchError)}) and curl (${formatError(curlError)})`
        );
      }
    }
  }

  const text = payload.candidates?.[0]?.content?.parts
    ?.map(part => part.text ?? "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini returned an empty review");
  }

  return extractJsonPayload(text);
}

export async function requestGeminiImageJson(options = {}) {
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

  const parts = [{ text: String(options.prompt ?? "") }];

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

async function requestWithFetch(url, body, timeoutMs) {
  const controller = new AbortController();
  const timeout = Number(
    timeoutMs ?? process.env.BLOG_AGENT_GEMINI_TIMEOUT_MS ?? 45000
  );
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
    throw new Error(
      `Gemini request failed: ${response.status}${detail ? ` ${detail}` : ""}`
    );
  }

  return response.json();
}

function requestWithCurl(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = Number(
      timeoutMs ?? process.env.BLOG_AGENT_GEMINI_TIMEOUT_MS ?? 45000
    );
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
        "Content-Type: application/json",
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
            reject(
              new Error(`Gemini curl request timed out after ${timeout}ms`)
            );
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
        reject(
          new Error(
            stderr.trim() || stdout.trim() || `curl exited with code ${code}`
          )
        );
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
}

export function createGeminiProvider(options = {}) {
  const gemini = resolveGeminiConfig(options);

  return {
    name: "gemini",
    model: gemini.model,
    available: gemini.available,
    unavailable_reason: gemini.unavailable_reason,
    async generateReview(input, context) {
      const payload = await requestGeminiJson({
        apiKey: gemini.apiKey,
        model: gemini.model,
        prompt: buildPrompt(input, context),
      });

      return sanitizeReview(payload, input);
    },
    async generateFixes() {
      return { fixes: [] };
    },
  };
}
