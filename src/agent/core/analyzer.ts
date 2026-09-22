import fs from "node:fs/promises";
import { DEFAULT_PROVIDER, DEFAULT_RUN_MODE } from "../shared/constants.js";
import { readJsonIfExists, writeJson } from "../shared/fs.js";
import { MemoryStore } from "../memory/memory-store.js";
import { createProvider } from "../providers/index.js";
import { createHeuristicProvider } from "../providers/heuristic.js";
import { loadPostSnapshot } from "../parsers/post-snapshot.js";
import { runChecks } from "./checks.js";
import {
  generateFrontmatter,
  parseFrontmatterHints,
} from "./frontmatter-generator.js";
import {
  getAssistableFields,
  hasAssistableField,
  requestFrontmatterAssist,
} from "./frontmatter-assist.js";
import { getKnowledgeForPost, loadKnowledgeMap } from "./knowledge.js";
import type { KnowledgeMap } from "./knowledge.js";
import { loadContentSchemaRules } from "../parsers/schema.js";
import { hashContent, isoNow, maxSeverity } from "../shared/utils.js";
import type { ReviewInput } from "../providers/gemini.js";
import type {
  AnalyzeOptions,
  AnalyzeResult,
  CheckResult,
  KnowledgePosition,
  MemoryUpdateInput,
  PostSidecar,
  PostSnapshot,
  RelatedPost,
  Review,
  ReviewProvider,
} from "../types.js";

type KnowledgeContext =
  | (KnowledgePosition & {
      post_id: string;
      related_posts?: RelatedPost[];
      memory_refs?: string[];
    })
  | null;

// Everything that changes what the LLM would say. Knowledge context is
// deliberately excluded: it only affects related_posts / knowledge_position,
// which are patched in place without a new LLM call (see refreshSidecarKnowledge).
export function buildReviewKey({
  sourceHash,
  provider,
  model,
  promptVersion,
}: {
  sourceHash: string;
  provider: string;
  model: string;
  promptVersion?: string | null;
}): string {
  return hashContent(
    [sourceHash, provider, model, promptVersion ?? ""].join("\n")
  );
}

function buildReviewInput(
  snapshot: PostSnapshot,
  checkResult: CheckResult,
  knowledgeContext: KnowledgeContext
): ReviewInput {
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
      body: snapshot.body ?? snapshot.document?.body ?? "",
      agentExperiment: snapshot.document.data.agentExperiment === true,
      agentExperimentNote:
        typeof snapshot.document.data.agentExperimentNote === "string"
          ? snapshot.document.data.agentExperimentNote
          : "",
    },
    analysis: snapshot.analysis,
    issues: checkResult.issues,
    actionItems: checkResult.actionItems,
    suggestions: checkResult.suggestions,
    knowledge: knowledgeContext,
  };
}

function buildKnowledgePosition(
  knowledgeContext: KnowledgeContext
): KnowledgePosition | null {
  if (!knowledgeContext) {
    return null;
  }

  return {
    series_id: knowledgeContext.series_id,
    series_label: knowledgeContext.series_label,
    role: knowledgeContext.role,
    previous_posts: knowledgeContext.previous_posts ?? [],
    next_posts: knowledgeContext.next_posts ?? [],
    topic_neighbors: knowledgeContext.topic_neighbors ?? [],
    position_summary: knowledgeContext.position_summary,
  };
}

function resolveRelatedPosts(
  relatedPostIds: string[] | undefined,
  knowledgeContext: KnowledgeContext
): RelatedPost[] {
  const allowedPosts = knowledgeContext?.related_posts ?? [];
  const requestedIds = new Set(relatedPostIds ?? []);

  if (requestedIds.size === 0) {
    return allowedPosts.slice(0, 3);
  }

  return allowedPosts
    .filter(post => requestedIds.has(post.post_id))
    .slice(0, 3);
}

function buildSidecar(
  snapshot: PostSnapshot,
  review: Review,
  checkResult: CheckResult,
  provider: ReviewProvider,
  providerNotes: string[],
  runMode: string,
  knowledgeMap: { knowledge_hash?: string | null } | null,
  knowledgeContext: KnowledgeContext,
  degraded: boolean,
  degradedReason: string | null,
  reviewKey: string
): PostSidecar {
  return {
    post_id: snapshot.post_id,
    title: snapshot.title,
    source_path: snapshot.file_path,
    route_path: snapshot.route_path,
    source_hash: snapshot.source_hash,
    review_key: reviewKey,
    prompt_version: provider.prompt_version ?? null,
    generated_at: isoNow(),
    run_mode: runMode,
    provider: provider.name,
    model: provider.model,
    degraded,
    degraded_reason: degradedReason,
    agent_experiment: snapshot.document.data.agentExperiment === true,
    agent_experiment_note:
      typeof snapshot.document.data.agentExperimentNote === "string"
        ? snapshot.document.data.agentExperimentNote
        : "",
    public_commentary: review.public_commentary ?? "",
    related_post_ids: review.related_post_ids ?? [],
    related_posts: resolveRelatedPosts(
      review.related_post_ids,
      knowledgeContext
    ),
    summary: review.summary || snapshot.excerpt,
    structural_review: review.structural_review,
    technical_review: review.technical_review,
    strengths: review.strengths,
    concerns: review.concerns,
    action_items: review.action_items,
    severity: maxSeverity([
      review.severity,
      ...checkResult.issues.map(
        (issue: { severity: string }) => issue.severity
      ),
    ]),
    confidence: review.confidence,
    memory_refs: review.memory_refs,
    knowledge_hash: knowledgeMap?.knowledge_hash ?? null,
    knowledge_refs: knowledgeContext?.memory_refs ?? [],
    knowledge_position: buildKnowledgePosition(knowledgeContext),
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

// Patches the knowledge-derived fields of an existing sidecar when only the
// knowledge map changed. No LLM call: the review text itself is still valid.
export function refreshSidecarKnowledge(
  sidecar: PostSidecar,
  knowledgeMap: { knowledge_hash?: string | null } | null,
  knowledgeContext: KnowledgeContext
): PostSidecar {
  return {
    ...sidecar,
    related_posts: resolveRelatedPosts(
      sidecar.related_post_ids ?? [],
      knowledgeContext
    ),
    knowledge_hash: knowledgeMap?.knowledge_hash ?? null,
    knowledge_refs: knowledgeContext?.memory_refs ?? [],
    knowledge_position: buildKnowledgePosition(knowledgeContext),
    knowledge_refreshed_at: isoNow(),
  };
}

function buildMinimalSidecar(
  snapshot: PostSnapshot,
  existingSidecar: PostSidecar | null = null
): MemoryUpdateInput {
  return (existingSidecar ?? {
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
    severity: "info" as const,
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
  }) as MemoryUpdateInput;
}

function buildSkippedResult(
  snapshot: PostSnapshot,
  sidecar: PostSidecar,
  notes: string[],
  extra: Partial<AnalyzeResult> = {}
): AnalyzeResult {
  return {
    post_id: snapshot.post_id,
    title: snapshot.title,
    source_path: snapshot.file_path,
    sidecar_path: snapshot.sidecar_path,
    route_path: snapshot.route_path,
    provider: sidecar.provider,
    model: sidecar.model,
    severity: sidecar.severity,
    hard_checks: sidecar.hard_checks ?? [],
    concerns: sidecar.concerns ?? [],
    action_items: sidecar.action_items ?? [],
    fixes_applied: [],
    notes,
    degraded: sidecar.degraded === true,
    degraded_reason: sidecar.degraded_reason ?? null,
    knowledge_stale: false,
    skipped: true,
    ...extra,
  };
}

// Decides whether an existing sidecar can be kept. Returns null when a fresh
// review is needed, otherwise a reason string for the report.
export function resolveSkipReason({
  existingSidecar,
  snapshot,
  provider,
  requestedProvider,
  reviewKey,
}: {
  existingSidecar: PostSidecar | null;
  snapshot: Pick<PostSnapshot, "source_hash">;
  provider: Pick<ReviewProvider, "name">;
  requestedProvider: string;
  reviewKey: string;
}): string | null {
  if (!existingSidecar) {
    return null;
  }

  const sameSource = existingSidecar.source_hash === snapshot.source_hash;
  const fellBackToHeuristic =
    requestedProvider !== "heuristic" && provider.name === "heuristic";

  // Auto mode without an LLM available: never downgrade an LLM-generated
  // sidecar to heuristic output just because the key is missing right now.
  if (
    fellBackToHeuristic &&
    sameSource &&
    existingSidecar.provider !== "heuristic" &&
    existingSidecar.degraded !== true
  ) {
    return "preserved: existing LLM review kept because no LLM provider is available";
  }

  if (existingSidecar.review_key !== reviewKey) {
    return null;
  }

  if (existingSidecar.degraded === true) {
    // A degraded sidecar is only "good enough" when nothing better is possible.
    return provider.name === "heuristic"
      ? "skipped: degraded review kept; no LLM provider available"
      : null;
  }

  return "skipped: review_key unchanged";
}

export async function analyzePost(
  filePath: string,
  options: AnalyzeOptions & {
    deferMemoryUpdate?: (sidecar: PostSidecar) => void;
  } = {}
): Promise<AnalyzeResult> {
  const runMode = options.runMode ?? DEFAULT_RUN_MODE;
  const providerName = options.provider ?? DEFAULT_PROVIDER;
  const memoryStore = (options.memoryStore as MemoryStore) ?? new MemoryStore();
  await memoryStore.ensureLayout();

  const [schemaRules, globalRules] = await Promise.all([
    loadContentSchemaRules(),
    memoryStore.loadGlobalRules(),
  ]);
  let snapshot = await loadPostSnapshot(filePath);
  const knowledgeMap = (options.knowledgeMap ??
    (await loadKnowledgeMap())) as KnowledgeMap | null;
  const knowledgeContext = getKnowledgeForPost(knowledgeMap, snapshot.post_id);
  const { provider, notes } = createProvider({
    provider: providerName,
    model: options.model,
    apiKey: options.apiKey,
  });

  if (options.force !== true) {
    const existingSidecar = await readJsonIfExists<PostSidecar>(
      snapshot.sidecar_path
    );
    const skipReason = resolveSkipReason({
      existingSidecar,
      snapshot,
      provider,
      requestedProvider: providerName,
      reviewKey: buildReviewKey({
        sourceHash: snapshot.source_hash,
        provider: provider.name,
        model: provider.model,
        promptVersion: provider.prompt_version,
      }),
    });

    // resolveSkipReason only returns a reason when a sidecar exists.
    if (skipReason && existingSidecar) {
      const skipNotes = [skipReason];
      const knowledgeHash = knowledgeMap?.knowledge_hash ?? null;
      const knowledgeStale =
        Boolean(knowledgeHash) &&
        existingSidecar.knowledge_hash !== knowledgeHash;
      let sidecar = existingSidecar;
      // Read-only mode reports the drift but must not touch the working tree.
      const refreshKnowledge = knowledgeStale && options.regenerate !== false;

      if (refreshKnowledge) {
        sidecar = refreshSidecarKnowledge(
          existingSidecar,
          knowledgeMap,
          knowledgeContext
        );
        await writeJson(snapshot.sidecar_path, sidecar);
        skipNotes.push(
          `knowledge refreshed without LLM: ${existingSidecar.knowledge_hash ?? "(none)"} -> ${knowledgeHash}`
        );
      } else if (knowledgeStale) {
        skipNotes.push(
          `stale knowledge refs: ${existingSidecar.knowledge_hash ?? "(none)"} -> ${knowledgeHash}; run \`./agent ${snapshot.post_id}\` locally and commit the sidecar.`
        );
      }

      return buildSkippedResult(snapshot, sidecar, skipNotes, {
        knowledge_refreshed: refreshKnowledge,
        ...(knowledgeStale && !refreshKnowledge
          ? { stale: true, stale_status: "stale" as const }
          : {}),
      });
    }

    // Read-only mode (CI): report what a real run would regenerate, but never
    // call a provider or write anything.
    if (options.regenerate === false) {
      const status = existingSidecar ? "stale" : "missing";
      const detail = existingSidecar
        ? existingSidecar.degraded === true
          ? "existing sidecar is a degraded (heuristic) review"
          : existingSidecar.source_hash !== snapshot.source_hash
            ? "post source changed since the sidecar was generated"
            : "provider/model/prompt changed since the sidecar was generated"
        : "no sidecar committed for this post";

      return {
        post_id: snapshot.post_id,
        title: snapshot.title,
        source_path: snapshot.file_path,
        sidecar_path: snapshot.sidecar_path,
        route_path: snapshot.route_path,
        provider: existingSidecar?.provider ?? null,
        model: existingSidecar?.model ?? null,
        severity: "warn",
        hard_checks: [],
        concerns: [],
        action_items: [],
        fixes_applied: [],
        notes: [
          `${status}: ${detail}; run \`./agent ${snapshot.post_id}\` locally and commit the sidecar.`,
        ],
        degraded: existingSidecar?.degraded === true,
        degraded_reason: existingSidecar?.degraded_reason ?? null,
        knowledge_stale: false,
        skipped: true,
        stale: true,
        stale_status: status,
      };
    }
  }
  const frontmatterPreparationNotes: string[] = [];
  const frontmatterPreparationFixes: string[] = [];

  if (options.generateFrontmatter === true && options.writeMarkdown !== false) {
    // Ask the model for description/tags only when those fields actually need
    // filling; otherwise the rule-based generator runs alone, as before.
    const assistableFields = getAssistableFields(snapshot, schemaRules, {
      structured: parseFrontmatterHints(options.frontmatterHintText ?? "")
        .structured,
    });
    const assist = hasAssistableField(assistableFields)
      ? await requestFrontmatterAssist(
          snapshot,
          globalRules,
          assistableFields,
          {
            provider: providerName,
            model: options.model,
            apiKey: options.apiKey,
            hintText: options.frontmatterHintText,
          }
        )
      : null;

    if (assist?.notes.length) {
      frontmatterPreparationNotes.push(...assist.notes);
    }

    const generationResult = generateFrontmatter(
      snapshot,
      schemaRules,
      globalRules,
      {
        hintText: options.frontmatterHintText,
        assist,
      }
    );

    if (generationResult.changed) {
      await fs.writeFile(filePath, generationResult.source, "utf8");
      snapshot = await loadPostSnapshot(filePath);

      if (generationResult.appliedFields.length > 0) {
        frontmatterPreparationFixes.push(
          generationResult.createdFrontmatter
            ? `生成完整 frontmatter：${generationResult.appliedFields.join("、")}。`
            : `补全 frontmatter 字段：${generationResult.appliedFields.join("、")}。`
        );
      }

      if (generationResult.hints.freeform.length > 0) {
        frontmatterPreparationNotes.push(
          "Frontmatter generation used user-provided hints."
        );
      }
    }
  }

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
  const reviewInput = buildReviewInput(snapshot, checkResult, knowledgeContext);
  let activeProvider = provider;
  const providerNotes = [...frontmatterPreparationNotes, ...notes];
  let degraded = activeProvider.name === "heuristic";
  let degradedReason: string | null = degraded
    ? (notes[0] ??
      "Heuristic provider selected; Gemini public commentary was not generated.")
    : null;
  let review: Review;

  if (frontmatterPreparationFixes.length > 0) {
    checkResult.fixesApplied = [
      ...frontmatterPreparationFixes,
      ...checkResult.fixesApplied,
    ];
  }

  try {
    review = await activeProvider.generateReview(reviewInput, memoryContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    providerNotes.push(
      `Provider ${activeProvider.name} failed: ${message}; using heuristic review.`
    );
    degraded = true;
    degradedReason = `Provider ${activeProvider.name} failed: ${message}`;
    activeProvider = createHeuristicProvider();
    review = await activeProvider.generateReview(reviewInput, memoryContext);
  }

  providerNotes.push(...(review.notes ?? []));

  if (checkResult.contentChanged && !snapshot.document.hasFrontmatter) {
    providerNotes.push(
      "Post has no frontmatter; Agent skipped write-back and only emitted review sidecar."
    );
  }

  // The key records what we *asked for*, so a degraded run with the same
  // inputs is retried next time instead of being pinned by a matching key.
  const reviewKey = buildReviewKey({
    sourceHash: snapshot.source_hash,
    provider: provider.name,
    model: provider.model,
    promptVersion: provider.prompt_version,
  });
  const sidecar = buildSidecar(
    snapshot,
    review,
    checkResult,
    activeProvider,
    providerNotes,
    runMode,
    knowledgeMap,
    knowledgeContext,
    degraded,
    degradedReason,
    reviewKey
  );

  await writeJson(snapshot.sidecar_path, sidecar);

  if (options.updateMemory !== false) {
    if (typeof options.deferMemoryUpdate === "function") {
      // Batch runs serialize memory writes themselves (see analyzePosts).
      options.deferMemoryUpdate(sidecar);
    } else {
      await memoryStore.applyUpdates(sidecar);
    }
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
    degraded: sidecar.degraded === true,
    degraded_reason: sidecar.degraded_reason ?? null,
    knowledge_stale: false,
  };
}

function resolveConcurrency(options: AnalyzeOptions): number {
  const raw = Number(options.concurrency ?? process.env.BLOG_AGENT_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 2;
}

// Posts are reviewed with bounded parallelism (LLM calls dominate wall time),
// but the shared memory JSON stores are updated sequentially afterwards in
// input order so results stay deterministic and free of write races.
export async function analyzePosts(
  filePaths: string[],
  options: AnalyzeOptions = {}
): Promise<AnalyzeResult[]> {
  const concurrency = Math.min(resolveConcurrency(options), filePaths.length);
  const memoryStore = (options.memoryStore as MemoryStore) ?? new MemoryStore();

  if (concurrency <= 1) {
    const results: AnalyzeResult[] = [];

    for (const filePath of filePaths) {
      results.push(await analyzePost(filePath, { ...options, memoryStore }));
    }

    return results;
  }

  const results: AnalyzeResult[] = new Array(filePaths.length);
  const deferredSidecars: Array<PostSidecar | null> = new Array(
    filePaths.length
  ).fill(null);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < filePaths.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await analyzePost(filePaths[index], {
        ...options,
        memoryStore,
        deferMemoryUpdate: sidecar => {
          deferredSidecars[index] = sidecar;
        },
      });
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (options.updateMemory !== false) {
    for (const sidecar of deferredSidecars) {
      if (sidecar) {
        await memoryStore.applyUpdates(sidecar);
      }
    }
  }

  return results;
}

export async function refreshMemoryEntries(
  filePaths: string[]
): Promise<Array<Partial<AnalyzeResult>>> {
  const memoryStore = new MemoryStore();
  await memoryStore.ensureLayout();
  const results: Array<Partial<AnalyzeResult>> = [];

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

export async function rebuildMemory(postPaths: string[]) {
  const memoryStore = new MemoryStore();
  await memoryStore.ensureLayout();
  return memoryStore.rebuildAll(postPaths);
}
