import crypto from "node:crypto";
import fs from "node:fs/promises";
import type { RawJson, Severity } from "../../types.js";
import type { VisualCheckOptions, VisualIssue } from "./types.js";

export async function sha256File(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function sha256Text(value: unknown): string {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export async function readJsonFile<T = RawJson>(
  filePath: string
): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function makeIssue(
  code: string,
  severity: string,
  message: unknown,
  extra: Record<string, unknown> = {}
): VisualIssue {
  return {
    code,
    severity: (["info", "warn", "error"].includes(severity)
      ? severity
      : "warn") as Severity,
    message: String(message ?? "").slice(0, 500),
    fixable: false,
    ...extra,
  };
}

export function compactVisualText(value: unknown, maxLength = 180): string {
  const normalized = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(String);
}

export function htmlEscape(value: unknown): string {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

export function reportTruncate(value: unknown, maxLength = 180): string {
  const normalized = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function severityRank(severity: string): number {
  return (
    ({ error: 2, warn: 1, info: 0 } as Record<string, number>)[severity] ?? 0
  );
}

// Best-effort progress callback shared by the capture and review phases.
export function emitVisualProgress(
  options: VisualCheckOptions,
  event: RawJson
): void {
  if (typeof options.onProgress !== "function") {
    return;
  }

  try {
    options.onProgress(event);
  } catch {
    // Progress callbacks are best-effort and must not affect lint results.
  }
}
