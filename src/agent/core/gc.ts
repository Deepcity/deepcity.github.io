import fs from "node:fs/promises";
import { REPO_ROOT, SIDECAR_ROOT } from "../shared/constants.js";
import { listJsonFiles } from "../shared/fs.js";
import { MemoryStore } from "../memory/memory-store.js";
import {
  getPostIdFromFilePath,
  getSidecarPathForPost,
} from "../shared/pathing.js";
import { repoRelative } from "../shared/utils.js";
import type { GcResult } from "../types.js";

// Sidecars whose post no longer exists (deleted or renamed — including a
// case-only rename, which on Linux leaves the old sidecar behind).
export async function collectOrphanSidecars(
  postPaths: string[]
): Promise<string[]> {
  const expected = new Set(postPaths.map(getSidecarPathForPost));
  const existing = await listJsonFiles(SIDECAR_ROOT);

  return existing.filter(sidecarPath => !expected.has(sidecarPath));
}

// Requires the *full* post list (i.e. an `--all` run); with a partial list
// every other post would look orphaned.
export async function pruneOrphans(
  postPaths: string[],
  options: { dryRun?: boolean; memoryStore?: MemoryStore } = {}
): Promise<GcResult> {
  const dryRun = options.dryRun === true;
  const memoryStore = options.memoryStore ?? new MemoryStore();
  const orphanSidecars = await collectOrphanSidecars(postPaths);
  const knownPostIds = postPaths.map(getPostIdFromFilePath);

  if (!dryRun) {
    for (const sidecarPath of orphanSidecars) {
      await fs.rm(sidecarPath, { force: true });
    }
  }

  const memoryRemoved = (
    dryRun
      ? await memoryStore.findMissingPosts(knownPostIds)
      : await memoryStore.pruneMissingPosts(knownPostIds)
  ) as string[];

  return {
    dry_run: dryRun,
    orphan_sidecars: orphanSidecars.map(sidecarPath =>
      repoRelative(sidecarPath, REPO_ROOT)
    ),
    memory_removed_post_ids: memoryRemoved,
  };
}
