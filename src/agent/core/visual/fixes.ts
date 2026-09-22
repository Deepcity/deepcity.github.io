import fs from "node:fs/promises";
import path from "node:path";
import { BLOG_ROOT, REPO_ROOT } from "../../shared/constants.js";
import { listMarkdownFiles } from "../../shared/fs.js";
import { getRoutePathFromFile } from "../../shared/pathing.js";
import { isoNow, normalizePathSlashes } from "../../shared/utils.js";
import { buildUnifiedVisualFindings } from "./findings.js";
import { reportTruncate } from "./shared.js";
import type { AppliedVisualFix, PageRecord } from "./types.js";

function pushVisualFix(
  fixes: AppliedVisualFix[],
  rule: string,
  message: string,
  before: string,
  after: string
): void {
  if (before === after) {
    return;
  }

  fixes.push({
    code: "latex-render-fix",
    rule,
    message,
    before: reportTruncate(before, 260),
    after: reportTruncate(after, 260),
  });
}

function normalizeLatexAlignmentBody(body: string): string {
  return String(body ?? "")
    .replace(/&=&/gu, "&=")
    .replace(/([A-Za-z]+)_([\p{Script=Han}]+)/gu, "$1_{\\text{$2}}");
}

function escapeTextCommandUnderscores(
  source: string,
  fixes: AppliedVisualFix[]
): string {
  return String(source ?? "").replace(/\\text\{([^{}]*)\}/gu, match => {
    const escaped = match.replace(/(?<!\\)_/gu, "\\_");

    pushVisualFix(
      fixes,
      "escape-text-underscore",
      "转义数学公式 \\text{...} 内的裸下划线，避免 KaTeX 把普通文本当作下标解析。",
      match,
      escaped
    );

    return escaped;
  });
}

export function applyLatexVisualSafeFixesToMarkdown(source: string): {
  content: string;
  fixes: AppliedVisualFix[];
} {
  let next = String(source ?? "");
  const fixes: AppliedVisualFix[] = [];

  const escapedText = escapeTextCommandUnderscores(next, fixes);
  next = escapedText;

  const eqnarrayFixed = next.replace(
    /(\$\$\s*\n?)\\begin\{eqnarray\*?\}([\s\S]*?)\\end\{eqnarray\*?\}(\s*\n?\$\$)/gu,
    (match, open, body, close) => {
      const replacement = `${open}\\begin{aligned}${normalizeLatexAlignmentBody(body)}\\end{aligned}${close}`;
      pushVisualFix(
        fixes,
        "eqnarray-to-aligned",
        "将 KaTeX 不支持的 eqnarray 环境改为 display math 内可渲染的 aligned 环境。",
        match,
        replacement
      );
      return replacement;
    }
  );
  next = eqnarrayFixed;

  const inlineAlignFixed = next.replace(
    /\$\$[ \t]*\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}[ \t]*\$\$/gu,
    (match, body) => {
      const normalizedBody = normalizeLatexAlignmentBody(body).trim();
      const replacement = `$$\n\\begin{aligned}\n${normalizedBody}\n\\end{aligned}\n$$`;
      pushVisualFix(
        fixes,
        "inline-align-to-display-aligned",
        "将同一行 $$...$$ 中的 align 环境改为多行 display aligned，避免被解析成行内公式。",
        match,
        replacement
      );
      return replacement;
    }
  );
  next = inlineAlignFixed;

  return {
    content: next,
    fixes,
  };
}

async function buildMarkdownRouteMap(): Promise<Map<string, string>> {
  const files = await listMarkdownFiles(BLOG_ROOT);
  const routes = new Map<string, string>();

  for (const filePath of files) {
    routes.set(getRoutePathFromFile(filePath), filePath);
  }

  return routes;
}

export async function applyVisualSafeFixes(
  pages: PageRecord[],
  options: { applyVisualFixes?: boolean } = {}
): Promise<AppliedVisualFix[]> {
  if (options.applyVisualFixes === false) {
    return [];
  }

  const pagesWithMathIssues = pages.filter(page =>
    (page.visual_findings ?? buildUnifiedVisualFindings(page)).some(
      issue => issue.code === "math-render-error"
    )
  );

  if (pagesWithMathIssues.length === 0) {
    return [];
  }

  const routeMap = await buildMarkdownRouteMap();
  const appliedFixes = [];

  for (const page of pagesWithMathIssues) {
    const sourcePath = routeMap.get(page.route_path);

    if (!sourcePath) {
      continue;
    }

    const original = await fs.readFile(sourcePath, "utf8");
    const result = applyLatexVisualSafeFixesToMarkdown(original);

    if (result.content === original || result.fixes.length === 0) {
      continue;
    }

    await fs.writeFile(sourcePath, result.content, "utf8");

    const sourcePathRelative = normalizePathSlashes(
      path.relative(REPO_ROOT, sourcePath)
    );
    const pageFixes = result.fixes.map(fix => ({
      ...fix,
      route_path: page.route_path,
      source_path: sourcePathRelative,
      applied_at: isoNow(),
    }));

    page.visual_fixes_applied = pageFixes;
    appliedFixes.push(...pageFixes);
  }

  return appliedFixes;
}
