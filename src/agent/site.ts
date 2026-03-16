// @ts-nocheck
import { readJsonIfExists } from "./fs.js";
import { getSidecarPathForPost, resolveRepoPath } from "./pathing.js";

export async function loadPostAgentSidecar(filePath) {
  if (!filePath) {
    return null;
  }

  const absolutePath = resolveRepoPath(filePath);
  return readJsonIfExists(getSidecarPathForPost(absolutePath));
}

export const loadAgentSidecar = loadPostAgentSidecar;
