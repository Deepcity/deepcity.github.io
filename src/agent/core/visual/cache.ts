import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT, VISUAL_LATEST_PATH } from "../../shared/constants.js";
import { fileExists } from "../../shared/fs.js";
import { isoNow, normalizePathSlashes } from "../../shared/utils.js";
import {
  VISUAL_REVIEW_PROMPT_VERSION,
  VISUAL_RUNTIME_ASSET_EXTENSIONS,
} from "./constants.js";
import { readJsonFile, sha256File, sha256Text } from "./shared.js";
import type { RawJson } from "../../types.js";
import type {
  PageRecord,
  VisualCheckOptions,
  VisualGemini,
  VisualManifest,
  VisualReview,
} from "./types.js";

export async function buildDistAssetFingerprint(
  distRoot: string
): Promise<string> {
  const files: string[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();

      if (
        extension === ".html" ||
        !VISUAL_RUNTIME_ASSET_EXTENSIONS.has(extension)
      ) {
        continue;
      }

      files.push(entryPath);
    }
  }

  await walk(distRoot);

  const hash = crypto.createHash("sha256");

  for (const filePath of files.sort()) {
    const relativePath = normalizePathSlashes(
      path.relative(distRoot, filePath)
    );
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await sha256File(filePath));
    hash.update("\0");
  }

  return hash.digest("hex");
}

export function buildRenderInputFingerprint(input: RawJson): string {
  return sha256Text(
    JSON.stringify({
      html_sha256: input.htmlSha256,
      dist_asset_sha256: input.distAssetSha256,
      viewport: input.viewport,
      visual_font: input.visualFont,
    })
  );
}

export function normalizeVisualReviewMode(value?: string): string {
  const mode = String(value ?? "changed")
    .trim()
    .toLowerCase();

  if (["all", "changed", "none"].includes(mode)) {
    return mode;
  }

  throw new Error("--review-mode must be one of: changed, all, none");
}

export async function loadPreviousVisualManifest(
  options: VisualCheckOptions = {}
): Promise<VisualManifest | null> {
  const manifestPath = options.reviewBaseManifestPath ?? VISUAL_LATEST_PATH;
  const manifest = await readJsonFile(manifestPath);

  if (!manifest || !Array.isArray(manifest.pages)) {
    return null;
  }

  for (const page of manifest.pages) {
    if (page.screenshot_sha256 || !page.screenshot_path) {
      continue;
    }

    const screenshotPath = path.join(REPO_ROOT, page.screenshot_path);

    if (await fileExists(screenshotPath)) {
      page.screenshot_sha256 = await sha256File(screenshotPath);
    }
  }

  return manifest;
}

export function canReuseVisualReview(
  pageRecord: PageRecord | null | undefined,
  previousPage: PageRecord | null | undefined,
  previousManifest: VisualManifest | null | undefined,
  gemini: VisualGemini | null | undefined
): boolean {
  if (!pageRecord || !previousPage || !previousManifest || !gemini) {
    return false;
  }

  if (!previousPage.review || pageRecord.capture_ok !== true) {
    return false;
  }

  if (pageRecord.route_path !== previousPage.route_path) {
    return false;
  }

  const currentHasLocalFindings = (pageRecord.hard_checks?.length ?? 0) > 0;
  const previousHasLocalFindings = (previousPage.hard_checks?.length ?? 0) > 0;

  if (
    (currentHasLocalFindings || previousHasLocalFindings) &&
    pageRecord.local_findings_sha256 !== previousPage.local_findings_sha256
  ) {
    return false;
  }

  if (pageRecord.render_input_sha256 && previousPage.render_input_sha256) {
    if (pageRecord.render_input_sha256 !== previousPage.render_input_sha256) {
      return false;
    }
  } else if (
    !pageRecord.screenshot_sha256 ||
    pageRecord.screenshot_sha256 !== previousPage.screenshot_sha256
  ) {
    return false;
  }

  if (previousManifest.provider !== gemini.provider) {
    return false;
  }

  if (previousManifest.model !== gemini.model) {
    return false;
  }

  const previousPromptVersion =
    previousManifest.visual_review_prompt_version ??
    previousPage.review?.prompt_version ??
    VISUAL_REVIEW_PROMPT_VERSION;

  if (previousPromptVersion !== VISUAL_REVIEW_PROMPT_VERSION) {
    return false;
  }

  const previousViewport = previousPage.viewport ?? previousManifest.viewport;

  return (
    Number(pageRecord.viewport?.width) === Number(previousViewport?.width) &&
    Number(pageRecord.viewport?.height) === Number(previousViewport?.height)
  );
}

export function reuseVisualReview(
  previousPage: PageRecord | undefined,
  previousManifest: VisualManifest | null
): VisualReview | null {
  if (!previousPage?.review || !previousManifest) {
    return null;
  }

  return {
    ...previousPage.review,
    review_source: "cache",
    cached: true,
    prompt_version: VISUAL_REVIEW_PROMPT_VERSION,
    reused_from_run_id: previousManifest.run_id ?? null,
    reused_at: isoNow(),
  };
}
