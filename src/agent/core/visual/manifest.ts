// Phase 5: assemble the run manifest. This is the machine-readable record of
// a visual-check run and the input to the HTML/Markdown reports, so every
// path in it is stored repo-relative to stay portable across machines.
import path from "node:path";
import { REPO_ROOT, VISUAL_LATEST_PATH } from "../../shared/constants.js";
import { isoNow, normalizePathSlashes } from "../../shared/utils.js";
import { VISUAL_REVIEW_PROMPT_VERSION } from "./constants.js";
import { buildVisualCheckSummary } from "./report.js";
import type {
  AppliedVisualFix,
  PageRecord,
  VisualCheckOptions,
  VisualFont,
  VisualGemini,
  VisualManifest,
  VisualRunContext,
} from "./types.js";

function describeFont(font: VisualFont): VisualFont {
  return {
    available: font.available,
    source: font.source,
    path: font.path,
    error: font.error ?? null,
  };
}

export function buildVisualManifest({
  ctx,
  pages,
  gemini,
  notes,
  appliedFixes,
  options = {},
}: {
  ctx: VisualRunContext;
  pages: PageRecord[];
  gemini: VisualGemini;
  notes: string[];
  appliedFixes: AppliedVisualFix[];
  options?: VisualCheckOptions;
}): VisualManifest {
  const {
    runId,
    reviewMode,
    viewport,
    distRoot,
    screenshotRoot,
    distAssetSha256,
    geminiTimeoutMs,
    previousManifest,
    visualFonts,
    build,
  } = ctx;

  return {
    generated_at: isoNow(),
    run_id: runId,
    run_mode: "visual-check",
    provider: gemini.provider,
    model: gemini.model,
    review_mode: reviewMode,
    visual_review_prompt_version: VISUAL_REVIEW_PROMPT_VERSION,
    review_cache: {
      base_run_id: previousManifest?.run_id ?? null,
      base_manifest_path:
        reviewMode === "changed"
          ? normalizePathSlashes(
              path.relative(
                REPO_ROOT,
                options.reviewBaseManifestPath ?? VISUAL_LATEST_PATH
              )
            )
          : null,
    },
    degraded: !gemini.available || notes.length > 0,
    degraded_reason: !gemini.available ? gemini.unavailable_reason : null,
    build,
    dist_root: normalizePathSlashes(path.relative(REPO_ROOT, distRoot)),
    dist_asset_sha256: distAssetSha256,
    route_filter: options.route ?? options.routes ?? null,
    visual_font: {
      cjk: describeFont(visualFonts.cjk),
      cjk_bold: describeFont(visualFonts.cjkBold),
      emoji: describeFont(visualFonts.emoji),
    },
    screenshot_root: normalizePathSlashes(
      path.relative(REPO_ROOT, screenshotRoot)
    ),
    viewport,
    gemini_timeout_ms: geminiTimeoutMs,
    summary: buildVisualCheckSummary(pages, appliedFixes),
    notes,
    applied_fixes: appliedFixes,
    pages,
  };
}
