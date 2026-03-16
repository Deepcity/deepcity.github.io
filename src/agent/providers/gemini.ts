// @ts-nocheck
import { DEFAULT_MODEL } from "../constants.js";
import { dedupeStrings, roundConfidence } from "../utils.js";

function extractJsonPayload(text) {
  const normalized = text
    .trim()
    .replace(/^```json\s*/u, "")
    .replace(/```$/u, "");

  try {
    return JSON.parse(normalized);
  } catch {
    const match = normalized.match(/\{[\s\S]*\}/u);

    if (!match) {
      throw new Error("Gemini response is not valid JSON");
    }

    return JSON.parse(match[0]);
  }
}

function sanitizeReview(rawReview) {
  return {
    summary: String(rawReview.summary ?? "").trim(),
    structural_review: String(rawReview.structural_review ?? "").trim(),
    technical_review: String(rawReview.technical_review ?? "").trim(),
    strengths: dedupeStrings((rawReview.strengths ?? []).map(String)).slice(
      0,
      5
    ),
    concerns: dedupeStrings((rawReview.concerns ?? []).map(String)).slice(0, 6),
    action_items: dedupeStrings(
      (rawReview.action_items ?? []).map(String)
    ).slice(0, 6),
    severity: ["info", "warn", "error"].includes(rawReview.severity)
      ? rawReview.severity
      : "warn",
    confidence: roundConfidence(Number(rawReview.confidence ?? 0.72)),
    memory_refs: dedupeStrings((rawReview.memory_refs ?? []).map(String)).slice(
      0,
      8
    ),
  };
}

function buildPrompt(input, context) {
  return [
    "你是 Deepcity 博客的审稿 Agent。",
    "请只输出一个 JSON 对象，不要输出 Markdown。",
    "必须包含字段：summary、structural_review、technical_review、strengths、concerns、action_items、severity、confidence、memory_refs。",
    "summary 用中文，控制在 120 字以内。",
    "strengths、concerns、action_items 都是字符串数组，每项一句话。",
    "",
    `文章标题: ${input.post.title}`,
    `文章 tags: ${input.post.tags.join(", ") || "(none)"}`,
    `文章摘要: ${input.post.description || "(none)"}`,
    `结构统计: headings=${input.analysis.headings.length}, code_fences=${input.analysis.codeFences.length}, images=${input.analysis.images.length}, links=${input.analysis.linkCount}`,
    `硬校验问题: ${input.issues.map(issue => `${issue.severity}:${issue.message}`).join(" | ") || "(none)"}`,
    `已有 action items: ${input.actionItems.join(" | ") || "(none)"}`,
    `相关 memory refs: ${(context.refs ?? []).join(", ") || "(none)"}`,
    `相关 series memory: ${JSON.stringify(context.series ?? null)}`,
    `相关 topics memory: ${JSON.stringify(context.topics ?? [])}`,
    "",
    "正文摘要片段：",
    input.post.excerpt || "(empty)",
  ].join("\n");
}

export function createGeminiProvider(options = {}) {
  const apiKey = options.apiKey ?? process.env.GEMINI_API_KEY;
  const model = options.model ?? process.env.BLOG_AGENT_MODEL ?? DEFAULT_MODEL;

  return {
    name: "gemini",
    model,
    available: Boolean(apiKey),
    unavailable_reason: apiKey ? null : "Missing GEMINI_API_KEY",
    async generateReview(input, context) {
      if (!apiKey) {
        throw new Error("GEMINI_API_KEY is required for Gemini provider");
      }

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            generationConfig: {
              responseMimeType: "application/json",
            },
            contents: [
              {
                role: "user",
                parts: [{ text: buildPrompt(input, context) }],
              },
            ],
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Gemini request failed: ${response.status}`);
      }

      const payload = await response.json();
      const text = payload.candidates?.[0]?.content?.parts
        ?.map(part => part.text ?? "")
        .join("")
        .trim();

      if (!text) {
        throw new Error("Gemini returned an empty review");
      }

      return sanitizeReview(extractJsonPayload(text));
    },
    async generateFixes() {
      return { fixes: [] };
    },
  };
}
