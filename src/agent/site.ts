// Astro-facing API: loads committed sidecars at build time. No LLM calls.
import { readJsonIfExists } from "./shared/fs.js";
import {
  getHomeSidecarPath,
  getSidecarPathForPost,
  resolveRepoPath,
  slugifyStr,
} from "./shared/pathing.js";
import type { HomeSidecar, PostSidecar } from "./types.js";

export type { HomeSidecar, PostSidecar } from "./types.js";

function canonicalizePostHref<T>(value: T): T {
  if (typeof value !== "string" || !value.startsWith("/posts")) {
    return value;
  }

  const segments = value
    .split("/")
    .filter(Boolean)
    .map(segment => slugifyStr(segment));

  return `/${segments.join("/")}` as T;
}

function normalizeSiteSidecar<T extends object | null>(sidecar: T): T {
  if (!sidecar || typeof sidecar !== "object") {
    return sidecar;
  }

  const normalized: Record<string, unknown> = { ...sidecar };

  if (typeof normalized.route_path === "string") {
    normalized.route_path = canonicalizePostHref(normalized.route_path);
  }

  if (Array.isArray(normalized.recommended_paths)) {
    normalized.recommended_paths = normalized.recommended_paths.map(
      (item: unknown) => {
        if (!item || typeof item !== "object") {
          return item;
        }

        return {
          ...item,
          href: canonicalizePostHref((item as { href?: unknown }).href),
        };
      }
    );
  }

  if (Array.isArray(normalized.related_posts)) {
    normalized.related_posts = normalized.related_posts.map((item: unknown) => {
      if (!item || typeof item !== "object") {
        return item;
      }

      return {
        ...item,
        route_path: canonicalizePostHref(
          (item as { route_path?: unknown }).route_path
        ),
      };
    });
  }

  return normalized as T;
}

export async function loadPostAgentSidecar(
  filePath: string | null | undefined
): Promise<PostSidecar | null> {
  if (!filePath) {
    return null;
  }

  const absolutePath = resolveRepoPath(filePath);
  return normalizeSiteSidecar(
    await readJsonIfExists<PostSidecar>(getSidecarPathForPost(absolutePath))
  );
}

export const loadAgentSidecar = loadPostAgentSidecar;

export async function loadHomeAgentSidecar(): Promise<HomeSidecar | null> {
  return normalizeSiteSidecar(
    await readJsonIfExists<HomeSidecar>(getHomeSidecarPath())
  );
}
