// @ts-nocheck
import { readText } from "../shared/fs.js";
import { parseMarkdownDocument } from "./frontmatter.js";
import { analyzeMarkdownBody } from "./markdown.js";
import {
  getPostIdFromFilePath,
  getRoutePathFromFile,
  getSidecarPathForPost,
} from "../shared/pathing.js";
import { REPO_ROOT } from "../shared/constants.js";
import { hashContent, repoRelative, truncateText } from "../shared/utils.js";

export async function loadPostSnapshot(filePath) {
  const raw = await readText(filePath);
  const document = parseMarkdownDocument(raw);
  const analysis = analyzeMarkdownBody(document.body);
  const postId = getPostIdFromFilePath(filePath);
  const title =
    typeof document.data.title === "string" && document.data.title.trim()
      ? document.data.title.trim()
      : postId;
  const description =
    typeof document.data.description === "string"
      ? document.data.description.trim()
      : "";
  const tags = Array.isArray(document.data.tags)
    ? document.data.tags.map(String)
    : [];

  return {
    post_id: postId,
    title,
    description,
    tags,
    file_path: repoRelative(filePath, REPO_ROOT),
    route_path: getRoutePathFromFile(filePath),
    sidecar_path: getSidecarPathForPost(filePath),
    source_hash: hashContent(raw),
    pubDatetime:
      typeof document.data.pubDatetime === "string"
        ? document.data.pubDatetime
        : null,
    document,
    analysis,
    raw,
    excerpt: truncateText(
      description || analysis.firstParagraphs.join(" "),
      160
    ),
  };
}
