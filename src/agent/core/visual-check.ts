// @ts-nocheck
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  BLOG_ROOT,
  DIST_ROOT,
  REPO_ROOT,
  VISUAL_LATEST_PATH,
  VISUAL_RUNS_ROOT,
} from "../shared/constants.js";
import { ensureDir, fileExists, listMarkdownFiles, writeJson } from "../shared/fs.js";
import { getRoutePathFromFile } from "../shared/pathing.js";
import {
  dedupeStrings,
  isoNow,
  maxSeverity,
  normalizePathSlashes,
  roundConfidence,
} from "../shared/utils.js";
import {
  requestGeminiImageJson,
  resolveGeminiConfig,
} from "../providers/gemini.js";

const DEFAULT_VIEWPORT = {
  width: 1440,
  height: 1200,
};
const DEFAULT_IMAGE_TIMEOUT_MS = 15000;
const DEFAULT_IMAGE_RETRY_COUNT = 2;
const LOCAL_PROXY_BYPASS_HOSTS = ["127.0.0.1", "localhost", "::1"];
const VISUAL_REVIEW_PROMPT_VERSION = "visual-review-v1";

const AGENT_VISUAL_FONT_ROUTE = "/__agent-visual/fonts/cjk-font";
const AGENT_VISUAL_BOLD_FONT_ROUTE = "/__agent-visual/fonts/cjk-bold-font";
const AGENT_VISUAL_EMOJI_FONT_ROUTE = "/__agent-visual/fonts/emoji-font";
const AGENT_VISUAL_FONT_URL =
  "https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf";
const AGENT_VISUAL_BOLD_FONT_URL =
  "https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf";
const AGENT_VISUAL_EMOJI_FONT_URL =
  "https://github.com/googlefonts/noto-emoji/raw/main/fonts/NotoColorEmoji.ttf";
const AGENT_VISUAL_FONT_PATH =
  "/tmp/astro-agent-visual-fonts/NotoSansCJKsc-Regular.otf";
const AGENT_VISUAL_BOLD_FONT_PATH =
  "/tmp/astro-agent-visual-fonts/NotoSansCJKsc-Bold.otf";
const AGENT_VISUAL_EMOJI_FONT_PATH =
  "/tmp/astro-agent-visual-fonts/NotoColorEmoji.ttf";
const AGENT_VISUAL_CAPTURE_CSS = `
  html {
    scroll-behavior: auto !important;
  }

  .progress-container,
  #btt-btn-container {
    display: none !important;
  }
`;
const LOCAL_CJK_FONT_CANDIDATES = [
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf",
  "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
  "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
  "/usr/share/fonts/truetype/arphic/uming.ttc",
];
const LOCAL_CJK_BOLD_FONT_CANDIDATES = [
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Bold.otf",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansSC-Bold.ttf",
  "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
];
const LOCAL_EMOJI_FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
  "/usr/share/fonts/google-noto-emoji/NotoColorEmoji.ttf",
  "/usr/share/fonts/truetype/ancient-scripts/Symbola_hint.ttf",
];

const VISUAL_ISSUE_CODES = new Set([
  "visual-overlap",
  "visual-clipping",
  "visual-overflow",
  "visual-contrast",
  "visual-blank-space",
  "broken-image",
  "missing-image",
  "broken-icon",
  "navigation-layout",
  "text-readability",
  "responsive-layout",
  "unexpected-rendering",
  "math-render-error",
]);

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const VISUAL_RUNTIME_ASSET_EXTENSIONS = new Set([
  ".avif",
  ".css",
  ".gif",
  ".jpeg",
  ".jpg",
  ".js",
  ".json",
  ".png",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
]);

function sanitizeRunId(value) {
  return String(value ?? isoNow())
    .replace(/[:.]/gu, "-")
    .replace(/[^a-z0-9T_Z-]+/giu, "-")
    .replace(/^-+|-+$/gu, "");
}

export function routeToVisualArtifactName(routePath) {
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

function routeSortKey(routePath) {
  return routePath === "/" ? "" : routePath;
}

function htmlPathToRoute(distRoot, filePath) {
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

export async function collectStaticHtmlRoutes(distRoot = DIST_ROOT) {
  const routes = [];

  async function walk(currentPath) {
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

function normalizeRouteFilterPath(routePath) {
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

export function filterStaticHtmlRoutes(routes, routeFilter) {
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

async function resolveRequestPath(distRoot, requestUrl) {
  const url = new URL(requestUrl ?? "/", "http://127.0.0.1");
  const pathname = decodeURIComponent(url.pathname);
  const pathnames = [];

  if (pathname.endsWith("/")) {
    pathnames.push(`${pathname}index.html`);
  } else if (!path.extname(pathname)) {
    pathnames.push(`${pathname}/index.html`, `${pathname}.html`);
  } else {
    pathnames.push(pathname);
  }

  const normalizedRoot = path.resolve(distRoot);

  for (const candidatePathname of pathnames) {
    const candidatePath = path.normalize(
      path.join(distRoot, candidatePathname)
    );
    const normalizedCandidate = path.resolve(candidatePath);

    if (
      normalizedCandidate !== normalizedRoot &&
      !normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`)
    ) {
      return null;
    }

    if (await fileExists(normalizedCandidate)) {
      return normalizedCandidate;
    }
  }

  return null;
}

async function resolveVisualFont({
  candidates,
  cachePath,
  sourceUrl,
  disabled,
  downloadTimeoutMs,
}) {
  if (disabled) {
    return {
      available: false,
      path: null,
      source: "disabled",
    };
  }

  for (const candidate of candidates) {
    if (await fileExists(candidate)) {
      return {
        available: true,
        path: candidate,
        source: "local",
      };
    }
  }

  if (await fileExists(cachePath)) {
    return {
      available: true,
      path: cachePath,
      source: "cache",
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => {
      controller.abort();
    },
    Number(downloadTimeoutMs ?? 20000)
  );

  try {
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const fontBytes = new Uint8Array(await response.arrayBuffer());
    await ensureDir(path.dirname(cachePath));
    await fs.writeFile(cachePath, fontBytes);

    return {
      available: true,
      path: cachePath,
      source: "download",
    };
  } catch (error) {
    return {
      available: false,
      path: null,
      source: "unavailable",
      error: error.message ?? String(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function resolveVisualFonts(options = {}) {
  const disabled = options.disableCjkFont === true;
  const [cjk, cjkBold, emoji] = await Promise.all([
    resolveVisualFont({
      candidates: LOCAL_CJK_FONT_CANDIDATES,
      cachePath: AGENT_VISUAL_FONT_PATH,
      sourceUrl: AGENT_VISUAL_FONT_URL,
      disabled,
      downloadTimeoutMs: options.fontDownloadTimeoutMs,
    }),
    resolveVisualFont({
      candidates: LOCAL_CJK_BOLD_FONT_CANDIDATES,
      cachePath: AGENT_VISUAL_BOLD_FONT_PATH,
      sourceUrl: AGENT_VISUAL_BOLD_FONT_URL,
      disabled,
      downloadTimeoutMs: options.fontDownloadTimeoutMs,
    }),
    resolveVisualFont({
      candidates: LOCAL_EMOJI_FONT_CANDIDATES,
      cachePath: AGENT_VISUAL_EMOJI_FONT_PATH,
      sourceUrl: AGENT_VISUAL_EMOJI_FONT_URL,
      disabled,
      downloadTimeoutMs: options.fontDownloadTimeoutMs,
    }),
  ]);

  return { cjk, cjkBold, emoji };
}

function buildVisualFontCss(fontRoute) {
  return `
@font-face {
  font-family: "AgentVisualCJK";
  src: url("${fontRoute}") format("opentype");
  font-weight: 400;
  font-display: block;
}
@font-face {
  font-family: "AgentVisualCJK";
  src: url("${AGENT_VISUAL_BOLD_FONT_ROUTE}") format("opentype");
  font-weight: 500 900;
  font-display: block;
}
@font-face {
  font-family: "AgentVisualEmoji";
  src: url("${AGENT_VISUAL_EMOJI_FONT_ROUTE}") format("truetype");
  font-weight: 400;
  font-display: block;
}
:root {
  --agent-visual-sans-font: "AgentVisualCJK", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, "AgentVisualEmoji", sans-serif;
  --agent-visual-mono-font: "AgentVisualCJK", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", "AgentVisualEmoji", monospace;
}
:where(body, body *:not(svg):not(svg *)) {
  font-family: var(--agent-visual-sans-font) !important;
}
:where(pre, code, kbd, samp, pre *, code *) {
  font-family: var(--agent-visual-mono-font) !important;
}
`;
}

async function serveStaticFile(distRoot, visualFonts, request, response) {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");

  if (url.pathname === AGENT_VISUAL_FONT_ROUTE && visualFonts?.cjk?.path) {
    response.writeHead(200, {
      "Content-Type": "font/otf",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    response.end(await fs.readFile(visualFonts.cjk.path));
    return;
  }

  if (
    url.pathname === AGENT_VISUAL_BOLD_FONT_ROUTE &&
    visualFonts?.cjkBold?.path
  ) {
    response.writeHead(200, {
      "Content-Type": "font/otf",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    response.end(await fs.readFile(visualFonts.cjkBold.path));
    return;
  }

  if (
    url.pathname === AGENT_VISUAL_EMOJI_FONT_ROUTE &&
    visualFonts?.emoji?.path
  ) {
    response.writeHead(200, {
      "Content-Type": "font/ttf",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
    response.end(await fs.readFile(visualFonts.emoji.path));
    return;
  }

  const filePath = await resolveRequestPath(distRoot, request.url);

  if (!filePath) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
  });
  response.end(await fs.readFile(filePath));
}

async function startStaticServer(distRoot, options = {}) {
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    serveStaticFile(distRoot, options.visualFonts, request, response).catch(
      error => {
        response.writeHead(500, {
          "Content-Type": "text/plain; charset=utf-8",
        });
        response.end(error.message);
      }
    );
  });

  server.on("connection", socket => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  await new Promise(resolve => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise(resolve => {
        server.close(resolve);
      });
    },
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? REPO_ROOT,
      env: {
        ...process.env,
        npm_config_cache: process.env.npm_config_cache ?? "/tmp/npm-cache",
      },
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", code => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(`${command} ${args.join(" ")} exited with code ${code}`)
      );
    });
  });
}

async function commandExists(command) {
  const pathEntries = String(process.env.PATH ?? "")
    .split(path.delimiter)
    .filter(Boolean);

  for (const entry of pathEntries) {
    if (await fileExists(path.join(entry, command))) {
      return true;
    }
  }

  return false;
}

async function resolveBuildCommand() {
  if (
    (await fileExists(path.join(REPO_ROOT, "pnpm-lock.yaml"))) &&
    (await commandExists("pnpm"))
  ) {
    return {
      command: "pnpm",
      args: ["run", "build"],
      label: "pnpm run build",
    };
  }

  return {
    command: "npm",
    args: ["run", "build"],
    label: "npm run build",
  };
}

async function clearAstroContentCache() {
  const cachePaths = [
    path.join(REPO_ROOT, ".astro"),
    path.join(REPO_ROOT, "node_modules", ".astro"),
  ];

  await Promise.all(
    cachePaths.map(cachePath =>
      fs.rm(cachePath, { recursive: true, force: true }).catch(() => {})
    )
  );
}

async function maybeBuildSite(options = {}) {
  if (options.build === false) {
    return {
      ran: false,
      command: null,
      cleared_astro_cache: false,
    };
  }

  const buildCommand = await resolveBuildCommand();
  await clearAstroContentCache();
  await runCommand(buildCommand.command, buildCommand.args);

  return {
    ran: true,
    command: buildCommand.label,
    cleared_astro_cache: true,
  };
}

async function sha256File(filePath) {
  const data = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

async function buildDistAssetFingerprint(distRoot) {
  const files = [];

  async function walk(currentPath) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const extension = path.extname(entry.name).toLowerCase();

      if (
        extension === ".html" ||
        !VISUAL_RUNTIME_ASSET_EXTENSIONS.has(extension)
      ) {
        continue;
      }

      files.push(entryPath);
    }
  }

  await walk(distRoot);

  const hash = crypto.createHash("sha256");

  for (const filePath of files.sort()) {
    const relativePath = normalizePathSlashes(path.relative(distRoot, filePath));
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await sha256File(filePath));
    hash.update("\0");
  }

  return hash.digest("hex");
}

function buildRenderInputFingerprint(input) {
  return sha256Text(
    JSON.stringify({
      html_sha256: input.htmlSha256,
      dist_asset_sha256: input.distAssetSha256,
      viewport: input.viewport,
      visual_font: input.visualFont,
    })
  );
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeVisualReviewMode(value) {
  const mode = String(value ?? "changed").trim().toLowerCase();

  if (["all", "changed", "none"].includes(mode)) {
    return mode;
  }

  throw new Error("--review-mode must be one of: changed, all, none");
}

async function loadPreviousVisualManifest(options = {}) {
  const manifestPath = options.reviewBaseManifestPath ?? VISUAL_LATEST_PATH;
  const manifest = await readJsonFile(manifestPath);

  if (!manifest || !Array.isArray(manifest.pages)) {
    return null;
  }

  for (const page of manifest.pages) {
    if (page.screenshot_sha256 || !page.screenshot_path) {
      continue;
    }

    const screenshotPath = path.join(REPO_ROOT, page.screenshot_path);

    if (await fileExists(screenshotPath)) {
      page.screenshot_sha256 = await sha256File(screenshotPath);
    }
  }

  return manifest;
}

async function loadPlaywrightChromium() {
  try {
    const playwright = await import("playwright");
    return playwright.chromium;
  } catch (error) {
    throw new Error(
      `Playwright is required for visual-check. Install project dependencies with npm install, then run npx playwright install chromium. (${error.message})`
    );
  }
}

function makeIssue(code, severity, message, extra = {}) {
  return {
    code,
    severity: ["info", "warn", "error"].includes(severity) ? severity : "warn",
    message: String(message ?? "").slice(0, 500),
    fixable: false,
    ...extra,
  };
}

function compactVisualText(value, maxLength = 180) {
  const normalized = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function firstNonEmptyEnv(env, names) {
  for (const name of names) {
    const value = env[name];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function splitProxyBypass(value) {
  return String(value ?? "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

export function resolvePlaywrightProxyConfig(env = process.env) {
  const server = firstNonEmptyEnv(env, [
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "ALL_PROXY",
    "https_proxy",
    "http_proxy",
    "all_proxy",
  ]);

  if (!server) {
    return null;
  }

  const bypassHosts = new Set([
    ...splitProxyBypass(firstNonEmptyEnv(env, ["NO_PROXY", "no_proxy"])),
    ...LOCAL_PROXY_BYPASS_HOSTS,
  ]);

  return {
    server,
    bypass: [...bypassHosts].join(","),
  };
}

async function closeWithTimeout(label, closeFn, timeoutMs = 3000) {
  if (!closeFn) {
    return null;
  }

  let timeoutId;

  try {
    await Promise.race([
      closeFn(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} close timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
    return null;
  } catch (error) {
    return error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForPageImages(page, timeoutMs) {
  return page
    .evaluate(async waitMs => {
      const waitForImage = image =>
        new Promise(resolve => {
          if (image.complete) {
            resolve(image.naturalWidth > 0 ? "loaded" : "broken");
            return;
          }

          const timeoutId = setTimeout(() => resolve("timeout"), waitMs);
          const done = state => {
            clearTimeout(timeoutId);
            resolve(state);
          };

          image.addEventListener("load", () => done("loaded"), {
            once: true,
          });
          image.addEventListener("error", () => done("broken"), {
            once: true,
          });
        });

      const images = Array.from(document.images ?? []);
      await Promise.allSettled(images.map(waitForImage));
      await Promise.allSettled(
        images
          .filter(image => image.complete && image.naturalWidth > 0)
          .map(image =>
            typeof image.decode === "function" ? image.decode() : undefined
          )
      );
    }, timeoutMs)
    .catch(() => {});
}

async function retryBrokenPageImages(page, attempt, timeoutMs) {
  return page
    .evaluate(
      async ({ attempt: retryAttempt, timeoutMs: retryTimeoutMs }) => {
        const makeRetryUrl = src => {
          try {
            const url = new URL(src, document.baseURI);

            if (url.protocol !== "http:" && url.protocol !== "https:") {
              return src;
            }

            url.searchParams.set(
              "__agent_visual_retry",
              `${retryAttempt}-${Date.now()}`
            );
            return url.href;
          } catch {
            return src;
          }
        };

        const brokenImages = Array.from(document.images ?? []).filter(
          image =>
            image.complete &&
            image.naturalWidth === 0 &&
            (image.currentSrc || image.src)
        );

        const retryOne = image =>
          new Promise(resolve => {
            const originalSrc =
              image.dataset.agentVisualOriginalSrc ||
              image.currentSrc ||
              image.src;
            const retrySrc = makeRetryUrl(originalSrc);
            const probe = new Image();
            const timeoutId = setTimeout(() => {
              resolve(false);
            }, retryTimeoutMs);
            const done = ok => {
              clearTimeout(timeoutId);
              resolve(ok);
            };

            image.dataset.agentVisualOriginalSrc = originalSrc;
            probe.decoding = "sync";
            probe.loading = "eager";
            probe.fetchPriority = "high";
            probe.referrerPolicy = "no-referrer";
            probe.addEventListener(
              "load",
              () => {
                image.removeAttribute("srcset");
                image.loading = "eager";
                image.decoding = "sync";
                image.fetchPriority = "high";
                image.referrerPolicy = "no-referrer";
                image.src = retrySrc;
                done(true);
              },
              { once: true }
            );
            probe.addEventListener("error", () => done(false), {
              once: true,
            });
            probe.src = retrySrc;
          });

        const results = await Promise.allSettled(brokenImages.map(retryOne));
        return {
          candidates: brokenImages.length,
          recovered: results.filter(
            result => result.status === "fulfilled" && result.value
          ).length,
        };
      },
      {
        attempt,
        timeoutMs: Math.min(Math.max(1500, timeoutMs), 6000),
      }
    )
    .catch(() => ({
      candidates: 0,
      recovered: 0,
    }));
}

async function collectDomMetrics(page) {
  return page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    const images = Array.from(document.images ?? []);
    const compactText = (value, maxLength = 180) => {
      const normalized = String(value ?? "")
        .replace(/\s+/gu, " ")
        .trim();

      if (normalized.length <= maxLength) {
        return normalized;
      }

      return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
    };
    const selectorHint = element => {
      if (!element) {
        return "";
      }

      if (element.id) {
        return `#${CSS.escape(element.id)}`;
      }

      const className = String(element.className ?? "")
        .split(/\s+/u)
        .filter(Boolean)
        .slice(0, 3)
        .map(name => `.${CSS.escape(name)}`)
        .join("");

      return `${element.tagName.toLowerCase()}${className}`;
    };
    const elementRect = element => {
      if (!element) {
        return null;
      }

      const rect = element.getBoundingClientRect();

      if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
        return null;
      }

      return {
        x: Math.max(0, Math.round(rect.left + window.scrollX)),
        y: Math.max(0, Math.round(rect.top + window.scrollY)),
        width: Math.max(0, Math.round(rect.width)),
        height: Math.max(0, Math.round(rect.height)),
      };
    };
    const brokenImages = images
      .filter(image => !image.complete || image.naturalWidth === 0)
      .map(image => ({
        src: image.currentSrc || image.src || "",
        alt: image.alt || "",
        selector: selectorHint(image),
        rect: elementRect(image),
      }))
      .slice(0, 12);
    const katexErrors = Array.from(
      document.querySelectorAll(".katex-error")
    ).map(element => ({
      text: compactText(element.textContent, 220),
      title: compactText(element.getAttribute("title"), 220),
      selector: selectorHint(element),
      rect: elementRect(element),
    }));
    const rawLatexPattern =
      /\\(?:begin|end)\{(?:align\*?|aligned|array|bmatrix|cases|eqnarray\*?|equation\*?|gather\*?|matrix|multline\*?|pmatrix|split)\}/u;
    const rawLatexTextNodes = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;

          if (!parent) {
            return NodeFilter.FILTER_REJECT;
          }

          if (
            parent.closest(
              "pre, code, script, style, textarea, math, annotation, .katex"
            )
          ) {
            return NodeFilter.FILTER_REJECT;
          }

          return rawLatexPattern.test(node.nodeValue ?? "")
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      }
    );

    while (rawLatexTextNodes.length < 8) {
      const node = walker.nextNode();

      if (!node) {
        break;
      }

      rawLatexTextNodes.push({
        text: compactText(node.nodeValue, 220),
        selector: selectorHint(node.parentElement),
        rect: elementRect(node.parentElement),
      });
    }

    return {
      title: document.title || "",
      scroll_width: Math.max(
        documentElement?.scrollWidth ?? 0,
        body?.scrollWidth ?? 0
      ),
      scroll_height: Math.max(
        documentElement?.scrollHeight ?? 0,
        body?.scrollHeight ?? 0
      ),
      viewport_width: window.innerWidth,
      viewport_height: window.innerHeight,
      broken_images: brokenImages,
      katex_errors: katexErrors.slice(0, 8),
      raw_latex_nodes: rawLatexTextNodes,
    };
  });
}

export function buildMathRenderIssuesFromMetrics(metrics) {
  const issues = [];

  for (const error of metrics?.katex_errors ?? []) {
    const detail = error.title || error.text || "unknown KaTeX parse error";
    issues.push(
      makeIssue(
        "math-render-error",
        "error",
        `KaTeX 公式解析失败：${compactVisualText(detail, 220)}`,
        {
          selector_hint: error.selector || ".katex-error",
          region: error.rect
            ? `${error.rect.x},${error.rect.y},${error.rect.width},${error.rect.height}`
            : "formula",
          rect: error.rect ?? null,
          latex_source: compactVisualText(error.text, 220),
        }
      )
    );
  }

  for (const node of metrics?.raw_latex_nodes ?? []) {
    issues.push(
      makeIssue(
        "math-render-error",
        "error",
        `LaTeX 环境源码未被渲染：${compactVisualText(node.text, 220)}`,
        {
          selector_hint: node.selector || "text node",
          region: node.rect
            ? `${node.rect.x},${node.rect.y},${node.rect.width},${node.rect.height}`
            : "text",
          rect: node.rect ?? null,
          latex_source: compactVisualText(node.text, 220),
        }
      )
    );
  }

  return issues.slice(0, 12);
}

async function settlePageMedia(page, options = {}) {
  const viewportHeight = Math.max(300, Number(options.viewport?.height ?? 900));
  const step = Math.max(300, Math.floor(viewportHeight * 0.75));
  const scrollPauseMs = Number(options.scrollPauseMs ?? 180);
  const imageTimeoutMs = Number(
    options.imageTimeoutMs ?? DEFAULT_IMAGE_TIMEOUT_MS
  );
  const imageRetryCount = Math.max(
    0,
    Number(options.imageRetryCount ?? DEFAULT_IMAGE_RETRY_COUNT)
  );

  await page
    .evaluate(() => {
      for (const image of Array.from(document.images ?? [])) {
        image.loading = "eager";
        image.decoding = "sync";
        image.fetchPriority = "high";
        if (/^https?:\/\//iu.test(image.currentSrc || image.src || "")) {
          image.referrerPolicy = "no-referrer";
        }
      }
    })
    .catch(() => {});

  let scrollHeight = await page
    .evaluate(() =>
      Math.max(
        document.documentElement?.scrollHeight ?? 0,
        document.body?.scrollHeight ?? 0
      )
    )
    .catch(() => viewportHeight);

  for (let y = 0; y <= scrollHeight; y += step) {
    await page.evaluate(position => {
      window.scrollTo(0, position);
    }, y);
    await page.waitForTimeout(scrollPauseMs);
    scrollHeight = await page
      .evaluate(() =>
        Math.max(
          document.documentElement?.scrollHeight ?? 0,
          document.body?.scrollHeight ?? 0
        )
      )
      .catch(() => scrollHeight);
  }

  await page.evaluate(() => {
    window.scrollTo(0, Math.max(document.documentElement.scrollHeight, 0));
  });
  await page.waitForTimeout(scrollPauseMs);

  await waitForPageImages(page, imageTimeoutMs);

  for (let attempt = 1; attempt <= imageRetryCount; attempt += 1) {
    const retryResult = await retryBrokenPageImages(
      page,
      attempt,
      imageTimeoutMs
    );

    if (retryResult.candidates === 0) {
      break;
    }

    await waitForPageImages(page, imageTimeoutMs);
  }

  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(scrollPauseMs);
}

async function preparePageForVisualCapture(page) {
  await page
    .addStyleTag({
      content: AGENT_VISUAL_CAPTURE_CSS,
    })
    .catch(() => {});
}

async function buildGeminiReviewImage(pageRecord) {
  if (!pageRecord.screenshot_path_abs) {
    return null;
  }

  const reviewImagePath = pageRecord.screenshot_path_abs
    .replace(
      `${path.sep}screenshots${path.sep}`,
      `${path.sep}review-images${path.sep}`
    )
    .replace(/\.png$/u, ".jpg");

  try {
    const sharp = (await import("sharp")).default;
    await ensureDir(path.dirname(reviewImagePath));
    await sharp(pageRecord.screenshot_path_abs)
      .resize({
        width: Math.max(1440, Number(pageRecord.viewport?.width ?? 1440)),
        height: 12000,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({
        quality: 84,
        mozjpeg: true,
      })
      .toFile(reviewImagePath);

    return {
      imagePath: reviewImagePath,
      mimeType: "image/jpeg",
    };
  } catch {
    return {
      imagePath: pageRecord.screenshot_path_abs,
      mimeType: "image/png",
    };
  }
}

function clampNumber(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function issueCropKey(issue) {
  const rect = issue?.rect;

  if (!rect) {
    return null;
  }

  return [
    Math.round(Number(rect.x ?? 0) / 80),
    Math.round(Number(rect.y ?? 0) / 80),
    Math.round(Number(rect.width ?? 0) / 80),
    Math.round(Number(rect.height ?? 0) / 80),
  ].join(":");
}

async function buildGeminiEvidenceCropImages(pageRecord, options = {}) {
  if (!pageRecord.screenshot_path_abs || !pageRecord.hard_checks?.length) {
    return [];
  }

  const cropRoot = pageRecord.screenshot_path_abs.replace(
    `${path.sep}screenshots${path.sep}`,
    `${path.sep}review-crops${path.sep}`
  );
  const maxCrops = Number(options.maxCrops ?? 4);

  try {
    const sharp = (await import("sharp")).default;
    const image = sharp(pageRecord.screenshot_path_abs);
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height || !pageRecord.viewport?.width) {
      return [];
    }

    const scale = metadata.width / pageRecord.viewport.width;
    const seen = new Set();
    const crops = [];
    const cropIssues = pageRecord.hard_checks
      .filter(issue => issue.rect)
      .sort((left, right) => severityRank(right.severity) - severityRank(left.severity));

    for (const issue of cropIssues) {
      if (crops.length >= maxCrops) {
        break;
      }

      const key = issueCropKey(issue);

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      const rect = issue.rect;
      const centerX = (Number(rect.x) + Number(rect.width) / 2) * scale;
      const centerY = (Number(rect.y) + Number(rect.height) / 2) * scale;
      const width = Math.min(
        metadata.width,
        Math.max(760, Number(rect.width) * scale + 240)
      );
      const height = Math.min(
        metadata.height,
        Math.max(360, Number(rect.height) * scale + 220)
      );
      const left = Math.round(
        clampNumber(centerX - width / 2, 0, Math.max(0, metadata.width - width))
      );
      const top = Math.round(
        clampNumber(centerY - height / 2, 0, Math.max(0, metadata.height - height))
      );
      const cropPath = cropRoot.replace(
        /\.png$/u,
        `__${crops.length + 1}-${issue.code}.jpg`
      );

      await ensureDir(path.dirname(cropPath));
      await sharp(pageRecord.screenshot_path_abs)
        .extract({
          left,
          top,
          width: Math.max(1, Math.round(width)),
          height: Math.max(1, Math.round(height)),
        })
        .jpeg({
          quality: 88,
          mozjpeg: true,
        })
        .toFile(cropPath);

      crops.push({
        imagePath: cropPath,
        mimeType: "image/jpeg",
        role: "evidence-crop",
        issue_code: issue.code,
        issue_message: issue.message,
        selector_hint: issue.selector_hint ?? "",
      });
    }

    return crops;
  } catch {
    return [];
  }
}

async function buildGeminiReviewImages(pageRecord) {
  const overview = await buildGeminiReviewImage(pageRecord);
  const crops = await buildGeminiEvidenceCropImages(pageRecord);

  return [
    overview
      ? {
          ...overview,
          role: "full-page-overview",
        }
      : null,
    ...crops,
  ].filter(Boolean);
}

async function capturePage(route, context, server, screenshotPath, options) {
  const page = await context.newPage();
  const browserIssues = [];
  const consoleErrors = [];
  const pageErrors = [];
  const imageRequestErrors = [];
  const url = `${server.baseUrl}${encodeURI(route.route_path)}`;

  page.on("pageerror", error => {
    const message = error.message ?? String(error);
    pageErrors.push(message);
    browserIssues.push(
      makeIssue("browser-page-error", "error", `页面脚本错误：${message}`)
    );
  });

  page.on("console", message => {
    if (message.type() !== "error") {
      return;
    }

    const text = message.text();
    consoleErrors.push(text);
    browserIssues.push(
      makeIssue(
        "browser-console-error",
        "warn",
        `浏览器 console error：${text}`
      )
    );
  });

  page.on("requestfailed", request => {
    if (request.resourceType() !== "image") {
      return;
    }

    imageRequestErrors.push({
      url: request.url(),
      error: request.failure()?.errorText ?? "request failed",
    });
  });

  page.on("response", response => {
    if (
      response.request().resourceType() !== "image" ||
      response.status() < 400
    ) {
      return;
    }

    imageRequestErrors.push({
      url: response.url(),
      status: response.status(),
    });
  });

  try {
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: options.timeoutMs,
    });

    if (options.visualFont?.css) {
      await page.addStyleTag({
        content: options.visualFont.css,
      });
      await page
        .evaluate(async () => {
          await Promise.allSettled([
            document.fonts?.load?.("16px AgentVisualCJK", "你好研究兴趣"),
            document.fonts?.load?.("16px AgentVisualEmoji", "🔬📝👤⭐"),
          ]);
          await (document.fonts?.ready ?? Promise.resolve());
        })
        .catch(() => {});
    }

    await page.waitForTimeout(options.settleMs);
    await settlePageMedia(page, options);
    await preparePageForVisualCapture(page);

    if (!response) {
      browserIssues.push(
        makeIssue(
          "missing-response",
          "error",
          "页面加载没有返回 HTTP response。"
        )
      );
    } else if (response.status() >= 400) {
      browserIssues.push(
        makeIssue("http-error", "error", `页面返回 HTTP ${response.status()}。`)
      );
    }

    await ensureDir(path.dirname(screenshotPath));
    await page.screenshot({
      path: screenshotPath,
      fullPage: true,
      type: "png",
      animations: "disabled",
      caret: "hide",
    });

    const metrics = await collectDomMetrics(page);

    if (metrics.scroll_width > options.viewport.width + 4) {
      browserIssues.push(
        makeIssue(
          "visual-overflow",
          "warn",
          `页面存在横向溢出：document width ${metrics.scroll_width}px > viewport ${options.viewport.width}px。`
        )
      );
    }

    for (const image of metrics.broken_images) {
      browserIssues.push(
        makeIssue(
          "broken-image",
          "warn",
          `图片未成功渲染：${image.alt || image.src || "(unknown image)"}`,
          {
            asset_hint: image.src,
            selector_hint: image.selector,
            region: image.rect
              ? `${image.rect.x},${image.rect.y},${image.rect.width},${image.rect.height}`
              : "image",
            rect: image.rect ?? null,
          }
        )
      );
    }

    browserIssues.push(...buildMathRenderIssuesFromMetrics(metrics));

    const [stat, screenshotSha256] = await Promise.all([
      fs.stat(screenshotPath),
      sha256File(screenshotPath),
    ]);

    return {
      ok: true,
      url,
      title: metrics.title,
      screenshot_bytes: stat.size,
      screenshot_sha256: screenshotSha256,
      viewport: options.viewport,
      page_metrics: metrics,
      browser_errors: {
        console: consoleErrors.slice(0, 8),
        page: pageErrors.slice(0, 8),
        image_requests: imageRequestErrors.slice(0, 16),
      },
      hard_checks: browserIssues,
    };
  } catch (error) {
    return {
      ok: false,
      url,
      title: "",
      screenshot_bytes: 0,
      screenshot_sha256: null,
      viewport: options.viewport,
      page_metrics: null,
      browser_errors: {
        console: consoleErrors.slice(0, 8),
        page: pageErrors.slice(0, 8),
        image_requests: imageRequestErrors.slice(0, 16),
      },
      hard_checks: [
        ...browserIssues,
        makeIssue(
          "screenshot-failed",
          "error",
          `截图失败：${error.message ?? String(error)}`
        ),
      ],
    };
  } finally {
    await closeWithTimeout("page", () => page.close(), 2000);
  }
}

function toStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(String);
}

function visualFieldToString(value) {
  if (value === null || value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.map(visualFieldToString).filter(Boolean).join(" ");
  }

  if (typeof value === "object") {
    return Object.values(value)
      .map(visualFieldToString)
      .filter(Boolean)
      .join(" ");
  }

  return String(value);
}

function sanitizeIssueCode(value) {
  const normalized = String(value ?? "unexpected-rendering")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");

  if (VISUAL_ISSUE_CODES.has(normalized)) {
    return normalized;
  }

  return normalized || "unexpected-rendering";
}

function normalizeVisualConfidence(value, fallback = 0.72) {
  const numeric = Number(value);

  return roundConfidence(Number.isFinite(numeric) ? numeric : fallback);
}

function normalizeVisualIssueSource(value) {
  const source = visualFieldToString(value)
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();

  if (!source) {
    return "gemini";
  }

  if (source.includes("local-check")) {
    return source.includes("gemini") || source.includes("visual")
      ? "gemini+local-check"
      : "local-check";
  }

  if (/local|hard|dom|browser/u.test(source)) {
    return "gemini+local-check";
  }

  return "gemini";
}

function normalizeIssueRect(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rect = {
    x: Number(value.x ?? value.left),
    y: Number(value.y ?? value.top),
    width: Number(value.width ?? value.w),
    height: Number(value.height ?? value.h),
  };

  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    return null;
  }

  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function parseIssueRegionRect(value) {
  const numbers = String(value ?? "")
    .match(/-?\d+(?:\.\d+)?/gu)
    ?.map(Number)
    .filter(Number.isFinite);

  if (!numbers || numbers.length < 4) {
    return null;
  }

  return normalizeIssueRect({
    x: numbers[0],
    y: numbers[1],
    width: numbers[2],
    height: numbers[3],
  });
}

function getIssueRect(issue) {
  return normalizeIssueRect(issue?.rect) ?? parseIssueRegionRect(issue?.region);
}

function rectOverlapRatio(left, right) {
  const x1 = Math.max(left.x, right.x);
  const y1 = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  const width = Math.max(0, x2 - x1);
  const height = Math.max(0, y2 - y1);
  const intersection = width * height;
  const smallestArea = Math.min(left.width * left.height, right.width * right.height);

  if (smallestArea <= 0) {
    return 0;
  }

  return intersection / smallestArea;
}

function rectsReferToSameArea(left, right) {
  const overlap = rectOverlapRatio(left, right);

  if (overlap >= 0.35) {
    return true;
  }

  const leftCenterX = left.x + left.width / 2;
  const leftCenterY = left.y + left.height / 2;
  const rightCenterX = right.x + right.width / 2;
  const rightCenterY = right.y + right.height / 2;

  return (
    Math.abs(leftCenterX - rightCenterX) <= 120 &&
    Math.abs(leftCenterY - rightCenterY) <= 80
  );
}

function isSpecificSelector(selector) {
  const value = String(selector ?? "").trim();

  if (!value || ["img", "p", "text node", "span.katex-error"].includes(value)) {
    return false;
  }

  return value.includes("#") || value.includes("[") || value.includes(":nth");
}

function issuesReferToSameFinding(issue, localIssue) {
  if (issue.code !== localIssue.code) {
    return false;
  }

  const issueRect = getIssueRect(issue);
  const localRect = getIssueRect(localIssue);

  if (issueRect && localRect) {
    return rectsReferToSameArea(issueRect, localRect);
  }

  if (
    issue.message.includes(localIssue.message.slice(0, 48)) ||
    localIssue.message.includes(issue.message.slice(0, 48))
  ) {
    return true;
  }

  return (
    issue.selector_hint === localIssue.selector_hint &&
    isSpecificSelector(issue.selector_hint)
  );
}

function sanitizeVisualIssue(rawIssue) {
  const severity = ["info", "warn", "error"].includes(rawIssue?.severity)
    ? rawIssue.severity
    : "warn";

  return {
    code: sanitizeIssueCode(rawIssue?.code),
    severity,
    message: String(rawIssue?.message ?? rawIssue?.summary ?? "")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 500),
    region:
      visualFieldToString(rawIssue?.region ?? rawIssue?.where) || "unknown",
    selector_hint: visualFieldToString(
      rawIssue?.selector_hint ?? rawIssue?.selector
    )
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 120),
    confidence: normalizeVisualConfidence(rawIssue?.confidence),
    source: normalizeVisualIssueSource(rawIssue?.source ?? rawIssue?.provenance),
    evidence: visualFieldToString(rawIssue?.evidence)
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 220),
    rect: normalizeIssueRect(rawIssue?.rect ?? rawIssue?.bbox),
    fixable: false,
  };
}

function issueDedupKey(issue) {
  const rect = getIssueRect(issue);
  const location = rect
    ? [
        Math.round(rect.x / 24),
        Math.round(rect.y / 24),
        Math.round(rect.width / 24),
        Math.round(rect.height / 24),
      ].join(",")
    : issue.selector_hint || "";

  return [
    issue.code,
    location,
    compactVisualText(issue.message, 120),
  ].join("|");
}

function localIssueToUnifiedFinding(issue) {
  return {
    code: sanitizeIssueCode(issue?.code),
    severity: ["info", "warn", "error"].includes(issue?.severity)
      ? issue.severity
      : "warn",
    message: String(issue?.message ?? "")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 500),
    region: visualFieldToString(issue?.region) || "unknown",
    selector_hint: visualFieldToString(issue?.selector_hint ?? issue?.asset_hint)
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 120),
    confidence: 1,
    source: "local-check",
    evidence: visualFieldToString(issue?.latex_source ?? issue?.asset_hint)
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 220),
    rect: normalizeIssueRect(issue?.rect),
    fixable: false,
  };
}

export function mergeVisualFindings(reviewIssues = [], localIssues = []) {
  const findings = [];
  const seen = new Set();

  for (const issue of reviewIssues) {
    const normalized = {
      ...issue,
      source: issue.source || "gemini",
    };
    const key = issueDedupKey(normalized);

    if (!seen.has(key)) {
      seen.add(key);
      findings.push(normalized);
    }
  }

  const linkedFindingIndexes = new Set();
  const reviewFindingCount = findings.length;

  for (const localIssue of localIssues.map(localIssueToUnifiedFinding)) {
    const sameCodeIndex = findings.findIndex(
      (issue, index) => {
        if (!issuesReferToSameFinding(issue, localIssue)) {
          return false;
        }

        if (index >= reviewFindingCount || !linkedFindingIndexes.has(index)) {
          return true;
        }

        const issueRect = getIssueRect(issue);
        const localRect = getIssueRect(localIssue);

        return Boolean(
          issueRect && localRect && rectsReferToSameArea(issueRect, localRect)
        );
      }
    );

    const sameCode = sameCodeIndex >= 0 ? findings[sameCodeIndex] : null;

    if (sameCode) {
      sameCode.source = sameCode.source?.includes("local-check")
        ? sameCode.source
        : `${sameCode.source || "gemini"}+local-check`;
      sameCode.severity = maxSeverity([sameCode.severity, localIssue.severity]);
      sameCode.confidence = Math.max(Number(sameCode.confidence ?? 0), 0.92);
      sameCode.evidence = sameCode.evidence || localIssue.evidence;
      sameCode.rect = sameCode.rect ?? localIssue.rect ?? null;
      if (sameCodeIndex < reviewFindingCount) {
        linkedFindingIndexes.add(sameCodeIndex);
      }
      continue;
    }

    const key = issueDedupKey(localIssue);

    if (!seen.has(key)) {
      seen.add(key);
      findings.push(localIssue);
    }
  }

  return findings.slice(0, 16);
}

export function sanitizeVisualReview(rawReview, fallback = {}) {
  const issues = (Array.isArray(rawReview?.issues) ? rawReview.issues : [])
    .map(sanitizeVisualIssue)
    .filter(issue => issue.message)
    .slice(0, 10);
  const severity = maxSeverity([
    rawReview?.severity,
    ...issues.map(issue => issue.severity),
  ]);

  return {
    route_path: String(rawReview?.route_path ?? fallback.route_path ?? ""),
    summary: String(rawReview?.summary ?? "")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 600),
    severity,
    confidence: roundConfidence(Number(rawReview?.confidence ?? 0.72)),
    issues,
    action_items: dedupeStrings(toStringArray(rawReview?.action_items)).slice(
      0,
      8
    ),
    suggested_adjustments: dedupeStrings(
      toStringArray(
        rawReview?.suggested_adjustments ?? rawReview?.fix_suggestions
      )
    ).slice(0, 8),
  };
}

function buildGeminiVisualPrompt(pageRecord) {
  const localFindings = (pageRecord.hard_checks ?? []).map(issue => ({
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    region: issue.region ?? null,
    selector_hint: issue.selector_hint ?? issue.asset_hint ?? null,
    evidence: issue.latex_source ?? issue.asset_hint ?? null,
  }));
  const evidenceCrops = (pageRecord.review_image_manifest ?? [])
    .filter(image => image.role === "evidence-crop")
    .map((image, index) => ({
      image_index: index + 2,
      issue_code: image.issue_code,
      issue_message: image.issue_message,
      selector_hint: image.selector_hint,
    }));

  return [
    "你是 Deepcity 博客的视觉 lint Agent。",
    "请根据截图和本地浏览器 hard-check 证据做统一显示纠错，只输出一个 JSON 对象，不要输出 Markdown。",
    "必须包含字段：route_path、summary、severity、confidence、issues、action_items、suggested_adjustments。",
    "issues 是数组，每项包含 code、severity、message、region、selector_hint、confidence、source、evidence。",
    "允许的 code 优先使用：visual-overlap、visual-clipping、visual-overflow、visual-contrast、visual-blank-space、broken-image、missing-image、broken-icon、navigation-layout、text-readability、responsive-layout、unexpected-rendering、math-render-error。",
    "重点检查：文字遮挡/截断、内容溢出、图片或图标缺失、对比度明显不可读、大片异常空白、导航/正文/页脚碰撞、排版层级混乱、公式渲染错误。",
    "公式渲染错误包括：KaTeX 红色错误文本、LaTeX 源码直接暴露（例如 \\begin{...} / \\end{...}）、公式符号明显错位或没有按数学排版呈现。",
    "local_findings 是浏览器 DOM / 网络层已验证的本地证据，不是另一份报告。请把这些证据纳入你的统一 issues；除非截图明确证明它是假阳性，否则不要忽略。",
    "图片 1 是全页概览；后续图片如果存在，是 local_findings 对应区域的高质量局部 crop，请优先用 crop 判断细节问题。",
    "不要评价文章观点、技术内容或写作质量；只处理截图可见的显示问题。",
    "如果看不到明确问题，返回 issues=[]，severity=info，并在 summary 说明未发现明显显示异常。",
    "",
    `route_path: ${pageRecord.route_path}`,
    `title: ${pageRecord.title || "(none)"}`,
    `viewport: ${pageRecord.viewport.width}x${pageRecord.viewport.height}`,
    `page_metrics: ${JSON.stringify(pageRecord.page_metrics ?? null)}`,
    `local_findings: ${JSON.stringify(localFindings)}`,
    `evidence_crops: ${JSON.stringify(evidenceCrops)}`,
  ].join("\n");
}

async function reviewPageWithGemini(pageRecord, gemini, options = {}) {
  if (!pageRecord.screenshot_path_abs || pageRecord.capture_ok !== true) {
    return null;
  }

  const reviewImages = await buildGeminiReviewImages(pageRecord);
  pageRecord.review_image_manifest = reviewImages.map(image => ({
    role: image.role,
    issue_code: image.issue_code ?? null,
    issue_message: image.issue_message ?? null,
    selector_hint: image.selector_hint ?? null,
    image_path: normalizePathSlashes(path.relative(REPO_ROOT, image.imagePath)),
    mime_type: image.mimeType,
  }));

  const rawReview = await requestGeminiImageJson({
    apiKey: gemini.apiKey,
    model: gemini.model,
    images:
      reviewImages.length > 0
        ? reviewImages.map(image => ({
            imagePath: image.imagePath,
            mimeType: image.mimeType,
          }))
        : [
            {
              imagePath: pageRecord.screenshot_path_abs,
              mimeType: "image/png",
            },
          ],
    prompt: buildGeminiVisualPrompt(pageRecord),
    timeoutMs: options.timeoutMs,
  });

  const sanitized = sanitizeVisualReview(rawReview, {
    route_path: pageRecord.route_path,
  });

  return {
    ...sanitized,
    review_source: "gemini",
    cached: false,
    prompt_version: VISUAL_REVIEW_PROMPT_VERSION,
  };
}

function resolveVisualGemini(options = {}) {
  if (options.skipGemini === true || options.provider === "heuristic") {
    return {
      provider: options.provider === "heuristic" ? "heuristic" : "none",
      model: "none",
      available: false,
      apiKey: null,
      unavailable_reason:
        options.provider === "heuristic"
          ? "Gemini visual review skipped because provider=heuristic."
          : "Gemini visual review skipped by option.",
    };
  }

  const gemini = resolveGeminiConfig({
    apiKey: options.apiKey,
    model: options.model,
  });

  return {
    ...gemini,
    provider: "gemini",
  };
}

function isGeminiTransportError(error) {
  const message = String(error?.message ?? error ?? "");

  return /fetch failed|timed out|timeout|curl|network|ECONN|ENOTFOUND|EAI_AGAIN|AbortError/iu.test(
    message
  );
}

function emitVisualProgress(options, event) {
  if (typeof options.onProgress !== "function") {
    return;
  }

  try {
    options.onProgress(event);
  } catch {
    // Progress callbacks are best-effort and must not affect lint results.
  }
}

export function canReuseVisualReview(
  pageRecord,
  previousPage,
  previousManifest,
  gemini
) {
  if (!pageRecord || !previousPage || !previousManifest || !gemini) {
    return false;
  }

  if (!previousPage.review || pageRecord.capture_ok !== true) {
    return false;
  }

  if (pageRecord.route_path !== previousPage.route_path) {
    return false;
  }

  const currentHasLocalFindings = (pageRecord.hard_checks?.length ?? 0) > 0;
  const previousHasLocalFindings = (previousPage.hard_checks?.length ?? 0) > 0;

  if (
    (currentHasLocalFindings || previousHasLocalFindings) &&
    pageRecord.local_findings_sha256 !== previousPage.local_findings_sha256
  ) {
    return false;
  }

  if (pageRecord.render_input_sha256 && previousPage.render_input_sha256) {
    if (pageRecord.render_input_sha256 !== previousPage.render_input_sha256) {
      return false;
    }
  } else if (
    !pageRecord.screenshot_sha256 ||
    pageRecord.screenshot_sha256 !== previousPage.screenshot_sha256
  ) {
    return false;
  }

  if (previousManifest.provider !== gemini.provider) {
    return false;
  }

  if (previousManifest.model !== gemini.model) {
    return false;
  }

  const previousPromptVersion =
    previousManifest.visual_review_prompt_version ??
    previousPage.review?.prompt_version ??
    VISUAL_REVIEW_PROMPT_VERSION;

  if (previousPromptVersion !== VISUAL_REVIEW_PROMPT_VERSION) {
    return false;
  }

  const previousViewport = previousPage.viewport ?? previousManifest.viewport;

  return (
    Number(pageRecord.viewport?.width) === Number(previousViewport?.width) &&
    Number(pageRecord.viewport?.height) === Number(previousViewport?.height)
  );
}

function reuseVisualReview(previousPage, previousManifest) {
  return {
    ...previousPage.review,
    review_source: "cache",
    cached: true,
    prompt_version: VISUAL_REVIEW_PROMPT_VERSION,
    reused_from_run_id: previousManifest.run_id ?? null,
    reused_at: isoNow(),
  };
}

function buildUnifiedVisualFindings(pageRecord) {
  return mergeVisualFindings(
    pageRecord?.review?.issues ?? [],
    pageRecord?.hard_checks ?? []
  );
}

function pushVisualFix(fixes, rule, message, before, after) {
  if (before === after) {
    return;
  }

  fixes.push({
    code: "latex-render-fix",
    rule,
    message,
    before: reportTruncate(before, 260),
    after: reportTruncate(after, 260),
  });
}

function normalizeLatexAlignmentBody(body) {
  return String(body ?? "")
    .replace(/&=&/gu, "&=")
    .replace(/([A-Za-z]+)_([\p{Script=Han}]+)/gu, "$1_{\\text{$2}}");
}

function escapeTextCommandUnderscores(source, fixes) {
  return String(source ?? "").replace(/\\text\{([^{}]*)\}/gu, match => {
    const escaped = match.replace(/(?<!\\)_/gu, "\\_");

    pushVisualFix(
      fixes,
      "escape-text-underscore",
      "转义数学公式 \\text{...} 内的裸下划线，避免 KaTeX 把普通文本当作下标解析。",
      match,
      escaped
    );

    return escaped;
  });
}

export function applyLatexVisualSafeFixesToMarkdown(source) {
  let next = String(source ?? "");
  const fixes = [];

  const escapedText = escapeTextCommandUnderscores(next, fixes);
  next = escapedText;

  const eqnarrayFixed = next.replace(
    /(\$\$\s*\n?)\\begin\{eqnarray\*?\}([\s\S]*?)\\end\{eqnarray\*?\}(\s*\n?\$\$)/gu,
    (match, open, body, close) => {
      const replacement = `${open}\\begin{aligned}${normalizeLatexAlignmentBody(body)}\\end{aligned}${close}`;
      pushVisualFix(
        fixes,
        "eqnarray-to-aligned",
        "将 KaTeX 不支持的 eqnarray 环境改为 display math 内可渲染的 aligned 环境。",
        match,
        replacement
      );
      return replacement;
    }
  );
  next = eqnarrayFixed;

  const inlineAlignFixed = next.replace(
    /\$\$[ \t]*\\begin\{align\*?\}([\s\S]*?)\\end\{align\*?\}[ \t]*\$\$/gu,
    (match, body) => {
      const normalizedBody = normalizeLatexAlignmentBody(body).trim();
      const replacement = `$$\n\\begin{aligned}\n${normalizedBody}\n\\end{aligned}\n$$`;
      pushVisualFix(
        fixes,
        "inline-align-to-display-aligned",
        "将同一行 $$...$$ 中的 align 环境改为多行 display aligned，避免被解析成行内公式。",
        match,
        replacement
      );
      return replacement;
    }
  );
  next = inlineAlignFixed;

  return {
    content: next,
    fixes,
  };
}

async function buildMarkdownRouteMap() {
  const files = await listMarkdownFiles(BLOG_ROOT);
  const routes = new Map();

  for (const filePath of files) {
    routes.set(getRoutePathFromFile(filePath), filePath);
  }

  return routes;
}

async function applyVisualSafeFixes(pages, options = {}) {
  if (options.applyVisualFixes === false) {
    return [];
  }

  const pagesWithMathIssues = pages.filter(page =>
    (page.visual_findings ?? buildUnifiedVisualFindings(page)).some(
      issue => issue.code === "math-render-error"
    )
  );

  if (pagesWithMathIssues.length === 0) {
    return [];
  }

  const routeMap = await buildMarkdownRouteMap();
  const appliedFixes = [];

  for (const page of pagesWithMathIssues) {
    const sourcePath = routeMap.get(page.route_path);

    if (!sourcePath) {
      continue;
    }

    const original = await fs.readFile(sourcePath, "utf8");
    const result = applyLatexVisualSafeFixesToMarkdown(original);

    if (result.content === original || result.fixes.length === 0) {
      continue;
    }

    await fs.writeFile(sourcePath, result.content, "utf8");

    const sourcePathRelative = normalizePathSlashes(
      path.relative(REPO_ROOT, sourcePath)
    );
    const pageFixes = result.fixes.map(fix => ({
      ...fix,
      route_path: page.route_path,
      source_path: sourcePathRelative,
      applied_at: isoNow(),
    }));

    page.visual_fixes_applied = pageFixes;
    appliedFixes.push(...pageFixes);
  }

  return appliedFixes;
}

export function buildVisualCheckSummary(pages, appliedFixes = []) {
  const findings = pages.flatMap(page =>
    page.visual_findings ?? buildUnifiedVisualFindings(page)
  );

  return {
    page_count: pages.length,
    screenshot_count: pages.filter(page => page.capture_ok).length,
    reviewed_count: pages.filter(page => page.review).length,
    review_fresh_count: pages.filter(
      page => page.review?.review_source === "gemini"
    ).length,
    review_cached_count: pages.filter(
      page => page.review?.review_source === "cache"
    ).length,
    issue_count: findings.length,
    error_count: findings.filter(issue => issue.severity === "error").length,
    warn_count: findings.filter(issue => issue.severity === "warn").length,
    visual_fix_count: appliedFixes.length,
    highest_severity: maxSeverity(findings.map(issue => issue.severity)),
  };
}

function collectVisualIssuesForPage(page) {
  return page.visual_findings ?? buildUnifiedVisualFindings(page);
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");
}

function markdownCell(value) {
  return String(value ?? "")
    .replace(/\s+/gu, " ")
    .replace(/\|/gu, "\\|")
    .trim();
}

function reportTruncate(value, maxLength = 180) {
  const normalized = String(value ?? "")
    .replace(/\s+/gu, " ")
    .trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function reportAssetPath(runRoot, repoRelativePath) {
  if (!repoRelativePath) {
    return "";
  }

  return normalizePathSlashes(
    path.relative(runRoot, path.join(REPO_ROOT, repoRelativePath))
  );
}

function severityRank(severity) {
  return { error: 2, warn: 1, info: 0 }[severity] ?? 0;
}

function sortVisualIssueRows(rows) {
  return [...rows].sort((left, right) => {
    const severityDelta =
      severityRank(right.highest_severity) -
      severityRank(left.highest_severity);

    if (severityDelta !== 0) {
      return severityDelta;
    }

    return right.issues.length - left.issues.length;
  });
}

function summarizeIssueCodes(issues) {
  const counts = new Map();

  for (const issue of issues) {
    counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([code, count]) => (count > 1 ? `${code} x${count}` : code))
    .join(", ");
}

function buildVisualReportRows(manifest, runRoot) {
  return manifest.pages.map(page => {
    const issues = collectVisualIssuesForPage(page);

    return {
      ...page,
      issues,
      screenshot_report_path: reportAssetPath(runRoot, page.screenshot_path),
      highest_severity: maxSeverity(issues.map(issue => issue.severity)),
    };
  });
}

function issueCountLabel(count) {
  if (count === 0) {
    return "0 issues";
  }

  return count === 1 ? "1 issue" : `${count} issues`;
}

function buildVisualHtmlReport(manifest, runRoot) {
  const rows = buildVisualReportRows(manifest, runRoot);
  const issueRows = sortVisualIssueRows(
    rows.filter(row => row.issues.length > 0)
  );
  const cleanRows = rows.filter(row => row.issues.length === 0);
  const issueCards = issueRows
    .map(row => {
      const issues = row.issues
        .map(
          issue => `
            <li class="issue issue-${htmlEscape(issue.severity)}">
              <div class="issue-head">
                <span class="pill ${htmlEscape(issue.severity)}">${htmlEscape(issue.severity)}</span>
                <span class="code">${htmlEscape(issue.code)}</span>
                <span class="source">${htmlEscape(issue.source)}</span>
              </div>
              <p>${htmlEscape(issue.message)}</p>
              ${
                issue.region && issue.region !== "unknown"
                  ? `<small>Region: ${htmlEscape(issue.region)}</small>`
                  : ""
              }
              ${
                issue.selector_hint
                  ? `<small>Selector: ${htmlEscape(issue.selector_hint)}</small>`
                  : ""
              }
            </li>`
        )
        .join("");

      return `
        <article class="page-card issue-card">
          <a class="thumb" href="${htmlEscape(row.screenshot_report_path)}">
            ${
              row.screenshot_report_path
                ? `<img src="${htmlEscape(row.screenshot_report_path)}" alt="${htmlEscape(row.route_path)} screenshot" loading="lazy" />`
                : `<div class="missing-thumb">No screenshot</div>`
            }
          </a>
          <div class="page-body">
            <div class="page-title-row">
              <h2>${htmlEscape(row.route_path)}</h2>
              <span class="pill ${htmlEscape(row.highest_severity)}">${htmlEscape(row.highest_severity)}</span>
            </div>
            <p class="title">${htmlEscape(row.title || row.html_path || "")}</p>
            <ul>${issues}</ul>
          </div>
        </article>`;
    })
    .join("");
  const gallery = rows
    .map(
      row => `
        <a class="gallery-card ${row.issues.length ? "has-issues" : "clean"}" href="${htmlEscape(row.screenshot_report_path)}">
          ${
            row.screenshot_report_path
              ? `<img src="${htmlEscape(row.screenshot_report_path)}" alt="${htmlEscape(row.route_path)} screenshot" loading="lazy" />`
              : `<div class="missing-thumb">No screenshot</div>`
          }
          <span>${htmlEscape(row.route_path)}</span>
          <em>${htmlEscape(issueCountLabel(row.issues.length))}</em>
        </a>`
    )
    .join("");
  const notes = (manifest.notes ?? [])
    .map(note => `<li>${htmlEscape(note)}</li>`)
    .join("");
  const appliedFixes = (manifest.applied_fixes ?? [])
    .map(
      fix => `
        <li>
          <strong>${htmlEscape(fix.source_path)}</strong>
          <span class="code">${htmlEscape(fix.rule)}</span>
          <p>${htmlEscape(fix.message)}</p>
          <small>Before: ${htmlEscape(fix.before)}</small>
          <small>After: ${htmlEscape(fix.after)}</small>
        </li>`
    )
    .join("");
  const reviewCacheStats =
    Number.isFinite(Number(manifest.summary.review_fresh_count)) ||
    Number.isFinite(Number(manifest.summary.review_cached_count))
      ? `
        <span class="stat">${Number(manifest.summary.review_fresh_count ?? 0)} fresh reviews</span>
        <span class="stat">${Number(manifest.summary.review_cached_count ?? 0)} cached reviews</span>`
      : "";

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Visual Check Report - ${htmlEscape(manifest.run_id)}</title>
    <style>
      :root { color-scheme: light; --bg: #f7f7f4; --paper: #fff; --ink: #242424; --muted: #686868; --line: #dedbd2; --accent: #006cac; --warn: #9a5b00; --error: #b42318; --info: #31615f; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: var(--bg); color: var(--ink); }
      header { padding: 32px clamp(18px, 4vw, 56px); border-bottom: 1px solid var(--line); background: var(--paper); }
      main { padding: 24px clamp(18px, 4vw, 56px) 48px; }
      h1 { margin: 0 0 8px; font-size: clamp(28px, 4vw, 42px); line-height: 1.05; letter-spacing: 0; }
      h2 { margin: 0; font-size: 18px; letter-spacing: 0; }
      p { margin: 0; color: var(--muted); line-height: 1.65; }
      .meta { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
      .stat, .pill { display: inline-flex; align-items: center; border: 1px solid var(--line); border-radius: 999px; padding: 5px 10px; background: #fafafa; font-size: 13px; font-weight: 650; color: var(--ink); }
      .pill.warn { color: var(--warn); border-color: #e4c27b; background: #fff8e7; }
      .pill.error { color: var(--error); border-color: #f0a39c; background: #fff1f0; }
      .pill.info { color: var(--info); border-color: #9fc9c5; background: #effaf8; }
      .section-title { margin: 32px 0 14px; display: flex; align-items: baseline; justify-content: space-between; gap: 16px; }
      .page-card { display: grid; grid-template-columns: minmax(180px, 280px) minmax(0, 1fr); gap: 18px; padding: 16px; margin-bottom: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); }
      .thumb { display: block; overflow: hidden; border: 1px solid var(--line); border-radius: 6px; background: #eceae3; aspect-ratio: 4 / 3; }
      .thumb img, .gallery-card img { width: 100%; height: 100%; object-fit: cover; object-position: top; display: block; }
      .page-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .title { margin-top: 4px; font-size: 13px; }
      ul { margin: 14px 0 0; padding: 0; list-style: none; }
      .issue { padding: 12px 0; border-top: 1px solid var(--line); }
      .issue:first-child { border-top: 0; }
      .issue-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 6px; }
      .code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; color: var(--ink); }
      .source { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
      small { display: block; color: var(--muted); margin-top: 4px; font-size: 12px; line-height: 1.45; }
      .notes { border: 1px solid var(--line); border-radius: 8px; background: var(--paper); padding: 16px 18px; }
      .notes li { margin: 6px 0; color: var(--muted); line-height: 1.55; }
      .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 14px; }
      .gallery-card { display: grid; gap: 8px; color: inherit; text-decoration: none; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); padding: 10px; }
      .gallery-card img, .missing-thumb { aspect-ratio: 4 / 3; border-radius: 6px; background: #eceae3; }
      .gallery-card span { font-size: 13px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .gallery-card em { color: var(--muted); font-size: 12px; font-style: normal; }
      .gallery-card.has-issues { border-color: #e4c27b; }
      .empty { padding: 20px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); }
      @media (max-width: 760px) { .page-card { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <header>
      <h1>Visual Check Report</h1>
      <p>Run ${htmlEscape(manifest.run_id)} generated at ${htmlEscape(manifest.generated_at)}.</p>
      <div class="meta">
        <span class="stat">${manifest.summary.page_count} pages</span>
        <span class="stat">${manifest.summary.screenshot_count} screenshots</span>
        <span class="stat">${manifest.summary.reviewed_count} reviewed</span>
        ${reviewCacheStats}
        <span class="stat">${manifest.summary.issue_count} issues</span>
        <span class="stat">${manifest.summary.visual_fix_count ?? 0} fixes</span>
        <span class="pill ${htmlEscape(manifest.summary.highest_severity)}">${htmlEscape(manifest.summary.highest_severity)}</span>
      </div>
    </header>
    <main>
      ${
        appliedFixes
          ? `<section><div class="section-title"><h2>Applied Fixes</h2><p>${manifest.applied_fixes.length} source edits applied by visual safe-fix rules.</p></div><ul class="notes">${appliedFixes}</ul></section>`
          : ""
      }
      <section>
        <div class="section-title">
          <h2>Needs Attention</h2>
          <p>${issueRows.length} pages with issues, ${cleanRows.length} clean pages.</p>
        </div>
        ${issueCards || `<div class="empty">No visual issues found.</div>`}
      </section>
      ${
        notes
          ? `<section><div class="section-title"><h2>Run Notes</h2></div><ul class="notes">${notes}</ul></section>`
          : ""
      }
      <section>
        <div class="section-title">
          <h2>Screenshot Gallery</h2>
          <p>Click any thumbnail to open the full-page screenshot.</p>
        </div>
        <div class="gallery">${gallery}</div>
      </section>
    </main>
  </body>
</html>
`;
}

function buildVisualMarkdownReport(manifest, runRoot) {
  const rows = buildVisualReportRows(manifest, runRoot);
  const issueRows = rows.filter(row => row.issues.length > 0);
  const lines = [
    `# Visual Check Report`,
    "",
    `Run: \`${manifest.run_id}\``,
    `Generated: \`${manifest.generated_at}\``,
    "",
    `Pages: ${manifest.summary.page_count}`,
    `Screenshots: ${manifest.summary.screenshot_count}`,
    `Reviewed: ${manifest.summary.reviewed_count}`,
    ...(Number.isFinite(Number(manifest.summary.review_fresh_count)) ||
    Number.isFinite(Number(manifest.summary.review_cached_count))
      ? [
          `Fresh reviews: ${Number(manifest.summary.review_fresh_count ?? 0)}`,
          `Cached reviews: ${Number(manifest.summary.review_cached_count ?? 0)}`,
        ]
      : []),
    `Issues: ${manifest.summary.issue_count}`,
    `Applied fixes: ${manifest.summary.visual_fix_count ?? 0}`,
    `Highest severity: \`${manifest.summary.highest_severity}\``,
    "",
  ];

  if (manifest.notes?.length) {
    lines.push("## Run Notes", "");
    for (const note of manifest.notes) {
      lines.push(`- ${note}`);
    }
    lines.push("");
  }

  if (manifest.applied_fixes?.length) {
    lines.push("## Applied Fixes", "");

    for (const fix of manifest.applied_fixes) {
      lines.push(
        `- \`${markdownCell(fix.source_path)}\` \`${markdownCell(fix.rule)}\`: ${markdownCell(fix.message)}`
      );
      lines.push(`  Before: \`${markdownCell(fix.before)}\``);
      lines.push(`  After: \`${markdownCell(fix.after)}\``);
    }

    lines.push("");
  }

  lines.push("## Needs Attention", "");

  if (issueRows.length === 0) {
    lines.push("No visual issues found.", "");
  } else {
    lines.push("| Route | Severity | Count | Signals | Screenshot |");
    lines.push("| --- | --- | ---: | --- | --- |");

    for (const row of sortVisualIssueRows(issueRows)) {
      lines.push(
        `| ${markdownCell(row.route_path)} | ${markdownCell(row.highest_severity)} | ${row.issues.length} | ${markdownCell(reportTruncate(summarizeIssueCodes(row.issues), 110))} | ${row.screenshot_report_path ? `[open](${row.screenshot_report_path})` : ""} |`
      );
    }

    lines.push("");
    lines.push("## Issue Details", "");

    for (const row of sortVisualIssueRows(issueRows)) {
      lines.push(
        `<details><summary>${htmlEscape(row.route_path)} · ${htmlEscape(row.highest_severity)} · ${row.issues.length} ${row.issues.length === 1 ? "issue" : "issues"}</summary>`,
        ""
      );

      if (row.screenshot_report_path) {
        lines.push(`Screenshot: [open](${row.screenshot_report_path})`, "");
      }

      for (const issue of row.issues) {
        const source = issue.source ? ` (${issue.source})` : "";
        const region =
          issue.region && issue.region !== "unknown"
            ? ` Region: ${reportTruncate(issue.region, 90)}.`
            : "";
        const selector = issue.selector_hint
          ? ` Selector: ${reportTruncate(issue.selector_hint, 90)}.`
          : "";
        lines.push(
          `- **${htmlEscape(issue.severity)}** \`${htmlEscape(issue.code)}\`${htmlEscape(source)}: ${htmlEscape(issue.message)}${htmlEscape(region)}${htmlEscape(selector)}`
        );
      }

      lines.push("", "</details>", "");
    }
  }

  lines.push("## Screenshot Index", "");
  lines.push("| Route | Status | Screenshot |");
  lines.push("| --- | --- | --- |");

  for (const row of rows) {
    lines.push(
      `| ${markdownCell(row.route_path)} | ${markdownCell(issueCountLabel(row.issues.length))} | ${row.screenshot_report_path ? `[open](${row.screenshot_report_path})` : ""} |`
    );
  }

  lines.push("");
  return lines.join("\n");
}

export async function writeVisualReports(manifest, runRoot) {
  const htmlPath = path.join(runRoot, "report.html");
  const markdownPath = path.join(runRoot, "report.md");

  await fs.writeFile(
    htmlPath,
    buildVisualHtmlReport(manifest, runRoot),
    "utf8"
  );
  await fs.writeFile(
    markdownPath,
    buildVisualMarkdownReport(manifest, runRoot),
    "utf8"
  );

  return {
    htmlPath,
    markdownPath,
  };
}

export async function runVisualCheck(options = {}) {
  const runId = sanitizeRunId(options.runId);
  const reviewMode =
    options.skipGemini === true
      ? "none"
      : normalizeVisualReviewMode(options.reviewMode);
  const viewport = {
    width: Number(options.viewport?.width ?? DEFAULT_VIEWPORT.width),
    height: Number(options.viewport?.height ?? DEFAULT_VIEWPORT.height),
  };
  const distRoot = options.distRoot ?? DIST_ROOT;
  const runRoot = path.join(VISUAL_RUNS_ROOT, runId);
  const screenshotRoot = path.join(runRoot, "screenshots");
  const manifestPath = path.join(runRoot, "manifest.json");
  const timeoutMs = Number(options.timeoutMs ?? 30000);
  const geminiTimeoutMs = Number(options.geminiTimeoutMs ?? 60000);
  const settleMs = Number(options.settleMs ?? 600);
  const previousManifest =
    reviewMode === "changed" ? await loadPreviousVisualManifest(options) : null;
  const previousPagesByRoute = new Map(
    (previousManifest?.pages ?? []).map(page => [page.route_path, page])
  );
  const visualFonts = await resolveVisualFonts(options);
  const visualFontRuntime =
    visualFonts.cjk.available || visualFonts.emoji.available
      ? {
          ...visualFonts,
          css: buildVisualFontCss(AGENT_VISUAL_FONT_ROUTE),
        }
      : visualFonts;
  const visualFontFingerprint = {
    cjk: Boolean(visualFonts.cjk.available),
    cjk_bold: Boolean(visualFonts.cjkBold.available),
    emoji: Boolean(visualFonts.emoji.available),
  };
  const build = await maybeBuildSite(options);
  const distAssetSha256 = await buildDistAssetFingerprint(distRoot);
  let routes = await collectStaticHtmlRoutes(distRoot);
  routes = filterStaticHtmlRoutes(routes, options.route ?? options.routes);

  if (
    Number.isFinite(Number(options.maxPages)) &&
    Number(options.maxPages) > 0
  ) {
    routes = routes.slice(0, Number(options.maxPages));
  }

  emitVisualProgress(options, {
    type: "start",
    total: routes.length,
  });

  const chromium = await loadPlaywrightChromium();
  const browserProxy = resolvePlaywrightProxyConfig();
  let server = null;
  let browser = null;
  let context = null;
  const pages = [];

  try {
    server = await startStaticServer(distRoot, {
      visualFonts,
    });
    browser = await chromium.launch({
      headless: true,
      ...(browserProxy ? { proxy: browserProxy } : {}),
    });
    context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
    });

    for (const [index, route] of routes.entries()) {
      const pageId = routeToVisualArtifactName(route.route_path);
      const screenshotPath = path.join(screenshotRoot, `${pageId}.png`);
      const htmlSha256 = await sha256File(route.html_path);
      const renderInputSha256 = buildRenderInputFingerprint({
        htmlSha256,
        distAssetSha256,
        viewport,
        visualFont: visualFontFingerprint,
      });
      const capture = await capturePage(
        route,
        context,
        server,
        screenshotPath,
        {
          viewport,
          timeoutMs,
          settleMs,
          visualFont: visualFontRuntime,
        }
      );

      pages.push({
        page_id: pageId,
        route_path: route.route_path,
        html_path: route.html_path_relative,
        url: capture.url,
        title: capture.title,
        capture_ok: capture.ok,
        screenshot_path: capture.ok
          ? normalizePathSlashes(path.relative(REPO_ROOT, screenshotPath))
          : null,
        screenshot_path_abs: capture.ok ? screenshotPath : null,
        screenshot_bytes: capture.screenshot_bytes,
        screenshot_sha256: capture.screenshot_sha256,
        html_sha256: htmlSha256,
        dist_asset_sha256: distAssetSha256,
        render_input_sha256: renderInputSha256,
        viewport: capture.viewport,
        page_metrics: capture.page_metrics,
        browser_errors: capture.browser_errors,
        hard_checks: capture.hard_checks,
        local_findings_sha256: sha256Text(
          JSON.stringify(capture.hard_checks ?? [])
        ),
        review: null,
      });

      emitVisualProgress(options, {
        type: "capture",
        index: index + 1,
        total: routes.length,
        route_path: route.route_path,
        ok: capture.ok,
      });
    }
  } finally {
    await closeWithTimeout("browser context", () => context?.close(), 3000);
    const browserCloseError = await closeWithTimeout(
      "browser",
      () => browser?.close(),
      3000
    );

    if (browserCloseError) {
      browser?.process?.()?.kill?.("SIGKILL");
    }

    await closeWithTimeout("static server", () => server?.close(), 2000);
  }

  const gemini = resolveVisualGemini(options);
  const notes = [];

  if (!visualFonts.cjk.available) {
    notes.push(
      `CJK visual font unavailable (${visualFonts.cjk.error ?? visualFonts.cjk.source}); screenshots may show tofu boxes for Chinese text.`
    );
  }

  if (!visualFonts.cjkBold.available) {
    notes.push(
      `CJK bold visual font unavailable (${visualFonts.cjkBold.error ?? visualFonts.cjkBold.source}); semibold Chinese text may show tofu boxes.`
    );
  }

  if (!visualFonts.emoji.available) {
    notes.push(
      `Emoji visual font unavailable (${visualFonts.emoji.error ?? visualFonts.emoji.source}); screenshots may differ from browsers with native color emoji.`
    );
  }

  if (reviewMode === "none") {
    notes.push(
      "Gemini visual review skipped by review_mode=none; screenshots were archived without multimodal review."
    );
  } else if (!gemini.available) {
    notes.push(
      `Gemini visual review unavailable (${gemini.unavailable_reason}); screenshots were archived without multimodal review.`
    );
  } else {
    for (const [index, pageRecord] of pages.entries()) {
      const previousPage = previousPagesByRoute.get(pageRecord.route_path);

      if (
        reviewMode === "changed" &&
        canReuseVisualReview(pageRecord, previousPage, previousManifest, gemini)
      ) {
        pageRecord.review = reuseVisualReview(previousPage, previousManifest);
        emitVisualProgress(options, {
          type: "review",
          index: index + 1,
          total: pages.length,
          route_path: pageRecord.route_path,
          ok: true,
          cached: true,
        });
        continue;
      }

      try {
        pageRecord.review = await reviewPageWithGemini(pageRecord, gemini, {
          timeoutMs: geminiTimeoutMs,
        });
        emitVisualProgress(options, {
          type: "review",
          index: index + 1,
          total: pages.length,
          route_path: pageRecord.route_path,
          ok: Boolean(pageRecord.review),
          cached: false,
        });
      } catch (error) {
        if (isGeminiTransportError(error)) {
          notes.push(
            `Gemini visual review disabled after provider transport failure for ${pageRecord.route_path}: ${error.message ?? String(error)}`
          );
          break;
        }

        notes.push(
          `Gemini visual review failed for ${pageRecord.route_path}: ${error.message ?? String(error)}`
        );
        emitVisualProgress(options, {
          type: "review",
          index: index + 1,
          total: pages.length,
          route_path: pageRecord.route_path,
          ok: false,
          cached: false,
        });
      }
    }
  }

  for (const pageRecord of pages) {
    pageRecord.visual_findings = buildUnifiedVisualFindings(pageRecord);
  }

  const appliedFixes = await applyVisualSafeFixes(pages, {
    applyVisualFixes: options.applyVisualFixes,
  });

  if (appliedFixes.length > 0) {
    notes.push(
      `Applied ${appliedFixes.length} visual safe fix(es) to Markdown sources. Rebuild and rerun visual-check to verify screenshots.`
    );
  }

  for (const pageRecord of pages) {
    delete pageRecord.screenshot_path_abs;
  }

  const summary = buildVisualCheckSummary(pages, appliedFixes);
  const manifest = {
    generated_at: isoNow(),
    run_id: runId,
    run_mode: "visual-check",
    provider: gemini.provider,
    model: gemini.model,
    review_mode: reviewMode,
    visual_review_prompt_version: VISUAL_REVIEW_PROMPT_VERSION,
    review_cache: {
      base_run_id: previousManifest?.run_id ?? null,
      base_manifest_path:
        reviewMode === "changed"
          ? normalizePathSlashes(
              path.relative(
                REPO_ROOT,
                options.reviewBaseManifestPath ?? VISUAL_LATEST_PATH
              )
            )
          : null,
    },
    degraded: !gemini.available || notes.length > 0,
    degraded_reason: !gemini.available ? gemini.unavailable_reason : null,
    build,
    dist_root: normalizePathSlashes(path.relative(REPO_ROOT, distRoot)),
    dist_asset_sha256: distAssetSha256,
    route_filter: options.route ?? options.routes ?? null,
    visual_font: {
      cjk: {
        available: visualFonts.cjk.available,
        source: visualFonts.cjk.source,
        path: visualFonts.cjk.path,
        error: visualFonts.cjk.error ?? null,
      },
      cjk_bold: {
        available: visualFonts.cjkBold.available,
        source: visualFonts.cjkBold.source,
        path: visualFonts.cjkBold.path,
        error: visualFonts.cjkBold.error ?? null,
      },
      emoji: {
        available: visualFonts.emoji.available,
        source: visualFonts.emoji.source,
        path: visualFonts.emoji.path,
        error: visualFonts.emoji.error ?? null,
      },
    },
    screenshot_root: normalizePathSlashes(
      path.relative(REPO_ROOT, screenshotRoot)
    ),
    viewport,
    gemini_timeout_ms: geminiTimeoutMs,
    summary,
    notes,
    applied_fixes: appliedFixes,
    pages,
  };
  const reportPaths = await writeVisualReports(manifest, runRoot);
  manifest.report_path = normalizePathSlashes(
    path.relative(REPO_ROOT, reportPaths.htmlPath)
  );
  manifest.report_markdown_path = normalizePathSlashes(
    path.relative(REPO_ROOT, reportPaths.markdownPath)
  );

  await writeJson(manifestPath, manifest);
  await writeJson(VISUAL_LATEST_PATH, {
    ...manifest,
    manifest_path: normalizePathSlashes(path.relative(REPO_ROOT, manifestPath)),
  });

  return {
    ...manifest,
    manifest_path: manifestPath,
    latest_path: VISUAL_LATEST_PATH,
    report_path: reportPaths.htmlPath,
    report_markdown_path: reportPaths.markdownPath,
  };
}
