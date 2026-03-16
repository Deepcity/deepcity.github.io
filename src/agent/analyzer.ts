// @ts-nocheck
import fs from "node:fs/promises";
import { DEFAULT_PROVIDER, DEFAULT_RUN_MODE } from "./constants.js";
import { writeJson } from "./fs.js";
import { MemoryStore } from "./memory-store.js";
import { createProvider } from "./provider.js";
import { createHeuristicProvider } from "./providers/heuristic.js";
import { loadPostSnapshot } from "./post-snapshot.js";
import { runChecks } from "./checks.js";
import { loadContentSchemaRules } from "./schema.js";
import { isoNow, maxSeverity } from "./utils.js";

function buildReviewInput(snapshot, checkResult) {
  return {
    post: {
      id: snapshot.post_id,
      title: snapshot.title,
      description:
        typeof checkResult.document.data.description === "string"
          ? checkResult.document.data.description
          : snapshot.description,
      tags: checkResult.currentTags,
      excerpt: snapshot.excerpt,
    },
    analysis: snapshot.analysis,
    issues: checkResult.issues,
    actionItems: checkResult.actionItems,
    suggestions: checkResult.suggestions,
  };
}

function buildSidecar(
  snapshot,
  review,
  checkResult,
  provider,
  providerNotes,
  runMode
) {
  return {
    post_id: snapshot.post_id,
    title: snapshot.title,
    source_path: snapshot.file_path,
    route_path: snapshot.route_path,
    source_hash: snapshot.source_hash,
    generated_at: isoNow(),
    run_mode: runMode,
    provider: provider.name,
    model: provider.model,
    summary: review.summary || snapshot.excerpt,
    structural_review: review.structural_review,
    technical_review: review.technical_review,
    strengths: review.strengths,
    concerns: review.concerns,
    action_items: review.action_items,
    severity: maxSeverity([
      review.severity,
      ...checkResult.issues.map(issue => issue.severity),
    ]),
    confidence: review.confidence,
    memory_refs: review.memory_refs,
    series_key: checkResult.series?.id ?? null,
    series_label: checkResult.series?.label ?? null,
    published_at: snapshot.pubDatetime,
    tags_snapshot: checkResult.currentTags,
    hard_checks: checkResult.issues,
    fixes_applied: checkResult.fixesApplied,
    safe_fix_codes: checkResult.safe_fix_codes,
    suggestions: checkResult.suggestions,
    notes: providerNotes,
  };
}

function buildMinimalSidecar(snapshot, existingSidecar = null) {
  return (
    existingSidecar ?? {
      post_id: snapshot.post_id,
      title: snapshot.title,
      source_path: snapshot.file_path,
      route_path: snapshot.route_path,
      source_hash: snapshot.source_hash,
      generated_at: isoNow(),
      run_mode: "build",
      provider: "memory-refresh",
      model: "memory-refresh",
      summary: snapshot.excerpt,
      structural_review: "",
      technical_review: "",
      strengths: [],
      concerns: [],
      action_items: [],
      severity: "info",
      confidence: 0.5,
      memory_refs: [],
      series_key: null,
      series_label: null,
      published_at: snapshot.pubDatetime,
      tags_snapshot: snapshot.tags,
      hard_checks: [],
      fixes_applied: [],
      safe_fix_codes: [],
      suggestions: {},
      notes: [],
    }
  );
}

export async function analyzePost(filePath, options = {}) {
  const runMode = options.runMode ?? DEFAULT_RUN_MODE;
  const providerName = options.provider ?? DEFAULT_PROVIDER;
  const memoryStore = options.memoryStore ?? new MemoryStore();
  await memoryStore.ensureLayout();

  const [schemaRules, globalRules] = await Promise.all([
    loadContentSchemaRules(),
    memoryStore.loadGlobalRules(),
  ]);
  let snapshot = await loadPostSnapshot(filePath);
  const checkResult = runChecks(snapshot, schemaRules, globalRules, {
    filePath,
    applyFixes: options.applyFixes !== false,
    allowUnsafeFixes: options.allowUnsafeFixes === true,
  });

  if (
    checkResult.contentChanged &&
    options.writeMarkdown !== false &&
    snapshot.document.hasFrontmatter
  ) {
    await fs.writeFile(filePath, checkResult.changedSource, "utf8");
    snapshot = await loadPostSnapshot(filePath);
  }

  const memoryContext = await memoryStore.loadSeriesContext(
    snapshot.post_id,
    checkResult.series?.id,
    checkResult.currentTags
  );
  const { provider, notes } = createProvider({
    provider: providerName,
    model: options.model,
    apiKey: options.apiKey,
  });
  const reviewInput = buildReviewInput(snapshot, checkResult);
  let activeProvider = provider;
  const providerNotes = [...notes];
  let review;

  try {
    review = await activeProvider.generateReview(reviewInput, memoryContext);
  } catch (error) {
    providerNotes.push(
      `Provider ${activeProvider.name} failed: ${error.message}; using heuristic review.`
    );
    activeProvider = createHeuristicProvider();
    review = await activeProvider.generateReview(reviewInput, memoryContext);
  }

  if (checkResult.contentChanged && !snapshot.document.hasFrontmatter) {
    providerNotes.push(
      "Post has no frontmatter; Agent skipped write-back and only emitted review sidecar."
    );
  }

  const sidecar = buildSidecar(
    snapshot,
    review,
    checkResult,
    activeProvider,
    providerNotes,
    runMode
  );

  await writeJson(snapshot.sidecar_path, sidecar);

  if (options.updateMemory !== false) {
    await memoryStore.applyUpdates(sidecar);
  }

  return {
    post_id: sidecar.post_id,
    title: sidecar.title,
    source_path: sidecar.source_path,
    sidecar_path: snapshot.sidecar_path,
    route_path: sidecar.route_path,
    provider: sidecar.provider,
    model: sidecar.model,
    severity: sidecar.severity,
    hard_checks: sidecar.hard_checks,
    concerns: sidecar.concerns,
    action_items: sidecar.action_items,
    fixes_applied: sidecar.fixes_applied,
    notes: sidecar.notes,
  };
}

export async function analyzePosts(filePaths, options = {}) {
  const results = [];

  for (const filePath of filePaths) {
    results.push(await analyzePost(filePath, options));
  }

  return results;
}

export async function refreshMemoryEntries(filePaths) {
  const memoryStore = new MemoryStore();
  await memoryStore.ensureLayout();
  const results = [];

  for (const filePath of filePaths) {
    const snapshot = await loadPostSnapshot(filePath);
    const existingSidecar = await memoryStore.loadPostMemory(filePath);
    const sidecar = buildMinimalSidecar(snapshot, existingSidecar);
    await memoryStore.applyUpdates(sidecar);
    results.push({
      post_id: snapshot.post_id,
      source_path: snapshot.file_path,
      severity: sidecar.severity,
      hard_checks: [],
      concerns: [],
      action_items: [],
      fixes_applied: [],
      notes: [],
    });
  }

  return results;
}

export async function rebuildMemory(postPaths) {
  const memoryStore = new MemoryStore();
  await memoryStore.ensureLayout();
  return memoryStore.rebuildAll(postPaths);
}
