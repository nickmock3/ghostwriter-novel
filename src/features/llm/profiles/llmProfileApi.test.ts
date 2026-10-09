import { describe, expect, it } from "vitest";
import { createLlmProfileApiHandler } from "./llmProfileApi";
import { createLlmSecretStore, type SystemCredentialAdapter } from "../secrets/llmSecretStore";

function memoryAdapter(initial: Record<string, string> = {}): SystemCredentialAdapter {
  const values = new Map(Object.entries(initial));

  return {
    async deletePassword(_service, account) {
      values.delete(account);
    },
    async getPassword(_service, account) {
      return values.get(account) ?? null;
    },
    async setPassword(_service, account, password) {
      values.set(account, password);
    },
  };
}

describe("LLM profile API", () => {
  it("uses a system secret to make profiles available without exposing the API key", async () => {
    const response = await createLlmProfileApiHandler({
      config: {
        defaultProviderId: "openai",
        providers: { anthropic: {}, deepseek: {}, gemini: {}, openai: {} },
      },
      secretStore: createLlmSecretStore({
        adapter: memoryAdapter({ "ghostwriter/openai": "openai-system-secret" }),
        env: {},
      }),
    })(new Request("http://localhost/api/llm/profiles"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.profiles.find((profile: { id: string }) => profile.id === "builtin:openai:main"))
      .toMatchObject({ available: true });
    expect(body.roleAssignments.main).toEqual({
      kind: "profile",
      profileId: "builtin:openai:main",
    });
    expect(JSON.stringify(body)).not.toContain("openai-system-secret");
  });
});
