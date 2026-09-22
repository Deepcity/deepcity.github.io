import fs from "node:fs/promises";
import path from "node:path";
import { DIST_ROOT, REPO_ROOT } from "../../shared/constants.js";
import { isoNow, normalizePathSlashes } from "../../shared/utils.js";
import type { RouteEntry } from "./types.js";

export function sanitizeRunId(value?: string): string {
  return String(value ?? isoNow())
    .replace(/[:.]/gu, "-")
    .replace(/[^a-z0-9T_Z-]+/giu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function routeToVisualArtifactName(routePath: string): string {
  const segments = String(routePath || "/")
    .split("/")
    .filter(Boolean);

  if (segments.length === 0) {
    return "index";
  }

  return segments
    .map(segment => encodeURIComponent(segment).replace(/%/gu, "~"))
    .join("__")
    .replace(/[^a-z0-9_.~-]+/giu, "-");
}

function routeSortKey(routePath: string): string {
  return routePath === "/" ? "" : routePath;
}

function htmlPathToRoute(distRoot: string, filePath: string): string {
  const relativePath = normalizePathSlashes(path.relative(distRoot, filePath));

  if (relativePath === "index.html") {
    return "/";
  }

  if (relativePath === "404.html") {
    return "/404";
  }

  if (relativePath.endsWith("/index.html")) {
    return `/${relativePath.replace(/\/index\.html$/u, "")}`;
  }

  return `/${relativePath.replace(/\.html$/u, "")}`;
}

export async function collectStaticHtmlRoutes(
  distRoot: string = DIST_ROOT
): Promise<RouteEntry[]> {
  const routes: RouteEntry[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".html")) {
        routes.push({
          route_path: htmlPathToRoute(distRoot, entryPath),
          html_path: entryPath,
          html_path_relative: normalizePathSlashes(
            path.relative(REPO_ROOT, entryPath)
          ),
        });
      }
    }
  }

  await walk(distRoot);

  return routes.sort((left, right) =>
    routeSortKey(left.route_path).localeCompare(routeSortKey(right.route_path))
  );
}

function normalizeRouteFilterPath(routePath: string): string | null {
  const trimmed = String(routePath ?? "").trim();

  if (!trimmed) {
    return null;
  }

  let pathname = trimmed;

  try {
    pathname = new URL(trimmed).pathname;
  } catch {
    pathname = trimmed;
  }

  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return normalized.length > 1 ? normalized.replace(/\/+$/u, "") : "/";
}

export function filterStaticHtmlRoutes(
  routes: RouteEntry[],
  routeFilter?: string | string[] | null
): RouteEntry[] {
  const filterValues = Array.isArray(routeFilter)
    ? routeFilter
    : String(routeFilter ?? "").split(",");
  const wantedRoutes = new Set(
    filterValues.map(normalizeRouteFilterPath).filter(Boolean)
  );

  if (wantedRoutes.size === 0) {
    return routes;
  }

  const filteredRoutes = routes.filter(route =>
    wantedRoutes.has(normalizeRouteFilterPath(route.route_path))
  );

  if (filteredRoutes.length === 0) {
    throw new Error(
      `No static HTML route matched visual route filter: ${Array.from(wantedRoutes).join(", ")}`
    );
  }

  return filteredRoutes;
}
