// @ts-nocheck
import { SAFE_FIX_CODES } from "../shared/constants.js";
import { stringifyMarkdownDocument } from "../parsers/frontmatter.js";
import { inferCodeFenceLanguage, suggestImageAlt } from "../parsers/markdown.js";
import { getPostIdFromFilePath, slugifyStr } from "../shared/pathing.js";
import { dedupeStrings } from "../shared/utils.js";

function buildTagAliasMap(tagRegistry) {
  const aliasMap = new Map();

  for (const [canonical, metadata] of Object.entries(tagRegistry ?? {})) {
    aliasMap.set(canonical.toLowerCase(), canonical);

    for (const alias of metadata.aliases ?? []) {
      aliasMap.set(alias.toLowerCase(), canonical);
    }
  }

  return aliasMap;
}

export function normalizeTags(tags, tagRegistry) {
  const aliasMap = buildTagAliasMap(tagRegistry);

  return dedupeStrings(
    tags.map(tag => {
      const canonical = aliasMap.get(String(tag).toLowerCase());
      return canonical ?? String(tag);
    })
  );
}

export function inferTagsFromContent(snapshot, globalRules) {
  const text = [
    snapshot.title,
    snapshot.description,
    snapshot.analysis.firstParagraphs.join(" "),
  ]
    .join(" ")
    .toLowerCase();
  const scored = [];

  for (const [canonical, metadata] of Object.entries(
    globalRules.tag_registry ?? {}
  )) {
    const hits = (metadata.keywords ?? []).filter(keyword =>
      text.includes(String(keyword).toLowerCase())
    );

    if (hits.length > 0) {
      scored.push({
        canonical,
        score: hits.length,
      });
    }
  }

  return scored
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map(item => item.canonical);
}

export function buildDescriptionSuggestion(snapshot) {
  const source = snapshot.analysis.firstParagraphs.join(" ");

  if (!source) {
    return `${snapshot.title} 的技术记录，补充文章目标、核心内容与结论摘要。`;
  }

  const normalized = source.replace(/\s+/gu, " ").trim();
  return normalized.length <= 80 ? normalized : `${normalized.slice(0, 79)}…`;
}

function detectSeries(postId, globalRules) {
  for (const rule of globalRules.series_naming_rules ?? []) {
    if (new RegExp(rule.id_pattern, "u").test(postId)) {
      return {
        id: rule.id,
        label: rule.label,
        expected_total: rule.expected_total,
      };
    }
  }

  return null;
}

function setDocumentField(document, key, value) {
  document.data[key] = value;

  if (!document.order.includes(key)) {
    document.order.push(key);
  }
}

export function runChecks(snapshot, schemaRules, globalRules, options = {}) {
  const document = {
    ...snapshot.document,
    data: { ...snapshot.document.data },
    order: [...snapshot.document.order],
  };
  const issues = [];
  const fixesApplied = [];
  const actionItems = [];
  const suggestions = {
    normalized_tags: [],
    tag_replacements: [],
    inferred_tags: [],
    description_suggestion: null,
    slug_suggestion: null,
  };
  const applySafeFixes = options.applyFixes !== false;
  const allowUnsafeFixes = options.allowUnsafeFixes === true;

  if (!document.hasFrontmatter) {
    issues.push({
      code: "missing-frontmatter",
      severity: "error",
      message: "缺少 YAML frontmatter，Agent 无法基于 schema 做完整校验。",
      fixable: false,
    });
  }

  for (const field of schemaRules.required_fields) {
    const value = document.data[field];
    const missing =
      value === undefined ||
      value === null ||
      (typeof value === "string" && value.trim() === "");

    if (missing) {
      issues.push({
        code: `missing-required-${field}`,
        severity: "error",
        message: `缺少 schema 必填字段 \`${field}\`。`,
        fixable: false,
      });
    }
  }

  if (
    typeof document.data.pubDatetime === "string" &&
    Number.isNaN(Date.parse(document.data.pubDatetime))
  ) {
    issues.push({
      code: "invalid-pubDatetime",
      severity: "error",
      message: "`pubDatetime` 不是可解析的日期值。",
      fixable: false,
    });
  }

  if (document.data.draft === undefined) {
    issues.push({
      code: "missing-draft",
      severity: "info",
      message: "建议显式声明 `draft: false`，避免发布状态只依赖默认值。",
      fixable: true,
      fixed: applySafeFixes,
    });

    if (applySafeFixes) {
      setDocumentField(document, "draft", false);
      fixesApplied.push("补全 `draft: false`。");
    }
  }

  if (!document.data.description) {
    suggestions.description_suggestion = buildDescriptionSuggestion(snapshot);
    actionItems.push("补充 description，摘要当前仍为空。");

    if (allowUnsafeFixes) {
      setDocumentField(
        document,
        "description",
        suggestions.description_suggestion
      );
      fixesApplied.push("根据首段自动生成 description。");
    }
  } else if (String(document.data.description).trim().length < 15) {
    suggestions.description_suggestion = buildDescriptionSuggestion(snapshot);
    actionItems.push("扩展 description，当前摘要过短。");
  }

  if (!document.data.slug) {
    suggestions.slug_suggestion = slugifyStr(
      getPostIdFromFilePath(options.filePath)
    );
    actionItems.push("如需稳定分享链接，可补充推荐 slug。");

    if (allowUnsafeFixes) {
      setDocumentField(document, "slug", suggestions.slug_suggestion);
      fixesApplied.push("补全推荐 slug。");
    }
  }

  const postId = getPostIdFromFilePath(options.filePath);
  const canonicalPostId = slugifyStr(postId);

  if (postId !== canonicalPostId) {
    issues.push({
      code: "non-canonical-post-id",
      severity: "warn",
      message: `文件名 \`${postId}.md\` 不符合站点路径规范，建议改为 \`${canonicalPostId}.md\`，站内文章链接统一使用小写 kebab-case。`,
      fixable: false,
    });
    actionItems.push("统一文章文件名与站内文章链接为小写 kebab-case。");
  }

  if (
    typeof document.data.slug === "string" &&
    document.data.slug.trim() !== "" &&
    document.data.slug !== slugifyStr(document.data.slug)
  ) {
    suggestions.slug_suggestion = slugifyStr(document.data.slug);
    issues.push({
      code: "non-canonical-slug",
      severity: "warn",
      message: "`slug` 应使用小写 kebab-case，避免站内链接出现大小写漂移。",
      fixable: allowUnsafeFixes,
      fixed: allowUnsafeFixes,
    });

    if (allowUnsafeFixes) {
      setDocumentField(document, "slug", suggestions.slug_suggestion);
      fixesApplied.push("将 `slug` 规范化为小写 kebab-case。");
    }
  }

  const originalTags = Array.isArray(document.data.tags)
    ? document.data.tags.map(String)
    : [];
  const normalizedTags = normalizeTags(originalTags, globalRules.tag_registry);
  suggestions.normalized_tags = normalizedTags;
  suggestions.tag_replacements = originalTags.filter(
    (tag, index) => normalizedTags[index] && normalizedTags[index] !== tag
  );

  if (originalTags.length === 0) {
    suggestions.inferred_tags = inferTagsFromContent(snapshot, globalRules);
    actionItems.push("补充 2-5 个标签，当前文章只会落到 schema 默认值。");

    if (allowUnsafeFixes && suggestions.inferred_tags.length > 0) {
      setDocumentField(document, "tags", suggestions.inferred_tags);
      fixesApplied.push("基于标题与摘要推断 tags。");
    }
  } else if (suggestions.tag_replacements.length > 0) {
    actionItems.push("将 tags 规范化到标准标签库，减少同义词漂移。");

    if (allowUnsafeFixes) {
      setDocumentField(document, "tags", normalizedTags);
      fixesApplied.push("把 tags 归一化到标准标签库。");
    }
  }

  const bodyLines = document.body.split(/\r?\n/u);

  for (const heading of snapshot.analysis.headings) {
    if (heading.depth === 1) {
      issues.push({
        code: "body-h1",
        severity: "warn",
        message: `第 ${heading.line} 行存在正文 H1，建议从 H2 开始。`,
        line: heading.line,
        fixable: false,
      });
    }
  }

  for (let index = 1; index < snapshot.analysis.headings.length; index += 1) {
    const previous = snapshot.analysis.headings[index - 1];
    const current = snapshot.analysis.headings[index];

    if (current.depth - previous.depth > 1) {
      issues.push({
        code: "heading-skip",
        severity: "warn",
        message: `第 ${current.line} 行标题层级从 H${previous.depth} 跳到了 H${current.depth}。`,
        line: current.line,
        fixable: false,
      });
    }
  }

  for (const image of snapshot.analysis.images) {
    if (!image.alt) {
      const alt = suggestImageAlt(image.url);
      issues.push({
        code: "empty-image-alt",
        severity: "warn",
        message: `第 ${image.line} 行图片缺少 alt 文本。`,
        line: image.line,
        fixable: true,
        fixed: applySafeFixes,
      });

      if (applySafeFixes) {
        const lineIndex = image.line - 1;
        bodyLines[lineIndex] = bodyLines[lineIndex].replace(
          /!\[\]\(([^)]+)\)/u,
          `![${alt}]($1)`
        );
      }
    }
  }

  for (const fence of snapshot.analysis.codeFences) {
    if (!fence.language) {
      const inferred = inferCodeFenceLanguage(fence.content);
      issues.push({
        code: "missing-code-language",
        severity: "warn",
        message: `第 ${fence.startLine} 行代码块缺少语言标记。`,
        line: fence.startLine,
        fixable: true,
        fixed: applySafeFixes,
      });

      if (applySafeFixes) {
        const lineIndex = fence.startLine - 1;
        bodyLines[lineIndex] = `\`\`\`${inferred.language}`;
        fixesApplied.push(
          `为第 ${fence.startLine} 行代码块补全语言标记 \`${inferred.language}\`。`
        );
      }
    }
  }

  if (snapshot.analysis.bareUrls.length > 0) {
    issues.push({
      code: "bare-url",
      severity: "info",
      message: `检测到 ${snapshot.analysis.bareUrls.length} 处裸 URL，建议改成 Markdown 链接。`,
      fixable: false,
    });
  }

  if (applySafeFixes) {
    document.body = bodyLines.join(document.newline ?? "\n");
  }

  const changedSource = stringifyMarkdownDocument(document);
  const contentChanged = changedSource !== snapshot.raw;
  const series = detectSeries(snapshot.post_id, globalRules);
  const currentTags = Array.isArray(document.data.tags)
    ? document.data.tags.map(String)
    : originalTags;

  return {
    document,
    issues,
    fixesApplied,
    actionItems: dedupeStrings(actionItems),
    suggestions,
    contentChanged,
    changedSource,
    series,
    currentTags,
    safe_fix_codes: issues
      .filter(
        issue => issue.fixable && issue.fixed && SAFE_FIX_CODES.has(issue.code)
      )
      .map(issue => issue.code),
  };
}
