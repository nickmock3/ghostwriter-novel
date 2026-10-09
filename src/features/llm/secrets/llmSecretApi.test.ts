import { describe, expect, it } from "vitest";
import { createLlmSecretApiHandler } from "./llmSecretApi";
import { createLlmSecretStore, type SystemCredentialAdapter } from "./llmSecretStore";

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

describe("LLM secret API", () => {
  it("returns provider statuses without API key bodies", async () => {
    const handler = createLlmSecretApiHandler({
      secretStore: createLlmSecretStore({
        adapter: memoryAdapter({ "ghostwriter/deepseek": "deepseek-system-secret" }),
        env: { OPENAI_API_KEY: "openai-env-secret" },
      }),
    });

    const response = await handler(new Request("http://localhost/api/llm/secrets"));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      providers: [
        {
          canDelete: false,
          canUpdate: true,
          isConfigured: false,
          providerId: "anthropic",
          source: "missing",
        },
        {
          canDelete: true,
          canUpdate: true,
          isConfigured: true,
          maskedSuffix: "cret",
          providerId: "deepseek",
          source: "system",
        },
        {
          canDelete: false,
          canUpdate: true,
          isConfigured: false,
          providerId: "gemini",
          source: "missing",
        },
        {
          canDelete: false,
          canUpdate: false,
          isConfigured: true,
          maskedSuffix: "cret",
          providerId: "openai",
          source: "env",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("deepseek-system-secret");
    expect(JSON.stringify(body)).not.toContain("openai-env-secret");
  });

  it("validates provider IDs and non-empty API key input before saving", async () => {
    const handler = createLlmSecretApiHandler({
      secretStore: createLlmSecretStore({ adapter: memoryAdapter(), env: {} }),
    });

    const unknownProviderResponse = await handler(
      new Request("http://localhost/api/llm/secrets/unknown", {
        body: JSON.stringify({ apiKey: "secret" }),
        method: "PUT",
      }),
    );
    const emptyKeyResponse = await handler(
      new Request("http://localhost/api/llm/secrets/openai", {
        body: JSON.stringify({ apiKey: "" }),
        method: "PUT",
      }),
    );

    expect(unknownProviderResponse.status).toBe(400);
    expect(emptyKeyResponse.status).toBe(400);
  });

  it("saves and deletes system credentials while returning status only", async () => {
    const handler = createLlmSecretApiHandler({
      secretStore: createLlmSecretStore({ adapter: memoryAdapter(), env: {} }),
    });

    const putResponse = await handler(
      new Request("http://localhost/api/llm/secrets/openai", {
        body: JSON.stringify({ apiKey: "openai-system-secret" }),
        method: "PUT",
      }),
    );
    const putBody = await putResponse.json();

    expect(putResponse.status).toBe(200);
    expect(putBody).toEqual({
      provider: {
        canDelete: true,
        canUpdate: true,
        isConfigured: true,
        maskedSuffix: "cret",
        providerId: "openai",
        source: "system",
      },
    });
    expect(JSON.stringify(putBody)).not.toContain("openai-system-secret");

    const deleteResponse = await handler(
      new Request("http://localhost/api/llm/secrets/openai", { method: "DELETE" }),
    );

    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toEqual({
      provider: {
        canDelete: false,
        canUpdate: true,
        isConfigured: false,
        providerId: "openai",
        source: "missing",
      },
    });
  });

  it("accepts Anthropic API key updates and deletes", async () => {
    const handler = createLlmSecretApiHandler({
      secretStore: createLlmSecretStore({ adapter: memoryAdapter(), env: {} }),
    });

    const putResponse = await handler(
      new Request("http://localhost/api/llm/secrets/anthropic", {
        body: JSON.stringify({ apiKey: "anthropic-system-secret" }),
        method: "PUT",
      }),
    );

    expect(putResponse.status).toBe(200);
    await expect(putResponse.json()).resolves.toEqual({
      provider: {
        canDelete: true,
        canUpdate: true,
        isConfigured: true,
        maskedSuffix: "cret",
        providerId: "anthropic",
        source: "system",
      },
    });

    const deleteResponse = await handler(
      new Request("http://localhost/api/llm/secrets/anthropic", { method: "DELETE" }),
    );

    expect(deleteResponse.status).toBe(200);
  });

  it("rejects overwriting or deleting env configured keys", async () => {
    const handler = createLlmSecretApiHandler({
      secretStore: createLlmSecretStore({
        adapter: memoryAdapter(),
        env: { OPENAI_API_KEY: "openai-env-secret" },
      }),
    });

    const putResponse = await handler(
      new Request("http://localhost/api/llm/secrets/openai", {
        body: JSON.stringify({ apiKey: "openai-system-secret" }),
        method: "PUT",
      }),
    );
    const deleteResponse = await handler(
      new Request("http://localhost/api/llm/secrets/openai", { method: "DELETE" }),
    );

    expect(putResponse.status).toBe(409);
    expect(deleteResponse.status).toBe(409);
    expect(JSON.stringify(await putResponse.json())).not.toContain("openai-env-secret");
  });
});
