#!/usr/bin/env node
// @ts-nocheck

import {
  analyzePosts,
  rebuildMemory,
  refreshMemoryEntries,
} from "../src/agent/analyzer.js";
import { BLOG_ROOT } from "../src/agent/constants.js";
import { listMarkdownFiles, writeJson } from "../src/agent/fs.js";
import { getChangedPostPaths } from "../src/agent/git.js";
import { getPostIdFromFilePath, resolvePostInput } from "../src/agent/pathing.js";
import { MemoryStore } from "../src/agent/memory-store.js";
import { maxSeverity } from "../src/agent/utils.js";

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
    "--no-fix",
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
  writeStdout("  node scripts/blog-agent.js analyze <post>");
  writeStdout("  node scripts/blog-agent.js analyze --changed");
  writeStdout("  node scripts/blog-agent.js analyze --all");
  writeStdout("  node scripts/blog-agent.js build-panel <post|--changed|--all>");
  writeStdout("  node scripts/blog-agent.js refresh-memory all");
  writeStdout("  node scripts/blog-agent.js refresh-memory post <post>");
  writeStdout("  node scripts/blog-agent.js refresh-memory series <series-id>");
}

async function collectTargets(command, parsed) {
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

  const target = parsed.positionals[1];

  if (!target) {
    throw new Error(`Missing target for command: ${command}`);
  }

  return [await resolvePostInput(target)];
}

function buildReport(command, results) {
  const hardChecks = results.flatMap(result => result.hard_checks ?? []);
  const summary = {
    command,
    processed: results.length,
    highest_severity: maxSeverity(results.map(result => result.severity ?? "info")),
    error_count: hardChecks.filter(issue => issue.severity === "error").length,
    warn_count: hardChecks.filter(issue => issue.severity === "warn").length,
    fix_count: results.reduce(
      (count, result) => count + (result.fixes_applied?.length ?? 0),
      0
    ),
  };

  return {
    generated_at: new Date().toISOString(),
    summary,
    results,
  };
}

function printAnalyzeReport(report) {
  writeStdout(
    `[agent] processed=${report.summary.processed} severity=${report.summary.highest_severity} errors=${report.summary.error_count} warnings=${report.summary.warn_count} fixes=${report.summary.fix_count}`
  );

  for (const result of report.results) {
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

async function maybeWriteReport(report, reportFile) {
  if (!reportFile) {
    return;
  }

  await writeJson(reportFile, report);
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed.positionals[0];

  if (!command || command === "--help" || command === "help") {
    printUsage();
    return;
  }

  if (!["analyze", "build-panel", "refresh-memory"].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  const targets = await collectTargets(command, parsed);
  const reportFile = parsed.flags.get("--report-file");

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

  const results = await analyzePosts(targets, {
    runMode: parsed.flags.get("--mode") ?? (command === "build-panel" ? "build" : "cli"),
    provider: parsed.flags.get("--provider") ?? "auto",
    applyFixes:
      command === "build-panel" ? false : !parsed.flags.get("--no-fix"),
    allowUnsafeFixes: parsed.flags.get("--allow-unsafe-fixes") === true,
    writeMarkdown: command !== "build-panel",
    model: parsed.flags.get("--model"),
  });
  const report = buildReport(command, results);
  printAnalyzeReport(report);
  await maybeWriteReport(report, reportFile);
}

main().catch(error => {
  writeStderr(`[agent] ${error.message}`);
  process.exitCode = 1;
});
