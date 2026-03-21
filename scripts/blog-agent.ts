#!/usr/bin/env node
// @ts-nocheck

import fs from "node:fs/promises";
import {
  analyzePosts,
  rebuildMemory,
  refreshMemoryEntries,
} from "../src/agent/core/analyzer.js";
import { buildHomePanel } from "../src/agent/core/home-panel.js";
import { runSyncWorkflow } from "../src/agent/core/sync.js";
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

function writeStdout(message = "") {
  process.stdout.write(`${message}\n`);
}

function writeStderr(message = "") {
  process.stderr.write(`${message}\n`);
}

function parseArgs(rawArgs) {
  const flags = new Map();
  const positionals = [];
  const booleanFlags = new Set([
    "--all",
    "--changed",
    "--force",
    "--generate-frontmatter",
    "--help",
    "--no-fix",
    "--no-generate-frontmatter",
    "--allow-unsafe-fixes",
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

function printUsage() {
  writeStdout("Usage:");
  writeStdout("  node scripts/blog-agent.js");
  writeStdout("  node scripts/blog-agent.js <post>");
  writeStdout("  node scripts/blog-agent.js --changed");
  writeStdout("  node scripts/blog-agent.js --all");
  writeStdout("  node scripts/blog-agent.js sync <post|--changed|--all>");
  writeStdout("  node scripts/blog-agent.js analyze <post>");
  writeStdout("  node scripts/blog-agent.js analyze --changed");
  writeStdout("  node scripts/blog-agent.js analyze --all");
  writeStdout(
    "  node scripts/blog-agent.js analyze <post> --generate-frontmatter [--hint \"...\"] [--hint-file ./docs/frontmatter-hint.txt]"
  );
  writeStdout("  node scripts/blog-agent.js build-panel <post|--changed|--all>");
  writeStdout("  node scripts/blog-agent.js build-home-panel");
  writeStdout("  node scripts/blog-agent.js refresh-memory all");
  writeStdout("  node scripts/blog-agent.js refresh-memory post <post>");
  writeStdout("  node scripts/blog-agent.js refresh-memory series <series-id>");
}

function resolveCommand(parsed) {
  const command = parsed.positionals[0];
  const knownCommands = new Set([
    "sync",
    "analyze",
    "build-panel",
    "build-home-panel",
    "refresh-memory",
  ]);

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

function getTargetPosition(commandInfo) {
  return commandInfo.implicit ? 0 : 1;
}

async function collectTargets(command, parsed, commandInfo) {
  if (parsed.flags.get("--all")) {
    return listMarkdownFiles(BLOG_ROOT);
  }

  if (parsed.flags.get("--changed")) {
    return getChangedPostPaths();
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

      return allPosts.filter(postPath =>
        new RegExp(rule.id_pattern, "u").test(getPostIdFromFilePath(postPath))
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

  return [await resolvePostInput(target)];
}

function buildReport(command, results, extraSummary = {}) {
  const hardChecks = results.flatMap(result => result.hard_checks ?? []);
  const skipped = results.filter(result => result.skipped === true).length;
  const summary = {
    command,
    processed: results.length,
    skipped,
    highest_severity: maxSeverity(results.map(result => result.severity ?? "info")),
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

function printAnalyzeReport(report) {
  writeStdout(
    `[agent] processed=${report.summary.processed} skipped=${report.summary.skipped} severity=${report.summary.highest_severity} errors=${report.summary.error_count} warnings=${report.summary.warn_count} fixes=${report.summary.fix_count}`
  );

  for (const result of report.results) {
    if (result.skipped) {
      writeStdout(`- ${result.post_id} [skipped]`);
      continue;
    }

    writeStdout(`- ${result.post_id} [${result.severity}]`);

    for (const concern of result.concerns.slice(0, 3)) {
      writeStdout(`  concern: ${concern}`);
    }

    for (const fix of result.fixes_applied.slice(0, 3)) {
      writeStdout(`  fix: ${fix}`);
    }

    if (result.notes.length > 0) {
      writeStdout(`  note: ${result.notes[0]}`);
    }
  }
}

function printHomePanelResult(result) {
  if (!result) {
    return;
  }

  if (result.skipped) {
    writeStdout("[agent] home panel skipped: posts_hash unchanged");
    return;
  }

  writeStdout(
    `[agent] built home panel: posts=${result.content_stats.total_posts} topics=${result.focus_topics.length} sidecar=${result.sidecar_path}`
  );
}

async function maybeWriteReport(report, reportFile) {
  if (!reportFile) {
    return;
  }

  await writeJson(reportFile, report);
}

async function main() {
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
      "refresh-memory",
    ].includes(
      command
    )
  ) {
    throw new Error(`Unknown command: ${command}`);
  }

  const reportFile = parsed.flags.get("--report-file");

  if (command === "build-home-panel") {
    const result = await buildHomePanel({
      provider: parsed.flags.get("--provider") ?? "auto",
      model: parsed.flags.get("--model"),
      force: parsed.flags.get("--force") === true,
    });
    const report = {
      generated_at: new Date().toISOString(),
      summary: {
        command,
        processed: 1,
        highest_severity: "info",
        error_count: 0,
        warn_count: 0,
        fix_count: 0,
      },
      results: [result],
    };

    writeStdout(
      result.skipped
        ? `[agent] home panel skipped: posts_hash unchanged`
        : `[agent] built home panel: posts=${result.content_stats.total_posts} topics=${result.focus_topics.length} sidecar=${result.sidecar_path}`
    );
    await maybeWriteReport(report, reportFile);
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

  const frontmatterHintParts = [];

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

  if (command === "sync") {
    const workflowResult = await runSyncWorkflow(targets, {
      runMode: parsed.flags.get("--mode") ?? "cli",
      provider: parsed.flags.get("--provider") ?? "auto",
      applyFixes: !parsed.flags.get("--no-fix"),
      allowUnsafeFixes: parsed.flags.get("--allow-unsafe-fixes") === true,
      generateFrontmatter: parsed.flags.get("--no-generate-frontmatter")
        ? false
        : true,
      frontmatterHintText: frontmatterHintParts.join("\n").trim(),
      writeMarkdown: true,
      model: parsed.flags.get("--model"),
      force: parsed.flags.get("--force") === true,
    });
    const report = buildReport(command, workflowResult.postResults, {
      home_panel_skipped: workflowResult.homePanelResult?.skipped === true,
      home_panel_generated: Boolean(
        workflowResult.homePanelResult &&
          workflowResult.homePanelResult.skipped !== true
      ),
    });

    report.home_panel = workflowResult.homePanelResult;
    printAnalyzeReport(report);
    printHomePanelResult(workflowResult.homePanelResult);
    await maybeWriteReport(report, reportFile);
    return;
  }

  const results = await analyzePosts(targets, {
    runMode:
      parsed.flags.get("--mode") ?? (command === "build-panel" ? "build" : "cli"),
    provider: parsed.flags.get("--provider") ?? "auto",
    applyFixes:
      command === "build-panel" ? false : !parsed.flags.get("--no-fix"),
    allowUnsafeFixes: parsed.flags.get("--allow-unsafe-fixes") === true,
    generateFrontmatter: parsed.flags.get("--generate-frontmatter") === true,
    frontmatterHintText: frontmatterHintParts.join("\n").trim(),
    writeMarkdown: command !== "build-panel",
    model: parsed.flags.get("--model"),
    force: parsed.flags.get("--force") === true,
  });
  const report = buildReport(command, results);
  printAnalyzeReport(report);
  await maybeWriteReport(report, reportFile);
}

main().catch(error => {
  writeStderr(`[agent] ${error.message}`);
  process.exitCode = 1;
});
