// @ts-nocheck
import { BLOG_ROOT, DEFAULT_PROVIDER, REPO_ROOT } from "./constants.js";
import { listMarkdownFiles, writeJson } from "./fs.js";
import { getHomeSidecarPath } from "./pathing.js";
import { loadPostSnapshot } from "./post-snapshot.js";
import {
  requestGeminiJson,
  resolveGeminiConfig,
} from "./providers/gemini.js";
import {
  dedupeStrings,
  isoNow,
  repoRelative,
  roundConfidence,
  truncateText,
} from "./utils.js";

const TRACK_DEFINITIONS = [
  {
    id: "cmu-15213",
    label: "CMU 15-213 实验与系统基础",
    patterns: [
      /\bcmu[-\s]?15[-\s]?213\b/iu,
      /\b(bomblab|attacklab|shelllab|cachelab|malloclab|architecturelab)\b/iu,
      /\bcsapp\b/iu,
    ],
    tags: ["CMU15213", "CSAPP"],
  },
  {
    id: "papers",
    label: "OSDI / SOSP 论文阅读",
    patterns: [/\b(osdi|sosp)\b/iu, /论文/u, /\bpaper\b/iu],
    tags: ["OSDI", "SOSP", "论文阅读", "Paper"],
  },
  {
    id: "ascend-c",
    label: "Ascend C 算子开发",
    patterns: [/\bascend\s*c\b/iu, /\bascendc\b/iu, /算子/u],
    tags: ["AscendC", "Ascend C", "昇腾"],
  },
  {
    id: "agent-engineering",
    label: "Agent / MCP / Embedding 工程",
    patterns: [/\bagent\b/iu, /\bmcp\b/iu, /\bembedding\b/iu, /\bllm\b/iu],
    tags: ["Agent", "MCP", "Embedding", "LLM", "API"],
  },
  {
    id: "algorithms",
    label: "算法、数论与群体智能",
    patterns: [/\balgorithm\b/iu, /number\s*theory/iu, /\bpso\b/iu, /群体/u],
    tags: ["算法", "数论", "群体智能", "数学"],
  },
];

function sortSnapshotsByPublishedAt(snapshots) {
  return [...snapshots].sort((left, right) =>
    String(right.pubDatetime ?? "").localeCompare(String(left.pubDatetime ?? ""))
  );
}

function normalizeTags(tags) {
  return new Set((tags ?? []).map(tag => String(tag).trim().toLowerCase()));
}

function collectSearchText(snapshot) {
  return [
    snapshot.post_id,
    snapshot.title,
    snapshot.description,
    snapshot.excerpt,
    snapshot.file_path,
  ]
    .filter(Boolean)
    .join(" ");
}

function matchesTrack(snapshot, track) {
  const searchText = collectSearchText(snapshot);
  const tagSet = normalizeTags(snapshot.tags);

  return (
    track.patterns.some(pattern => pattern.test(searchText)) ||
    track.tags.some(tag => tagSet.has(tag.toLowerCase()))
  );
}

function buildTracks(snapshots) {
  return TRACK_DEFINITIONS.map(track => {
    const matches = sortSnapshotsByPublishedAt(
      snapshots.filter(snapshot => matchesTrack(snapshot, track))
    );

    if (matches.length === 0) {
      return null;
    }

    const latest = matches[0];

    return {
      id: track.id,
      label: track.label,
      count: matches.length,
      latest_post_id: latest.post_id,
      latest_post_title: latest.title,
      latest_route_path: latest.route_path,
      latest_excerpt: truncateText(
        latest.description || latest.excerpt || latest.title,
        88
      ),
      published_at: latest.pubDatetime,
    };
  })
    .filter(Boolean)
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return String(right.published_at ?? "").localeCompare(
        String(left.published_at ?? "")
      );
    });
}

function summarizeTrackLabels(tracks) {
  const labels = tracks.slice(0, 4).map(track => track.label);

  if (labels.length === 0) {
    return "系统学习笔记与技术实践";
  }

  if (labels.length === 1) {
    return labels[0];
  }

  return labels.join("、");
}

function buildSummary(stats, tracks) {
  const topics = summarizeTrackLabels(tracks);

  return truncateText(
    `这是 Deepcity 博客首页的静态 Agent 导览，聚焦 ${topics} 等主题，帮助首次访问者快速理解站点内容主线，并跳转到最值得先读的入口。`,
    160
  );
}

function buildAgentRole() {
  return "这个首页 Agent 不是在线客服，而是构建期生成的静态导览员：它负责概括博客主题、解释文章页 Agent Review 的作用，并把读者引到站内最有代表性的内容入口。";
}

function buildSiteOverview(stats, tracks) {
  const topics = summarizeTrackLabels(tracks);
  const latestTitle = stats.latest_post_title
    ? `最近更新是《${stats.latest_post_title}》。`
    : "";

  return `站点当前收录 ${stats.total_posts} 篇文章，其中 ${stats.featured_posts} 篇被标记为精选。内容主要围绕 ${topics} 展开，既包含课程实验与论文阅读，也包含 AI 基础设施和工程实践。${latestTitle}`.trim();
}

function buildHighlights(stats, tracks) {
  const highlights = [
    `首页精选与最近发布共同构成阅读入口，当前已收录 ${stats.total_posts} 篇文章、${stats.featured_posts} 篇精选。`,
    `站点主线集中在 ${summarizeTrackLabels(tracks)}，适合按专题连续阅读。`,
    "文章页中的 Agent Review 来自预先生成的 sidecar JSON，访问页面时不会触发在线请求。",
  ];

  const agentTrack = tracks.find(track => track.id === "agent-engineering");

  if (agentTrack) {
    highlights.splice(
      2,
      0,
      `Agent 相关主题当前已有 ${agentTrack.count} 篇，最近一篇是《${agentTrack.latest_post_title}》。`
    );
  }

  return dedupeStrings(highlights).slice(0, 4);
}

function buildRecommendedPaths(stats, tracks) {
  const paths = [];

  if (stats.featured_post) {
    paths.push({
      label: `精选起点：${stats.featured_post.title}`,
      href: stats.featured_post.route_path,
      description: truncateText(
        stats.featured_post.description ||
          stats.featured_post.excerpt ||
          "从首页精选文章开始了解站点代表性内容。",
        80
      ),
    });
  } else if (stats.latest_post) {
    paths.push({
      label: `最近更新：${stats.latest_post.title}`,
      href: stats.latest_post.route_path,
      description: truncateText(
        stats.latest_post.description ||
          stats.latest_post.excerpt ||
          "从最近更新开始了解站点当前关注的主题。",
        80
      ),
    });
  }

  for (const trackId of ["agent-engineering", "ascend-c", "papers", "cmu-15213"]) {
    const track = tracks.find(item => item.id === trackId);

    if (!track) {
      continue;
    }

    paths.push({
      label: track.label,
      href: track.latest_route_path,
      description: `最近相关更新是《${track.latest_post_title}》。`,
    });
  }

  paths.push({
    label: "浏览全部文章",
    href: "/posts/",
    description: `按时间线查看站内全部 ${stats.total_posts} 篇文章。`,
  });
  paths.push({
    label: "关于作者",
    href: "/about",
    description: "查看研究兴趣、背景与站点定位。",
  });

  return dedupeStrings(paths.map(path => path.href))
    .map(href => paths.find(path => path.href === href))
    .filter(Boolean)
    .slice(0, 4);
}

function buildLatestPostContext(snapshots) {
  return sortSnapshotsByPublishedAt(snapshots)
    .slice(0, 6)
    .map(snapshot => ({
      title: snapshot.title,
      route_path: snapshot.route_path,
      description: truncateText(
        snapshot.description || snapshot.excerpt || snapshot.title,
        96
      ),
      tags: snapshot.tags.slice(0, 4),
    }));
}

function buildAllowedRecommendedPaths(baseSidecar) {
  return dedupeStrings(
    [
      ...(baseSidecar.recommended_paths ?? []).map(path => path.href),
      "/posts/",
      "/about",
    ].filter(Boolean)
  )
    .map(href => {
      const existing = (baseSidecar.recommended_paths ?? []).find(
        path => path.href === href
      );

      if (existing) {
        return existing;
      }

      if (href === "/posts/") {
        return {
          label: "浏览全部文章",
          href,
          description: "按时间线查看站内全部文章。",
        };
      }

      return {
        label: "关于作者",
        href,
        description: "查看研究兴趣、背景与站点定位。",
      };
    })
    .slice(0, 6);
}

function buildGeminiHomePanelPrompt(baseSidecar, snapshots) {
  const allowedPaths = buildAllowedRecommendedPaths(baseSidecar);
  const latestPosts = buildLatestPostContext(snapshots);

  return [
    "你是 Deepcity 博客首页的导览 Agent。",
    "请只输出一个 JSON 对象，不要输出 Markdown。",
    "必须包含字段：summary、agent_role、site_overview、focus_topics、highlights、recommended_paths、confidence。",
    "summary、agent_role、site_overview 用中文，每项控制在 120 字以内。",
    "focus_topics 是 3 到 4 个字符串。",
    "highlights 是 3 到 4 个字符串，每项一句话。",
    "recommended_paths 是 3 到 4 个对象，每个对象都必须包含 label、href、description。",
    "只能使用允许的 href，不要虚构文章、路径、数量或主题。",
    "所有 href 必须保持站内 canonical route 形式，也就是全小写 kebab-case。",
    "",
    `站点统计: ${JSON.stringify(baseSidecar.content_stats)}`,
    `启发式 summary: ${baseSidecar.summary}`,
    `启发式 agent_role: ${baseSidecar.agent_role}`,
    `启发式 site_overview: ${baseSidecar.site_overview}`,
    `启发式 focus_topics: ${JSON.stringify(baseSidecar.focus_topics)}`,
    `启发式 highlights: ${JSON.stringify(baseSidecar.highlights)}`,
    `允许的推荐路径: ${JSON.stringify(allowedPaths)}`,
    `最近文章: ${JSON.stringify(latestPosts)}`,
  ].join("\n");
}

function sanitizeRecommendedPaths(rawPaths, fallbackPaths, allowedPaths) {
  const allowedByHref = new Map(allowedPaths.map(item => [item.href, item]));
  const sanitized = [];

  for (const item of rawPaths ?? []) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const href = String(item.href ?? "").trim();
    const fallback = allowedByHref.get(href);

    if (!fallback) {
      continue;
    }

    sanitized.push({
      label: String(item.label ?? fallback.label).trim() || fallback.label,
      href,
      description: truncateText(
        String(item.description ?? fallback.description).trim() ||
          fallback.description,
        88
      ),
    });
  }

  const deduped = dedupeStrings(sanitized.map(item => item.href))
    .map(href => sanitized.find(item => item.href === href))
    .filter(Boolean)
    .slice(0, 4);

  return deduped.length > 0 ? deduped : fallbackPaths;
}

export function applyHomePanelGuide(baseSidecar, rawGuide, options = {}) {
  const allowedPaths = buildAllowedRecommendedPaths(baseSidecar);

  return {
    ...baseSidecar,
    provider: options.provider ?? baseSidecar.provider,
    model: options.model ?? baseSidecar.model,
    summary: String(rawGuide?.summary ?? baseSidecar.summary).trim() || baseSidecar.summary,
    agent_role:
      String(rawGuide?.agent_role ?? baseSidecar.agent_role).trim() ||
      baseSidecar.agent_role,
    site_overview:
      String(rawGuide?.site_overview ?? baseSidecar.site_overview).trim() ||
      baseSidecar.site_overview,
    focus_topics:
      dedupeStrings((rawGuide?.focus_topics ?? []).map(String)).slice(0, 4)
        .length > 0
        ? dedupeStrings((rawGuide?.focus_topics ?? []).map(String)).slice(0, 4)
        : baseSidecar.focus_topics,
    highlights:
      dedupeStrings((rawGuide?.highlights ?? []).map(String)).slice(0, 4)
        .length > 0
        ? dedupeStrings((rawGuide?.highlights ?? []).map(String)).slice(0, 4)
        : baseSidecar.highlights,
    recommended_paths: sanitizeRecommendedPaths(
      rawGuide?.recommended_paths,
      baseSidecar.recommended_paths,
      allowedPaths
    ),
    confidence: roundConfidence(
      Number(rawGuide?.confidence ?? baseSidecar.confidence ?? 0.82)
    ),
    notes: dedupeStrings([...(baseSidecar.notes ?? []), ...(options.notes ?? [])]),
  };
}

export function buildHomePanelData(snapshots) {
  const publishedSnapshots = sortSnapshotsByPublishedAt(snapshots);
  const featuredSnapshots = publishedSnapshots.filter(
    snapshot => snapshot.document?.data?.featured === true
  );
  const tracks = buildTracks(publishedSnapshots);
  const latestPost = publishedSnapshots[0] ?? null;
  const stats = {
    total_posts: publishedSnapshots.length,
    featured_posts: featuredSnapshots.length,
    latest_post_title: latestPost?.title ?? null,
    latest_post_route_path: latestPost?.route_path ?? null,
    latest_post: latestPost
      ? {
          title: latestPost.title,
          route_path: latestPost.route_path,
          description: latestPost.description,
          excerpt: latestPost.excerpt,
        }
      : null,
    featured_post: featuredSnapshots[0]
      ? {
          title: featuredSnapshots[0].title,
          route_path: featuredSnapshots[0].route_path,
          description: featuredSnapshots[0].description,
          excerpt: featuredSnapshots[0].excerpt,
        }
      : null,
  };

  return {
    page_id: "index",
    title: "首页 Agent 导览",
    route_path: "/",
    generated_at: isoNow(),
    run_mode: "build-home-panel",
    provider: "heuristic",
    model: "heuristic-v1",
    summary: buildSummary(stats, tracks),
    agent_role: buildAgentRole(),
    site_overview: buildSiteOverview(stats, tracks),
    focus_topics: tracks.slice(0, 4).map(track => track.label),
    highlights: buildHighlights(stats, tracks),
    recommended_paths: buildRecommendedPaths(stats, tracks),
    content_stats: {
      total_posts: stats.total_posts,
      featured_posts: stats.featured_posts,
      latest_post_title: stats.latest_post_title,
      primary_topics: tracks.slice(0, 4).map(track => track.label),
    },
    confidence: roundConfidence(
      0.68 +
        Math.min(0.12, publishedSnapshots.length * 0.01) +
        Math.min(0.1, tracks.length * 0.03)
    ),
    notes: [
      "Home panel is generated from committed blog posts and frontmatter only.",
      "Homepage Agent panel is a static guide and does not issue online requests at runtime.",
    ],
  };
}

export async function buildHomePanel(options = {}) {
  const postPaths = options.postPaths ?? (await listMarkdownFiles(BLOG_ROOT));
  const snapshots = [];

  for (const filePath of postPaths) {
    snapshots.push(await loadPostSnapshot(filePath));
  }

  const preferredProvider = options.provider ?? DEFAULT_PROVIDER;
  const baseSidecar = buildHomePanelData(snapshots);
  let sidecar = baseSidecar;

  if (!["auto", "gemini", "heuristic"].includes(preferredProvider)) {
    throw new Error(`Unsupported home panel provider: ${preferredProvider}`);
  }

  if (preferredProvider !== "heuristic") {
    const gemini = resolveGeminiConfig(options);

    if (gemini.available) {
      try {
        const guide = await requestGeminiJson({
          apiKey: gemini.apiKey,
          model: gemini.model,
          prompt: buildGeminiHomePanelPrompt(baseSidecar, snapshots),
        });

        sidecar = applyHomePanelGuide(baseSidecar, guide, {
          provider: "gemini",
          model: gemini.model,
          notes: ["Homepage guide was refined by Gemini from committed site data."],
        });
      } catch (error) {
        sidecar = applyHomePanelGuide(baseSidecar, null, {
          notes: [
            `Gemini homepage guide failed: ${error.message}; falling back to heuristic guide.`,
          ],
        });
      }
    } else {
      sidecar = applyHomePanelGuide(baseSidecar, null, {
        notes: [
          `Gemini unavailable (${gemini.unavailable_reason}); falling back to heuristic guide.`,
        ],
      });
    }
  }

  const sidecarPath = getHomeSidecarPath();

  await writeJson(sidecarPath, sidecar);

  return {
    page_id: sidecar.page_id,
    title: sidecar.title,
    route_path: sidecar.route_path,
    sidecar_path: repoRelative(sidecarPath, REPO_ROOT),
    focus_topics: sidecar.focus_topics,
    content_stats: sidecar.content_stats,
    notes: sidecar.notes,
  };
}
