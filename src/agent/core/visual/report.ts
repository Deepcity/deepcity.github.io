import fs from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "../../shared/constants.js";
import { maxSeverity, normalizePathSlashes } from "../../shared/utils.js";
import { buildUnifiedVisualFindings } from "./findings.js";
import { htmlEscape, reportTruncate, severityRank } from "./shared.js";
import type { RawJson } from "../../types.js";
import type {
  AppliedVisualFix,
  PageRecord,
  VisualIssue,
  VisualManifest,
  VisualSummary,
} from "./types.js";

export function buildVisualCheckSummary(
  pages: PageRecord[],
  appliedFixes: AppliedVisualFix[] = []
): VisualSummary {
  const findings = pages.flatMap(
    page => page.visual_findings ?? buildUnifiedVisualFindings(page)
  );

  return {
    page_count: pages.length,
    screenshot_count: pages.filter(page => page.capture_ok).length,
    reviewed_count: pages.filter(page => page.review).length,
    review_fresh_count: pages.filter(
      page => page.review?.review_source === "gemini"
    ).length,
    review_cached_count: pages.filter(
      page => page.review?.review_source === "cache"
    ).length,
    issue_count: findings.length,
    error_count: findings.filter(
      (issue: VisualIssue) => issue.severity === "error"
    ).length,
    warn_count: findings.filter(issue => issue.severity === "warn").length,
    visual_fix_count: appliedFixes.length,
    highest_severity: maxSeverity(findings.map(issue => issue.severity)),
  };
}

function collectVisualIssuesForPage(page: PageRecord): VisualIssue[] {
  return page.visual_findings ?? buildUnifiedVisualFindings(page);
}

function markdownCell(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .replace(/\|/gu, "\\|")
    .trim();
}

function reportAssetPath(
  runRoot: string,
  repoRelativePath: string | null | undefined
): string {
  if (!repoRelativePath) {
    return "";
  }

  return normalizePathSlashes(
    path.relative(runRoot, path.join(REPO_ROOT, repoRelativePath))
  );
}

function sortVisualIssueRows(rows: RawJson[]): RawJson[] {
  return [...rows].sort((left, right) => {
    const severityDelta =
      severityRank(right.highest_severity) -
      severityRank(left.highest_severity);

    if (severityDelta !== 0) {
      return severityDelta;
    }

    return right.issues.length - left.issues.length;
  });
}

function summarizeIssueCodes(issues: VisualIssue[]): string {
  const counts = new Map();

  for (const issue of issues) {
    counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
    )
    .map(([code, count]) => (count > 1 ? `${code} x${count}` : code))
    .join(", ");
}

function buildVisualReportRows(
  manifest: VisualManifest,
  runRoot: string
): RawJson[] {
  return manifest.pages.map(page => {
    const issues = collectVisualIssuesForPage(page);

    return {
      ...page,
      issues,
      screenshot_report_path: reportAssetPath(runRoot, page.screenshot_path),
      highest_severity: maxSeverity(issues.map(issue => issue.severity)),
    };
  });
}

function issueCountLabel(count: number): string {
  if (count === 0) {
    return "0 issues";
  }

  return count === 1 ? "1 issue" : `${count} issues`;
}

function buildVisualHtmlReport(
  manifest: VisualManifest,
  runRoot: string
): string {
  const rows = buildVisualReportRows(manifest, runRoot);
  const issueRows = sortVisualIssueRows(
    rows.filter(row => row.issues.length > 0)
  );
  const cleanRows = rows.filter(row => row.issues.length === 0);
  const issueCards = issueRows
    .map(row => {
      const issues = row.issues
        .map(
          (issue: VisualIssue) => `
            <li class="issue issue-${htmlEscape(issue.severity)}">
              <div class="issue-head">
                <span class="pill ${htmlEscape(issue.severity)}">${htmlEscape(issue.severity)}</span>
                <span class="code">${htmlEscape(issue.code)}</span>
                <span class="source">${htmlEscape(issue.source)}</span>
              </div>
              <p>${htmlEscape(issue.message)}</p>
              ${
                issue.region && issue.region !== "unknown"
                  ? `<small>Region: ${htmlEscape(issue.region)}</small>`
                  : ""
              }
              ${
                issue.selector_hint
                  ? `<small>Selector: ${htmlEscape(issue.selector_hint)}</small>`
                  : ""
              }
            </li>`
        )
        .join("");

      return `
        <article class="page-card issue-card">
          <a class="thumb" href="${htmlEscape(row.screenshot_report_path)}">
            ${
              row.screenshot_report_path
                ? `<img src="${htmlEscape(row.screenshot_report_path)}" alt="${htmlEscape(row.route_path)} screenshot" loading="lazy" />`
                : `<div class="missing-thumb">No screenshot</div>`
            }
          </a>
          <div class="page-body">
            <div class="page-title-row">
              <h2>${htmlEscape(row.route_path)}</h2>
              <span class="pill ${htmlEscape(row.highest_severity)}">${htmlEscape(row.highest_severity)}</span>
            </div>
            <p class="title">${htmlEscape(row.title || row.html_path || "")}</p>
            <ul>${issues}</ul>
          </div>
        </article>`;
    })
    .join("");
  const gallery = rows
    .map(
      row => `
        <a class="gallery-card ${row.issues.length ? "has-issues" : "clean"}" href="${htmlEscape(row.screenshot_report_path)}">
          ${
            row.screenshot_report_path
              ? `<img src="${htmlEscape(row.screenshot_report_path)}" alt="${htmlEscape(row.route_path)} screenshot" loading="lazy" />`
              : `<div class="missing-thumb">No screenshot</div>`
          }
          <span>${htmlEscape(row.route_path)}</span>
          <em>${htmlEscape(issueCountLabel(row.issues.length))}</em>
        </a>`
    )
    .join("");
  const notes = (manifest.notes ?? [])
    .map(note => `<li>${htmlEscape(note)}</li>`)
    .join("");
  const appliedFixes = (manifest.applied_fixes ?? [])
    .map(
      fix => `
        <li>
          <strong>${htmlEscape(fix.source_path)}</strong>
          <span class="code">${htmlEscape(fix.rule)}</span>
          <p>${htmlEscape(fix.message)}</p>
          <small>Before: ${htmlEscape(fix.before)}</small>
          <small>After: ${htmlEscape(fix.after)}</small>
        </li>`
    )
    .join("");
  const reviewCacheStats =
    Number.isFinite(Number(manifest.summary.review_fresh_count)) ||
    Number.isFinite(Number(manifest.summary.review_cached_count))
      ? `
        <span class="stat">${Number(manifest.summary.review_fresh_count ?? 0)} fresh reviews</span>
        <span class="stat">${Number(manifest.summary.review_cached_count ?? 0)} cached reviews</span>`
      : "";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Visual Check Report - ${htmlEscape(manifest.run_id)}</title>
    <style>
      :root { color-scheme: light; --bg: #f7f7f4; --paper: #fff; --ink: #242424; --muted: #686868; --line: #dedbd2; --accent: #006cac; --warn: #9a5b00; --error: #b42318; --info: #31615f; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--ink); }
      header { padding: 32px clamp(18px, 4vw, 56px); border-bottom: 1px solid var(--line); background: var(--paper); }
      main { padding: 24px clamp(18px, 4vw, 56px) 48px; }
      h1 { margin: 0 0 8px; font-size: clamp(28px, 4vw, 42px); line-height: 1.05; letter-spacing: 0; }
      h2 { margin: 0; font-size: 18px; letter-spacing: 0; }
      p { margin: 0; color: var(--muted); line-height: 1.65; }
      .meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
      .stat, .pill { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: 5px 10px; background: #fafafa; font-size: 13px; font-weight: 650; color: var(--ink); }
      .pill.warn { color: var(--warn); border-color: #e4c27b; background: #fff8e7; }
      .pill.error { color: var(--error); border-color: #f0a39c; background: #fff1f0; }
      .pill.info { color: var(--info); border-color: #9fc9c5; background: #effaf8; }
      .section-title { margin: 32px 0 14px; display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
      .page-card { display: grid; grid-template-columns: minmax(180px, 280px) minmax(0, 1fr); gap: 18px; padding: 16px; margin-bottom: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); }
      .thumb { display: block; overflow: hidden; border: 1px solid var(--line); border-radius: 6px; background: #eceae3; aspect-ratio: 4 / 3; }
      .thumb img, .gallery-card img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
      .page-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .title { margin-top: 4px; font-size: 13px; }
      ul { margin: 14px 0 0; padding: 0; list-style: none; }
      .issue { padding: 12px 0; border-top: 1px solid var(--line); }
      .issue:first-child { border-top: 0; }
      .issue-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 6px; }
      .code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--ink); }
      .source { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
      small { display: block; color: var(--muted); margin-top: 4px; font-size: 12px; line-height: 1.45; }
      .notes { border: 1px solid var(--line); border-radius: 8px; background: var(--paper); padding: 16px 18px; }
      .notes li { margin: 6px 0; color: var(--muted); line-height: 1.55; }
      .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
      .gallery-card { display: grid; gap: 8px; color: inherit; text-decoration: none; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); padding: 10px; }
      .gallery-card img, .missing-thumb { aspect-ratio: 4 / 3; border-radius: 6px; background: #eceae3; }
      .gallery-card span { font-size: 13px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .gallery-card em { color: var(--muted); font-size: 12px; font-style: normal; }
      .gallery-card.has-issues { border-color: #e4c27b; }
      .empty { padding: 20px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); }
      @media (max-width: 760px) { .page-card { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <header>
      <h1>Visual Check Report</h1>
      <p>Run ${htmlEscape(manifest.run_id)} generated at ${htmlEscape(manifest.generated_at)}.</p>
      <div class="meta">
        <span class="stat">${manifest.summary.page_count} pages</span>
        <span class="stat">${manifest.summary.screenshot_count} screenshots</span>
        <span class="stat">${manifest.summary.reviewed_count} reviewed</span>
        ${reviewCacheStats}
        <span class="stat">${manifest.summary.issue_count} issues</span>
        <span class="stat">${manifest.summary.visual_fix_count ?? 0} fixes</span>
        <span class="pill ${htmlEscape(manifest.summary.highest_severity)}">${htmlEscape(manifest.summary.highest_severity)}</span>
      </div>
    </header>
    <main>
      ${
        appliedFixes
          ? `<section><div class="section-title"><h2>Applied Fixes</h2><p>${manifest.applied_fixes.length} source edits applied by visual safe-fix rules.</p></div><ul class="notes">${appliedFixes}</ul></section>`
          : ""
      }
      <section>
        <div class="section-title">
          <h2>Needs Attention</h2>
          <p>${issueRows.length} pages with issues, ${cleanRows.length} clean pages.</p>
        </div>
        ${issueCards || `<div class="empty">No visual issues found.</div>`}
      </section>
      ${
        notes
          ? `<section><div class="section-title"><h2>Run Notes</h2></div><ul class="notes">${notes}</ul></section>`
          : ""
      }
      <section>
        <div class="section-title">
          <h2>Screenshot Gallery</h2>
          <p>Click any thumbnail to open the full-page screenshot.</p>
        </div>
        <div class="gallery">${gallery}</div>
      </section>
    </main>
  </body>
</html>
`;
}

function buildVisualMarkdownReport(
  manifest: VisualManifest,
  runRoot: string
): string {
  const rows = buildVisualReportRows(manifest, runRoot);
  const issueRows = rows.filter(row => row.issues.length > 0);
  const lines = [
    `# Visual Check Report`,
    "",
    `Run: \`${manifest.run_id}\``,
    `Generated: \`${manifest.generated_at}\``,
    "",
    `Pages: ${manifest.summary.page_count}`,
    `Screenshots: ${manifest.summary.screenshot_count}`,
    `Reviewed: ${manifest.summary.reviewed_count}`,
    ...(Number.isFinite(Number(manifest.summary.review_fresh_count)) ||
    Number.isFinite(Number(manifest.summary.review_cached_count))
      ? [
          `Fresh reviews: ${Number(manifest.summary.review_fresh_count ?? 0)}`,
          `Cached reviews: ${Number(manifest.summary.review_cached_count ?? 0)}`,
        ]
      : []),
    `Issues: ${manifest.summary.issue_count}`,
    `Applied fixes: ${manifest.summary.visual_fix_count ?? 0}`,
    `Highest severity: \`${manifest.summary.highest_severity}\``,
    "",
  ];

  if (manifest.notes?.length) {
    lines.push("## Run Notes", "");
    for (const note of manifest.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  if (manifest.applied_fixes?.length) {
    lines.push("## Applied Fixes", "");

    for (const fix of manifest.applied_fixes) {
      lines.push(
        `- \`${markdownCell(fix.source_path)}\` \`${markdownCell(fix.rule)}\`: ${markdownCell(fix.message)}`
      );
      lines.push(`  Before: \`${markdownCell(fix.before)}\``);
      lines.push(`  After: \`${markdownCell(fix.after)}\``);
    }

    lines.push("");
  }

  lines.push("## Needs Attention", "");

  if (issueRows.length === 0) {
    lines.push("No visual issues found.", "");
  } else {
    lines.push("| Route | Severity | Count | Signals | Screenshot |");
    lines.push("| --- | --- | ---: | --- | --- |");

    for (const row of sortVisualIssueRows(issueRows)) {
      lines.push(
        `| ${markdownCell(row.route_path)} | ${markdownCell(row.highest_severity)} | ${row.issues.length} | ${markdownCell(reportTruncate(summarizeIssueCodes(row.issues), 110))} | ${row.screenshot_report_path ? `[open](${row.screenshot_report_path})` : ""} |`
      );
    }

    lines.push("");
    lines.push("## Issue Details", "");

    for (const row of sortVisualIssueRows(issueRows)) {
      lines.push(
        `<details><summary>${htmlEscape(row.route_path)} · ${htmlEscape(row.highest_severity)} · ${row.issues.length} ${row.issues.length === 1 ? "issue" : "issues"}</summary>`,
        ""
      );

      if (row.screenshot_report_path) {
        lines.push(`Screenshot: [open](${row.screenshot_report_path})`, "");
      }

      for (const issue of row.issues) {
        const source = issue.source ? ` (${issue.source})` : "";
        const region =
          issue.region && issue.region !== "unknown"
            ? ` Region: ${reportTruncate(issue.region, 90)}.`
            : "";
        const selector = issue.selector_hint
          ? ` Selector: ${reportTruncate(issue.selector_hint, 90)}.`
          : "";
        lines.push(
          `- **${htmlEscape(issue.severity)}** \`${htmlEscape(issue.code)}\`${htmlEscape(source)}: ${htmlEscape(issue.message)}${htmlEscape(region)}${htmlEscape(selector)}`
        );
      }

      lines.push("", "</details>", "");
    }
  }

  lines.push("## Screenshot Index", "");
  lines.push("| Route | Status | Screenshot |");
  lines.push("| --- | --- | --- |");

  for (const row of rows) {
    lines.push(
      `| ${markdownCell(row.route_path)} | ${markdownCell(issueCountLabel(row.issues.length))} | ${row.screenshot_report_path ? `[open](${row.screenshot_report_path})` : ""} |`
    );
  }

  lines.push("");
  return lines.join("\n");
}

export async function writeVisualReports(
  manifest: VisualManifest,
  runRoot: string
): Promise<{ htmlPath: string; markdownPath: string }> {
  const htmlPath = path.join(runRoot, "report.html");
  const markdownPath = path.join(runRoot, "report.md");

  await fs.writeFile(
    htmlPath,
    buildVisualHtmlReport(manifest, runRoot),
    "utf8"
  );
  await fs.writeFile(
    markdownPath,
    buildVisualMarkdownReport(manifest, runRoot),
    "utf8"
  );

  return {
    htmlPath,
    markdownPath,
  };
}
