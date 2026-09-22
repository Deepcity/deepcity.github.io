#!/usr/bin/env node

import fs from "node:fs/promises";
import {
  analyzePosts,
  rebuildMemory,
  refreshMemoryEntries,
} from "../src/agent/core/analyzer.js";
import { buildHomePanel } from "../src/agent/core/home-panel.js";
import {
  checkKnowledgeMap,
  refreshKnowledgeMap,
  verifyKnowledgeMap,
} from "../src/agent/core/knowledge.js";
import { pruneOrphans } from "../src/agent/core/gc.js";
import { runSyncWorkflow } from "../src/agent/core/sync.js";
import { runVisualCheck } from "../src/agent/core/visual-check.js";
import { BLOG_ROOT } from "../src/agent/shared/constants.js";
import { listMarkdownFiles, writeJson } from "../src/agent/shared/fs.js";
import { getChangedPostPaths } from "../src/agent/shared/git.js";
import {
  getPostIdFromFilePath,
  resolvePostInput,
  resolveRepoPath,
} from "../src/agent/shared/pathing.js";
import { MemoryStore } from "../src/agent/memory/memory-store.js";
import { maxSeverity } from "../src/agent/shared/utils.js";
import type {
  AnalyzeResult,
  GcResult,
  HomePanelResult,
  KnowledgeRefreshResult,
  RawJson,
  RequestedProvider,
} from "../src/agent/types.js";

type FlagValue = string | boolean | undefined;

/** Flags carry `true` for boolean switches and a string for valued ones. */
function asString(value: FlagValue): string | undefined {
  return typeof value === "string" ? value : undefined;
}

interface ParsedArgs {
  positionals: string[];
  flags: Map<string, FlagValue>;
}

interface CommandInfo {
  command: string;
  implicit: boolean;
}

interface Report {
  generated_at: string;
  summary: Record<string, unknown> & {
    stale_count?: number;
    missing_count?: number;
    error_count?: number;
  };
  results: unknown[];
  home_panel?: HomePanelResult | null;
  knowledge?: Record<string, unknown> | null;
  gc?: GcResult;
  visual?: Record<string, unknown>;
}

function writeStdout(message = ""): void {
  process.stdout.write(`${message}\n`);
}

function writeStderr(message = ""): void {
  process.stderr.write(`${message}\n`);
}

function parseArgs(rawArgs: string[]): ParsedArgs {
  const flags = new Map<string, FlagValue>();
  const positionals: string[] = [];
  const booleanFlags = new Set([
    "--all",
    "--changed",
    "--check",
    "--force",
    "--generate-frontmatter",
    "--help",
    "--no-fix",
    "--no-build",
    "--no-generate-frontmatter",
    "--no-visual-fix",
    "--no-visual-fixes",
    "--refresh-knowledge",
    "--skip-gemini",
    "--allow-unsafe-fixes",
    "--strict",
  ]);

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];

    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const [flag, inlineValue] = token.split("=", 2);

    if (booleanFlags.has(flag)) {
      flags.set(flag, true);
      continue;
    }

    const value = inlineValue ?? rawArgs[index + 1];

    if (inlineValue === undefined) {
      index += 1;
    }

    flags.set(flag, value);
  }

  return { positionals, flags };
}

function printUsage(): void {
  writeStdout("Usage:");
  writeStdout("  node scripts/blog-agent.js");
  writeStdout("  node scripts/blog-agent.js <post>");
  writeStdout("  node scripts/blog-agent.js --changed");
  writeStdout("  node scripts/blog-agent.js --all");
  writeStdout("  node scripts/blog-agent.js --check");
  writeStdout("  node scripts/blog-agent.js --refresh-knowledge");
  writeStdout(
    "  node scripts/blog-agent.js --all --mode ci [--strict]      # read-only: verify committed sidecars, never call an LLM or write"
  );
  writeStdout(
    "  node scripts/blog-agent.js --changed --base origin/main   # diff against a ref instead of the working tree (CI on PRs)"
  );
  writeStdout(
    "  node scripts/blog-agent.js --all --concurrency 3          # parallel LLM reviews (default 2, env BLOG_AGENT_CONCURRENCY)"
  );
  writeStdout("  node scripts/blog-agent.js sync <post|--changed|--all>");
  writeStdout("  node scripts/blog-agent.js analyze <post>");
  writeStdout("  node scripts/blog-agent.js analyze --changed");
  writeStdout("  node scripts/blog-agent.js analyze --all");
  writeStdout(
    "  node scripts/blog-agent.js analyze <post> --generate-frontmatter [--hint \"...\"] [--hint-file ./docs/frontmatter-hint.txt]"
  );
  writeStdout("  node scripts/blog-agent.js build-panel <post|--changed|--all>");
  writeStdout("  node scripts/blog-agent.js build-home-panel");
  writeStdout(
    "  node scripts/blog-agent.js visual-check [--no-build] [--no-visual-fix] [--review-mode changed|all|none] [--route /posts/example] [--review-base-manifest-path path]"
  );
  writeStdout("  node scripts/blog-agent.js refresh-knowledge");
  writeStdout("  node scripts/blog-agent.js check-knowledge");
  writeStdout("  node scripts/blog-agent.js refresh-memory all");
  writeStdout("  node scripts/blog-agent.js refresh-memory post <post>");
  writeStdout("  node scripts/blog-agent.js refresh-memory series <series-id>");
}

function resolveCommand(parsed: ParsedArgs): CommandInfo {
  const command = parsed.positionals[0];
  const knownCommands = new Set([
    "sync",
    "analyze",
    "build-panel",
    "build-home-panel",
    "check-knowledge",
    "refresh-memory",
    "refresh-knowledge",
    "visual-check",
  ]);

  if (parsed.flags.get("--check")) {
    return {
      command: "check-knowledge",
      implicit: false,
    };
  }

  if (parsed.flags.get("--refresh-knowledge")) {
    return {
      command: "refresh-knowledge",
      implicit: false,
    };
  }

  if (!command) {
    return {
      command: "sync",
      implicit: true,
    };
  }

  if (knownCommands.has(command)) {
    return {
      command,
      implicit: false,
    };
  }

  return {
    command: "sync",
    implicit: true,
  };
}

function getTargetPosition(commandInfo: CommandInfo): number {
  return commandInfo.implicit ? 0 : 1;
}

async function collectTargets(
  command: string,
  parsed: ParsedArgs,
  commandInfo: CommandInfo
): Promise<string[]> {
  if (parsed.flags.get("--all")) {
    return listMarkdownFiles(BLOG_ROOT);
  }

  if (parsed.flags.get("--changed")) {
    return getChangedPostPaths({
      base: asString(parsed.flags.get("--base")),
    });
  }

  if (command === "refresh-memory") {
    const scope = parsed.positionals[1] ?? "all";

    if (scope === "all") {
      return listMarkdownFiles(BLOG_ROOT);
    }

    if (scope === "post") {
      const target = parsed.positionals[2];

      if (!target) {
        throw new Error("refresh-memory post requires a post path or id");
      }

      return [await resolvePostInput(target)];
    }

    if (scope === "series") {
      const seriesId = parsed.positionals[2];

      if (!seriesId) {
        throw new Error("refresh-memory series requires a series id");
      }

      const allPosts = await listMarkdownFiles(BLOG_ROOT);
      const memoryStore = new MemoryStore();
      const globalRules = await memoryStore.loadGlobalRules();
      const rule = (globalRules.series_naming_rules ?? []).find(
        item => item.id === seriesId
      );

      if (!rule) {
        throw new Error(`Unknown series id: ${seriesId}`);
      }

      const idPattern = rule.id_pattern;

      if (!idPattern) {
        throw new Error(`Series ${seriesId} has no id_pattern to match posts`);
      }

      return allPosts.filter(postPath =>
        new RegExp(idPattern, "u").test(getPostIdFromFilePath(postPath))
      );
    }

    return [await resolvePostInput(scope)];
  }

  const target = parsed.positionals[getTargetPosition(commandInfo)];

  if (!target) {
    if (command === "sync") {
      return getChangedPostPaths();
    }

    throw new Error(`Missing target for command: ${command}`);
  }

  try {
    return [await resolvePostInput(target)];
  } catch (error) {
    if (commandInfo.implicit) {
      throw new Error(
        `"${target}" is neither a known command nor a resolvable post (${error instanceof Error ? error.message : String(error)}). Known commands: sync, analyze, build-panel, build-home-panel, check-knowledge, refresh-memory, refresh-knowledge, visual-check.`
      );
    }

    throw error;
  }
}

function buildReport(
  command: string,
  results: Array<Partial<AnalyzeResult>>,
  extraSummary: Record<string, unknown> = {}
): Report {
  const hardChecks = results.flatMap(result => result.hard_checks ?? []);
  const skipped = results.filter(result => result.skipped === true).length;
  const summary: Report["summary"] = {
    command,
    processed: results.length,
    skipped,
    stale_count: results.filter(result => result.stale_status === "stale")
      .length,
    missing_count: results.filter(result => result.stale_status === "missing")
      .length,
    highest_severity: maxSeverity(
      results.map(result => result.severity ?? "info")
    ),
    error_count: hardChecks.filter(issue => issue.severity === "error").length,
    warn_count: hardChecks.filter(issue => issue.severity === "warn").length,
    fix_count: results.reduce(
      (count, result) => count + (result.fixes_applied?.length ?? 0),
      0
    ),
    ...extraSummary,
  };

  return {
    generated_at: new Date().toISOString(),
    summary,
    results,
  };
}

function printAnalyzeReport(report: Report): void {
  const results = report.results as AnalyzeResult[];
  const staleSummary =
    report.summary.stale_count || report.summary.missing_count
      ? ` stale=${report.summary.stale_count} missing=${report.summary.missing_count}`
      : "";
  writeStdout(
    `[agent] processed=${report.summary.processed} skipped=${report.summary.skipped}${staleSummary} severity=${report.summary.highest_severity} errors=${report.summary.error_count} warnings=${report.summary.warn_count} fixes=${report.summary.fix_count}`
  );

  for (const result of results) {
    if (result.stale) {
      writeStdout(`- ${result.post_id} [${result.stale_status}]`);

      for (const note of (result.notes ?? []).slice(0, 2)) {
        writeStdout(`  note: ${note}`);
      }

      continue;
    }

    if (result.skipped) {
      writeStdout(
        `- ${result.post_id} [skipped${result.knowledge_refreshed ? ", knowledge-refreshed" : ""}]`
      );

      for (const note of (result.notes ?? []).slice(0, 2)) {
        writeStdout(`  note: ${note}`);
      }

      continue;
    }

    writeStdout(`- ${result.post_id} [${result.severity}]`);

    if (result.degraded) {
      writeStdout(
        `  degraded: ${result.degraded_reason ?? "heuristic fallback"}`
      );
    }

    for (const concern of (result.concerns ?? []).slice(0, 3)) {
      writeStdout(`  concern: ${concern}`);
    }

    for (const fix of (result.fixes_applied ?? []).slice(0, 3)) {
      writeStdout(`  fix: ${fix}`);
    }

    if (result.notes?.length > 0) {
      writeStdout(`  note: ${result.notes[0]}`);
    }
  }
}

function printHomePanelResult(
  result: HomePanelResult | null | undefined
): void {
  if (!result) {
    return;
  }

  if (result.stale) {
    writeStdout(`[agent] home panel ${result.stale_status}: ${result.notes[0]}`);
    return;
  }

  if (result.skipped) {
    writeStdout("[agent] home panel skipped: posts_hash unchanged");
    return;
  }

  writeStdout(
    `[agent] built home panel: posts=${result.content_stats?.total_posts ?? 0} topics=${result.focus_topics.length} sidecar=${result.sidecar_path}`
  );
}

function printKnowledgeResult(
  result: (KnowledgeRefreshResult<unknown> & { stale?: boolean }) | null
): void {
  if (!result) {
    return;
  }

  if (result.stale) {
    writeStdout(
      `[agent] knowledge map stale: committed=${result.committed_hash ?? "(none)"} computed=${result.knowledge_hash}; run \`./agent refresh-knowledge\` locally and commit it.`
    );
  }
}

// Garbage-collects sidecars / memory entries for deleted or renamed posts.
// Only meaningful with the full post list, so it is tied to `--all`.
async function maybePruneOrphans(
  report: Report,
  targets: string[],
  options: { all?: boolean; readOnly?: boolean } = {}
): Promise<void> {
  if (!options.all) {
    return;
  }

  const result = await pruneOrphans(targets, { dryRun: options.readOnly });
  report.gc = result;

  const total =
    result.orphan_sidecars.length + result.memory_removed_post_ids.length;

  if (total === 0) {
    return;
  }

  const verb = result.dry_run ? "would prune" : "pruned";
  writeStdout(
    `[agent] gc ${verb}: sidecars=${result.orphan_sidecars.length} memory_posts=${result.memory_removed_post_ids.length}`
  );

  for (const sidecarPath of result.orphan_sidecars) {
    writeStdout(`  orphan sidecar: ${sidecarPath}`);
  }

  for (const postId of result.memory_removed_post_ids) {
    writeStdout(`  orphan memory entry: ${postId}`);
  }
}

// In --strict mode anything that would need a local regeneration fails the run.
function applyStrictExit(
  report: Report,
  options: { strict?: boolean } = {}
): void {
  if (!options.strict) {
    return;
  }

  const reasons: string[] = [];

  if ((report.summary.missing_count ?? 0) > 0) {
    reasons.push(`${report.summary.missing_count} post(s) missing a sidecar`);
  }

  if ((report.summary.stale_count ?? 0) > 0) {
    reasons.push(`${report.summary.stale_count} stale sidecar(s)`);
  }

  if ((report.summary.error_count ?? 0) > 0) {
    reasons.push(`${report.summary.error_count} hard-check error(s)`);
  }

  if (report.home_panel?.stale) {
    reasons.push(`home panel ${report.home_panel.stale_status}`);
  }

  if (report.knowledge?.stale) {
    reasons.push("knowledge map stale");
  }

  if (report.gc?.dry_run && report.gc.orphan_sidecars.length > 0) {
    reasons.push(`${report.gc.orphan_sidecars.length} orphan sidecar(s)`);
  }

  if (reasons.length > 0) {
    writeStderr(`[agent] strict mode failed: ${reasons.join("; ")}`);
    process.exitCode = 1;
  }
}

function parseViewport(value: FlagValue) {
  if (!value) {
    return undefined;
  }

  const match = String(value).match(/^(\d+)x(\d+)$/u);

  if (!match) {
    throw new Error("--viewport must use WIDTHxHEIGHT, for example 1440x1200");
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

function printVisualCheckReport(result: RawJson): void {
  writeStdout(
    `[agent] visual check: pages=${result.summary.page_count} screenshots=${result.summary.screenshot_count} reviewed=${result.summary.reviewed_count} fresh=${result.summary.review_fresh_count ?? 0} cached=${result.summary.review_cached_count ?? 0} severity=${result.summary.highest_severity} issues=${result.summary.issue_count} fixes=${result.summary.visual_fix_count ?? 0}`
  );
  writeStdout(`[agent] visual manifest: ${result.manifest_path}`);
  writeStdout(`[agent] visual report: ${result.report_path}`);
  writeStdout(`[agent] visual markdown: ${result.report_markdown_path}`);

  if (result.notes?.length > 0) {
    writeStdout(`  note: ${result.notes[0]}`);
  }

  for (const fix of (result.applied_fixes ?? []).slice(0, 5)) {
    writeStdout(
      `  fix: ${fix.source_path} ${fix.rule}: ${fix.message}`
    );
  }

  const pagesWithIssues = result.pages
    .map((page: RawJson) => ({
      page,
      issues: page.visual_findings ?? [],
    }))
    .filter((item: RawJson) => item.issues.length > 0)
    .slice(0, 8);

  for (const item of pagesWithIssues) {
    const firstIssue = item.issues[0];
    writeStdout(
      `- ${item.page.route_path} [${firstIssue.severity}] ${firstIssue.code}: ${firstIssue.message}`
    );
  }
}

async function maybeWriteReport(
  report: unknown,
  reportFile: FlagValue
): Promise<void> {
  if (!reportFile) {
    return;
  }

  await writeJson(String(reportFile), report);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const commandInfo = resolveCommand(parsed);
  const command = commandInfo.command;

  if (
    parsed.flags.get("--help") === true ||
    parsed.positionals[0] === "--help" ||
    parsed.positionals[0] === "help"
  ) {
    printUsage();
    return;
  }

  if (
    ![
      "sync",
      "analyze",
      "build-panel",
      "build-home-panel",
      "check-knowledge",
      "refresh-memory",
      "refresh-knowledge",
      "visual-check",
    ].includes(
      command
    )
  ) {
    throw new Error(`Unknown command: ${command}`);
  }

  const reportFile = parsed.flags.get("--report-file");
  const runMode = asString(parsed.flags.get("--mode")) ?? null;
  // ci = read-only: verify committed artifacts, never write or call an LLM.
  const readOnly = runMode === "ci";
  const strict = parsed.flags.get("--strict") === true;

  if (command === "refresh-knowledge") {
    const result = await refreshKnowledgeMap();
    const report = {
      generated_at: new Date().toISOString(),
      summary: {
        command,
        processed: result.post_count,
        series_count: result.series_count,
        issue_count: result.issue_count,
        knowledge_hash: result.knowledge_hash,
        sidecar_path: result.sidecar_path,
      },
      results: result.map.issues,
    };

    writeStdout(
      `[agent] refreshed knowledge map: posts=${result.post_count} series=${result.series_count} issues=${result.issue_count} sidecar=${result.sidecar_path}`
    );
    await maybeWriteReport(report, reportFile);
    return;
  }

  if (command === "visual-check") {
    const result = await runVisualCheck({
      build: parsed.flags.get("--no-build") !== true,
      provider: asString(parsed.flags.get("--provider")) ?? "auto",
      model: asString(parsed.flags.get("--model")),
      skipGemini: parsed.flags.get("--skip-gemini") === true,
      reviewMode: asString(parsed.flags.get("--review-mode")),
      maxPages: asString(parsed.flags.get("--max-pages")),
      route: asString(parsed.flags.get("--route")),
      runId: asString(parsed.flags.get("--run-id")),
      reviewBaseManifestPath: asString(
        parsed.flags.get("--review-base-manifest-path")
      ),
      applyVisualFixes:
        parsed.flags.get("--no-visual-fix") !== true &&
        parsed.flags.get("--no-visual-fixes") !== true,
      timeoutMs: asString(parsed.flags.get("--timeout-ms")),
      geminiTimeoutMs: asString(parsed.flags.get("--gemini-timeout-ms")),
      viewport: parseViewport(parsed.flags.get("--viewport")),
      onProgress: (event: RawJson) => {
        if (event.type === "start") {
          writeStdout(`[agent] visual pages queued: ${event.total}`);
          return;
        }

        if (event.type === "capture") {
          writeStdout(
            `[agent] visual capture ${event.index}/${event.total}: ${event.route_path} ${event.ok ? "ok" : "failed"}`
          );
          return;
        }

        if (event.type === "review") {
          const status = event.cached
            ? "cached"
            : event.ok
              ? "ok"
              : "skipped";
          writeStdout(
            `[agent] visual review ${event.index}/${event.total}: ${event.route_path} ${status}`
          );
        }
      },
    });
    const report = {
      generated_at: new Date().toISOString(),
      summary: {
        command,
        ...result.summary,
        manifest_path: result.manifest_path,
        latest_path: result.latest_path,
      },
      results: result.pages,
      visual: {
        run_id: result.run_id,
        provider: result.provider,
        model: result.model,
        degraded: result.degraded,
        degraded_reason: result.degraded_reason,
        manifest_path: result.manifest_path,
        latest_path: result.latest_path,
        report_path: result.report_path,
        report_markdown_path: result.report_markdown_path,
        screenshot_root: result.screenshot_root,
        notes: result.notes,
        applied_fixes: result.applied_fixes,
      },
    };

    printVisualCheckReport(result);
    await maybeWriteReport(report, reportFile);
    return;
  }

  if (command === "check-knowledge") {
    const report = await checkKnowledgeMap();

    if (report.summary.issue_count === 0) {
      writeStdout(
        `[agent] knowledge map ok: posts=${report.summary.post_count} series=${report.summary.series_count} hash=${report.summary.knowledge_hash}`
      );
    } else {
      writeStdout(
        `[agent] knowledge map has ${report.summary.issue_count} issue(s):`
      );

      for (const issue of report.issues) {
        writeStdout(`- [${issue.severity}] ${issue.code}: ${issue.message}`);
      }
    }

    await maybeWriteReport(report, reportFile);
    return;
  }

  if (command === "build-home-panel") {
    const result = await buildHomePanel({
      provider: (asString(parsed.flags.get("--provider")) ??
        "auto") as RequestedProvider,
      model: asString(parsed.flags.get("--model")),
      force: !readOnly && parsed.flags.get("--force") === true,
      regenerate: !readOnly,
    });
    const report = {
      generated_at: new Date().toISOString(),
      summary: {
        command,
        processed: 1,
        highest_severity: result.stale ? "warn" : "info",
        error_count: 0,
        warn_count: result.stale ? 1 : 0,
        fix_count: 0,
        stale_count: 0,
        missing_count: 0,
      },
      results: [result],
      home_panel: result,
    };

    printHomePanelResult(result);
    await maybeWriteReport(report, reportFile);
    applyStrictExit(report, { strict });
    return;
  }

  const targets = await collectTargets(command, parsed, commandInfo);

  if (targets.length === 0) {
    writeStdout("[agent] no target posts detected.");
    await maybeWriteReport(buildReport(command, []), reportFile);
    return;
  }

  if (command === "refresh-memory") {
    const scope = parsed.positionals[1] ?? "all";

    if (scope === "all") {
      const summary = await rebuildMemory(targets);
      const report = {
        generated_at: new Date().toISOString(),
        summary: {
          command,
          processed: targets.length,
          ...summary,
        },
        results: [],
      };
      writeStdout(
        `[agent] refreshed memory from ${targets.length} posts: series=${summary.series} topics=${summary.topics} negative_patterns=${summary.negative_patterns}`
      );
      await maybePruneOrphans(report, targets, { all: true, readOnly });
      await maybeWriteReport(report, reportFile);
      return;
    }

    const results = await refreshMemoryEntries(targets);
    const report = buildReport(command, results);
    writeStdout(
      `[agent] refreshed incremental memory for ${results.length} posts.`
    );
    await maybeWriteReport(report, reportFile);
    return;
  }

  const frontmatterHintParts: string[] = [];

  if (parsed.flags.get("--hint")) {
    frontmatterHintParts.push(String(parsed.flags.get("--hint")));
  }

  if (parsed.flags.get("--hint-file")) {
    const hintFilePath = resolveRepoPath(String(parsed.flags.get("--hint-file")));
    frontmatterHintParts.push(await fs.readFile(hintFilePath, "utf8"));
  }

  const implicitHintStart =
    command === "sync" ? getTargetPosition(commandInfo) + 1 : -1;
  const implicitHintText =
    implicitHintStart >= 0
      ? parsed.positionals.slice(implicitHintStart).join(" ").trim()
      : "";

  if (implicitHintText) {
    frontmatterHintParts.push(implicitHintText);
  }

  function summarizeKnowledge(
    knowledgeResult: (KnowledgeRefreshResult<unknown> & { stale?: boolean }) | null
  ) {
    if (!knowledgeResult) {
      return null;
    }

    return {
      knowledge_hash: knowledgeResult.knowledge_hash,
      committed_hash: knowledgeResult.committed_hash ?? null,
      stale: knowledgeResult.stale === true,
      post_count: knowledgeResult.post_count,
      series_count: knowledgeResult.series_count,
      issue_count: knowledgeResult.issue_count,
      sidecar_path: knowledgeResult.sidecar_path,
    };
  }

  if (command === "sync") {
    const workflowResult = await runSyncWorkflow(targets, {
      runMode: runMode ?? "cli",
      provider: (asString(parsed.flags.get("--provider")) ??
        "auto") as RequestedProvider,
      applyFixes: !parsed.flags.get("--no-fix"),
      allowUnsafeFixes: parsed.flags.get("--allow-unsafe-fixes") === true,
      generateFrontmatter: parsed.flags.get("--no-generate-frontmatter")
        ? false
        : true,
      frontmatterHintText: frontmatterHintParts.join("\n").trim(),
      writeMarkdown: true,
      model: asString(parsed.flags.get("--model")),
      force: parsed.flags.get("--force") === true,
      regenerate: !readOnly,
      concurrency: Number(parsed.flags.get("--concurrency")) || undefined,
    });
    const report = buildReport(command, workflowResult.postResults, {
      read_only: readOnly,
      home_panel_skipped: workflowResult.homePanelResult?.skipped === true,
      home_panel_generated: Boolean(
        workflowResult.homePanelResult &&
          workflowResult.homePanelResult.skipped !== true
      ),
      knowledge_hash: workflowResult.knowledgeResult?.knowledge_hash ?? null,
      knowledge_stale: workflowResult.knowledgeResult?.stale === true,
      knowledge_issue_count: workflowResult.knowledgeResult?.issue_count ?? 0,
    });

    report.home_panel = workflowResult.homePanelResult;
    report.knowledge = summarizeKnowledge(workflowResult.knowledgeResult);
    printAnalyzeReport(report);
    printHomePanelResult(workflowResult.homePanelResult);
    printKnowledgeResult(workflowResult.knowledgeResult);
    await maybePruneOrphans(report, targets, {
      all: parsed.flags.get("--all") === true,
      readOnly,
    });
    await maybeWriteReport(report, reportFile);
    applyStrictExit(report, { strict });
    return;
  }

  const knowledgeResult = readOnly
    ? await verifyKnowledgeMap()
    : await refreshKnowledgeMap();
  const results = await analyzePosts(targets, {
    runMode: runMode ?? (command === "build-panel" ? "build" : "cli"),
    provider: (asString(parsed.flags.get("--provider")) ??
      "auto") as RequestedProvider,
    applyFixes:
      !readOnly &&
      (command === "build-panel" ? false : !parsed.flags.get("--no-fix")),
    allowUnsafeFixes:
      !readOnly && parsed.flags.get("--allow-unsafe-fixes") === true,
    generateFrontmatter:
      !readOnly && parsed.flags.get("--generate-frontmatter") === true,
    frontmatterHintText: frontmatterHintParts.join("\n").trim(),
    writeMarkdown: !readOnly && command !== "build-panel",
    model: asString(parsed.flags.get("--model")),
    force: !readOnly && parsed.flags.get("--force") === true,
    updateMemory: !readOnly,
    regenerate: !readOnly,
    concurrency: Number(parsed.flags.get("--concurrency")) || undefined,
    knowledgeMap: knowledgeResult.map,
  });
  const report = buildReport(command, results, {
    read_only: readOnly,
    knowledge_hash: knowledgeResult.knowledge_hash,
    knowledge_stale: knowledgeResult.stale === true,
    knowledge_issue_count: knowledgeResult.issue_count,
  });
  report.knowledge = summarizeKnowledge(knowledgeResult);
  printAnalyzeReport(report);
  printKnowledgeResult(knowledgeResult);
  await maybePruneOrphans(report, targets, {
    all: parsed.flags.get("--all") === true,
    readOnly,
  });
  await maybeWriteReport(report, reportFile);
  applyStrictExit(report, { strict });
}

main().catch(error => {
  writeStderr(`[agent] ${error.message}`);
  process.exitCode = 1;
});
