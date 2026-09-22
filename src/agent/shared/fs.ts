import fs from "node:fs/promises";
import path from "node:path";

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function readText(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

export async function readJsonIfExists<T = unknown>(
  filePath: string,
  fallback: T | null = null
): Promise<T | null> {
  if (!(await fileExists(filePath))) {
    return fallback;
  }

  const content = await readText(filePath);
  return JSON.parse(content) as T;
}

export async function writeJson(
  filePath: string,
  data: unknown
): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function stripKeys(value: unknown, ignoreKeys: Set<string>): unknown {
  if (Array.isArray(value)) {
    return value.map(item => stripKeys(item, ignoreKeys));
  }

  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};

    for (const [key, item] of Object.entries(value)) {
      if (!ignoreKeys.has(key)) {
        next[key] = stripKeys(item, ignoreKeys);
      }
    }

    return next;
  }

  return value;
}

// Writes only when the payload differs from what is on disk, ignoring
// timestamp-like keys. Keeps memory/knowledge files from churning in git
// on every run. Returns true when a write happened.
export async function writeJsonIfChanged(
  filePath: string,
  data: unknown,
  options: { ignoreKeys?: string[] } = {}
): Promise<boolean> {
  const ignoreKeys = new Set(
    options.ignoreKeys ?? ["updated_at", "generated_at"]
  );
  const current = await readJsonIfExists<unknown>(filePath);

  if (
    current &&
    JSON.stringify(stripKeys(current, ignoreKeys)) ===
      JSON.stringify(stripKeys(data, ignoreKeys))
  ) {
    return false;
  }

  await writeJson(filePath, data);
  return true;
}

export async function listFiles(
  rootPath: string,
  extension: string
): Promise<string[]> {
  const results: string[] = [];

  if (!(await fileExists(rootPath))) {
    return results;
  }

  async function walk(currentPath: string): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(extension)) {
        results.push(entryPath);
      }
    }
  }

  await walk(rootPath);

  return results.sort((left, right) => left.localeCompare(right));
}

export async function listMarkdownFiles(rootPath: string): Promise<string[]> {
  return listFiles(rootPath, ".md");
}

export async function listJsonFiles(rootPath: string): Promise<string[]> {
  return listFiles(rootPath, ".json");
}
