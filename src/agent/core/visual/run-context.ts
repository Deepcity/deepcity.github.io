// Phase 1 of `visual-check`: resolve everything the later phases need before
// a browser is launched — run paths, review mode, fonts, the built site and
// the route list. Kept side-effect-light apart from the optional site build.
import path from "node:path";
import { DIST_ROOT, VISUAL_RUNS_ROOT } from "../../shared/constants.js";
import { maybeBuildSite } from "./build.js";
import {
  buildDistAssetFingerprint,
  loadPreviousVisualManifest,
  normalizeVisualReviewMode,
} from "./cache.js";
import { AGENT_VISUAL_FONT_ROUTE, DEFAULT_VIEWPORT } from "./constants.js";
import {
  collectStaticHtmlRoutes,
  filterStaticHtmlRoutes,
  sanitizeRunId,
} from "./routes.js";
import { buildVisualFontCss, resolveVisualFonts } from "./server.js";
import type {
  VisualCheckOptions,
  VisualManifest,
  VisualReviewMode,
  VisualRunContext,
} from "./types.js";

export async function resolveVisualRunContext(
  options: VisualCheckOptions = {}
): Promise<VisualRunContext> {
  const runId = sanitizeRunId(options.runId);
  const reviewMode =
    options.skipGemini === true
      ? "none"
      : (normalizeVisualReviewMode(options.reviewMode) as VisualReviewMode);
  const viewport = {
    width: Number(options.viewport?.width ?? DEFAULT_VIEWPORT.width),
    height: Number(options.viewport?.height ?? DEFAULT_VIEWPORT.height),
  };
  const distRoot = options.distRoot ?? DIST_ROOT;
  const runRoot = path.join(VISUAL_RUNS_ROOT, runId);
  const screenshotRoot = path.join(runRoot, "screenshots");
  const manifestPath = path.join(runRoot, "manifest.json");
  const timeoutMs = Number(options.timeoutMs ?? 30000);
  const geminiTimeoutMs = Number(options.geminiTimeoutMs ?? 60000);
  const settleMs = Number(options.settleMs ?? 600);
  const previousManifest =
    reviewMode === "changed"
      ? ((await loadPreviousVisualManifest(options)) as VisualManifest | null)
      : null;
  const previousPagesByRoute = new Map(
    (previousManifest?.pages ?? []).map(
      page => [page.route_path, page] as const
    )
  );
  const visualFonts = await resolveVisualFonts(options);
  // Only inject the @font-face CSS when a font actually resolved, so the
  // fingerprint below stays stable for runs without local CJK fonts.
  const visualFontRuntime =
    visualFonts.cjk.available || visualFonts.emoji.available
      ? {
          ...visualFonts,
          css: buildVisualFontCss(AGENT_VISUAL_FONT_ROUTE),
        }
      : visualFonts;
  const visualFontFingerprint = {
    cjk: Boolean(visualFonts.cjk.available),
    cjk_bold: Boolean(visualFonts.cjkBold.available),
    emoji: Boolean(visualFonts.emoji.available),
  };
  const build = await maybeBuildSite(options);
  const distAssetSha256 = await buildDistAssetFingerprint(distRoot);
  let routes = await collectStaticHtmlRoutes(distRoot);
  routes = filterStaticHtmlRoutes(routes, options.route ?? options.routes);

  if (
    Number.isFinite(Number(options.maxPages)) &&
    Number(options.maxPages) > 0
  ) {
    routes = routes.slice(0, Number(options.maxPages));
  }

  return {
    runId,
    reviewMode,
    viewport,
    distRoot,
    runRoot,
    screenshotRoot,
    manifestPath,
    timeoutMs,
    geminiTimeoutMs,
    settleMs,
    previousManifest,
    previousPagesByRoute,
    visualFonts,
    visualFontRuntime,
    visualFontFingerprint,
    build,
    distAssetSha256,
    routes,
  };
}
