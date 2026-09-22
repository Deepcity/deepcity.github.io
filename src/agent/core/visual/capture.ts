/// <reference lib="dom" />
// This module straddles two runtimes: Node code that drives Playwright, and
// callbacks serialized into the page via `page.evaluate`, which run in the
// browser and need DOM globals. The lib reference above is scoped to this
// file so the rest of the agent build stays DOM-free.
import fs from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "../../shared/constants.js";
import { ensureDir } from "../../shared/fs.js";
import { normalizePathSlashes } from "../../shared/utils.js";
import { buildRenderInputFingerprint } from "./cache.js";
import { routeToVisualArtifactName } from "./routes.js";
import { startStaticServer } from "./server.js";
import {
  AGENT_VISUAL_CAPTURE_CSS,
  DEFAULT_IMAGE_RETRY_COUNT,
  DEFAULT_IMAGE_TIMEOUT_MS,
  LOCAL_PROXY_BYPASS_HOSTS,
} from "./constants.js";
import {
  clampNumber,
  compactVisualText,
  emitVisualProgress,
  makeIssue,
  severityRank,
  sha256File,
  sha256Text,
} from "./shared.js";
import type { RawJson } from "../../types.js";
import type {
  PageRecord,
  RouteEntry,
  VisualCheckOptions,
  VisualFonts,
  VisualIssue,
  VisualRunContext,
} from "./types.js";

/**
 * Playwright objects are typed as RawJson: the dependency is loaded lazily via
 * a dynamic import so `playwright` stays an optional install, which means its
 * types are not available at compile time here.
 */
type PlaywrightPage = RawJson;
type PlaywrightContext = RawJson;

interface StaticServer {
  baseUrl: string;
  close(): Promise<void>;
}

export async function loadPlaywrightChromium(): Promise<RawJson> {
  try {
    const playwright = await import("playwright");
    return playwright.chromium;
  } catch (error) {
    throw new Error(
      `Playwright is required for visual-check. Install project dependencies with npm install, then run npx playwright install chromium. (${error instanceof Error ? error.message : String(error)})`
    );
  }
}

function firstNonEmptyEnv(
  env: NodeJS.ProcessEnv,
  names: string[]
): string | null {
  for (const name of names) {
    const value = env[name];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function splitProxyBypass(value: string): string[] {
  return String(value ?? "")
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

export function resolvePlaywrightProxyConfig(
  env: NodeJS.ProcessEnv = process.env
): { server: string; bypass: string } | null {
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
    ...splitProxyBypass(firstNonEmptyEnv(env, ["NO_PROXY", "no_proxy"]) ?? ""),
    ...LOCAL_PROXY_BYPASS_HOSTS,
  ]);

  return {
    server,
    bypass: [...bypassHosts].join(","),
  };
}

export async function closeWithTimeout(
  label: string,
  closeFn: () => unknown,
  timeoutMs = 3000
): Promise<Error | null> {
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
    return error instanceof Error ? error : new Error(String(error));
  } finally {
    clearTimeout(timeoutId);
  }
}

async function waitForPageImages(
  page: PlaywrightPage,
  timeoutMs: number
): Promise<RawJson> {
  return page
    .evaluate(async (waitMs: number) => {
      const waitForImage = (image: HTMLImageElement) =>
        new Promise(resolve => {
          if (image.complete) {
            resolve(image.naturalWidth > 0 ? "loaded" : "broken");
            return;
          }

          const timeoutId = setTimeout(() => resolve("timeout"), waitMs);
          const done = (state: string) => {
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

async function retryBrokenPageImages(
  page: PlaywrightPage,
  attempt: number,
  timeoutMs: number
): Promise<RawJson> {
  return page
    .evaluate(
      async ({
        attempt: retryAttempt,
        timeoutMs: retryTimeoutMs,
      }: {
        attempt: number;
        timeoutMs: number;
      }) => {
        const makeRetryUrl = (src: string) => {
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

        const retryOne = (image: HTMLImageElement) =>
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
            const done = (ok: boolean) => {
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

async function collectDomMetrics(page: PlaywrightPage): Promise<RawJson> {
  return page.evaluate(() => {
    const documentElement = document.documentElement;
    const body = document.body;
    const images = Array.from(document.images ?? []);
    const compactText = (value: unknown, maxLength = 180) => {
      const normalized = String(value ?? "")
        .replace(/\s+/gu, " ")
        .trim();

      if (normalized.length <= maxLength) {
        return normalized;
      }

      return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
    };
    const selectorHint = (element: Element | null) => {
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
    const elementRect = (element: Element) => {
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
        rect: node.parentElement ? elementRect(node.parentElement) : null,
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

export function buildMathRenderIssuesFromMetrics(
  metrics: RawJson
): VisualIssue[] {
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

async function settlePageMedia(
  page: PlaywrightPage,
  options: RawJson = {}
): Promise<RawJson> {
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
    await page.evaluate((position: number) => {
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

async function preparePageForVisualCapture(
  page: PlaywrightPage
): Promise<void> {
  await page
    .addStyleTag({
      content: AGENT_VISUAL_CAPTURE_CSS,
    })
    .catch(() => {});
}

async function buildGeminiReviewImage(
  pageRecord: PageRecord
): Promise<RawJson | null> {
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

function issueCropKey(issue: VisualIssue): string | null {
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

async function buildGeminiEvidenceCropImages(
  pageRecord: PageRecord,
  options: RawJson = {}
): Promise<RawJson[]> {
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
      .sort(
        (left, right) =>
          severityRank(right.severity) - severityRank(left.severity)
      );

    for (const issue of cropIssues) {
      if (crops.length >= maxCrops) {
        break;
      }

      const key = issueCropKey(issue);

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      // issueCropKey() already returned null for issues without a rect.
      const rect = issue.rect as NonNullable<VisualIssue["rect"]>;
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
        clampNumber(
          centerY - height / 2,
          0,
          Math.max(0, metadata.height - height)
        )
      );
      const cropPath: string = cropRoot.replace(
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

export async function buildGeminiReviewImages(
  pageRecord: PageRecord
): Promise<RawJson[]> {
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

export async function capturePage(
  route: RouteEntry,
  context: PlaywrightContext,
  server: StaticServer,
  screenshotPath: string,
  options: {
    viewport: { width: number; height: number };
    timeoutMs: number;
    settleMs: number;
    visualFont?: VisualFonts;
  }
): Promise<RawJson> {
  const page = await context.newPage();
  const browserIssues = [];
  const consoleErrors: RawJson[] = [];
  const pageErrors: RawJson[] = [];
  const imageRequestErrors: RawJson[] = [];
  const url = `${server.baseUrl}${encodeURI(route.route_path)}`;

  page.on("pageerror", (error: RawJson) => {
    const message = error.message ?? String(error);
    pageErrors.push(message);
    browserIssues.push(
      makeIssue("browser-page-error", "error", `页面脚本错误：${message}`)
    );
  });

  page.on("console", (message: RawJson) => {
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

  page.on("requestfailed", (request: RawJson) => {
    if (request.resourceType() !== "image") {
      return;
    }

    imageRequestErrors.push({
      url: request.url(),
      error: request.failure()?.errorText ?? "request failed",
    });
  });

  page.on("response", (response: RawJson) => {
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
          `截图失败：${error instanceof Error ? error.message : String(error)}`
        ),
      ],
    };
  } finally {
    await closeWithTimeout("page", () => page.close(), 2000);
  }
}

// Phase 2: drive one browser session over every route. Owns the static
// server / browser / context lifecycle so callers never leak a process.
export async function captureAllPages(
  ctx: VisualRunContext,
  options: VisualCheckOptions = {}
): Promise<PageRecord[]> {
  const {
    routes,
    distRoot,
    viewport,
    timeoutMs,
    settleMs,
    screenshotRoot,
    distAssetSha256,
    visualFonts,
    visualFontRuntime,
    visualFontFingerprint,
  } = ctx;
  const chromium = await loadPlaywrightChromium();
  const browserProxy = resolvePlaywrightProxyConfig();
  let server: StaticServer | null = null;
  let browser: RawJson = null;
  let context: PlaywrightContext = null;
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

  return pages;
}
