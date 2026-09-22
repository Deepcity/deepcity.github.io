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
| Build all panels (local, writes sidecars) | `./agent --all` |
| Verify committed sidecars (read-only, no LLM) | `./agent --all --mode ci [--strict]` |
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
  - `frontmatter-generator.ts` — frontmatter auto-completion (rule-based)
  - `frontmatter-assist.ts` — LLM-generated `description`/`tags` from the full body; only runs when those fields are missing or placeholder, and explicit `--hint` values always win
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
- `types.ts` — shared contract types (sidecars, review, memory, checks). `RawJson` marks genuine untyped boundaries (LLM responses, legacy files, YAML).
- `core/visual-check.ts` — `./agent visual-check` orchestrator; sequences five phases implemented under `core/visual/`: `run-context` → `capture` → `review` → `fixes` → `manifest`/`report`, supported by `constants`, `shared`, `types`, `routes`, `server`, `build`, `cache`, `findings`. `capture.ts` carries a file-scoped `/// <reference lib="dom" />` because its `page.evaluate` callbacks run in the browser.
- CLI entry: `scripts/blog-agent.ts`, compiled via `tsconfig.agent.json`

Sidecar JSON output goes to `src/data/agent/posts/` and `src/data/agent/site/`. The lightweight knowledge map lives in `src/data/agent/knowledge/map.json`, with author-visible corrections in `src/data/agent/knowledge/overrides.yml`.

**Sidecars are committed artifacts generated locally.** CI (`--mode ci`) is read-only: it never writes files or calls an LLM, only reports `stale` / `missing` sidecars (`--strict` turns that into a failure). Each sidecar stores `review_key = sha256(source_hash, provider, model, prompt_version)`; a post is re-reviewed when any of those change or when the previous result was `degraded`. Bump `REVIEW_PROMPT_VERSION` in `providers/gemini.ts` whenever the prompt/schema changes. Knowledge-map-only changes patch `related_posts` / `knowledge_position` in place without an LLM call. Use `--force` to bypass all skipping.

Local secrets go in `.env` (git-ignored); the `./agent` wrapper loads it. See `docs/blog-agent/improvement-plan.md` for the current improvement roadmap.

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

- **ci.yml** (PRs): read-only agent verification of posts changed vs. base branch (`--mode ci --strict`, fails if a changed post lacks a fresh committed sidecar), lint, format check, astro check, full build
- **deploy.yml** (main push): read-only agent audit of all posts (report artifact only, non-blocking) → Astro build from committed sidecars → deploy to GitHub Pages. No `GEMINI_API_KEY` needed in CI.
- Node 20, pnpm

## Environment Variables

- `GEMINI_API_KEY` — optional, enables AI-powered agent reviews (falls back to heuristic)
- `PUBLIC_GOOGLE_SITE_VERIFICATION` — optional, Google Search Console
