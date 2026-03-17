// @ts-nocheck
import { SITE } from "../config.js";
import { stringifyMarkdownDocument } from "./frontmatter.js";
import {
  buildDescriptionSuggestion,
  inferTagsFromContent,
  normalizeTags,
} from "./checks.js";
import { slugifyStr } from "./pathing.js";
import { dedupeStrings, truncateText } from "./utils.js";

const HINT_FIELD_ALIASES = {
  author: "author",
  canonical: "canonicalURL",
  canonicalurl: "canonicalURL",
  date: "pubDatetime",
  desc: "description",
  description: "description",
  draft: "draft",
  featured: "featured",
  hideeditpost: "hideEditPost",
  hint: "note",
  moddatetime: "modDatetime",
  notes: "note",
  ogimage: "ogImage",
  pubdate: "pubDatetime",
  pubdatetime: "pubDatetime",
  slug: "slug",
  summary: "description",
  tag: "tags",
  tags: "tags",
  timezone: "timezone",
  title: "title",
};

function isMissingValue(value) {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim() === "";
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return false;
}

function isWeakDescription(value) {
  return typeof value !== "string" || value.trim().length < 15;
}

function isPlaceholderTags(value) {
  if (!Array.isArray(value)) {
    return true;
  }

  const normalized = value
    .map(item => String(item).trim().toLowerCase())
    .filter(Boolean);

  return normalized.length === 0 || normalized.every(item => item === "others");
}

function normalizeDatetime(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().replace(/\.\d{3}Z$/u, "Z");
}

function humanizePostId(postId) {
  return postId
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[-_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function splitTagList(value) {
  return String(value)
    .replace(/^\[(.*)\]$/u, "$1")
    .split(/[,，|/]/u)
    .map(item => item.trim().replace(/^["']|["']$/gu, ""))
    .filter(Boolean);
}

function parseBoolean(value) {
  const normalized = String(value).trim().toLowerCase();

  if (["true", "yes", "y", "1", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "n", "0", "off"].includes(normalized)) {
    return false;
  }

  return null;
}

function parseStructuredHintValue(key, value) {
  if (key === "tags") {
    return splitTagList(value);
  }

  if (["draft", "featured", "hideEditPost"].includes(key)) {
    return parseBoolean(value);
  }

  if (["pubDatetime", "modDatetime"].includes(key)) {
    return normalizeDatetime(value);
  }

  return String(value).trim();
}

export function parseFrontmatterHints(hintText = "") {
  const structured = {};
  const freeform = [];

  for (const rawLine of String(hintText).split(/\r?\n/u)) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    const match = line.match(/^([A-Za-z][\w-]*):\s*(.+)$/u);

    if (!match) {
      freeform.push(line);
      continue;
    }

    const [, rawKey, rawValue] = match;
    const key =
      HINT_FIELD_ALIASES[rawKey.trim().toLowerCase()] ?? rawKey.trim();
    const parsedValue = parseStructuredHintValue(key, rawValue);

    if (key === "note") {
      freeform.push(String(parsedValue).trim());
      continue;
    }

    if (parsedValue === null || parsedValue === "") {
      freeform.push(line);
      continue;
    }

    structured[key] = parsedValue;
  }

  return {
    structured,
    freeform,
  };
}

function findHintTags(hints, globalRules) {
  const tagRegistry = globalRules.tag_registry ?? {};
  const haystack = [
    ...hints.freeform,
    ...(Array.isArray(hints.structured.tags) ? hints.structured.tags : []),
  ]
    .join(" ")
    .toLowerCase();
  const matches = [];

  for (const [canonical, metadata] of Object.entries(tagRegistry)) {
    const candidates = [
      canonical,
      ...(metadata.aliases ?? []),
      ...(metadata.keywords ?? []),
    ];

    if (
      candidates.some(candidate =>
        haystack.includes(String(candidate).trim().toLowerCase())
      )
    ) {
      matches.push(canonical);
    }
  }

  return matches;
}

function selectTitle(snapshot, hints) {
  if (!isMissingValue(hints.structured.title)) {
    return String(hints.structured.title).trim();
  }

  if (!isMissingValue(snapshot.document.data.title)) {
    return String(snapshot.document.data.title).trim();
  }

  const primaryHeading =
    snapshot.analysis.headings.find(heading => heading.depth === 1)?.text ??
    snapshot.analysis.headings[0]?.text;

  if (primaryHeading) {
    return primaryHeading.trim();
  }

  return humanizePostId(snapshot.post_id) || snapshot.post_id;
}

function buildDescription(snapshot, hints, title) {
  if (!isMissingValue(hints.structured.description)) {
    return String(hints.structured.description).trim();
  }

  if (!isWeakDescription(snapshot.document.data.description)) {
    return String(snapshot.document.data.description).trim();
  }

  const base = buildDescriptionSuggestion({
    ...snapshot,
    title,
  });
  const focusHint = hints.freeform.find(line =>
    /(视角|聚焦|侧重|重点|focus|angle)/iu.test(line)
  );

  if (!focusHint) {
    return base;
  }

  const normalizedFocus = focusHint
    .replace(/^(偏向|侧重于|侧重|聚焦|重点关注)\s*/u, "")
    .replace(/[。；;，,]+$/u, "")
    .trim();

  if (!normalizedFocus) {
    return base;
  }

  if (normalizedFocus.includes("视角")) {
    return truncateText(`${base} 文章从${normalizedFocus}展开。`, 140);
  }

  return truncateText(`${base} 文章重点关注${normalizedFocus}。`, 140);
}

function buildTags(snapshot, hints, globalRules, generatedTitle, description) {
  const existingTags = Array.isArray(snapshot.document.data.tags)
    ? snapshot.document.data.tags.map(String)
    : [];
  const normalizedExistingTags = normalizeTags(
    existingTags,
    globalRules.tag_registry
  );
  const hintTags = normalizeTags(
    [
      ...(Array.isArray(hints.structured.tags) ? hints.structured.tags : []),
      ...findHintTags(hints, globalRules),
    ],
    globalRules.tag_registry
  );
  const inferredTags = inferTagsFromContent(
    {
      ...snapshot,
      title: generatedTitle,
      description,
    },
    globalRules
  );

  if (
    normalizedExistingTags.length > 0 &&
    !isPlaceholderTags(normalizedExistingTags)
  ) {
    if (normalizedExistingTags.length >= 2 || hintTags.length === 0) {
      return normalizedExistingTags;
    }

    return dedupeStrings([
      ...normalizedExistingTags,
      ...hintTags,
      ...inferredTags,
    ]).slice(0, 5);
  }

  const generated = dedupeStrings([...hintTags, ...inferredTags]).slice(0, 5);
  return generated.length > 0 ? generated : ["others"];
}

function shouldFillField(key, existingValue) {
  if (isMissingValue(existingValue)) {
    return true;
  }

  if (key === "description") {
    return isWeakDescription(existingValue);
  }

  if (key === "tags") {
    return isPlaceholderTags(existingValue);
  }

  if (key === "pubDatetime") {
    return normalizeDatetime(existingValue) === null;
  }

  return false;
}

function buildGeneratedFields(snapshot, hints, globalRules) {
  const title = selectTitle(snapshot, hints);
  const description = buildDescription(snapshot, hints, title);
  const generated = {
    title,
    pubDatetime:
      normalizeDatetime(hints.structured.pubDatetime) ??
      normalizeDatetime(snapshot.document.data.pubDatetime) ??
      normalizeDatetime(new Date()),
    description,
    draft:
      typeof hints.structured.draft === "boolean"
        ? hints.structured.draft
        : typeof snapshot.document.data.draft === "boolean"
          ? snapshot.document.data.draft
          : false,
    tags: buildTags(snapshot, hints, globalRules, title, description),
    author: String(
      hints.structured.author ?? snapshot.document.data.author ?? SITE.author
    ).trim(),
    slug: String(
      hints.structured.slug ??
        snapshot.document.data.slug ??
        slugifyStr(snapshot.post_id)
    ).trim(),
    timezone: String(
      hints.structured.timezone ??
        snapshot.document.data.timezone ??
        SITE.timezone
    ).trim(),
  };

  for (const key of [
    "featured",
    "canonicalURL",
    "hideEditPost",
    "modDatetime",
    "ogImage",
  ]) {
    if (!isMissingValue(hints.structured[key])) {
      generated[key] = hints.structured[key];
    }
  }

  return generated;
}

export function generateFrontmatter(
  snapshot,
  schemaRules,
  globalRules,
  options = {}
) {
  const hints = parseFrontmatterHints(options.hintText ?? "");
  const generatedFields = buildGeneratedFields(snapshot, hints, globalRules);
  const document = {
    ...snapshot.document,
    hasFrontmatter: true,
    data: { ...snapshot.document.data },
    order: [...snapshot.document.order],
  };
  const appliedFields = [];

  for (const field of schemaRules.required_fields ?? []) {
    if (shouldFillField(field, document.data[field])) {
      document.data[field] = generatedFields[field];
      appliedFields.push(field);
    }
  }

  for (const field of [
    "draft",
    "tags",
    "author",
    "slug",
    "timezone",
    "featured",
    "canonicalURL",
    "hideEditPost",
    "modDatetime",
    "ogImage",
  ]) {
    if (
      Object.prototype.hasOwnProperty.call(generatedFields, field) &&
      shouldFillField(field, document.data[field])
    ) {
      document.data[field] = generatedFields[field];
      appliedFields.push(field);
    }
  }

  const source = stringifyMarkdownDocument(document);

  return {
    changed: !snapshot.document.hasFrontmatter || appliedFields.length > 0,
    createdFrontmatter: !snapshot.document.hasFrontmatter,
    appliedFields: dedupeStrings(appliedFields),
    source,
    document,
    hints,
  };
}
