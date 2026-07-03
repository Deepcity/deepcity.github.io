# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Astro 5-based personal blog (AstroPaper theme) focused on systems, algorithms, and AI infrastructure. Built with TypeScript, React 19, TailwindCSS v4. Includes a custom blog agent system for AI-powered content analysis and review panel generation.

## Commands

| Task | Command |
|------|---------|
| Dev server | `npm run dev` |
| Full build | `npm run build` |
| Lint | `npm run lint` |
| Format check | `npm run format:check` |
| Format fix | `npm run format` |
| Type check | `astro check` (also runs as part of build) |
| Agent tests | `npm run test:agent` |
| Agent smart workflow | `./agent <post\|--changed\|--all>` |
| Analyze posts | `./agent analyze <post\|--changed\|--all>` |
| Build review panels | `./agent build-panel <post\|--changed\|--all>` |
| Build home panel | `./agent build-home-panel` |
| Refresh knowledge map | `./agent refresh-knowledge` |
| Check knowledge overrides | `./agent check-knowledge` |
| Build all panels | `./agent --all --mode ci` |
| Refresh agent memory | `./agent refresh-memory` |

Build does: `astro check` → `astro build` → `pagefind --site dist` → copy pagefind to public/. Agent code compiles separately via `tsconfig.agent.json` into `.tmp/agent-build/`.

## Architecture

### Content Pipeline
- **Blog posts**: Markdown files in `src/data/blog/` with Zod-validated frontmatter (defined in `src/content.config.ts`)
- **Content Collections**: Astro's `getCollection("blog")` API, loaded via glob from `src/data/blog/`
- **Markdown processing**: remark (gfm, math, toc, collapse) → rehype (katex, image-attributes) → Shiki syntax highlighting
- **Dynamic OG images**: Generated at build time via Satori + ResvgJS when `dynamicOgImage` is true in `src/config.ts`
- **Search**: Pagefind static search, index built post-build and copied to `public/pagefind/`

### Agent System (`src/agent/`)
A standalone TypeScript system that analyzes blog posts and generates JSON sidecars displayed as review panels on the site.

- `site.ts` — Astro public API: loads sidecars at build time for `AgentPanel.astro` and `HomeAgentPanel.astro`
- `model-meta.ts` — barrel re-export for Astro components
- `core/` — business logic: orchestrators and skills
  - `analyzer.ts` — post analysis orchestrator (with hash-based skip)
  - `home-panel.ts` — home page panel orchestrator (with hash-based skip)
  - `checks.ts` — frontmatter and markdown validation rules
  - `frontmatter-generator.ts` — frontmatter auto-completion
- `providers/` — LLM interface layer
  - `index.ts` — provider factory (auto/gemini/heuristic)
  - `gemini.ts` — Google Gemini AI reviews (requires `GEMINI_API_KEY`)
  - `heuristic.ts` — rule-based fallback
- `memory/` — persistent JSON memory
  - `memory-store.ts` — 4 JSON store manager in `src/data/agent/memory/`
  - `default-global-rules.ts` — initial rules
- `parsers/` — input parsing (no side effects)
  - `frontmatter.ts`, `markdown.ts`, `schema.ts`, `post-snapshot.ts`
- `shared/` — utilities (no domain logic)
  - `constants.ts`, `pathing.ts`, `fs.ts`, `git.ts`, `utils.ts`, `model-meta.ts`
- CLI entry: `scripts/blog-agent.ts`, compiled via `tsconfig.agent.json`

Sidecar JSON output goes to `src/data/agent/posts/` and `src/data/agent/site/`. The lightweight knowledge map lives in `src/data/agent/knowledge/map.json`, with author-visible corrections in `src/data/agent/knowledge/overrides.yml`. Hash-based skip logic (`source_hash` / `posts_hash` / `knowledge_hash`) ensures unchanged posts are not re-analyzed during CI builds. Use `--force` to bypass.

### Key Directories
- `src/pages/` — Astro routes (index, posts/[...slug], tags/[tag], archives, search, rss)
- `src/components/` — Astro components (Header, Footer, AgentPanel, Card, etc.)
- `src/layouts/` — Layout.astro (base), PostDetails.astro (blog posts), AboutLayout.astro
- `src/utils/` — Post sorting, tag extraction, OG generation, slugify
- `src/styles/` — global.css (CSS variables, theme), typography.css (.app-prose rules)
- `src/config.ts` — site-wide settings (title, author, locale zh-CN, timezone Asia/Shanghai)

### Path Alias
`@/*` maps to `./src/*` (configured in tsconfig.json).

## Conventions

- **Commits**: Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`)
- **Formatting**: Prettier with 2-space indent, double quotes, trailing commas (ES5); plugins for Astro and Tailwind
- **Components**: PascalCase `.astro` files; camelCase for functions/variables
- **Blog filenames**: kebab-case English (e.g., `CMU-15213-BombLab.md`)
- **Headings in posts**: H1 is auto-generated from title; content starts at H2, no level skips
- **Code blocks**: must include language identifier
- **Math**: KaTeX via `$...$` (inline) and `$$...$$` (block)
- **Do not edit** `.tmp/agent-build/` — edit source `.ts` files instead

## CI/CD

- **ci.yml** (PRs): lint, format check, astro check, full build, unified agent workflow for changed posts
- **deploy.yml** (main push): unified agent workflow for all posts → Astro build → deploy to GitHub Pages
- Node 20, pnpm

## Environment Variables

- `GEMINI_API_KEY` — optional, enables AI-powered agent reviews (falls back to heuristic)
- `PUBLIC_GOOGLE_SITE_VERIFICATION` — optional, Google Search Console
