import path from "node:path";
import {
  BLOG_ROOT,
  REPO_ROOT,
  SIDECAR_ROOT,
  SITE_SIDECAR_ROOT,
} from "./constants.js";
import { fileExists, listMarkdownFiles } from "./fs.js";
import { normalizePathSlashes } from "./utils.js";

function hasNonLatin(value: string): boolean {
  return /[^\x00-\x7F]/.test(value);
}

export function slugifyStr(value: string): string {
  return value
    .normalize("NFKD")
    .trim()
    .toLowerCase()
    .replace(
      hasNonLatin(value) ? /[^\p{Letter}\p{Number}]+/gu : /[^a-z0-9]+/gu,
      "-"
    )
    .replace(/^-+|-+$/gu, "");
}

export function resolveRepoPath(value: string): string {
  if (path.isAbsolute(value)) {
    return value;
  }

  return path.join(REPO_ROOT, value);
}

export function getPostRelativePath(filePath: string): string {
  return normalizePathSlashes(path.relative(BLOG_ROOT, filePath));
}

export function getPostIdFromFilePath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

export function getSidecarPathForPost(filePath: string): string {
  const relativePath = getPostRelativePath(filePath).replace(/\.md$/u, ".json");
  return path.join(SIDECAR_ROOT, relativePath);
}

export function getSiteSidecarPath(pageId: string): string {
  const normalizedPageId = pageId
    .replace(/^\/+|\/+$/gu, "")
    .replace(/[^a-z0-9/_-]+/giu, "-");

  const sidecarFile =
    normalizedPageId === "" ? "index.json" : `${normalizedPageId}.json`;

  return path.join(SITE_SIDECAR_ROOT, sidecarFile);
}

export function getHomeSidecarPath(): string {
  return getSiteSidecarPath("index");
}

export function getRoutePathFromFile(filePath: string): string {
  const relativePath = getPostRelativePath(filePath);
  const segments = relativePath.split("/");
  const fileName = segments.pop() ?? "";
  const postId = fileName.replace(/\.md$/u, "");
  const dirSegments = segments
    .filter(segment => segment !== "" && !segment.startsWith("_"))
    .map(segment => slugifyStr(segment));
  const slug = slugifyStr(postId.split("/").slice(-1).join("/"));

  return ["/posts", ...dirSegments, slug].join("/");
}

function canonicalizePathInput(value: string): string {
  return value
    .split("/")
    .filter(Boolean)
    .map(segment => slugifyStr(segment))
    .join("/");
}

export async function resolvePostInput(input: string): Promise<string> {
  const directCandidates: string[] = [];
  const trimmedInput = input.trim();

  if (path.isAbsolute(trimmedInput)) {
    directCandidates.push(trimmedInput);
  } else {
    directCandidates.push(path.join(REPO_ROOT, trimmedInput));
    directCandidates.push(path.join(BLOG_ROOT, trimmedInput));

    if (!trimmedInput.endsWith(".md")) {
      directCandidates.push(path.join(BLOG_ROOT, `${trimmedInput}.md`));
    }
  }

  for (const candidate of directCandidates) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  const allPosts = await listMarkdownFiles(BLOG_ROOT);
  const normalizedInput = trimmedInput.replace(/\.md$/u, "");
  const matches = allPosts.filter(filePath => {
    const relativePath = getPostRelativePath(filePath);
    const withoutExtension = relativePath.replace(/\.md$/u, "");
    const postId = getPostIdFromFilePath(filePath);
    const canonicalPostId = slugifyStr(postId);
    const canonicalRelativePath = canonicalizePathInput(withoutExtension);

    return (
      relativePath === trimmedInput ||
      withoutExtension === normalizedInput ||
      postId === normalizedInput ||
      canonicalPostId === normalizedInput ||
      canonicalRelativePath === canonicalizePathInput(normalizedInput)
    );
  });

  if (matches.length === 1) {
    return matches[0];
  }

  if (matches.length > 1) {
    throw new Error(`Post input is ambiguous: ${input}`);
  }

  throw new Error(`Cannot find post: ${input}`);
}
