// Types for the visual-check subsystem. Kept local to ./visual because these
// shapes are internal to the screenshot pipeline; the blog-wide contract types
// live in src/agent/types.ts.
import type { RawJson, Severity } from "../../types.js";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A page route discovered under `dist/`. */
export interface RouteEntry {
  route_path: string;
  html_path: string;
  html_path_relative: string;
}

/** One normalized visual issue, from either a local hard check or the model. */
export interface VisualIssue {
  code: string;
  severity: Severity;
  message: string;
  fixable?: boolean;
  region?: string | null;
  selector_hint?: string | null;
  confidence?: number;
  source?: string;
  evidence?: string | null;
  rect?: Rect | null;
  [key: string]: unknown;
}

export interface VisualReview {
  summary?: string;
  issues?: VisualIssue[];
  provider?: string;
  model?: string;
  confidence?: number;
  prompt_version?: string;
  cached?: boolean;
  [key: string]: unknown;
}

/**
 * One image handed to the multimodal review: the full page or an evidence
 * crop. The in-memory form carries `imagePath`/`mimeType`; the serialized form
 * stored on the page record uses `image_path`/`mime_type`.
 */
export interface ReviewImage {
  role: string;
  imagePath?: string;
  mimeType?: string;
  image_path?: string;
  mime_type?: string;
  issue_code?: string | null;
  issue_message?: string | null;
  selector_hint?: string | null;
  [key: string]: unknown;
}

/** Everything recorded for a single captured page. */
export interface PageRecord {
  page_id: string;
  route_path: string;
  html_path: string;
  url: string | null;
  title: string | null;
  capture_ok: boolean;
  screenshot_path: string | null;
  /** Absolute path, deleted from the manifest before it is written. */
  screenshot_path_abs?: string | null;
  screenshot_bytes: number | null;
  screenshot_sha256: string | null;
  html_sha256: string;
  dist_asset_sha256: string;
  render_input_sha256: string;
  viewport: { width: number; height: number };
  page_metrics: RawJson;
  browser_errors: RawJson[];
  hard_checks: VisualIssue[];
  local_findings_sha256: string;
  review: VisualReview | null;
  visual_findings?: VisualIssue[];
  /** Set by the safe-fix phase when a fix was written for this page. */
  visual_fixes_applied?: AppliedVisualFix[];
  /** Images attached to the Gemini review request for this page. */
  review_image_manifest?: ReviewImage[];
}

export interface VisualFont {
  available: boolean;
  source: string;
  path: string | null;
  error?: string | null;
}

export interface VisualFonts {
  cjk: VisualFont;
  cjkBold: VisualFont;
  emoji: VisualFont;
  css?: string;
}

export type VisualReviewMode = "changed" | "all" | "none";

/** Resolved once per run and threaded through every later phase. */
export interface VisualRunContext {
  runId: string;
  reviewMode: VisualReviewMode;
  viewport: { width: number; height: number };
  distRoot: string;
  runRoot: string;
  screenshotRoot: string;
  manifestPath: string;
  timeoutMs: number;
  geminiTimeoutMs: number;
  settleMs: number;
  previousManifest: VisualManifest | null;
  previousPagesByRoute: Map<string, PageRecord>;
  visualFonts: VisualFonts;
  visualFontRuntime: VisualFonts;
  visualFontFingerprint: { cjk: boolean; cjk_bold: boolean; emoji: boolean };
  build: RawJson;
  distAssetSha256: string;
  routes: RouteEntry[];
}

export interface VisualSummary {
  page_count: number;
  screenshot_count: number;
  reviewed_count: number;
  review_fresh_count: number;
  review_cached_count: number;
  issue_count: number;
  error_count: number;
  warn_count: number;
  visual_fix_count: number;
  highest_severity: Severity;
}

export interface AppliedVisualFix {
  code?: string;
  rule: string;
  message: string;
  before: string;
  after: string;
  /** Attached once the fix is matched back to its Markdown source. */
  source_path?: string;
  route_path?: string;
  [key: string]: unknown;
}

export interface VisualManifest {
  generated_at: string;
  run_id: string;
  run_mode: string;
  provider: string | null;
  model: string | null;
  review_mode: VisualReviewMode;
  visual_review_prompt_version: string;
  review_cache: {
    base_run_id: string | null;
    base_manifest_path: string | null;
  };
  degraded: boolean;
  degraded_reason: string | null;
  build: RawJson;
  dist_root: string;
  dist_asset_sha256: string;
  route_filter: RawJson;
  visual_font: Record<string, VisualFont>;
  screenshot_root: string;
  viewport: { width: number; height: number };
  gemini_timeout_ms: number;
  summary: VisualSummary;
  notes: string[];
  applied_fixes: AppliedVisualFix[];
  pages: PageRecord[];
  report_path?: string;
  report_markdown_path?: string;
  manifest_path?: string;
  /** Absolute paths, added to the value returned to the CLI. */
  latest_path?: string;
}

/** Resolved Gemini configuration for the visual review pass. */
export interface VisualGemini {
  available: boolean;
  provider: string | null;
  model: string | null;
  apiKey?: string | null;
  unavailable_reason: string | null;
  prompt_version?: string;
}

/** CLI-facing options; every field is optional and defaulted per run. */
export interface VisualCheckOptions {
  build?: boolean;
  distRoot?: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  skipGemini?: boolean;
  reviewMode?: string;
  maxPages?: number | string;
  route?: string | string[];
  routes?: string | string[];
  runId?: string;
  reviewBaseManifestPath?: string;
  applyVisualFixes?: boolean;
  timeoutMs?: number | string;
  geminiTimeoutMs?: number | string;
  settleMs?: number | string;
  viewport?: { width?: number; height?: number };
  onProgress?: (event: RawJson) => void;
}
