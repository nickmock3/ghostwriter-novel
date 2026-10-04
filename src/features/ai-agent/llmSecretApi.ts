import { z } from "zod";
import {
  createLlmSecretStore,
  type LlmSecretProviderId,
  type LlmSecretStore,
} from "./llmSecretStore";

export type LlmSecretApiOptions = {
  secretStore?: LlmSecretStore;
};

const providerIds = ["anthropic", "deepseek", "gemini", "openai"] as const;

const providerIdSchema = z.enum(providerIds);

const putSecretBodySchema = z.object({
  apiKey: z.string().refine((value) => value.trim().length > 0, {
    message: "API key is required",
  }),
});

function jsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, { status });
}

function requestMessage(error: unknown, fallbackMessage: string): string {
  return error instanceof Error ? error.message : fallbackMessage;
}

function isEnvironmentConfiguredError(error: unknown): boolean {
  return error instanceof Error && /environment variable/i.test(error.message);
}

function parseProviderId(request: Request): LlmSecretProviderId | null {
  const url = new URL(request.url);
  const providerId = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
  const parsedProviderId = providerIdSchema.safeParse(providerId);

  return parsedProviderId.success ? parsedProviderId.data : null;
}

export function createLlmSecretApiHandler(options: LlmSecretApiOptions = {}) {
  const secretStore = options.secretStore ?? createLlmSecretStore();

  return async function llmSecretApiHandler(request: Request): Promise<Response> {
    if (request.method === "GET") {
      return jsonResponse(
        {
          providers: await Promise.all(
            providerIds.map(async (providerId) => {
              return secretStore.getStatus(providerId);
            }),
          ),
        },
        200,
      );
    }

    if (request.method === "PUT") {
      const providerId = parseProviderId(request);
      if (!providerId) {
        return jsonResponse({ message: "Invalid LLM provider" }, 400);
      }

      let parsedBody: ReturnType<typeof putSecretBodySchema.safeParse>;
      try {
        parsedBody = putSecretBodySchema.safeParse(await request.json());
      } catch {
        return jsonResponse({ message: "Invalid LLM secret request" }, 400);
      }

      if (!parsedBody.success) {
        return jsonResponse({ message: "Invalid LLM secret request" }, 400);
      }

      try {
        await secretStore.setApiKey(providerId, parsedBody.data.apiKey);
        return jsonResponse({ provider: await secretStore.getStatus(providerId) }, 200);
      } catch (error) {
        return jsonResponse(
          { message: requestMessage(error, "LLM secret update failed") },
          isEnvironmentConfiguredError(error) ? 409 : 400,
        );
      }
    }

    if (request.method === "DELETE") {
      const providerId = parseProviderId(request);
      if (!providerId) {
        return jsonResponse({ message: "Invalid LLM provider" }, 400);
      }

      try {
        await secretStore.deleteApiKey(providerId);
        return jsonResponse({ provider: await secretStore.getStatus(providerId) }, 200);
      } catch (error) {
        return jsonResponse(
          { message: requestMessage(error, "LLM secret delete failed") },
          isEnvironmentConfiguredError(error) ? 409 : 400,
        );
      }
    }

    return jsonResponse({ message: "Method not allowed" }, 405);
  };
}
