// @ts-nocheck
import { readJsonIfExists } from "./fs.js";
import {
  getHomeSidecarPath,
  getSidecarPathForPost,
  resolveRepoPath,
  slugifyStr,
} from "./pathing.js";

function canonicalizePostHref(value) {
  if (typeof value !== "string" || !value.startsWith("/posts")) {
    return value;
  }

  const segments = value
    .split("/")
    .filter(Boolean)
    .map(segment => slugifyStr(segment));

  return `/${segments.join("/")}`;
}

function normalizeSiteSidecar(sidecar) {
  if (!sidecar || typeof sidecar !== "object") {
    return sidecar;
  }

  const normalized = { ...sidecar };

  if (typeof normalized.route_path === "string") {
    normalized.route_path = canonicalizePostHref(normalized.route_path);
  }

  if (Array.isArray(normalized.recommended_paths)) {
    normalized.recommended_paths = normalized.recommended_paths.map(item => {
      if (!item || typeof item !== "object") {
        return item;
      }

      return {
        ...item,
        href: canonicalizePostHref(item.href),
      };
    });
  }

  return normalized;
}

export async function loadPostAgentSidecar(filePath) {
  if (!filePath) {
    return null;
  }

  const absolutePath = resolveRepoPath(filePath);
  return normalizeSiteSidecar(
    await readJsonIfExists(getSidecarPathForPost(absolutePath))
  );
}

export const loadAgentSidecar = loadPostAgentSidecar;

export async function loadHomeAgentSidecar() {
  return normalizeSiteSidecar(await readJsonIfExists(getHomeSidecarPath()));
}
