import fs from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "../../shared/constants.js";
import { fileExists } from "../../shared/fs.js";
import { spawn } from "node:child_process";
import type { RawJson } from "../../types.js";
import type { VisualCheckOptions } from "./types.js";

function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string } = {}
): Promise<void> {
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

async function commandExists(command: string): Promise<boolean> {
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

async function resolveBuildCommand(): Promise<{
  command: string;
  args: string[];
  label: string;
}> {
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

async function clearAstroContentCache(): Promise<void> {
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

export async function maybeBuildSite(
  options: VisualCheckOptions = {}
): Promise<RawJson> {
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
