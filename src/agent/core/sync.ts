import { DEFAULT_PROVIDER, DEFAULT_RUN_MODE } from "../shared/constants.js";
import { analyzePosts } from "./analyzer.js";
import { buildHomePanel } from "./home-panel.js";
import { refreshKnowledgeMap, verifyKnowledgeMap } from "./knowledge.js";
import type {
  HomePanelResult,
  KnowledgeRefreshResult,
  SyncOptions,
  SyncResult,
} from "../types.js";

async function resolveKnowledge(
  options: SyncOptions
): Promise<KnowledgeRefreshResult | null> {
  if (options.refreshKnowledge === false) {
    return null;
  }

  if (options.regenerate === false) {
    return verifyKnowledgeMap({ postPaths: options.knowledgePostPaths });
  }

  return refreshKnowledgeMap({ postPaths: options.knowledgePostPaths });
}

export async function runSyncWorkflow(
  filePaths: string[],
  options: SyncOptions = {}
): Promise<SyncResult> {
  const readOnly = options.regenerate === false;
  const knowledgeResult = await resolveKnowledge(options);
  const postResults = await analyzePosts(filePaths, {
    runMode: options.runMode ?? DEFAULT_RUN_MODE,
    provider: options.provider ?? DEFAULT_PROVIDER,
    applyFixes: !readOnly && options.applyFixes !== false,
    allowUnsafeFixes: !readOnly && options.allowUnsafeFixes === true,
    generateFrontmatter: !readOnly && options.generateFrontmatter !== false,
    frontmatterHintText: options.frontmatterHintText ?? "",
    writeMarkdown: !readOnly && options.writeMarkdown !== false,
    model: options.model,
    force: !readOnly && options.force === true,
    updateMemory: !readOnly && options.updateMemory !== false,
    regenerate: !readOnly,
    concurrency: options.concurrency,
    knowledgeMap: knowledgeResult?.map ?? options.knowledgeMap,
  });

  const homePanelResult = (
    options.buildHomePanel === false
      ? null
      : await buildHomePanel({
          provider: options.provider ?? DEFAULT_PROVIDER,
          model: options.model,
          force: !readOnly && options.force === true,
          regenerate: !readOnly,
        })
  ) as HomePanelResult | null;

  return {
    postResults,
    homePanelResult,
    knowledgeResult,
  };
}
