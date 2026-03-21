// @ts-nocheck
import { DEFAULT_PROVIDER, DEFAULT_RUN_MODE } from "../shared/constants.js";
import { analyzePosts } from "./analyzer.js";
import { buildHomePanel } from "./home-panel.js";

export async function runSyncWorkflow(filePaths, options = {}) {
  const postResults = await analyzePosts(filePaths, {
    runMode: options.runMode ?? DEFAULT_RUN_MODE,
    provider: options.provider ?? DEFAULT_PROVIDER,
    applyFixes: options.applyFixes !== false,
    allowUnsafeFixes: options.allowUnsafeFixes === true,
    generateFrontmatter: options.generateFrontmatter !== false,
    frontmatterHintText: options.frontmatterHintText ?? "",
    writeMarkdown: options.writeMarkdown !== false,
    model: options.model,
    force: options.force === true,
    updateMemory: options.updateMemory !== false,
  });

  const homePanelResult =
    options.buildHomePanel === false
      ? null
      : await buildHomePanel({
          provider: options.provider ?? DEFAULT_PROVIDER,
          model: options.model,
          force: options.force === true,
        });

  return {
    postResults,
    homePanelResult,
  };
}
