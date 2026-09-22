import {
  GLOBAL_RULES_PATH,
  MEMORY_ROOT,
  NEGATIVE_MEMORY_PATH,
  SERIES_MEMORY_PATH,
  SIDECAR_ROOT,
  TOPIC_MEMORY_PATH,
} from "../shared/constants.js";
import { DEFAULT_GLOBAL_RULES } from "./default-global-rules.js";
import {
  ensureDir,
  readJsonIfExists,
  writeJson,
  writeJsonIfChanged,
} from "../shared/fs.js";
import { getSidecarPathForPost } from "../shared/pathing.js";
import { loadPostSnapshot } from "../parsers/post-snapshot.js";
import { dedupeStrings, isoNow, sortByPublishedAt } from "../shared/utils.js";
import type {
  GlobalRules,
  TagMetadata,
  MemoryContext,
  NegativeMemory,
  MemoryUpdateInput,
  PostSidecar,
  RawJson,
  SeriesMemory,
  SeriesMemoryPost,
  SeriesRule,
  TopicMemory,
} from "../types.js";

function createSeriesMemory(): SeriesMemory {
  return {
    version: 1,
    updated_at: null,
    series: [],
  };
}

function createTopicMemory(): TopicMemory {
  return {
    version: 1,
    updated_at: null,
    topics: [],
  };
}

function createNegativeMemory(): NegativeMemory {
  return {
    version: 1,
    updated_at: null,
    patterns: [],
  };
}

function mergeGlobalRules(current: GlobalRules | null): GlobalRules {
  if (!current) {
    return DEFAULT_GLOBAL_RULES;
  }

  const mergedTagRegistry: Record<string, TagMetadata> = {
    ...DEFAULT_GLOBAL_RULES.tag_registry,
  };

  for (const [tag, metadata] of Object.entries(current.tag_registry ?? {})) {
    const defaultEntry = mergedTagRegistry[tag] ?? {};
    mergedTagRegistry[tag] = {
      ...defaultEntry,
      ...metadata,
      aliases: dedupeStrings([
        ...(defaultEntry.aliases ?? []),
        ...(metadata.aliases ?? []),
      ]),
      keywords: dedupeStrings([
        ...(defaultEntry.keywords ?? []),
        ...(metadata.keywords ?? []),
      ]),
    };
  }

  return {
    ...DEFAULT_GLOBAL_RULES,
    ...current,
    updated_at:
      current.updated_at ??
      current.generated_at ??
      DEFAULT_GLOBAL_RULES.updated_at,
    provider_defaults: {
      ...DEFAULT_GLOBAL_RULES.provider_defaults,
      ...(current.provider_defaults ?? {}),
    },
    review_rubric: {
      ...DEFAULT_GLOBAL_RULES.review_rubric,
      ...(current.review_rubric ?? {}),
    },
    tag_registry: mergedTagRegistry,
    series_naming_rules: Array.isArray(current.series_naming_rules)
      ? current.series_naming_rules
      : DEFAULT_GLOBAL_RULES.series_naming_rules,
    home_tracks: Array.isArray(current.home_tracks)
      ? current.home_tracks
      : DEFAULT_GLOBAL_RULES.home_tracks,
  };
}

function removePostFromMemories(
  seriesMemory: SeriesMemory,
  topicMemory: TopicMemory,
  negativeMemory: NegativeMemory,
  knownPostIds: string[]
): string[] {
  const known = new Set(knownPostIds);
  const removed = new Set<string>();
  const noteRemoved = (postId: string): boolean => {
    if (!known.has(postId)) {
      removed.add(postId);
      return true;
    }

    return false;
  };

  for (const entry of seriesMemory.series) {
    entry.posts = entry.posts.filter(post => !noteRemoved(post.post_id));
  }

  seriesMemory.series = seriesMemory.series.filter(
    entry => entry.posts.length > 0
  );

  for (const memory of [topicMemory.topics, negativeMemory.patterns]) {
    for (const entry of memory) {
      entry.post_ids = entry.post_ids.filter(postId => !noteRemoved(postId));
      entry.count = entry.post_ids.length;

      if (entry.latest_post_id && !known.has(entry.latest_post_id)) {
        entry.latest_post_id =
          entry.post_ids[entry.post_ids.length - 1] ?? null;
      }
    }
  }

  topicMemory.topics = topicMemory.topics.filter(
    entry => entry.post_ids.length > 0
  );
  negativeMemory.patterns = negativeMemory.patterns.filter(
    entry => entry.post_ids.length > 0
  );

  return [...removed].sort();
}

function normalizeSeriesMemory(memory: RawJson): SeriesMemory {
  if (!memory || Array.isArray(memory.series)) {
    return memory ?? createSeriesMemory();
  }

  return {
    version: memory.version ?? 1,
    updated_at: memory.updated_at ?? memory.generated_at ?? null,
    series: (Object.values(memory.series ?? {}) as RawJson[]).map(entry => ({
      id: entry.id,
      label: entry.label ?? entry.title ?? entry.id,
      expected_total: entry.expected_total ?? null,
      open_ended: entry.open_ended ?? true,
      missing: entry.missing ?? entry.open_slots ?? [],
      posts: entry.posts ?? [],
    })),
  };
}

function normalizeTopicMemory(memory: RawJson): TopicMemory {
  if (!memory || Array.isArray(memory.topics)) {
    return memory ?? createTopicMemory();
  }

  return {
    version: memory.version ?? 1,
    updated_at: memory.updated_at ?? memory.generated_at ?? null,
    topics: (Object.values(memory.topics ?? {}) as RawJson[]).map(entry => ({
      tag: entry.tag ?? entry.id,
      category: entry.category ?? "custom",
      post_ids: (entry.posts ?? []).map(
        (post: { post_id: string }) => post.post_id
      ),
      latest_post_id: entry.latest_post_id ?? entry.posts?.[0]?.post_id ?? null,
      count: entry.count ?? entry.posts?.length ?? 0,
    })),
  };
}

function normalizeNegativeMemory(memory: RawJson): NegativeMemory {
  if (!memory || Array.isArray(memory.patterns)) {
    return memory ?? createNegativeMemory();
  }

  return {
    version: memory.version ?? 1,
    updated_at: memory.updated_at ?? memory.generated_at ?? null,
    patterns: (Object.values(memory.patterns ?? {}) as RawJson[]).map(
      entry => ({
        code: entry.code,
        severity: entry.severity ?? "warn",
        post_ids: (entry.posts ?? []).map(
          (post: { post_id: string }) => post.post_id
        ),
        sample_message: entry.sample_message ?? entry.message ?? "",
        latest_post_id:
          entry.latest_post_id ?? entry.posts?.[0]?.post_id ?? null,
        count: entry.count ?? entry.posts?.length ?? 0,
      })
    ),
  };
}

function buildSeriesMissing(
  rule: SeriesRule | undefined,
  posts: SeriesMemoryPost[]
): string[] {
  const expectedIds = rule?.known_post_ids ?? [];
  const publishedIds = new Set(posts.map(post => post.post_id));

  return expectedIds.filter(postId => !publishedIds.has(postId));
}

function upsertSeries(
  memory: SeriesMemory,
  globalRules: GlobalRules,
  sidecar: MemoryUpdateInput
): void {
  if (!sidecar.series_key) {
    return;
  }

  const rule = (globalRules.series_naming_rules ?? []).find(
    item => item.id === sidecar.series_key
  );

  for (const entry of memory.series) {
    entry.posts = entry.posts.filter(post => post.post_id !== sidecar.post_id);
  }

  const existing =
    memory.series.find(entry => entry.id === sidecar.series_key) ??
    (() => {
      const next = {
        id: sidecar.series_key,
        label: sidecar.series_label ?? sidecar.series_key,
        expected_total: rule?.expected_total ?? null,
        open_ended: rule?.open_ended ?? true,
        missing: [],
        posts: [],
      };
      memory.series.push(next);
      return next;
    })();

  existing.label = sidecar.series_label ?? existing.label;
  existing.expected_total =
    rule?.expected_total ?? existing.expected_total ?? null;
  existing.open_ended = rule?.open_ended ?? existing.open_ended ?? true;
  existing.posts.push({
    post_id: sidecar.post_id,
    title: sidecar.title,
    file_path: sidecar.source_path,
    published_at: sidecar.published_at,
    severity: sidecar.severity,
    tags: sidecar.tags_snapshot,
  });
  existing.posts = sortByPublishedAt(existing.posts);
  existing.missing = buildSeriesMissing(rule, existing.posts);
  memory.series = memory.series
    .filter(entry => entry.posts.length > 0)
    .sort((left, right) => left.label.localeCompare(right.label));
}

function upsertTopics(
  memory: TopicMemory,
  globalRules: GlobalRules,
  sidecar: MemoryUpdateInput
): void {
  for (const entry of memory.topics) {
    entry.post_ids = entry.post_ids.filter(
      postId => postId !== sidecar.post_id
    );
  }

  for (const tag of sidecar.tags_snapshot ?? []) {
    const metadata = globalRules.tag_registry?.[tag] ?? {};
    const existing =
      memory.topics.find(entry => entry.tag === tag) ??
      (() => {
        const next = {
          tag,
          category: metadata.category ?? "custom",
          post_ids: [] as string[],
          latest_post_id: null,
          count: 0,
        };
        memory.topics.push(next);
        return next;
      })();

    existing.category = metadata.category ?? existing.category;
    existing.post_ids = dedupeStrings([...existing.post_ids, sidecar.post_id]);
    existing.latest_post_id = sidecar.post_id;
    existing.count = existing.post_ids.length;
  }

  memory.topics = memory.topics
    .filter(entry => entry.post_ids.length > 0)
    .sort(
      (left, right) =>
        right.count - left.count || left.tag.localeCompare(right.tag)
    );
}

function upsertNegativePatterns(
  memory: NegativeMemory,
  sidecar: MemoryUpdateInput
): void {
  for (const entry of memory.patterns) {
    entry.post_ids = entry.post_ids.filter(
      postId => postId !== sidecar.post_id
    );
  }

  for (const issue of sidecar.hard_checks ?? []) {
    const existing =
      memory.patterns.find(entry => entry.code === issue.code) ??
      (() => {
        const next = {
          code: issue.code,
          severity: issue.severity,
          post_ids: [],
          sample_message: issue.message,
          latest_post_id: null,
          count: 0,
        };
        memory.patterns.push(next);
        return next;
      })();

    existing.severity = issue.severity;
    existing.sample_message = issue.message;
    existing.post_ids = dedupeStrings([...existing.post_ids, sidecar.post_id]);
    existing.count = existing.post_ids.length;
    existing.latest_post_id = sidecar.post_id;
  }

  memory.patterns = memory.patterns
    .filter(entry => entry.post_ids.length > 0)
    .sort(
      (left, right) =>
        right.count - left.count || left.code.localeCompare(right.code)
    );
}

async function writeJsonIfMissing(
  filePath: string,
  fallback: unknown
): Promise<void> {
  const current = await readJsonIfExists(filePath);

  if (!current) {
    await writeJson(filePath, fallback);
  }
}

export class MemoryStore {
  async ensureLayout(): Promise<void> {
    await ensureDir(MEMORY_ROOT);
    await ensureDir(SIDECAR_ROOT);
    await this.loadGlobalRules();
    await writeJsonIfMissing(SERIES_MEMORY_PATH, createSeriesMemory());
    await writeJsonIfMissing(TOPIC_MEMORY_PATH, createTopicMemory());
    await writeJsonIfMissing(NEGATIVE_MEMORY_PATH, createNegativeMemory());
  }

  async loadGlobalRules(): Promise<GlobalRules> {
    const current = await readJsonIfExists<GlobalRules>(GLOBAL_RULES_PATH);

    if (current) {
      return mergeGlobalRules(current);
    }

    await writeJson(GLOBAL_RULES_PATH, DEFAULT_GLOBAL_RULES);
    return DEFAULT_GLOBAL_RULES;
  }

  async loadSeriesContext(
    postId: string,
    seriesId?: string | null,
    tags: string[] = []
  ): Promise<MemoryContext> {
    const [seriesMemoryRaw, topicMemoryRaw, negativeMemoryRaw] =
      await Promise.all([
        readJsonIfExists(SERIES_MEMORY_PATH, createSeriesMemory()),
        readJsonIfExists(TOPIC_MEMORY_PATH, createTopicMemory()),
        readJsonIfExists(NEGATIVE_MEMORY_PATH, createNegativeMemory()),
      ]);
    const seriesMemory = normalizeSeriesMemory(seriesMemoryRaw);
    const topicMemory = normalizeTopicMemory(topicMemoryRaw);
    const negativeMemory = normalizeNegativeMemory(negativeMemoryRaw);
    const refs: string[] = [];
    const series =
      seriesMemory.series.find(entry => entry.id === seriesId) ?? null;

    if (series) {
      refs.push(`series:${series.id}`);
    }

    const topics = topicMemory.topics.filter(entry => tags.includes(entry.tag));
    refs.push(...topics.map(topic => `topic:${topic.tag}`));

    const patterns = negativeMemory.patterns
      .filter(entry => !entry.post_ids.includes(postId))
      .slice(0, 5);
    refs.push(...patterns.map(pattern => `issue:${pattern.code}`));

    return {
      series,
      topics,
      patterns,
      refs: dedupeStrings(refs),
    };
  }

  async loadPostMemory(filePath: string): Promise<PostSidecar | null> {
    return readJsonIfExists(getSidecarPathForPost(filePath));
  }

  async applyUpdates(sidecar: MemoryUpdateInput): Promise<void> {
    const globalRules = await this.loadGlobalRules();
    const [seriesMemoryRaw, topicMemoryRaw, negativeMemoryRaw] =
      await Promise.all([
        readJsonIfExists(SERIES_MEMORY_PATH, createSeriesMemory()),
        readJsonIfExists(TOPIC_MEMORY_PATH, createTopicMemory()),
        readJsonIfExists(NEGATIVE_MEMORY_PATH, createNegativeMemory()),
      ]);
    const seriesMemory = normalizeSeriesMemory(seriesMemoryRaw);
    const topicMemory = normalizeTopicMemory(topicMemoryRaw);
    const negativeMemory = normalizeNegativeMemory(negativeMemoryRaw);

    upsertSeries(seriesMemory, globalRules, sidecar);
    upsertTopics(topicMemory, globalRules, sidecar);
    upsertNegativePatterns(negativeMemory, sidecar);

    await this.persist(seriesMemory, topicMemory, negativeMemory);
  }

  // Stamps updated_at and writes each store only if its content changed.
  async persist(
    seriesMemory: SeriesMemory,
    topicMemory: TopicMemory,
    negativeMemory: NegativeMemory
  ): Promise<boolean> {
    const updated_at = isoNow();
    seriesMemory.updated_at = updated_at;
    topicMemory.updated_at = updated_at;
    negativeMemory.updated_at = updated_at;

    const written = await Promise.all([
      writeJsonIfChanged(SERIES_MEMORY_PATH, seriesMemory),
      writeJsonIfChanged(TOPIC_MEMORY_PATH, topicMemory),
      writeJsonIfChanged(NEGATIVE_MEMORY_PATH, negativeMemory),
    ]);

    return written.some(Boolean);
  }

  async loadAll(): Promise<{
    seriesMemory: SeriesMemory;
    topicMemory: TopicMemory;
    negativeMemory: NegativeMemory;
  }> {
    const [seriesMemoryRaw, topicMemoryRaw, negativeMemoryRaw] =
      await Promise.all([
        readJsonIfExists(SERIES_MEMORY_PATH, createSeriesMemory()),
        readJsonIfExists(TOPIC_MEMORY_PATH, createTopicMemory()),
        readJsonIfExists(NEGATIVE_MEMORY_PATH, createNegativeMemory()),
      ]);

    return {
      seriesMemory: normalizeSeriesMemory(seriesMemoryRaw),
      topicMemory: normalizeTopicMemory(topicMemoryRaw),
      negativeMemory: normalizeNegativeMemory(negativeMemoryRaw),
    };
  }

  // Lists post ids referenced by memory that no longer exist as posts.
  async findMissingPosts(knownPostIds: string[]): Promise<string[]> {
    const { seriesMemory, topicMemory, negativeMemory } = await this.loadAll();
    return removePostFromMemories(
      seriesMemory,
      topicMemory,
      negativeMemory,
      knownPostIds
    );
  }

  // Drops references to deleted / renamed posts from all three stores.
  async pruneMissingPosts(knownPostIds: string[]): Promise<string[]> {
    const { seriesMemory, topicMemory, negativeMemory } = await this.loadAll();
    const removed = removePostFromMemories(
      seriesMemory,
      topicMemory,
      negativeMemory,
      knownPostIds
    );

    if (removed.length > 0) {
      await this.persist(seriesMemory, topicMemory, negativeMemory);
    }

    return removed;
  }

  async rebuildAll(postPaths: string[]): Promise<{
    series: number;
    topics: number;
    negative_patterns: number;
  }> {
    const globalRules = await this.loadGlobalRules();
    const seriesMemory = createSeriesMemory();
    const topicMemory = createTopicMemory();
    const negativeMemory = createNegativeMemory();

    for (const postPath of postPaths) {
      const snapshot = await loadPostSnapshot(postPath);
      const sidecar: MemoryUpdateInput = (await readJsonIfExists<PostSidecar>(
        snapshot.sidecar_path
      )) ?? {
        post_id: snapshot.post_id,
        title: snapshot.title,
        source_path: snapshot.file_path,
        published_at: snapshot.pubDatetime,
        tags_snapshot: snapshot.tags,
        severity: "info",
        series_key: null,
        series_label: null,
        hard_checks: [],
      };

      upsertSeries(seriesMemory, globalRules, sidecar);
      upsertTopics(topicMemory, globalRules, sidecar);
      upsertNegativePatterns(negativeMemory, sidecar);
    }

    await this.persist(seriesMemory, topicMemory, negativeMemory);

    return {
      series: seriesMemory.series.length,
      topics: topicMemory.topics.length,
      negative_patterns: negativeMemory.patterns.length,
    };
  }
}
