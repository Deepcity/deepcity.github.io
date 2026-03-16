// @ts-nocheck
import { readJsonIfExists } from "./fs.js";
import {
  getHomeSidecarPath,
  getSidecarPathForPost,
  resolveRepoPath,
} from "./pathing.js";

export async function loadPostAgentSidecar(filePath) {
  if (!filePath) {
    return null;
  }

  const absolutePath = resolveRepoPath(filePath);
  return readJsonIfExists(getSidecarPathForPost(absolutePath));
}

export const loadAgentSidecar = loadPostAgentSidecar;

export async function loadHomeAgentSidecar() {
  return readJsonIfExists(getHomeSidecarPath());
}
