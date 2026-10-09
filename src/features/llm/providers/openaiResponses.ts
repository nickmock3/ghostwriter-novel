import { createOpenAI } from "@ai-sdk/openai";

// Authentication and request validation belong to the caller's connection boundary.
export function createOpenAIResponsesProvider(options: {
  apiKey: string;
  baseURL: string;
  fetch: typeof globalThis.fetch;
}) {
  return createOpenAI(options);
}
