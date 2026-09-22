// Orchestrator for `./agent visual-check`. Sequences five phases, each owned
// by a module under ./visual/: resolve the run context, capture every page,
// review the screenshots, apply safe fixes, then write the manifest and
// reports. Implementation detail lives in those modules, not here.
import path from "node:path";
import { REPO_ROOT, VISUAL_LATEST_PATH } from "../shared/constants.js";
import { writeJson } from "../shared/fs.js";
import { normalizePathSlashes } from "../shared/utils.js";
import { captureAllPages } from "./visual/capture.js";
import { buildUnifiedVisualFindings } from "./visual/findings.js";
import { applyVisualSafeFixes } from "./visual/fixes.js";
import { buildVisualManifest } from "./visual/manifest.js";
import { writeVisualReports } from "./visual/report.js";
import {
  buildVisualFontNotes,
  resolveVisualGemini,
  reviewAllPages,
} from "./visual/review.js";
import { resolveVisualRunContext } from "./visual/run-context.js";
import { emitVisualProgress } from "./visual/shared.js";
import type { VisualCheckOptions, VisualManifest } from "./visual/types.js";

// Public surface kept stable for scripts/blog-agent.ts and tests/.
export { canReuseVisualReview } from "./visual/cache.js";
export {
  buildMathRenderIssuesFromMetrics,
  resolvePlaywrightProxyConfig,
} from "./visual/capture.js";
export { VISUAL_REVIEW_PROMPT_VERSION } from "./visual/constants.js";
export {
  mergeVisualFindings,
  sanitizeVisualReview,
} from "./visual/findings.js";
export { applyLatexVisualSafeFixesToMarkdown } from "./visual/fixes.js";
export {
  buildVisualCheckSummary,
  writeVisualReports,
} from "./visual/report.js";
export {
  collectStaticHtmlRoutes,
  filterStaticHtmlRoutes,
  routeToVisualArtifactName,
} from "./visual/routes.js";

export async function runVisualCheck(
  options: VisualCheckOptions = {}
): Promise<VisualManifest> {
  const ctx = await resolveVisualRunContext(options);

  emitVisualProgress(options, {
    type: "start",
    total: ctx.routes.length,
  });

  const pages = await captureAllPages(ctx, options);
  const gemini = resolveVisualGemini(options);
  const notes = buildVisualFontNotes(ctx.visualFonts);

  await reviewAllPages(pages, ctx, gemini, notes, options);

  for (const pageRecord of pages) {
    pageRecord.visual_findings = buildUnifiedVisualFindings(pageRecord);
  }

  const appliedFixes = await applyVisualSafeFixes(pages, {
    applyVisualFixes: options.applyVisualFixes,
  });

  if (appliedFixes.length > 0) {
    notes.push(
      `Applied ${appliedFixes.length} visual safe fix(es) to Markdown sources. Rebuild and rerun visual-check to verify screenshots.`
    );
  }

  // Absolute screenshot paths are only needed while cropping evidence images.
  for (const pageRecord of pages) {
    delete pageRecord.screenshot_path_abs;
  }

  const manifest = buildVisualManifest({
    ctx,
    pages,
    gemini,
    notes,
    appliedFixes,
    options,
  });
  const reportPaths = await writeVisualReports(manifest, ctx.runRoot);
  manifest.report_path = normalizePathSlashes(
    path.relative(REPO_ROOT, reportPaths.htmlPath)
  );
  manifest.report_markdown_path = normalizePathSlashes(
    path.relative(REPO_ROOT, reportPaths.markdownPath)
  );

  await writeJson(ctx.manifestPath, manifest);
  await writeJson(VISUAL_LATEST_PATH, {
    ...manifest,
    manifest_path: normalizePathSlashes(
      path.relative(REPO_ROOT, ctx.manifestPath)
    ),
  });

  return {
    ...manifest,
    manifest_path: ctx.manifestPath,
    latest_path: VISUAL_LATEST_PATH,
    report_path: reportPaths.htmlPath,
    report_markdown_path: reportPaths.markdownPath,
  };
}
