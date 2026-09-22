import fs from "node:fs/promises";
import { parseDocument } from "yaml";
import {
  BLOG_ROOT,
  KNOWLEDGE_MAP_PATH,
  KNOWLEDGE_OVERRIDES_PATH,
  KNOWLEDGE_ROOT,
  REPO_ROOT,
} from "../shared/constants.js";
import {
  ensureDir,
  fileExists,
  listMarkdownFiles,
  readJsonIfExists,
  readText,
  writeJsonIfChanged,
} from "../shared/fs.js";
import { MemoryStore } from "../memory/memory-store.js";
import { loadPostSnapshot } from "../parsers/post-snapshot.js";
import {
  dedupeStrings,
  hashContent,
  isoNow,
  repoRelative,
  truncateText,
} from "../shared/utils.js";
import type {
  GlobalRules,
  KnowledgeRefreshResult,
  PostSnapshot,
  RawJson,
  RelatedPost,
  Severity,
} from "../types.js";

interface SeriesDefinition {
  id: string;
  label: string;
  id_pattern: string | null;
  tag_triggers: string[];
  role_label: string | null;
  expected_total: number | null;
  open_ended: boolean;
  order: string[];
  source: string;
}

interface PostOverride {
  series_id: string | null;
  role: string | null;
  previous: string[];
  next: string[];
  topic_neighbors: string[];
  reader_context: string | null;
  position_summary: string | null;
}

interface KnowledgeOverrides {
  version: number;
  series: Record<string, { id: string; label: string; order: string[] }>;
  posts: Record<string, PostOverride>;
}

interface KnowledgeIssue {
  code: string;
  severity: Severity;
  message: string;
}

export interface KnowledgeMapEntry {
  post_id: string;
  title: string;
  source_path: string;
  route_path: string;
  series_id: string | null;
  series_label: string | null;
  role: string;
  previous_posts: string[];
  next_posts: string[];
  topic_neighbors: string[];
  related_posts: RelatedPost[];
  position_summary: string;
  memory_refs: string[];
}

export interface KnowledgeMap {
  version: number;
  series: Array<{
    id: string;
    label: string;
    role_label: string | null;
    post_ids: string[];
    expected_total: number | null;
    open_ended: boolean;
    source: string;
  }>;
  posts: KnowledgeMapEntry[];
  issues: KnowledgeIssue[];
  generated_at: string;
  knowledge_hash: string;
  source: { post_count: number; overrides_path: string };
}

export interface BuildKnowledgeMapOptions {
  memoryStore?: { loadGlobalRules(): Promise<GlobalRules> };
  postPaths?: string[];
  globalRules?: GlobalRules;
  overrides?: KnowledgeOverrides;
  snapshots?: PostSnapshot[];
}

const DEFAULT_OVERRIDES = `# Blog Agent knowledge overrides
# 只写明显需要人工纠错的例外；没写的部分全部由 Agent 自动推断。
#
# series:
#   ascendc:
#     label: "Ascend C 算子开发"
#     order:
#       - "AscendC-part1-basic-concept"
#       - "AscendC-part2-tiling-and-debug"
#
# posts:
#   AscendC-part5-pytorch-summary:
#     role: "阶段总结"
#     previous:
#       - "AscendC-part4-operator-invocation"
#     reader_context: "这篇更适合作为系列收束篇，而不是入门篇。"

version: 1
series: {}
posts: {}
`;

function isObject(value: unknown): value is Record<string, RawJson> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(item => String(item).trim()).filter(Boolean);
}

function createEmptyPostOverride(): PostOverride {
  return {
    series_id: null,
    role: null,
    previous: [],
    next: [],
    topic_neighbors: [],
    reader_context: null,
    position_summary: null,
  };
}

function normalizeOverridePost(rawPost: unknown): PostOverride {
  const fallback = createEmptyPostOverride();

  if (!isObject(rawPost)) {
    return fallback;
  }

  return {
    ...fallback,
    series_id: String(rawPost.series_id ?? rawPost.series ?? "").trim() || null,
    role: String(rawPost.role ?? "").trim() || null,
    previous: asArray(rawPost.previous ?? rawPost.previous_posts),
    next: asArray(rawPost.next ?? rawPost.next_posts),
    topic_neighbors: asArray(rawPost.topic_neighbors),
    reader_context: String(rawPost.reader_context ?? "").trim() || null,
    position_summary:
      String(rawPost.position_summary ?? "").trim() ||
      String(rawPost.reader_context ?? "").trim() ||
      null,
  };
}

function normalizeOverrides(rawOverrides: RawJson): KnowledgeOverrides {
  const rawSeries = isObject(rawOverrides?.series) ? rawOverrides.series : {};
  const rawPosts = isObject(rawOverrides?.posts) ? rawOverrides.posts : {};
  const series: KnowledgeOverrides["series"] = {};
  const posts: KnowledgeOverrides["posts"] = {};

  for (const [seriesId, rawSeriesEntry] of Object.entries(rawSeries)) {
    if (!isObject(rawSeriesEntry)) {
      continue;
    }

    series[seriesId] = {
      id: seriesId,
      label: String(rawSeriesEntry.label ?? seriesId).trim() || seriesId,
      order: asArray(rawSeriesEntry.order ?? rawSeriesEntry.post_ids),
    };
  }

  for (const [postId, rawPost] of Object.entries(rawPosts)) {
    posts[postId] = normalizeOverridePost(rawPost);
  }

  return {
    version: Number(rawOverrides?.version ?? 1),
    series,
    posts,
  };
}

async function ensureDefaultOverrides(): Promise<void> {
  await ensureDir(KNOWLEDGE_ROOT);

  if (!(await fileExists(KNOWLEDGE_OVERRIDES_PATH))) {
    await fs.writeFile(KNOWLEDGE_OVERRIDES_PATH, DEFAULT_OVERRIDES, "utf8");
  }
}

export async function loadKnowledgeOverrides(): Promise<KnowledgeOverrides> {
  await ensureDefaultOverrides();

  const source = await readText(KNOWLEDGE_OVERRIDES_PATH);
  const document = parseDocument(source, {
    prettyErrors: true,
  });

  if (document.errors.length > 0) {
    const detail = document.errors.map(error => error.message).join("; ");
    throw new Error(`Invalid knowledge overrides YAML: ${detail}`);
  }

  return normalizeOverrides(document.toJSON() ?? {});
}

function buildSeriesDefinitions(
  globalRules: GlobalRules,
  overrides: KnowledgeOverrides
): Map<string, SeriesDefinition> {
  const definitions = new Map<string, SeriesDefinition>();

  for (const rule of globalRules.series_naming_rules ?? []) {
    definitions.set(rule.id, {
      id: rule.id,
      label: rule.label ?? rule.id,
      id_pattern: rule.id_pattern ?? null,
      tag_triggers: rule.tag_triggers ?? [],
      role_label: rule.role_label ?? null,
      expected_total: rule.expected_total ?? null,
      open_ended: rule.open_ended ?? true,
      order: rule.known_post_ids ?? [],
      source: "global-rules",
    });
  }

  for (const override of Object.values(overrides.series ?? {})) {
    const existing = definitions.get(override.id);

    definitions.set(override.id, {
      ...(existing ?? {
        id: override.id,
        label: override.id,
        id_pattern: null,
        tag_triggers: [],
        role_label: null,
        expected_total: null,
        open_ended: true,
        order: [],
        source: "override",
      }),
      label: override.label ?? existing?.label ?? override.id,
      order:
        override.order.length > 0 ? override.order : (existing?.order ?? []),
      source: existing ? `${existing.source}+override` : "override",
    });
  }

  return definitions;
}

function detectSeries(
  snapshot: PostSnapshot,
  definitions: Map<string, SeriesDefinition>,
  override?: PostOverride
): string | null {
  if (override?.series_id) {
    return override.series_id;
  }

  // File-name patterns win over tag triggers so an explicitly numbered
  // series is never re-homed by a loosely applied tag.
  for (const definition of definitions.values()) {
    if (
      definition.id_pattern &&
      new RegExp(definition.id_pattern, "u").test(snapshot.post_id)
    ) {
      return definition.id;
    }
  }

  for (const definition of definitions.values()) {
    if (
      (definition.tag_triggers ?? []).some(tag => snapshot.tags.includes(tag))
    ) {
      return definition.id;
    }
  }

  return null;
}

function extractPartNumber(postId: string): number | null {
  const match = postId.match(/part[-_ ]?(\d+)/iu);

  return match ? Number(match[1]) : null;
}

function compareByPublishedAt(left: PostSnapshot, right: PostSnapshot): number {
  return String(left.pubDatetime ?? "").localeCompare(
    String(right.pubDatetime ?? "")
  );
}

function sortSeriesSnapshots(
  snapshots: PostSnapshot[],
  definition?: SeriesDefinition | null
): PostSnapshot[] {
  const order = definition?.order ?? [];
  const orderIndex = new Map(order.map((postId, index) => [postId, index]));

  return [...snapshots].sort((left, right) => {
    const leftOrder = orderIndex.get(left.post_id) ?? Number.POSITIVE_INFINITY;
    const rightOrder =
      orderIndex.get(right.post_id) ?? Number.POSITIVE_INFINITY;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    const leftPart = extractPartNumber(left.post_id);
    const rightPart = extractPartNumber(right.post_id);

    if (leftPart !== null && rightPart !== null && leftPart !== rightPart) {
      return leftPart - rightPart;
    }

    return compareByPublishedAt(left, right);
  });
}

function inferRole(
  snapshot: PostSnapshot,
  seriesInfo: {
    id: string;
    label: string;
    expected_total: number | null;
    role_label?: string | null;
  } | null,
  seriesSnapshots: PostSnapshot[],
  override?: PostOverride
): string {
  if (override?.role) {
    return override.role;
  }

  const index = seriesSnapshots.findIndex(
    item => item.post_id === snapshot.post_id
  );
  const partNumber = extractPartNumber(snapshot.post_id);
  const lowerTitle = snapshot.title.toLowerCase();

  if (!seriesInfo) {
    return "独立文章";
  }

  if (
    /summary|总结|阶段|recap/iu.test(snapshot.post_id) ||
    /summary|总结|阶段|recap/iu.test(lowerTitle)
  ) {
    return "阶段总结";
  }

  if (index === 0 || partNumber === 1) {
    return "系列开篇";
  }

  if (
    seriesInfo.expected_total &&
    index === Math.min(seriesInfo.expected_total, seriesSnapshots.length) - 1
  ) {
    return "阶段总结";
  }

  if (seriesInfo.role_label) {
    return seriesInfo.role_label;
  }

  return `系列第 ${index + 1} 篇`;
}

function sharedTagScore(left: PostSnapshot, right: PostSnapshot): number {
  const rightTags = new Set(right.tags);
  return left.tags.filter(tag => rightTags.has(tag)).length;
}

function buildTopicNeighbors(
  snapshot: PostSnapshot,
  snapshots: PostSnapshot[],
  excludedIds: Set<string>
): string[] {
  return snapshots
    .filter(candidate => candidate.post_id !== snapshot.post_id)
    .filter(candidate => !excludedIds.has(candidate.post_id))
    .map(candidate => ({
      snapshot: candidate,
      score: sharedTagScore(snapshot, candidate),
    }))
    .filter(item => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return String(right.snapshot.pubDatetime ?? "").localeCompare(
        String(left.snapshot.pubDatetime ?? "")
      );
    })
    .slice(0, 3)
    .map(item => item.snapshot.post_id);
}

function describePosition(
  snapshot: PostSnapshot,
  seriesInfo: { label: string } | null,
  role: string,
  previous: string[],
  next: string[]
): string {
  if (!seriesInfo) {
    return `${snapshot.title} 当前被视为独立文章，可通过 tags 与相邻主题文章建立阅读路径。`;
  }

  const neighbors = [
    previous.length > 0 ? `前置文章 ${previous.join("、")}` : "",
    next.length > 0 ? `后续文章 ${next.join("、")}` : "",
  ]
    .filter(Boolean)
    .join("，");
  const suffix = neighbors ? `，${neighbors}` : "";

  return truncateText(
    `这篇文章位于「${seriesInfo.label}」系列中，当前角色是「${role}」${suffix}。`,
    180
  );
}

function buildRelatedPosts(
  postIds: string[],
  snapshotsById: Map<string, PostSnapshot>,
  relation: string
): RelatedPost[] {
  return postIds
    .map(postId => snapshotsById.get(postId))
    .filter((snapshot): snapshot is PostSnapshot => Boolean(snapshot))
    .map(snapshot => ({
      post_id: snapshot.post_id,
      title: snapshot.title,
      route_path: snapshot.route_path,
      relation,
    }));
}

function validateOverrides(
  overrides: KnowledgeOverrides,
  snapshotsById: Map<string, PostSnapshot>,
  definitions: Map<string, SeriesDefinition>
): KnowledgeIssue[] {
  const issues: KnowledgeIssue[] = [];

  for (const [seriesId, series] of Object.entries(overrides.series ?? {})) {
    const seen = new Set();

    for (const postId of series.order ?? []) {
      if (seen.has(postId)) {
        issues.push({
          code: "duplicate-series-order-post",
          severity: "warn",
          message: `Series override \`${seriesId}\` lists \`${postId}\` more than once.`,
        });
      }

      seen.add(postId);

      if (!snapshotsById.has(postId)) {
        issues.push({
          code: "unknown-series-order-post",
          severity: "warn",
          message: `Series override \`${seriesId}\` references unknown post \`${postId}\`.`,
        });
      }
    }
  }

  for (const [postId, override] of Object.entries(overrides.posts ?? {})) {
    if (!snapshotsById.has(postId)) {
      issues.push({
        code: "unknown-post-override",
        severity: "warn",
        message: `Post override references unknown post \`${postId}\`.`,
      });
    }

    if (override.series_id && !definitions.has(override.series_id)) {
      issues.push({
        code: "unknown-post-series",
        severity: "warn",
        message: `Post override \`${postId}\` points to unknown series \`${override.series_id}\`.`,
      });
    }

    for (const field of ["previous", "next", "topic_neighbors"] as const) {
      for (const refId of override[field] ?? []) {
        if (!snapshotsById.has(refId)) {
          issues.push({
            code: "unknown-post-reference",
            severity: "warn",
            message: `Post override \`${postId}\` field \`${field}\` references unknown post \`${refId}\`.`,
          });
        }
      }
    }
  }

  return issues;
}

export async function buildKnowledgeMap(
  options: BuildKnowledgeMapOptions = {}
): Promise<KnowledgeMap> {
  const memoryStore = options.memoryStore ?? new MemoryStore();
  const [postPaths, globalRules, overrides] = await Promise.all([
    options.postPaths
      ? Promise.resolve(options.postPaths)
      : listMarkdownFiles(BLOG_ROOT),
    options.globalRules
      ? Promise.resolve(options.globalRules)
      : memoryStore.loadGlobalRules(),
    options.overrides
      ? Promise.resolve(options.overrides)
      : loadKnowledgeOverrides(),
  ]);
  // `snapshots` can be injected (tests / callers that already loaded them).
  const snapshots = options.snapshots ? [...options.snapshots] : [];

  if (!options.snapshots) {
    for (const filePath of postPaths) {
      snapshots.push(await loadPostSnapshot(filePath));
    }
  }

  const snapshotsById = new Map(
    snapshots.map(snapshot => [snapshot.post_id, snapshot])
  );
  const definitions = buildSeriesDefinitions(globalRules, overrides);
  const postSeries = new Map<string, string | null>();

  for (const snapshot of snapshots) {
    const override = overrides.posts?.[snapshot.post_id];
    const seriesId = detectSeries(snapshot, definitions, override);

    postSeries.set(snapshot.post_id, seriesId);

    if (seriesId && !definitions.has(seriesId)) {
      definitions.set(seriesId, {
        id: seriesId,
        label: seriesId,
        id_pattern: null,
        tag_triggers: [],
        role_label: null,
        expected_total: null,
        open_ended: true,
        order: [],
        source: "inferred",
      });
    }
  }

  const series: KnowledgeMap["series"] = [];

  for (const definition of definitions.values()) {
    const seriesSnapshots = sortSeriesSnapshots(
      snapshots.filter(
        snapshot => postSeries.get(snapshot.post_id) === definition.id
      ),
      definition
    );

    if (seriesSnapshots.length === 0) {
      continue;
    }

    series.push({
      id: definition.id,
      label: definition.label,
      role_label: definition.role_label ?? null,
      post_ids: seriesSnapshots.map(snapshot => snapshot.post_id),
      expected_total: definition.expected_total,
      open_ended: definition.open_ended,
      source: definition.source,
    });
  }

  series.sort((left, right) => left.label.localeCompare(right.label));

  const seriesById = new Map(series.map(item => [item.id, item]));
  const posts: KnowledgeMapEntry[] = [];

  for (const snapshot of snapshots) {
    const override =
      overrides.posts?.[snapshot.post_id] ?? createEmptyPostOverride();
    const seriesId = postSeries.get(snapshot.post_id);
    const seriesInfo = (seriesId ? seriesById.get(seriesId) : null) ?? null;
    const seriesSnapshots: PostSnapshot[] = seriesInfo
      ? seriesInfo.post_ids
          .map(postId => snapshotsById.get(postId))
          .filter((item): item is PostSnapshot => Boolean(item))
      : [];
    const index = seriesSnapshots.findIndex(
      item => item.post_id === snapshot.post_id
    );
    const previousSnapshot = index > 0 ? seriesSnapshots[index - 1] : undefined;
    const nextSnapshot =
      index >= 0 && index < seriesSnapshots.length - 1
        ? seriesSnapshots[index + 1]
        : undefined;
    const inferredPrevious = previousSnapshot ? [previousSnapshot.post_id] : [];
    const inferredNext = nextSnapshot ? [nextSnapshot.post_id] : [];
    const previousPosts =
      override.previous.length > 0 ? override.previous : inferredPrevious;
    const nextPosts = override.next.length > 0 ? override.next : inferredNext;
    const excluded = new Set([
      snapshot.post_id,
      ...previousPosts,
      ...nextPosts,
    ]);
    const topicNeighbors =
      override.topic_neighbors.length > 0
        ? override.topic_neighbors
        : buildTopicNeighbors(snapshot, snapshots, excluded);
    const role = inferRole(snapshot, seriesInfo, seriesSnapshots, override);
    const positionSummary =
      override.position_summary ??
      describePosition(snapshot, seriesInfo, role, previousPosts, nextPosts);
    const relatedPosts = [
      ...buildRelatedPosts(previousPosts, snapshotsById, "前置阅读"),
      ...buildRelatedPosts(nextPosts, snapshotsById, "后续阅读"),
      ...buildRelatedPosts(topicNeighbors, snapshotsById, "相邻主题"),
    ].slice(0, 3);

    posts.push({
      post_id: snapshot.post_id,
      title: snapshot.title,
      source_path: snapshot.file_path,
      route_path: snapshot.route_path,
      series_id: seriesInfo?.id ?? null,
      series_label: seriesInfo?.label ?? null,
      role,
      previous_posts: previousPosts,
      next_posts: nextPosts,
      topic_neighbors: topicNeighbors,
      related_posts: relatedPosts,
      position_summary: positionSummary,
      memory_refs: dedupeStrings([
        seriesInfo ? `series:${seriesInfo.id}` : null,
        ...snapshot.tags.map(tag => `topic:${tag}`),
      ]),
    });
  }

  posts.sort((left, right) => left.post_id.localeCompare(right.post_id));

  const issues = validateOverrides(overrides, snapshotsById, definitions);
  const stablePayload = {
    version: 1,
    series,
    posts,
    issues,
  };
  const knowledgeHash = hashContent(JSON.stringify(stablePayload));

  return {
    ...stablePayload,
    generated_at: isoNow(),
    knowledge_hash: knowledgeHash,
    source: {
      post_count: snapshots.length,
      overrides_path: repoRelative(KNOWLEDGE_OVERRIDES_PATH, REPO_ROOT),
    },
  };
}

export async function refreshKnowledgeMap(
  options: BuildKnowledgeMapOptions = {}
): Promise<KnowledgeRefreshResult<KnowledgeMap>> {
  const map = await buildKnowledgeMap(options);
  // Only `generated_at` differs between identical maps; don't churn the file.
  await writeJsonIfChanged(KNOWLEDGE_MAP_PATH, map);
  return {
    knowledge_hash: map.knowledge_hash,
    post_count: map.posts.length,
    series_count: map.series.length,
    issue_count: map.issues.length,
    sidecar_path: repoRelative(KNOWLEDGE_MAP_PATH, REPO_ROOT),
    map,
  };
}

export async function loadKnowledgeMap(): Promise<KnowledgeMap | null> {
  return readJsonIfExists(KNOWLEDGE_MAP_PATH, null);
}

// Builds the map in memory and compares it with the committed one. Used by
// read-only (CI) runs so the working tree is never touched.
export async function verifyKnowledgeMap(
  options: BuildKnowledgeMapOptions = {}
): Promise<KnowledgeRefreshResult<KnowledgeMap>> {
  const map = await buildKnowledgeMap(options);
  const committed = await loadKnowledgeMap();
  const committedHash = committed?.knowledge_hash ?? null;
  const stale = committedHash !== map.knowledge_hash;

  return {
    knowledge_hash: map.knowledge_hash,
    committed_hash: committedHash,
    stale,
    post_count: map.posts.length,
    series_count: map.series.length,
    issue_count: map.issues.length,
    sidecar_path: repoRelative(KNOWLEDGE_MAP_PATH, REPO_ROOT),
    // Analysis should reason about the committed state in read-only mode so
    // that "stale" is reported once here instead of once per post.
    map: committed ?? map,
  };
}

export function getKnowledgeForPost(
  knowledgeMap: KnowledgeMap | null | undefined,
  postId: string
): KnowledgeMapEntry | null {
  if (!knowledgeMap) {
    return null;
  }

  return (
    (knowledgeMap.posts ?? []).find(entry => entry.post_id === postId) ?? null
  );
}

export async function checkKnowledgeMap(
  options: BuildKnowledgeMapOptions = {}
) {
  const result = await refreshKnowledgeMap({
    ...options,
  });

  return {
    generated_at: isoNow(),
    summary: {
      post_count: result.post_count,
      series_count: result.series_count,
      issue_count: result.issue_count,
      knowledge_hash: result.knowledge_hash,
      sidecar_path: result.sidecar_path,
    },
    issues: result.map.issues,
  };
}
