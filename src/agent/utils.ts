// @ts-nocheck
import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SEVERITY_RANK = {
  info: 0,
  warn: 1,
  error: 2,
};

export function normalizePathSlashes(value) {
  return value.split(path.sep).join("/");
}

export function repoRelative(filePath, root) {
  return normalizePathSlashes(path.relative(root, filePath));
}

export function severityValue(severity) {
  return SEVERITY_RANK[severity] ?? 0;
}

export function maxSeverity(values) {
  return values.reduce(
    (current, value) =>
      severityValue(value) > severityValue(current) ? value : current,
    "info"
  );
}

export function dedupeStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

export function unique(values) {
  return dedupeStrings(values);
}

export function truncateText(value, maxLength = 140) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function truncate(value, maxLength = 140) {
  return truncateText(value, maxLength);
}

export function hashContent(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256(value) {
  return hashContent(value);
}

export function isoNow() {
  return new Date().toISOString();
}

export function roundConfidence(value) {
  return Number(Math.min(0.99, Math.max(0.05, value)).toFixed(2));
}

export function sortByPublishedAt(items) {
  return [...items].sort((left, right) => {
    const leftValue = left.published_at ?? "";
    const rightValue = right.published_at ?? "";

    return rightValue.localeCompare(leftValue);
  });
}

export function normalizeNewlines(value) {
  return value.replace(/\r\n?/g, "\n");
}

export function stripMarkdownInline(value) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugKey(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`"'()[\]{}]/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export async function ensureDirectory(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export async function readTextFile(filePath, fallback = null) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return fallback;
    }
    throw error;
  }
}

export async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return fallback;
    }
    throw error;
  }
}

export async function writeJsonFile(filePath, value) {
  await ensureDirectory(filePath);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

export function summarizeList(values, maxItems = 3) {
  if (values.length <= maxItems) {
    return values.join("，");
  }
  return `${values.slice(0, maxItems).join("，")} 等 ${values.length} 项`;
}
