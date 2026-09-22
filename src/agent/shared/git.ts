import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { BLOG_ROOT, REPO_ROOT } from "./constants.js";
import { fileExists } from "./fs.js";

const execFileAsync = promisify(execFile);

async function runGit(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: REPO_ROOT,
    });
    return stdout.trim();
  } catch (error) {
    const detail = String(
      (error as { stderr?: string; message?: string })?.stderr ??
        (error as { message?: string })?.message ??
        error
    ).trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

function repoBlogPath(): string {
  return path.relative(REPO_ROOT, BLOG_ROOT).split(path.sep).join("/");
}

async function collectExistingMarkdown(outputs: string[]): Promise<string[]> {
  const results = new Set<string>();

  for (const output of outputs) {
    for (const line of output.split("\n")) {
      const trimmed = line.trim();

      if (!trimmed || !trimmed.endsWith(".md")) {
        continue;
      }

      const absolutePath = path.join(REPO_ROOT, trimmed);

      if (await fileExists(absolutePath)) {
        results.add(absolutePath);
      }
    }
  }

  return [...results].sort((left, right) => left.localeCompare(right));
}

// Without `base`: working-tree changes (unstaged + staged + untracked), which
// is what a local author wants. With `base` (CI on a PR): everything that
// differs from the base ref, since a fresh checkout has no local changes.
export async function getChangedPostPaths(
  options: { base?: string | null } = {}
): Promise<string[]> {
  const blogPath = repoBlogPath();

  if (options.base) {
    const output = await runGit([
      "diff",
      "--name-only",
      "--diff-filter=ACMRT",
      `${options.base}...HEAD`,
      "--",
      blogPath,
    ]);

    return collectExistingMarkdown([output]);
  }

  const outputs = await Promise.all([
    runGit(["diff", "--name-only", "--diff-filter=ACMRT", "--", blogPath]),
    runGit([
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACMRT",
      "--",
      blogPath,
    ]),
    runGit(["ls-files", "--others", "--exclude-standard", "--", blogPath]),
  ]);

  return collectExistingMarkdown(outputs);
}
