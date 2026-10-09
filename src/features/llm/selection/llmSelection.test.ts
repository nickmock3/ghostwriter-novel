import { expect, it } from "vitest";
import { isLlmSecretProviderId, resolveModelSelection, type LlmProviderChoice } from "./llmSelection";

it("narrows known LLM secret provider ids without casting", () => {
  expect(isLlmSecretProviderId("openai")).toBe(true);
  expect(isLlmSecretProviderId("anthropic")).toBe(true);
  expect(isLlmSecretProviderId("unknown-provider")).toBe(false);
});

const providers: LlmProviderChoice[] = [
  {
    id: "openai", displayName: "OpenAI",
    models: [{ id: "disabled", displayName: "Disabled", available: false, supportsTools: true }],
  },
  {
    id: "deepseek", displayName: "DeepSeek",
    models: [{ id: "available", displayName: "Available", available: true, supportsTools: true }],
  },
];

it("fills missing selection with the first available model across providers", () => {
  expect(resolveModelSelection(null, providers)).toEqual({ providerId: "deepseek", modelId: "available" });
});

it("keeps selection empty when no model is available", () => {
  expect(resolveModelSelection(null, [])).toBeNull();
  expect(resolveModelSelection(null, providers.slice(0, 1))).toBeNull();
});

it("preserves explicit selection even when unavailable or absent from the catalog", () => {
  const selected = { providerId: "openai", modelId: "disabled" };
  expect(resolveModelSelection(selected, providers)).toEqual(selected);
  expect(resolveModelSelection(selected, [])).toEqual(selected);
});
