import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { ensureDir, fileExists } from "../../shared/fs.js";
import {
  AGENT_VISUAL_BOLD_FONT_PATH,
  AGENT_VISUAL_BOLD_FONT_ROUTE,
  AGENT_VISUAL_BOLD_FONT_URL,
  AGENT_VISUAL_EMOJI_FONT_PATH,
  AGENT_VISUAL_EMOJI_FONT_ROUTE,
  AGENT_VISUAL_EMOJI_FONT_URL,
  AGENT_VISUAL_FONT_PATH,
  AGENT_VISUAL_FONT_ROUTE,
  AGENT_VISUAL_FONT_URL,
  LOCAL_CJK_BOLD_FONT_CANDIDATES,
  LOCAL_CJK_FONT_CANDIDATES,
  LOCAL_EMOJI_FONT_CANDIDATES,
  MIME_TYPES,
} from "./constants.js";
import type { VisualCheckOptions, VisualFont, VisualFonts } from "./types.js";

async function resolveRequestPath(
  distRoot: string,
  requestUrl: string
): Promise<string | null> {
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
}: {
  candidates: string[];
  cachePath: string;
  sourceUrl: string;
  disabled?: boolean;
  downloadTimeoutMs?: number;
}): Promise<VisualFont> {
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
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function resolveVisualFonts(
  options: VisualCheckOptions & {
    disableCjkFont?: boolean;
    fontDownloadTimeoutMs?: number;
  } = {}
): Promise<VisualFonts> {
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

export function buildVisualFontCss(fontRoute: string): string {
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

async function serveStaticFile(
  distRoot: string,
  visualFonts: VisualFonts | undefined,
  request: http.IncomingMessage,
  response: http.ServerResponse
): Promise<void> {
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

  const filePath = await resolveRequestPath(distRoot, request.url ?? "/");

  if (!filePath) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("Not found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    "Content-Type":
      (MIME_TYPES as Record<string, string>)[extension] ??
      "application/octet-stream",
  });
  response.end(await fs.readFile(filePath));
}

export async function startStaticServer(
  distRoot: string,
  options: { visualFonts?: VisualFonts } = {}
): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const sockets = new Set<import("node:net").Socket>();
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

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      for (const socket of sockets) {
        socket.destroy();
      }

      await new Promise<void>(resolve => {
        server.close(() => resolve());
      });
    },
  };
}
