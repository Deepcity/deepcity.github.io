# Repository Guidelines

## Project Structure & Module Organization

This repository is an Astro-based blog. Main app code lives in [`src`](/home/deepc/deepcity.github.io/src): pages in `src/pages`, shared UI in `src/components`, layouts in `src/layouts`, styles in `src/styles`, and utilities in `src/utils`. Blog posts are Markdown files in `src/data/blog`. The static Blog Agent system lives in `src/agent` with its CLI entry at `scripts/blog-agent.ts`. Generated agent sidecars and memory are stored in `src/data/agent`. Tests currently live in `tests`, and design/feature docs belong in `docs`.

## Build, Test, and Development Commands

- `npm run dev`: start the local Astro dev server.
- `npm run build`: run `astro check`, build the site, and generate Pagefind search output.
- `npm run lint`: run ESLint across source files.
- `npm run format:check`: verify Prettier formatting.
- `npm run format`: apply Prettier formatting.
- `npm run test:agent`: compile Agent TypeScript and run the Node test suite.
- `npm run agent:analyze -- <post|--changed|--all>`: run blog checks and review generation.
- `npm run agent:build-panel -- <post|--changed|--all>`: regenerate sidecar review panels without editing Markdown.

## Coding Style & Naming Conventions

Use TypeScript/ESM for repository scripts and agent code. Follow the existing 2-space indentation and keep imports explicit and local. Use `PascalCase` for Astro components, `camelCase` for functions/variables, and kebab-case for Markdown filenames such as `AscendC-part2-tiling-and-debug.md`. Run Prettier before submitting changes. Do not edit generated output in `.tmp/agent-build`; edit the source `.ts` files instead.

## Testing Guidelines

Agent tests use the built-in Node test runner. Add new tests as `*.test.ts` under `tests`. For Agent changes, run `npm run test:agent`, `npm run lint`, and preferably `npm run build`. If you change blog parsing, sidecar generation, or page integration, include at least one regression test or clearly explain why a test was not added.

## Commit & Pull Request Guidelines

Recent history favors short, imperative commit messages, usually with Conventional Commit prefixes such as `feat:` and `fix:`. Prefer messages like `feat: add series memory refresh` or `fix: handle missing sidecar`. PRs should include a concise description, selected change type, linked issue when applicable, and screenshots for visible UI changes. Mention any generated files updated in `src/data/agent`.

## Security & Configuration Tips

Do not commit secrets. If using Gemini-backed review generation, provide `GEMINI_API_KEY` via environment variables only. Keep visitor-facing pages static; the site reads committed sidecar JSON and should not expose API keys client-side.
