// @ts-nocheck
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
  writeJson,
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

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(item => String(item).trim()).filter(Boolean);
}

function createEmptyPostOverride() {
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

function normalizeOverridePost(rawPost) {
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

function normalizeOverrides(rawOverrides) {
  const rawSeries = isObject(rawOverrides?.series) ? rawOverrides.series : {};
  const rawPosts = isObject(rawOverrides?.posts) ? rawOverrides.posts : {};
  const series = {};
  const posts = {};

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

async function ensureDefaultOverrides() {
  await ensureDir(KNOWLEDGE_ROOT);

  if (!(await fileExists(KNOWLEDGE_OVERRIDES_PATH))) {
    await fs.writeFile(KNOWLEDGE_OVERRIDES_PATH, DEFAULT_OVERRIDES, "utf8");
  }
}

export async function loadKnowledgeOverrides() {
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

function buildSeriesDefinitions(globalRules, overrides) {
  const definitions = new Map();

  for (const rule of globalRules.series_naming_rules ?? []) {
    definitions.set(rule.id, {
      id: rule.id,
      label: rule.label ?? rule.id,
      id_pattern: rule.id_pattern ?? null,
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

function detectSeries(snapshot, definitions, override) {
  if (override?.series_id) {
    return override.series_id;
  }

  for (const definition of definitions.values()) {
    if (
      definition.id_pattern &&
      new RegExp(definition.id_pattern, "u").test(snapshot.post_id)
    ) {
      return definition.id;
    }
  }

  if (
    snapshot.tags.includes("论文阅读") ||
    /^(AAAI|ICCV|ISOCC|NSDI|OSDI|SOSP|USENIX)\d{2}[-_]/u.test(snapshot.post_id)
  ) {
    return "paper-reading";
  }

  return null;
}

function extractPartNumber(postId) {
  const match = postId.match(/part[-_ ]?(\d+)/iu);

  return match ? Number(match[1]) : null;
}

function compareByPublishedAt(left, right) {
  return String(left.pubDatetime ?? "").localeCompare(
    String(right.pubDatetime ?? "")
  );
}

function sortSeriesSnapshots(snapshots, definition) {
  const order = definition?.order ?? [];
  const orderIndex = new Map(order.map((postId, index) => [postId, index]));

  return [...snapshots].sort((left, right) => {
    const leftOrder = orderIndex.has(left.post_id)
      ? orderIndex.get(left.post_id)
      : Number.POSITIVE_INFINITY;
    const rightOrder = orderIndex.has(right.post_id)
      ? orderIndex.get(right.post_id)
      : Number.POSITIVE_INFINITY;

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

function inferRole(snapshot, seriesInfo, seriesSnapshots, override) {
  if (override?.role) {
    return override.role;
  }

  const tags = new Set(snapshot.tags);
  const index = seriesSnapshots.findIndex(
    item => item.post_id === snapshot.post_id
  );
  const partNumber = extractPartNumber(snapshot.post_id);
  const lowerTitle = snapshot.title.toLowerCase();

  if (!seriesInfo) {
    if (tags.has("论文阅读")) {
      return "论文阅读";
    }

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

  if (seriesInfo.id === "cmu-15213") {
    return "实验记录";
  }

  if (seriesInfo.id === "paper-reading" || tags.has("论文阅读")) {
    return "论文阅读";
  }

  return `系列第 ${index + 1} 篇`;
}

function sharedTagScore(left, right) {
  const rightTags = new Set(right.tags);
  return left.tags.filter(tag => rightTags.has(tag)).length;
}

function buildTopicNeighbors(snapshot, snapshots, excludedIds) {
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

function describePosition(snapshot, seriesInfo, role, previous, next) {
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

function buildRelatedPosts(postIds, snapshotsById, relation) {
  return postIds
    .map(postId => snapshotsById.get(postId))
    .filter(Boolean)
    .map(snapshot => ({
      post_id: snapshot.post_id,
      title: snapshot.title,
      route_path: snapshot.route_path,
      relation,
    }));
}

function validateOverrides(overrides, snapshotsById, definitions) {
  const issues = [];

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

    for (const field of ["previous", "next", "topic_neighbors"]) {
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

export async function buildKnowledgeMap(options = {}) {
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
  const snapshots = [];

  for (const filePath of postPaths) {
    snapshots.push(await loadPostSnapshot(filePath));
  }

  const snapshotsById = new Map(
    snapshots.map(snapshot => [snapshot.post_id, snapshot])
  );
  const definitions = buildSeriesDefinitions(globalRules, overrides);
  const postSeries = new Map();

  for (const snapshot of snapshots) {
    const override = overrides.posts?.[snapshot.post_id];
    const seriesId = detectSeries(snapshot, definitions, override);

    postSeries.set(snapshot.post_id, seriesId);

    if (seriesId && !definitions.has(seriesId)) {
      definitions.set(seriesId, {
        id: seriesId,
        label: seriesId,
        id_pattern: null,
        expected_total: null,
        open_ended: true,
        order: [],
        source: "inferred",
      });
    }
  }

  const series = [];

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
      post_ids: seriesSnapshots.map(snapshot => snapshot.post_id),
      expected_total: definition.expected_total,
      open_ended: definition.open_ended,
      source: definition.source,
    });
  }

  series.sort((left, right) => left.label.localeCompare(right.label));

  const seriesById = new Map(series.map(item => [item.id, item]));
  const posts = [];

  for (const snapshot of snapshots) {
    const override =
      overrides.posts?.[snapshot.post_id] ?? createEmptyPostOverride();
    const seriesId = postSeries.get(snapshot.post_id);
    const seriesInfo = seriesId ? seriesById.get(seriesId) : null;
    const seriesSnapshots = seriesInfo
      ? seriesInfo.post_ids
          .map(postId => snapshotsById.get(postId))
          .filter(Boolean)
      : [];
    const index = seriesSnapshots.findIndex(
      item => item.post_id === snapshot.post_id
    );
    const inferredPrevious =
      index > 0 ? [seriesSnapshots[index - 1].post_id] : [];
    const inferredNext =
      index >= 0 && index < seriesSnapshots.length - 1
        ? [seriesSnapshots[index + 1].post_id]
        : [];
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

export async function refreshKnowledgeMap(options = {}) {
  const map = await buildKnowledgeMap(options);
  await writeJson(KNOWLEDGE_MAP_PATH, map);
  return {
    knowledge_hash: map.knowledge_hash,
    post_count: map.posts.length,
    series_count: map.series.length,
    issue_count: map.issues.length,
    sidecar_path: repoRelative(KNOWLEDGE_MAP_PATH, REPO_ROOT),
    map,
  };
}

export async function loadKnowledgeMap() {
  return readJsonIfExists(KNOWLEDGE_MAP_PATH, null);
}

export function getKnowledgeForPost(knowledgeMap, postId) {
  if (!knowledgeMap) {
    return null;
  }

  return (
    (knowledgeMap.posts ?? []).find(entry => entry.post_id === postId) ?? null
  );
}

export async function checkKnowledgeMap(options = {}) {
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
