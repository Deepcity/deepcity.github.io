// @ts-nocheck
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { BLOG_ROOT, REPO_ROOT } from "./constants.js";
import { fileExists } from "./fs.js";

const execFileAsync = promisify(execFile);

async function runGit(args) {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd: REPO_ROOT,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

export async function getChangedPostPaths() {
  const repoBlogPath = path
    .relative(REPO_ROOT, BLOG_ROOT)
    .split(path.sep)
    .join("/");
  const outputs = await Promise.all([
    runGit(["diff", "--name-only", "--diff-filter=ACMRT", "--", repoBlogPath]),
    runGit([
      "diff",
      "--cached",
      "--name-only",
      "--diff-filter=ACMRT",
      "--",
      repoBlogPath,
    ]),
    runGit(["ls-files", "--others", "--exclude-standard", "--", repoBlogPath]),
  ]);
  const results = new Set();

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
