// @ts-nocheck
import { createGeminiProvider } from "./gemini.js";
import { createHeuristicProvider } from "./heuristic.js";

export function createProvider(options = {}) {
  const preferred = options.provider ?? "auto";
  const notes = [];

  if (preferred === "heuristic") {
    return {
      provider: createHeuristicProvider(),
      notes,
    };
  }

  const geminiProvider = createGeminiProvider({
    model: options.model,
    apiKey: options.apiKey,
  });

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
    provider: createHeuristicProvider(),
    notes,
  };
}
