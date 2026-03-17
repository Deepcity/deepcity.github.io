// @ts-nocheck
import path from "node:path";

function countWords(value) {
  return value.trim() ? value.trim().split(/\s+/u).length : 0;
}

function collectParagraphs(lines) {
  const paragraphs = [];
  let buffer = [];

  for (const line of lines) {
    if (!line.trim()) {
      if (buffer.length > 0) {
        paragraphs.push(buffer.join(" ").trim());
        buffer = [];
      }

      continue;
    }

    if (/^>\s?/u.test(line) || /^!\[/u.test(line) || /^#{1,6}\s/u.test(line)) {
      if (buffer.length > 0) {
        paragraphs.push(buffer.join(" ").trim());
        buffer = [];
      }

      continue;
    }

    buffer.push(line.trim());
  }

  if (buffer.length > 0) {
    paragraphs.push(buffer.join(" ").trim());
  }

  return paragraphs;
}

export function getParagraphs(body, maxParagraphs = 3) {
  return collectParagraphs(body.split(/\r?\n/u)).slice(0, maxParagraphs);
}

export function analyzeMarkdownBody(body) {
  const lines = body.split(/\r?\n/u);
  const headings = [];
  const codeFences = [];
  const images = [];
  const bareUrls = [];
  let linkCount = 0;
  let inFence = false;
  let currentFence = null;
  const proseLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const fenceMatch = line.match(/^```([^\s`]*)\s*$/u);

    if (fenceMatch) {
      if (!inFence) {
        currentFence = {
          language: fenceMatch[1].trim(),
          startLine: lineNumber,
          content: [],
        };
        inFence = true;
      } else if (currentFence) {
        codeFences.push({
          ...currentFence,
          endLine: lineNumber,
        });
        currentFence = null;
        inFence = false;
      }

      continue;
    }

    if (inFence && currentFence) {
      currentFence.content.push(line);
      continue;
    }

    proseLines.push(line);

    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/u);

    if (headingMatch) {
      headings.push({
        depth: headingMatch[1].length,
        text: headingMatch[2].trim(),
        line: lineNumber,
      });
    }

    for (const match of line.matchAll(/!\[(.*?)\]\(([^)]+)\)/gu)) {
      images.push({
        alt: match[1].trim(),
        url: match[2].trim(),
        line: lineNumber,
      });
    }

    for (const match of line.matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)) {
      if (match[1]) {
        linkCount += 1;
      }
    }

    for (const match of line.matchAll(/https?:\/\/\S+/gu)) {
      const before = line.slice(0, match.index);
      if (!before.endsWith("(") && !before.endsWith("](")) {
        bareUrls.push({
          url: match[0],
          line: lineNumber,
        });
      }
    }
  }

  const paragraphs = collectParagraphs(proseLines);
  const firstParagraphs = paragraphs.slice(0, 3);

  return {
    headings,
    codeFences,
    images,
    bareUrls,
    paragraphCount: paragraphs.length,
    firstParagraphs,
    wordCount: countWords(paragraphs.join(" ")),
    linkCount,
  };
}

export function inferCodeFenceLanguage(contentLines) {
  const content = contentLines.join("\n").trim();
  const lowerContent = content.toLowerCase();

  if (!content) {
    return { language: "text", confidence: 0.4 };
  }

  if (
    /^(\$|#)\s/mu.test(content) ||
    /\b(git|pnpm|npm|yarn|cargo|make|cd|ls|cp|mv|rm)\b/u.test(content)
  ) {
    return { language: "sh", confidence: 0.88 };
  }

  if (
    /#include\s+</u.test(content) ||
    /\bprintf\s*\(/u.test(content) ||
    /\bint\s+main\s*\(/u.test(content)
  ) {
    return { language: "c", confidence: 0.91 };
  }

  if (
    /\bstd::/u.test(content) ||
    /#include\s+<iostream>/u.test(content) ||
    /\bvector\s*</u.test(content)
  ) {
    return { language: "cpp", confidence: 0.9 };
  }

  if (
    /^\s*def\s+\w+\(/mu.test(content) ||
    /^\s*from\s+\w+\s+import\s+/mu.test(content) ||
    /^\s*import\s+\w+/mu.test(content)
  ) {
    return { language: "py", confidence: 0.9 };
  }

  if (
    (content.startsWith("{") && content.endsWith("}")) ||
    (content.startsWith("[") && content.endsWith("]"))
  ) {
    try {
      JSON.parse(content);
      return { language: "json", confidence: 0.95 };
    } catch {
      return { language: "javascript", confidence: 0.55 };
    }
  }

  if (
    /:\s+\S+/u.test(content) &&
    !/[{};]/u.test(content) &&
    !lowerContent.includes("http")
  ) {
    return { language: "yaml", confidence: 0.66 };
  }

  return { language: "text", confidence: 0.45 };
}

export function suggestImageAlt(url) {
  const cleanUrl = url.split("?")[0].split("#")[0];
  const baseName = path.posix.basename(cleanUrl, path.posix.extname(cleanUrl));
  const normalized = decodeURIComponent(baseName)
    .replace(/[-_]+/gu, " ")
    .trim();

  return normalized || "image";
}

export function suggestCodeFenceLanguage(contentLines) {
  return inferCodeFenceLanguage(contentLines).language;
}

export function applyCodeFenceLanguageFixes(markdown, codeBlocks) {
  const lines = markdown.split(/\r?\n/u);
  let changed = false;

  for (const block of codeBlocks) {
    if (block.language) {
      continue;
    }

    const lineIndex = block.openLineIndex ?? block.startLine - 1;
    const openingLine = lines[lineIndex] ?? "";
    const indentation = openingLine.match(/^(\s*)/u)?.[1] ?? "";
    lines[lineIndex] =
      `${indentation}\`\`\`${block.suggestedLanguage ?? "text"}`;
    changed = true;
  }

  return {
    changed,
    markdown: lines.join("\n"),
  };
}

export function inspectMarkdown(markdown, options = {}) {
  const { lineOffset = 0 } = options;
  const analyzed = analyzeMarkdownBody(markdown);
  const issues = [];
  const codeBlocks = analyzed.codeFences.map(codeFence => {
    const suggestion = inferCodeFenceLanguage(codeFence.content);
    if (!codeFence.language) {
      issues.push({
        code: "markdown.missing_code_language",
        severity: "warn",
        line: codeFence.startLine + lineOffset,
        message: `代码块缺少语言标记，建议补成 \`${suggestion.language}\`。`,
        fixable: true,
      });
    }

    return {
      language: codeFence.language,
      content: codeFence.content,
      line: codeFence.startLine + lineOffset,
      openLineIndex: codeFence.startLine - 1,
      openingLine: "```",
      suggestedLanguage: suggestion.language,
    };
  });

  for (const heading of analyzed.headings) {
    if (heading.depth === 1) {
      issues.push({
        code: "markdown.heading_start",
        severity: "warn",
        line: heading.line + lineOffset,
        message: "正文建议从 H2 开始，H1 由页面模板负责。",
      });
    }
  }

  for (let index = 1; index < analyzed.headings.length; index += 1) {
    const previous = analyzed.headings[index - 1];
    const current = analyzed.headings[index];

    if (current.depth - previous.depth > 1) {
      issues.push({
        code: "markdown.heading_skip",
        severity: "warn",
        line: current.line + lineOffset,
        message: `标题层级从 H${previous.depth} 跳到了 H${current.depth}。`,
      });
    }
  }

  for (const image of analyzed.images) {
    if (!image.alt) {
      issues.push({
        code: "markdown.empty_alt",
        severity: "warn",
        line: image.line + lineOffset,
        message: `图片缺少 alt 文本，可至少补成 \`${suggestImageAlt(image.url)}\`。`,
      });
    }
  }

  for (const bareUrl of analyzed.bareUrls) {
    issues.push({
      code: "markdown.bare_url",
      severity: "info",
      line: bareUrl.line + lineOffset,
      message: `建议将裸链接改为 Markdown 链接：${bareUrl.url}`,
    });
  }

  if (analyzed.headings.length === 0) {
    issues.push({
      code: "markdown.no_headings",
      severity: "warn",
      message: "正文缺少明确的章节标题，长文会较难导航。",
    });
  }

  const charCount = collectParagraphs(markdown.split(/\r?\n/u)).join(
    " "
  ).length;
  if (charCount > 2800 && !markdown.includes("<!--more-->")) {
    issues.push({
      code: "markdown.missing_more",
      severity: "info",
      message: "文章较长但没有 `<!--more-->`，可考虑补一个摘要分割点。",
    });
  }

  return {
    headings: analyzed.headings.map(heading => ({
      ...heading,
      line: heading.line + lineOffset,
    })),
    codeBlocks,
    images: analyzed.images.map(image => ({
      alt: image.alt,
      source: image.url,
      line: image.line + lineOffset,
    })),
    bareLinks: analyzed.bareUrls.map(entry => entry.url),
    paragraphs: analyzed.firstParagraphs,
    charCount,
    issues,
  };
}
