import path from "node:path";
import {
  requestGeminiImageJson,
  resolveGeminiConfig,
} from "../../providers/gemini.js";
import { REPO_ROOT } from "../../shared/constants.js";
import { normalizePathSlashes } from "../../shared/utils.js";
import { buildGeminiReviewImages } from "./capture.js";
import { canReuseVisualReview, reuseVisualReview } from "./cache.js";
import { VISUAL_REVIEW_PROMPT_VERSION } from "./constants.js";
import { sanitizeVisualReview } from "./findings.js";
import { emitVisualProgress } from "./shared.js";
import type { RawJson } from "../../types.js";
import type {
  PageRecord,
  ReviewImage,
  VisualCheckOptions,
  VisualFonts,
  VisualGemini,
  VisualReview,
  VisualRunContext,
} from "./types.js";

function buildGeminiVisualPrompt(pageRecord: PageRecord): string {
  const localFindings = (pageRecord.hard_checks ?? []).map(issue => ({
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    region: issue.region ?? null,
    selector_hint: issue.selector_hint ?? issue.asset_hint ?? null,
    evidence: issue.latex_source ?? issue.asset_hint ?? null,
  }));
  const evidenceCrops = (pageRecord.review_image_manifest ?? [])
    .filter((image: ReviewImage) => image.role === "evidence-crop")
    .map((image, index) => ({
      image_index: index + 2,
      issue_code: image.issue_code,
      issue_message: image.issue_message,
      selector_hint: image.selector_hint,
    }));

  return [
    "你是 Deepcity 博客的视觉 lint Agent。",
    "请根据截图和本地浏览器 hard-check 证据做统一显示纠错，只输出一个 JSON 对象，不要输出 Markdown。",
    "必须包含字段：route_path、summary、severity、confidence、issues、action_items、suggested_adjustments。",
    "issues 是数组，每项包含 code、severity、message、region、selector_hint、confidence、source、evidence。",
    "允许的 code 优先使用：visual-overlap、visual-clipping、visual-overflow、visual-contrast、visual-blank-space、broken-image、missing-image、broken-icon、navigation-layout、text-readability、responsive-layout、unexpected-rendering、math-render-error。",
    "重点检查：文字遮挡/截断、内容溢出、图片或图标缺失、对比度明显不可读、大片异常空白、导航/正文/页脚碰撞、排版层级混乱、公式渲染错误。",
    "公式渲染错误包括：KaTeX 红色错误文本、LaTeX 源码直接暴露（例如 \\begin{...} / \\end{...}）、公式符号明显错位或没有按数学排版呈现。",
    "local_findings 是浏览器 DOM / 网络层已验证的本地证据，不是另一份报告。请把这些证据纳入你的统一 issues；除非截图明确证明它是假阳性，否则不要忽略。",
    "图片 1 是全页概览；后续图片如果存在，是 local_findings 对应区域的高质量局部 crop，请优先用 crop 判断细节问题。",
    "不要评价文章观点、技术内容或写作质量；只处理截图可见的显示问题。",
    "如果看不到明确问题，返回 issues=[]，severity=info，并在 summary 说明未发现明显显示异常。",
    "",
    `route_path: ${pageRecord.route_path}`,
    `title: ${pageRecord.title || "(none)"}`,
    `viewport: ${pageRecord.viewport.width}x${pageRecord.viewport.height}`,
    `page_metrics: ${JSON.stringify(pageRecord.page_metrics ?? null)}`,
    `local_findings: ${JSON.stringify(localFindings)}`,
    `evidence_crops: ${JSON.stringify(evidenceCrops)}`,
  ].join("\n");
}

export async function reviewPageWithGemini(
  pageRecord: PageRecord,
  gemini: VisualGemini,
  options: { timeoutMs?: number } = {}
): Promise<VisualReview | null> {
  if (!pageRecord.screenshot_path_abs || pageRecord.capture_ok !== true) {
    return null;
  }

  const reviewImages = await buildGeminiReviewImages(pageRecord);
  pageRecord.review_image_manifest = reviewImages.map((image: RawJson) => ({
    role: image.role,
    issue_code: image.issue_code ?? null,
    issue_message: image.issue_message ?? null,
    selector_hint: image.selector_hint ?? null,
    image_path: normalizePathSlashes(path.relative(REPO_ROOT, image.imagePath)),
    mime_type: image.mimeType,
  }));

  const rawReview = await requestGeminiImageJson({
    apiKey: gemini.apiKey ?? undefined,
    model: gemini.model ?? undefined,
    images:
      reviewImages.length > 0
        ? reviewImages.map((image: RawJson) => ({
            imagePath: image.imagePath,
            mimeType: image.mimeType,
          }))
        : [
            {
              imagePath: pageRecord.screenshot_path_abs,
              mimeType: "image/png",
            },
          ],
    prompt: buildGeminiVisualPrompt(pageRecord),
    timeoutMs: options.timeoutMs,
  });

  const sanitized = sanitizeVisualReview(rawReview, {
    route_path: pageRecord.route_path,
  });

  return {
    ...sanitized,
    review_source: "gemini",
    cached: false,
    prompt_version: VISUAL_REVIEW_PROMPT_VERSION,
  };
}

export function resolveVisualGemini(
  options: VisualCheckOptions = {}
): VisualGemini {
  if (options.skipGemini === true || options.provider === "heuristic") {
    return {
      provider: options.provider === "heuristic" ? "heuristic" : "none",
      model: "none",
      available: false,
      apiKey: null,
      unavailable_reason:
        options.provider === "heuristic"
          ? "Gemini visual review skipped because provider=heuristic."
          : "Gemini visual review skipped by option.",
    };
  }

  const gemini = resolveGeminiConfig({
    apiKey: options.apiKey,
    model: options.model,
  });

  return {
    ...gemini,
    provider: "gemini",
  };
}

export function isGeminiTransportError(error: RawJson): boolean {
  const message = String(error?.message ?? error ?? "");

  return /fetch failed|timed out|timeout|curl|network|ECONN|ENOTFOUND|EAI_AGAIN|AbortError/iu.test(
    message
  );
}

// Notes explaining why screenshots may not look like a real browser.
export function buildVisualFontNotes(visualFonts: VisualFonts): string[] {
  const notes: string[] = [];

  if (!visualFonts.cjk.available) {
    notes.push(
      `CJK visual font unavailable (${visualFonts.cjk.error ?? visualFonts.cjk.source}); screenshots may show tofu boxes for Chinese text.`
    );
  }

  if (!visualFonts.cjkBold.available) {
    notes.push(
      `CJK bold visual font unavailable (${visualFonts.cjkBold.error ?? visualFonts.cjkBold.source}); semibold Chinese text may show tofu boxes.`
    );
  }

  if (!visualFonts.emoji.available) {
    notes.push(
      `Emoji visual font unavailable (${visualFonts.emoji.error ?? visualFonts.emoji.source}); screenshots may differ from browsers with native color emoji.`
    );
  }

  return notes;
}

// Phase 3: attach a review to every captured page, reusing the previous run's
// verdict when nothing that feeds the model changed. Mutates `pages` in place
// (each record gets `.review`) and appends to `notes`.
export async function reviewAllPages(
  pages: PageRecord[],
  ctx: VisualRunContext,
  gemini: VisualGemini,
  notes: string[],
  options: VisualCheckOptions = {}
): Promise<void> {
  const {
    reviewMode,
    previousManifest,
    previousPagesByRoute,
    geminiTimeoutMs,
  } = ctx;

  if (reviewMode === "none") {
    notes.push(
      "Gemini visual review skipped by review_mode=none; screenshots were archived without multimodal review."
    );
    return;
  }

  if (!gemini.available) {
    notes.push(
      `Gemini visual review unavailable (${gemini.unavailable_reason}); screenshots were archived without multimodal review.`
    );
    return;
  }

  for (const [index, pageRecord] of pages.entries()) {
    const previousPage = previousPagesByRoute.get(pageRecord.route_path);

    if (
      reviewMode === "changed" &&
      canReuseVisualReview(pageRecord, previousPage, previousManifest, gemini)
    ) {
      pageRecord.review = reuseVisualReview(previousPage, previousManifest);
      emitVisualProgress(options, {
        type: "review",
        index: index + 1,
        total: pages.length,
        route_path: pageRecord.route_path,
        ok: true,
        cached: true,
      });
      continue;
    }

    try {
      pageRecord.review = await reviewPageWithGemini(pageRecord, gemini, {
        timeoutMs: geminiTimeoutMs,
      });
      emitVisualProgress(options, {
        type: "review",
        index: index + 1,
        total: pages.length,
        route_path: pageRecord.route_path,
        ok: Boolean(pageRecord.review),
        cached: false,
      });
    } catch (error) {
      // A transport failure will hit every remaining page, so stop early
      // instead of burning the whole run on the same error.
      if (isGeminiTransportError(error)) {
        notes.push(
          `Gemini visual review disabled after provider transport failure for ${pageRecord.route_path}: ${error instanceof Error ? error.message : String(error)}`
        );
        break;
      }

      notes.push(
        `Gemini visual review failed for ${pageRecord.route_path}: ${error instanceof Error ? error.message : String(error)}`
      );
      emitVisualProgress(options, {
        type: "review",
        index: index + 1,
        total: pages.length,
        route_path: pageRecord.route_path,
        ok: false,
        cached: false,
      });
    }
  }
}
