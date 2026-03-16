export type AgentModelBrand =
  | "chatgpt"
  | "grok"
  | "gemini"
  | "claude"
  | "qwen"
  | "heuristic"
  | "unknown";

type AgentModelMeta = {
  brand: AgentModelBrand;
  brandLabel: string;
  providerLabel: string;
  modelLabel: string | null;
  isLlm: boolean;
  summary: string;
};

function normalize(value?: string | null) {
  return String(value ?? "").trim();
}

export function inferAgentModelMeta(
  provider?: string | null,
  model?: string | null
): AgentModelMeta {
  const providerValue = normalize(provider);
  const modelValue = normalize(model);
  const haystack = `${providerValue} ${modelValue}`.toLowerCase();

  if (!haystack) {
    return {
      brand: "unknown",
      brandLabel: "Unknown",
      providerLabel: "Unknown provider",
      modelLabel: null,
      isLlm: false,
      summary: "当前 sidecar 没有记录可识别的模型来源。",
    };
  }

  if (/(heuristic|memory-refresh|rule[- ]?engine)/u.test(haystack)) {
    return {
      brand: "heuristic",
      brandLabel: "Heuristic",
      providerLabel: "Local heuristic",
      modelLabel: modelValue || "heuristic-v1",
      isLlm: false,
      summary: "当前点评来自站点内置规则引擎，没有调用外部 LLM。",
    };
  }

  if (
    /(chatgpt|openai|\bgpt[-\s]?\d|\bgpt\d|\bo[134]\b|\bo[134]-)/u.test(
      haystack
    )
  ) {
    return {
      brand: "chatgpt",
      brandLabel: "ChatGPT",
      providerLabel: "OpenAI",
      modelLabel: modelValue || providerValue || null,
      isLlm: true,
      summary: "本次点评由 OpenAI 系列模型生成。",
    };
  }

  if (/(grok|xai|x\.ai)/u.test(haystack)) {
    return {
      brand: "grok",
      brandLabel: "Grok",
      providerLabel: "xAI",
      modelLabel: modelValue || providerValue || null,
      isLlm: true,
      summary: "本次点评由 xAI 的 Grok 系列模型生成。",
    };
  }

  if (/(gemini|google)/u.test(haystack)) {
    return {
      brand: "gemini",
      brandLabel: "Gemini",
      providerLabel: "Google",
      modelLabel: modelValue || providerValue || null,
      isLlm: true,
      summary: "本次点评由 Google Gemini 系列模型生成。",
    };
  }

  if (/(claude|anthropic)/u.test(haystack)) {
    return {
      brand: "claude",
      brandLabel: "Claude",
      providerLabel: "Anthropic",
      modelLabel: modelValue || providerValue || null,
      isLlm: true,
      summary: "本次点评由 Anthropic Claude 系列模型生成。",
    };
  }

  if (/(qwen|tongyi|aliyun|alibaba)/u.test(haystack)) {
    return {
      brand: "qwen",
      brandLabel: "Qwen",
      providerLabel: "Alibaba Cloud",
      modelLabel: modelValue || providerValue || null,
      isLlm: true,
      summary: "本次点评由阿里云 Qwen 系列模型生成。",
    };
  }

  return {
    brand: "unknown",
    brandLabel: providerValue || "Unknown",
    providerLabel: providerValue || "Unknown provider",
    modelLabel: modelValue || null,
    isLlm: false,
    summary: "sidecar 已记录 provider/model，但当前 UI 还无法映射到已知品牌。",
  };
}
