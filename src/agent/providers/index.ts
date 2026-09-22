import { createGeminiProvider } from "./gemini.js";
import { createHeuristicProvider } from "./heuristic.js";
import type { RequestedProvider, ReviewProvider } from "../types.js";

export interface CreateProviderOptions {
  provider?: RequestedProvider;
  model?: string;
  apiKey?: string;
}

export interface CreatedProvider {
  provider: ReviewProvider;
  notes: string[];
}

export function createProvider(
  options: CreateProviderOptions = {}
): CreatedProvider {
  const preferred = options.provider ?? "auto";
  const notes: string[] = [];

  if (preferred === "heuristic") {
    return {
      provider: createHeuristicProvider() as ReviewProvider,
      notes,
    };
  }

  const geminiProvider = createGeminiProvider({
    model: options.model,
    apiKey: options.apiKey,
  }) as ReviewProvider;

  if (geminiProvider.available) {
    return {
      provider: geminiProvider,
      notes,
    };
  }

  notes.push(
    `Gemini unavailable (${geminiProvider.unavailable_reason}); falling back to heuristic review.`
  );

  return {
    provider: createHeuristicProvider() as ReviewProvider,
    notes,
  };
}
