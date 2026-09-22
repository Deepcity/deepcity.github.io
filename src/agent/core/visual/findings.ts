import {
  dedupeStrings,
  maxSeverity,
  roundConfidence,
} from "../../shared/utils.js";
import { VISUAL_ISSUE_CODES } from "./constants.js";
import { compactVisualText, toStringArray } from "./shared.js";
import type { RawJson } from "../../types.js";
import type { PageRecord, Rect, VisualIssue, VisualReview } from "./types.js";

function visualFieldToString(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map(visualFieldToString).filter(Boolean).join(" ");
  }

  if (typeof value === "object") {
    return Object.values(value)
      .map(visualFieldToString)
      .filter(Boolean)
      .join(" ");
  }

  return String(value);
}

function sanitizeIssueCode(value: unknown): string {
  const normalized = String(value ?? "unexpected-rendering")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  if (VISUAL_ISSUE_CODES.has(normalized)) {
    return normalized;
  }

  return normalized || "unexpected-rendering";
}

function normalizeVisualConfidence(value: unknown, fallback = 0.72): number {
  const numeric = Number(value);

  return roundConfidence(Number.isFinite(numeric) ? numeric : fallback);
}

function normalizeVisualIssueSource(value: unknown): string {
  const source = visualFieldToString(value)
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();

  if (!source) {
    return "gemini";
  }

  if (source.includes("local-check")) {
    return source.includes("gemini") || source.includes("visual")
      ? "gemini+local-check"
      : "local-check";
  }

  if (/local|hard|dom|browser/u.test(source)) {
    return "gemini+local-check";
  }

  return "gemini";
}

function normalizeIssueRect(value: unknown): Rect | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const rect: Rect = {
    x: Number(raw.x ?? raw.left),
    y: Number(raw.y ?? raw.top),
    width: Number(raw.width ?? raw.w),
    height: Number(raw.height ?? raw.h),
  };

  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }

  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function parseIssueRegionRect(value: unknown): Rect | null {
  const numbers = String(value ?? "")
    .match(/-?\d+(?:\.\d+)?/gu)
    ?.map(Number)
    .filter(Number.isFinite);

  if (!numbers || numbers.length < 4) {
    return null;
  }

  return normalizeIssueRect({
    x: numbers[0],
    y: numbers[1],
    width: numbers[2],
    height: numbers[3],
  });
}

function getIssueRect(issue: VisualIssue): Rect | null {
  return normalizeIssueRect(issue?.rect) ?? parseIssueRegionRect(issue?.region);
}

function rectOverlapRatio(left: Rect, right: Rect): number {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const width = Math.max(0, x2 - x1);
  const height = Math.max(0, y2 - y1);
  const intersection = width * height;
  const smallestArea = Math.min(
    left.width * left.height,
    right.width * right.height
  );

  if (smallestArea <= 0) {
    return 0;
  }

  return intersection / smallestArea;
}

function rectsReferToSameArea(left: Rect, right: Rect): boolean {
  const overlap = rectOverlapRatio(left, right);

  if (overlap >= 0.35) {
    return true;
  }

  const leftCenterX = left.x + left.width / 2;
  const leftCenterY = left.y + left.height / 2;
  const rightCenterX = right.x + right.width / 2;
  const rightCenterY = right.y + right.height / 2;

  return (
    Math.abs(leftCenterX - rightCenterX) <= 120 &&
    Math.abs(leftCenterY - rightCenterY) <= 80
  );
}

function isSpecificSelector(selector: unknown): boolean {
  const value = String(selector ?? "").trim();

  if (!value || ["img", "p", "text node", "span.katex-error"].includes(value)) {
    return false;
  }

  return value.includes("#") || value.includes("[") || value.includes(":nth");
}

function issuesReferToSameFinding(
  issue: VisualIssue,
  localIssue: VisualIssue
): boolean {
  if (issue.code !== localIssue.code) {
    return false;
  }

  const issueRect = getIssueRect(issue);
  const localRect = getIssueRect(localIssue);

  if (issueRect && localRect) {
    return rectsReferToSameArea(issueRect, localRect);
  }

  if (
    issue.message.includes(localIssue.message.slice(0, 48)) ||
    localIssue.message.includes(issue.message.slice(0, 48))
  ) {
    return true;
  }

  return (
    issue.selector_hint === localIssue.selector_hint &&
    isSpecificSelector(issue.selector_hint)
  );
}

function sanitizeVisualIssue(rawIssue: RawJson): VisualIssue | null {
  const severity = ["info", "warn", "error"].includes(rawIssue?.severity)
    ? rawIssue.severity
    : "warn";

  return {
    code: sanitizeIssueCode(rawIssue?.code),
    severity,
    message: String(rawIssue?.message ?? rawIssue?.summary ?? "")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 500),
    region:
      visualFieldToString(rawIssue?.region ?? rawIssue?.where) || "unknown",
    selector_hint: visualFieldToString(
      rawIssue?.selector_hint ?? rawIssue?.selector
    )
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 120),
    confidence: normalizeVisualConfidence(rawIssue?.confidence),
    source: normalizeVisualIssueSource(
      rawIssue?.source ?? rawIssue?.provenance
    ),
    evidence: visualFieldToString(rawIssue?.evidence)
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 220),
    rect: normalizeIssueRect(rawIssue?.rect ?? rawIssue?.bbox),
    fixable: false,
  };
}

function issueDedupKey(issue: VisualIssue): string {
  const rect = getIssueRect(issue);
  const location = rect
    ? [
        Math.round(rect.x / 24),
        Math.round(rect.y / 24),
        Math.round(rect.width / 24),
        Math.round(rect.height / 24),
      ].join(",")
    : issue.selector_hint || "";

  return [issue.code, location, compactVisualText(issue.message, 120)].join(
    "|"
  );
}

function localIssueToUnifiedFinding(issue: VisualIssue): VisualIssue {
  return {
    code: sanitizeIssueCode(issue?.code),
    severity: ["info", "warn", "error"].includes(issue?.severity)
      ? issue.severity
      : "warn",
    message: String(issue?.message ?? "")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 500),
    region: visualFieldToString(issue?.region) || "unknown",
    selector_hint: visualFieldToString(
      issue?.selector_hint ?? issue?.asset_hint
    )
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 120),
    confidence: 1,
    source: "local-check",
    evidence: visualFieldToString(issue?.latex_source ?? issue?.asset_hint)
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 220),
    rect: normalizeIssueRect(issue?.rect),
    fixable: false,
  };
}

export function mergeVisualFindings(
  reviewIssues: VisualIssue[] = [],
  localIssues: VisualIssue[] = []
): VisualIssue[] {
  const findings = [];
  const seen = new Set();

  for (const issue of reviewIssues) {
    const normalized = {
      ...issue,
      source: issue.source || "gemini",
    };
    const key = issueDedupKey(normalized);

    if (!seen.has(key)) {
      seen.add(key);
      findings.push(normalized);
    }
  }

  const linkedFindingIndexes = new Set();
  const reviewFindingCount = findings.length;

  for (const localIssue of localIssues.map(localIssueToUnifiedFinding)) {
    const sameCodeIndex = findings.findIndex((issue, index) => {
      if (!issuesReferToSameFinding(issue, localIssue)) {
        return false;
      }

      if (index >= reviewFindingCount || !linkedFindingIndexes.has(index)) {
        return true;
      }

      const issueRect = getIssueRect(issue);
      const localRect = getIssueRect(localIssue);

      return Boolean(
        issueRect && localRect && rectsReferToSameArea(issueRect, localRect)
      );
    });

    const sameCode = sameCodeIndex >= 0 ? findings[sameCodeIndex] : null;

    if (sameCode) {
      sameCode.source = sameCode.source?.includes("local-check")
        ? sameCode.source
        : `${sameCode.source || "gemini"}+local-check`;
      sameCode.severity = maxSeverity([sameCode.severity, localIssue.severity]);
      sameCode.confidence = Math.max(Number(sameCode.confidence ?? 0), 0.92);
      sameCode.evidence = sameCode.evidence || localIssue.evidence;
      sameCode.rect = sameCode.rect ?? localIssue.rect ?? null;
      if (sameCodeIndex < reviewFindingCount) {
        linkedFindingIndexes.add(sameCodeIndex);
      }
      continue;
    }

    const key = issueDedupKey(localIssue);

    if (!seen.has(key)) {
      seen.add(key);
      findings.push(localIssue);
    }
  }

  return findings.slice(0, 16);
}

export function sanitizeVisualReview(
  rawReview: RawJson,
  fallback: Partial<VisualReview> = {}
): VisualReview {
  const rawIssues: RawJson[] = Array.isArray(rawReview?.issues)
    ? rawReview.issues
    : [];
  const issues: VisualIssue[] = rawIssues
    .map(rawIssue => sanitizeVisualIssue(rawIssue))
    .filter((issue): issue is VisualIssue => Boolean(issue?.message))
    .slice(0, 10);
  const severity = maxSeverity([
    rawReview?.severity,
    ...issues.map(issue => issue.severity),
  ]);

  return {
    route_path: String(rawReview?.route_path ?? fallback.route_path ?? ""),
    summary: String(rawReview?.summary ?? "")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 600),
    severity,
    confidence: roundConfidence(Number(rawReview?.confidence ?? 0.72)),
    issues,
    action_items: dedupeStrings(toStringArray(rawReview?.action_items)).slice(
      0,
      8
    ),
    suggested_adjustments: dedupeStrings(
      toStringArray(
        rawReview?.suggested_adjustments ?? rawReview?.fix_suggestions
      )
    ).slice(0, 8),
  };
}

export function buildUnifiedVisualFindings(
  pageRecord: PageRecord
): VisualIssue[] {
  return mergeVisualFindings(
    pageRecord?.review?.issues ?? [],
    pageRecord?.hard_checks ?? []
  );
}
