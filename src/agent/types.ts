// Shared types for the blog agent. Sidecar shapes here are the contract
// between the CLI (writer) and the Astro components (readers).

export type Severity = "info" | "warn" | "error";

/**
 * Data crossing an untyped boundary: an LLM JSON response, a legacy on-disk
 * memory file, or parsed YAML. Named so these stay greppable instead of
 * spreading bare `any` through the codebase.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawJson = any;

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

export type FrontmatterScalar = string | boolean | null;
export type FrontmatterValue = FrontmatterScalar | FrontmatterScalar[];
export type FrontmatterData = Record<string, FrontmatterValue>;

export interface MarkdownDocument {
  hasFrontmatter: boolean;
  data: FrontmatterData;
  /** Key order as written in the source, used to preserve author intent. */
  order: string[];
  body: string;
  newline: string;
}

export interface Heading {
  depth: number;
  text: string;
  line: number;
}

export interface CodeFence {
  language: string;
  startLine: number;
  endLine: number;
  content: string[];
}

export interface ImageRef {
  alt: string;
  url: string;
  line: number;
}

export interface BareUrl {
  url: string;
  line: number;
}

export interface MarkdownAnalysis {
  headings: Heading[];
  codeFences: CodeFence[];
  images: ImageRef[];
  bareUrls: BareUrl[];
  paragraphCount: number;
  firstParagraphs: string[];
  wordCount: number;
  linkCount: number;
}

export interface PostSnapshot {
  post_id: string;
  title: string;
  description: string;
  tags: string[];
  file_path: string;
  route_path: string;
  sidecar_path: string;
  source_hash: string;
  pubDatetime: string | null;
  document: MarkdownDocument;
  analysis: MarkdownAnalysis;
  raw: string;
  body: string;
  excerpt: string;
}

// ---------------------------------------------------------------------------
// Memory / global rules
// ---------------------------------------------------------------------------

export interface TagMetadata {
  category?: string;
  aliases?: string[];
  keywords?: string[];
}

/** Single source of truth for series detection (see default-global-rules.ts). */
export interface SeriesRule {
  id: string;
  label: string;
  /** Matched against the post id (file name). */
  id_pattern?: string;
  /** Frontmatter tags that also place a post into this series. */
  tag_triggers?: string[];
  /** Default knowledge-map role for posts in this series. */
  role_label?: string | null;
  expected_total?: number | null;
  open_ended?: boolean;
  known_post_ids?: string[];
}

/** Home-page topic track; patterns are stored as source strings, not RegExp. */
export interface HomeTrackRule {
  id: string;
  label: string;
  patterns?: string[];
  tags?: string[];
}

export interface GlobalRules {
  version: number;
  updated_at: string;
  /** Legacy alias for updated_at, still present in older global.json files. */
  generated_at?: string;
  prompt_version?: string;
  provider_defaults?: Record<string, unknown>;
  site_path_policy?: Record<string, unknown>;
  review_rubric?: Record<string, unknown>;
  tag_registry?: Record<string, TagMetadata>;
  series_naming_rules?: SeriesRule[];
  home_tracks?: HomeTrackRule[];
}

export interface SeriesMemoryPost {
  post_id: string;
  title: string;
  file_path: string;
  published_at: string | null;
  severity: Severity;
  tags: string[];
}

export interface SeriesMemoryEntry {
  id: string;
  label: string;
  expected_total: number | null;
  open_ended: boolean;
  missing: string[];
  posts: SeriesMemoryPost[];
}

export interface TopicMemoryEntry {
  tag: string;
  category: string;
  post_ids: string[];
  latest_post_id: string | null;
  count: number;
}

export interface NegativePatternEntry {
  code: string;
  severity: Severity;
  post_ids: string[];
  sample_message: string;
  latest_post_id: string | null;
  count: number;
}

export interface SeriesMemory {
  version: number;
  updated_at: string | null;
  series: SeriesMemoryEntry[];
}

export interface TopicMemory {
  version: number;
  updated_at: string | null;
  topics: TopicMemoryEntry[];
}

export interface NegativeMemory {
  version: number;
  updated_at: string | null;
  patterns: NegativePatternEntry[];
}

/**
 * Subset of a sidecar that the memory stores actually consume. Declared
 * separately so `rebuildAll` can synthesize a minimal record for posts that
 * have no sidecar yet.
 */
export type MemoryUpdateInput = Pick<
  PostSidecar,
  | "post_id"
  | "title"
  | "source_path"
  | "published_at"
  | "tags_snapshot"
  | "severity"
  | "series_key"
  | "series_label"
  | "hard_checks"
>;

/** What a review provider is given about neighbouring posts and past issues. */
export interface MemoryContext {
  series: SeriesMemoryEntry | null;
  topics: TopicMemoryEntry[];
  patterns: NegativePatternEntry[];
  refs: string[];
}

// ---------------------------------------------------------------------------
// Checks / frontmatter generation
// ---------------------------------------------------------------------------

export interface CheckSuggestions {
  normalized_tags: string[];
  /** Original tags that normalization would rewrite. */
  tag_replacements: string[];
  inferred_tags: string[];
  description_suggestion: string | null;
  slug_suggestion: string | null;
}

export interface DetectedSeries {
  id: string;
  label: string;
  expected_total: number | null;
}

export interface CheckResult {
  document: MarkdownDocument;
  issues: HardCheckIssue[];
  fixesApplied: string[];
  actionItems: string[];
  suggestions: CheckSuggestions;
  contentChanged: boolean;
  changedSource: string;
  series: DetectedSeries | null;
  currentTags: string[];
  safe_fix_codes: string[];
}

export interface FrontmatterHints {
  structured: Record<string, FrontmatterValue>;
  freeform: string[];
  [key: string]: unknown;
}

export interface FrontmatterGenerationResult {
  changed: boolean;
  createdFrontmatter: boolean;
  appliedFields: string[];
  source: string;
  document: MarkdownDocument;
  hints: FrontmatterHints;
}

export interface SchemaField {
  type: string;
  required: boolean;
  has_default: boolean;
  source: string;
}

export interface ContentSchemaRules {
  source_path: string;
  fields: Record<string, SchemaField>;
  required_fields: string[];
  optional_fields: string[];
}

export type ProviderName = "gemini" | "heuristic";

export type RequestedProvider = ProviderName | "auto";

export type RunMode = "cli" | "ci" | "build" | string;

export interface HardCheckIssue {
  code: string;
  severity: Severity;
  message: string;
  line?: number;
  fixable?: boolean;
  fixed?: boolean;
  [key: string]: unknown;
}

export interface RelatedPost {
  post_id: string;
  title: string;
  route_path: string;
  relation?: string;
}

export interface KnowledgePosition {
  series_id: string | null;
  series_label: string | null;
  role: string | null;
  previous_posts: string[];
  next_posts: string[];
  topic_neighbors: string[];
  position_summary: string | null;
}

/** Normalized output of a review provider (Gemini or heuristic). */
export interface Review {
  public_commentary: string;
  related_post_ids: string[];
  summary: string;
  structural_review: string;
  technical_review: string;
  strengths: string[];
  concerns: string[];
  action_items: string[];
  severity: Severity;
  confidence: number;
  memory_refs: string[];
  /** Sanitizer remarks (invalid fields, dropped ids). */
  notes: string[];
}

export interface ReviewProvider {
  name: ProviderName;
  model: string;
  prompt_version: string;
  available: boolean;
  unavailable_reason: string | null;
  generateReview(input: unknown, context: unknown): Promise<Review>;
  generateFixes(): Promise<{ fixes: unknown[] }>;
}

/** `src/data/agent/posts/<post>.json` */
export interface PostSidecar {
  post_id: string;
  title: string;
  source_path: string;
  route_path: string;
  source_hash: string;
  /** sha256(source_hash, provider, model, prompt_version) */
  review_key?: string;
  prompt_version?: string | null;
  generated_at: string;
  run_mode: RunMode;
  provider: string;
  model: string;
  degraded?: boolean;
  degraded_reason?: string | null;
  agent_experiment?: boolean;
  agent_experiment_note?: string;
  public_commentary?: string;
  related_post_ids?: string[];
  related_posts?: RelatedPost[];
  summary: string;
  structural_review: string;
  technical_review: string;
  strengths: string[];
  concerns: string[];
  action_items: string[];
  severity: Severity;
  confidence: number;
  memory_refs: string[];
  knowledge_hash?: string | null;
  knowledge_refs?: string[];
  knowledge_position?: KnowledgePosition | null;
  knowledge_refreshed_at?: string;
  series_key: string | null;
  series_label: string | null;
  published_at: string | null;
  tags_snapshot: string[];
  hard_checks: HardCheckIssue[];
  fixes_applied: string[];
  safe_fix_codes: string[];
  suggestions: CheckSuggestions;
  notes: string[];
}

export interface RecommendedPath {
  label: string;
  href: string;
  description: string;
}

/** `src/data/agent/site/index.json` */
export interface HomeSidecar {
  page_id: string;
  title: string;
  route_path: string;
  generated_at: string;
  run_mode: RunMode;
  provider: string;
  model: string;
  summary: string;
  agent_role: string;
  site_overview: string;
  focus_topics: string[];
  highlights: string[];
  recommended_paths: RecommendedPath[];
  content_stats: {
    total_posts: number;
    featured_posts: number;
    latest_post_title: string | null;
    primary_topics: string[];
  };
  confidence: number;
  notes: string[];
  posts_hash?: string;
}

/** Per-post outcome returned by analyzePost / analyzePosts. */
export interface AnalyzeResult {
  post_id: string;
  title: string;
  source_path: string;
  sidecar_path: string;
  route_path: string;
  provider: string | null;
  model: string | null;
  severity: Severity;
  hard_checks: HardCheckIssue[];
  concerns: string[];
  action_items: string[];
  fixes_applied: string[];
  notes: string[];
  degraded: boolean;
  degraded_reason: string | null;
  knowledge_stale: boolean;
  skipped?: boolean;
  knowledge_refreshed?: boolean;
  /** Set in read-only mode when a regeneration would have happened. */
  stale?: boolean;
  stale_status?: "stale" | "missing";
}

export interface AnalyzeOptions {
  runMode?: RunMode;
  provider?: RequestedProvider;
  model?: string;
  apiKey?: string;
  applyFixes?: boolean;
  allowUnsafeFixes?: boolean;
  generateFrontmatter?: boolean;
  frontmatterHintText?: string;
  writeMarkdown?: boolean;
  force?: boolean;
  updateMemory?: boolean;
  /** false = read-only: report stale/missing instead of regenerating. */
  regenerate?: boolean;
  knowledgeMap?: unknown;
  memoryStore?: unknown;
  concurrency?: number;
}

export interface KnowledgeRefreshResult<TMap = unknown> {
  knowledge_hash: string;
  committed_hash?: string | null;
  stale?: boolean;
  post_count: number;
  series_count: number;
  issue_count: number;
  sidecar_path: string;
  map: TMap;
}

export interface HomePanelResult {
  page_id: string;
  title: string;
  route_path: string;
  sidecar_path: string;
  focus_topics: string[];
  content_stats: HomeSidecar["content_stats"] | null;
  notes: string[];
  skipped?: boolean;
  stale?: boolean;
  stale_status?: "stale" | "missing";
}

export interface SyncOptions extends AnalyzeOptions {
  refreshKnowledge?: boolean;
  knowledgePostPaths?: string[];
  buildHomePanel?: boolean;
}

export interface SyncResult {
  postResults: AnalyzeResult[];
  homePanelResult: HomePanelResult | null;
  knowledgeResult: KnowledgeRefreshResult | null;
}

export interface GcResult {
  dry_run: boolean;
  orphan_sidecars: string[];
  memory_removed_post_ids: string[];
}
