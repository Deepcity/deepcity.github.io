// @ts-nocheck
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  DIST_ROOT,
  REPO_ROOT,
  VISUAL_LATEST_PATH,
  VISUAL_RUNS_ROOT,
} from "../shared/constants.js";
import { ensureDir, fileExists, writeJson } from "../shared/fs.js";
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

async function maybeBuildSite(options = {}) {
  if (options.build === false) {
    return {
      ran: false,
      command: null,
    };
  }

  const buildCommand = await resolveBuildCommand();
  await runCommand(buildCommand.command, buildCommand.args);

  return {
    ran: true,
    command: buildCommand.label,
  };
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

async function collectDomMetrics(page) {
  return page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    const images = Array.from(document.images ?? []);
    const brokenImages = images
      .filter(image => !image.complete || image.naturalWidth === 0)
      .map(image => ({
        src: image.currentSrc || image.src || "",
        alt: image.alt || "",
      }))
      .slice(0, 12);

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
    };
  });
}

async function settlePageMedia(page, options = {}) {
  const viewportHeight = Math.max(300, Number(options.viewport?.height ?? 900));
  const step = Math.max(300, Math.floor(viewportHeight * 0.75));
  const scrollPauseMs = Number(options.scrollPauseMs ?? 180);
  const imageTimeoutMs = Number(options.imageTimeoutMs ?? 8000);

  await page
    .evaluate(() => {
      for (const image of Array.from(document.images ?? [])) {
        image.loading = "eager";
        image.decoding = "sync";
        image.fetchPriority = "high";
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

  await page
    .evaluate(async timeoutMs => {
      const waitForImage = image =>
        new Promise(resolve => {
          if (image.complete) {
            resolve();
            return;
          }

          const timeoutId = setTimeout(resolve, timeoutMs);
          const done = () => {
            clearTimeout(timeoutId);
            resolve();
          };

          image.addEventListener("load", done, { once: true });
          image.addEventListener("error", done, { once: true });
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
    }, imageTimeoutMs)
    .catch(() => {});

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

async function capturePage(route, context, server, screenshotPath, options) {
  const page = await context.newPage();
  const browserIssues = [];
  const consoleErrors = [];
  const pageErrors = [];
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
          }
        )
      );
    }

    const stat = await fs.stat(screenshotPath);

    return {
      ok: true,
      url,
      title: metrics.title,
      screenshot_bytes: stat.size,
      viewport: options.viewport,
      page_metrics: metrics,
      browser_errors: {
        console: consoleErrors.slice(0, 8),
        page: pageErrors.slice(0, 8),
      },
      hard_checks: browserIssues,
    };
  } catch (error) {
    return {
      ok: false,
      url,
      title: "",
      screenshot_bytes: 0,
      viewport: options.viewport,
      page_metrics: null,
      browser_errors: {
        console: consoleErrors.slice(0, 8),
        page: pageErrors.slice(0, 8),
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
    region: String(rawIssue?.region ?? rawIssue?.where ?? "unknown")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 120),
    selector_hint: String(rawIssue?.selector_hint ?? rawIssue?.selector ?? "")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 160),
    confidence: roundConfidence(Number(rawIssue?.confidence ?? 0.72)),
    fixable: false,
  };
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
  return [
    "你是 Deepcity 博客的视觉 lint Agent。",
    "请根据这一张完整页面截图做基础显示纠错，只输出一个 JSON 对象，不要输出 Markdown。",
    "必须包含字段：route_path、summary、severity、confidence、issues、action_items、suggested_adjustments。",
    "issues 是数组，每项包含 code、severity、message、region、selector_hint、confidence。",
    "允许的 code 优先使用：visual-overlap、visual-clipping、visual-overflow、visual-contrast、visual-blank-space、broken-image、missing-image、broken-icon、navigation-layout、text-readability、responsive-layout、unexpected-rendering。",
    "重点检查：文字遮挡/截断、内容溢出、图片或图标缺失、对比度明显不可读、大片异常空白、导航/正文/页脚碰撞、排版层级混乱。",
    "不要评价文章观点、技术内容或写作质量；只处理截图可见的显示问题。",
    "如果看不到明确问题，返回 issues=[]，severity=info，并在 summary 说明未发现明显显示异常。",
    "",
    `route_path: ${pageRecord.route_path}`,
    `title: ${pageRecord.title || "(none)"}`,
    `viewport: ${pageRecord.viewport.width}x${pageRecord.viewport.height}`,
    `page_metrics: ${JSON.stringify(pageRecord.page_metrics ?? null)}`,
    `browser_hard_checks: ${JSON.stringify(pageRecord.hard_checks ?? [])}`,
  ].join("\n");
}

async function reviewPageWithGemini(pageRecord, gemini, options = {}) {
  if (!pageRecord.screenshot_path_abs || pageRecord.capture_ok !== true) {
    return null;
  }

  const rawReview = await requestGeminiImageJson({
    apiKey: gemini.apiKey,
    model: gemini.model,
    imagePath: pageRecord.screenshot_path_abs,
    mimeType: "image/png",
    prompt: buildGeminiVisualPrompt(pageRecord),
    timeoutMs: options.timeoutMs,
  });

  return sanitizeVisualReview(rawReview, {
    route_path: pageRecord.route_path,
  });
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

export function buildVisualCheckSummary(pages) {
  const hardChecks = pages.flatMap(page => [
    ...(page.hard_checks ?? []),
    ...(page.review?.issues ?? []),
  ]);

  return {
    page_count: pages.length,
    screenshot_count: pages.filter(page => page.capture_ok).length,
    reviewed_count: pages.filter(page => page.review).length,
    issue_count: hardChecks.length,
    error_count: hardChecks.filter(issue => issue.severity === "error").length,
    warn_count: hardChecks.filter(issue => issue.severity === "warn").length,
    highest_severity: maxSeverity(hardChecks.map(issue => issue.severity)),
  };
}

export async function runVisualCheck(options = {}) {
  const runId = sanitizeRunId(options.runId);
  const viewport = {
    width: Number(options.viewport?.width ?? DEFAULT_VIEWPORT.width),
    height: Number(options.viewport?.height ?? DEFAULT_VIEWPORT.height),
  };
  const distRoot = options.distRoot ?? DIST_ROOT;
  const runRoot = path.join(VISUAL_RUNS_ROOT, runId);
  const screenshotRoot = path.join(runRoot, "screenshots");
  const manifestPath = path.join(runRoot, "manifest.json");
  const timeoutMs = Number(options.timeoutMs ?? 30000);
  const geminiTimeoutMs = Number(options.geminiTimeoutMs ?? 20000);
  const settleMs = Number(options.settleMs ?? 600);
  const visualFonts = await resolveVisualFonts(options);
  const visualFontRuntime =
    visualFonts.cjk.available || visualFonts.emoji.available
      ? {
          ...visualFonts,
          css: buildVisualFontCss(AGENT_VISUAL_FONT_ROUTE),
        }
      : visualFonts;
  const build = await maybeBuildSite(options);
  let routes = await collectStaticHtmlRoutes(distRoot);
  routes = filterStaticHtmlRoutes(routes, options.route ?? options.routes);

  if (
    Number.isFinite(Number(options.maxPages)) &&
    Number(options.maxPages) > 0
  ) {
    routes = routes.slice(0, Number(options.maxPages));
  }

  const chromium = await loadPlaywrightChromium();
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
    });
    context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
    });

    for (const route of routes) {
      const pageId = routeToVisualArtifactName(route.route_path);
      const screenshotPath = path.join(screenshotRoot, `${pageId}.png`);
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
        viewport: capture.viewport,
        page_metrics: capture.page_metrics,
        browser_errors: capture.browser_errors,
        hard_checks: capture.hard_checks,
        review: null,
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

  if (!gemini.available) {
    notes.push(
      `Gemini visual review unavailable (${gemini.unavailable_reason}); screenshots were archived without multimodal review.`
    );
  } else {
    for (const pageRecord of pages) {
      try {
        pageRecord.review = await reviewPageWithGemini(pageRecord, gemini, {
          timeoutMs: geminiTimeoutMs,
        });
      } catch (error) {
        if (isGeminiTransportError(error)) {
          notes.push(
            `Gemini visual review disabled after provider transport failure for ${pageRecord.route_path}: ${error.message ?? String(error)}`
          );
          break;
        }

        pageRecord.hard_checks.push(
          makeIssue(
            "gemini-visual-review-failed",
            "warn",
            `Gemini 视觉审查失败：${error.message ?? String(error)}`
          )
        );
        notes.push(
          `Gemini visual review failed for ${pageRecord.route_path}: ${error.message ?? String(error)}`
        );
      }
    }
  }

  for (const pageRecord of pages) {
    delete pageRecord.screenshot_path_abs;
  }

  const summary = buildVisualCheckSummary(pages);
  const manifest = {
    generated_at: isoNow(),
    run_id: runId,
    run_mode: "visual-check",
    provider: gemini.provider,
    model: gemini.model,
    degraded: !gemini.available || notes.length > 0,
    degraded_reason: !gemini.available ? gemini.unavailable_reason : null,
    build,
    dist_root: normalizePathSlashes(path.relative(REPO_ROOT, distRoot)),
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
    pages,
  };

  await writeJson(manifestPath, manifest);
  await writeJson(VISUAL_LATEST_PATH, {
    ...manifest,
    manifest_path: normalizePathSlashes(path.relative(REPO_ROOT, manifestPath)),
  });

  return {
    ...manifest,
    manifest_path: manifestPath,
    latest_path: VISUAL_LATEST_PATH,
  };
}
