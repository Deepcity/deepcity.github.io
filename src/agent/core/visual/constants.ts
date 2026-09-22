export const DEFAULT_VIEWPORT = {
  width: 1440,
  height: 1200,
};

export const DEFAULT_IMAGE_TIMEOUT_MS = 15000;

export const DEFAULT_IMAGE_RETRY_COUNT = 2;

export const LOCAL_PROXY_BYPASS_HOSTS = ["127.0.0.1", "localhost", "::1"];

export const VISUAL_REVIEW_PROMPT_VERSION = "visual-review-v1";

export const AGENT_VISUAL_FONT_ROUTE = "/__agent-visual/fonts/cjk-font";

export const AGENT_VISUAL_BOLD_FONT_ROUTE =
  "/__agent-visual/fonts/cjk-bold-font";

export const AGENT_VISUAL_EMOJI_FONT_ROUTE = "/__agent-visual/fonts/emoji-font";

export const AGENT_VISUAL_FONT_URL =
  "https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf";

export const AGENT_VISUAL_BOLD_FONT_URL =
  "https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf";

export const AGENT_VISUAL_EMOJI_FONT_URL =
  "https://github.com/googlefonts/noto-emoji/raw/main/fonts/NotoColorEmoji.ttf";

export const AGENT_VISUAL_FONT_PATH =
  "/tmp/astro-agent-visual-fonts/NotoSansCJKsc-Regular.otf";

export const AGENT_VISUAL_BOLD_FONT_PATH =
  "/tmp/astro-agent-visual-fonts/NotoSansCJKsc-Bold.otf";

export const AGENT_VISUAL_EMOJI_FONT_PATH =
  "/tmp/astro-agent-visual-fonts/NotoColorEmoji.ttf";

export const AGENT_VISUAL_CAPTURE_CSS = `
  html {
    scroll-behavior: auto !important;
  }

  .progress-container,
  #btt-btn-container {
    display: none !important;
  }
`;

export const LOCAL_CJK_FONT_CANDIDATES = [
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf",
  "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
  "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
  "/usr/share/fonts/truetype/arphic/uming.ttc",
];

export const LOCAL_CJK_BOLD_FONT_CANDIDATES = [
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Bold.otf",
  "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
  "/usr/share/fonts/truetype/noto/NotoSansSC-Bold.ttf",
  "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
];

export const LOCAL_EMOJI_FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf",
  "/usr/share/fonts/google-noto-emoji/NotoColorEmoji.ttf",
  "/usr/share/fonts/truetype/ancient-scripts/Symbola_hint.ttf",
];

export const VISUAL_ISSUE_CODES = new Set([
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

export const MIME_TYPES = {
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

export const VISUAL_RUNTIME_ASSET_EXTENSIONS = new Set([
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
