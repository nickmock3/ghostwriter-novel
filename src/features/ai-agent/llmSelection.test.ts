import { expect, it } from "vitest";
import { isLlmSecretProviderId } from "./llmSelection";

it("narrows known LLM secret provider ids without casting", () => {
  expect(isLlmSecretProviderId("openai")).toBe(true);
  expect(isLlmSecretProviderId("anthropic")).toBe(true);
  expect(isLlmSecretProviderId("unknown-provider")).toBe(false);
});
