import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Severity } from "../types.js";

const SEVERITY_RANK: Record<string, number> = {
  info: 0,
  warn: 1,
  error: 2,
};

export function normalizePathSlashes(value: string): string {
  return value.split(path.sep).join("/");
}

export function repoRelative(filePath: string, root: string): string {
  return normalizePathSlashes(path.relative(root, filePath));
}

export function severityValue(severity: string | null | undefined): number {
  return SEVERITY_RANK[severity ?? ""] ?? 0;
}

export function maxSeverity(
  values: Array<string | null | undefined>
): Severity {
  return values.reduce<Severity>(
    (current, value) =>
      severityValue(value) > severityValue(current)
        ? (value as Severity)
        : current,
    "info"
  );
}

export function dedupeStrings(
  values: Array<string | null | undefined>
): string[] {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

export function unique(values: Array<string | null | undefined>): string[] {
  return dedupeStrings(values);
}

export function truncateText(value: string, maxLength = 140): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function truncate(value: string, maxLength = 140): string {
  return truncateText(value, maxLength);
}

export function hashContent(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sha256(value: string): string {
  return hashContent(value);
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function roundConfidence(value: number): number {
  return Number(Math.min(0.99, Math.max(0.05, value)).toFixed(2));
}

export function sortByPublishedAt<T extends { published_at?: string | null }>(
  items: T[]
): T[] {
  return [...items].sort((left, right) => {
    const leftValue = left.published_at ?? "";
    const rightValue = right.published_at ?? "";

    return rightValue.localeCompare(leftValue);
  });
}

export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

export function stripMarkdownInline(value: string): string {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slugKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`"'()[\]{}]/g, "")
    .replace(/[^a-z0-9一-鿿]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export async function ensureDirectory(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export async function readTextFile(
  filePath: string,
  fallback: string | null = null
): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      return fallback;
    }
    throw error;
  }
}

export async function readJsonFile<T = unknown>(
  filePath: string,
  fallback: T | null = null
): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if (isEnoent(error)) {
      return fallback;
    }
    throw error;
  }
}

export async function writeJsonFile(
  filePath: string,
  value: unknown
): Promise<void> {
  await ensureDirectory(filePath);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function summarizeList(values: string[], maxItems = 3): string {
  if (values.length <= maxItems) {
    return values.join("，");
  }
  return `${values.slice(0, maxItems).join("，")} 等 ${values.length} 项`;
}
