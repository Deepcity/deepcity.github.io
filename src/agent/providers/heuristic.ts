// @ts-nocheck
import {
  dedupeStrings,
  maxSeverity,
  roundConfidence,
  truncateText,
} from "../utils.js";

function buildStructuralReview(input) {
  const headingCount = input.analysis.headings.length;
  const codeCount = input.analysis.codeFences.length;
  const imageCount = input.analysis.images.length;
  const structureIssues = input.issues.filter(issue =>
    ["body-h1", "heading-skip"].includes(issue.code)
  );

  if (structureIssues.length > 0) {
    return `文章结构已经有基本分段，但仍存在 ${structureIssues.length} 处标题层级问题；建议先把正文层级理顺，再考虑扩展细节。当前正文包含 ${headingCount} 个标题、${codeCount} 个代码块、${imageCount} 张图片。`;
  }

  if (headingCount >= 4) {
    return `文章分段较完整，主线已经能靠 ${headingCount} 个标题展开。当前还配有 ${codeCount} 个代码块和 ${imageCount} 张图片，适合作为技术记录继续细化关键结论。`;
  }

  return `正文结构偏紧凑，当前只有 ${headingCount} 个显式标题。若这是长文，建议再拆出更清晰的小节，把 ${codeCount} 个代码块或图示对应到明确段落。`;
}

function buildTechnicalReview(input) {
  const tags = new Set(input.post.tags);
  const lowerTitle = input.post.title.toLowerCase();

  if (tags.has("论文阅读") || tags.has("OSDI") || tags.has("SOSP")) {
    return "这篇文章更像论文阅读笔记，适合进一步补强机制拆解、实验设置与作者结论的对应关系。如果只保留摘要级结论，读者会知道论文说了什么，但不一定知道它为什么成立。";
  }

  if (tags.has("CMU15213") || lowerTitle.includes("lab")) {
    return "这篇文章具备实验记录的骨架，适合继续补足关键实现决策、调试过程与为什么这样做。课程实验类内容如果只停留在步骤罗列，会削弱对并发、体系结构或漏洞利用细节的解释力。";
  }

  if (tags.has("Agent") || tags.has("LLM") || tags.has("MCP")) {
    return "文章主题本身有较高的系统性，建议持续强调术语边界、模块关系与 runtime 编排的因果链。只要把概念表和实现取舍讲透，这类内容会比单纯 API 清单更有复用价值。";
  }

  return "技术内容已经具备记录价值，但还可以进一步压缩背景铺垫，把篇幅更多让给核心机制、关键示例和结论依据。读者最需要的是你对问题本身的判断，而不是对名词的重复解释。";
}

function buildStrengths(input) {
  const strengths = [];

  if (input.post.description && input.post.description.length >= 20) {
    strengths.push("frontmatter 中已有可用摘要，页面元信息完整度较好。");
  }

  if (input.analysis.headings.length >= 3) {
    strengths.push("正文存在明确分节，阅读路径基本清楚。");
  }

  if (input.analysis.codeFences.length > 0) {
    strengths.push("文章包含代码或命令示例，技术可操作性较强。");
  }

  if (input.analysis.linkCount >= 2) {
    strengths.push("引用链接数量足够，外部材料入口比较明确。");
  }

  if (strengths.length === 0) {
    strengths.push(
      "当前草稿已经具备发布雏形，Agent 可继续围绕结构与表达细化。"
    );
  }

  return strengths;
}

function buildConcerns(input) {
  const concerns = input.issues
    .filter(issue => issue.severity !== "info")
    .map(issue => issue.message);

  if (input.suggestions.description_suggestion) {
    concerns.push("description 仍需补强，当前摘要不足以代表全文。");
  }

  if (input.suggestions.tag_replacements.length > 0) {
    concerns.push("tags 与标准标签库存在漂移，建议先做归一化。");
  }

  if (input.suggestions.inferred_tags.length > 0) {
    concerns.push("tags 仍未明确，后续记忆聚类会缺乏稳定主题信号。");
  }

  return dedupeStrings(concerns);
}

function buildActionItems(input, concerns) {
  const actions = [...input.actionItems];

  for (const issue of input.issues) {
    if (issue.fixable && !issue.fixed) {
      actions.push(`处理 ${issue.code} 对应的问题。`);
    }
  }

  for (const concern of concerns) {
    if (concern.includes("description")) {
      actions.push("补充一句能覆盖文章目标、方法和结论的 description。");
    }

    if (concern.includes("tags")) {
      actions.push("按标准标签库规范化 tags，再刷新 topic memory。");
    }
  }

  if (actions.length === 0) {
    actions.push("当前未发现需要立刻修复的硬问题，可继续打磨技术论证。");
  }

  return dedupeStrings(actions);
}

export function createHeuristicProvider() {
  return {
    name: "heuristic",
    model: "heuristic-v1",
    async generateReview(input, context) {
      const concerns = buildConcerns(input);
      const actionItems = buildActionItems(input, concerns);
      const memoryRefs = dedupeStrings([
        "global:tag_registry",
        ...(context.refs ?? []),
      ]);

      return {
        summary: truncateText(
          input.post.description || input.post.excerpt || input.post.title,
          160
        ),
        structural_review: buildStructuralReview(input),
        technical_review: buildTechnicalReview(input),
        strengths: buildStrengths(input),
        concerns,
        action_items: actionItems,
        severity: maxSeverity(input.issues.map(issue => issue.severity)),
        confidence: roundConfidence(
          0.58 +
            Math.min(0.1, input.analysis.headings.length * 0.02) +
            Math.min(0.08, input.analysis.codeFences.length * 0.02) +
            Math.min(
              0.06,
              context.refs?.length ? context.refs.length * 0.01 : 0
            )
        ),
        memory_refs: memoryRefs,
      };
    },
    async generateFixes() {
      return { fixes: [] };
    },
  };
}
