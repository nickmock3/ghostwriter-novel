// Adapted from ChatGPT Plan Playground (MIT); see LICENSE.
import { z } from "zod";
import type { Account } from "./credentials";
import type { Fetch } from "./oidc";
import { BoundaryError, failure, safely } from "./result";
import { requireSession } from "./access";
import { responseError } from "./errors";

const modelSchema = z.object({
  slug: z.string().min(1),
  display_name: z.string().min(1),
  visibility: z.string(),
});
export type Model = Readonly<{ slug: string; displayName: string }>;
export const listModels = (
  account: Account,
  fetcher: Fetch,
  signal: AbortSignal,
  now = Date.now(),
) =>
  safely(
    async (): Promise<Model[]> => {
      const session = requireSession(account, now);
      if (signal.aborted) throw new BoundaryError("cancelled");
      const response = await fetcher("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { authorization: `Bearer ${session.accessToken}` },
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (!response.ok)
        throw new BoundaryError(responseError(body, response.status));
      const parsed = z
        .object({
          models: z.array(
            z.object({ visibility: z.string() }).catchall(z.unknown()),
          ),
        })
        .safeParse(body);
      if (!parsed.success) throw new BoundaryError("invalid_response");
      const listed = z
        .array(modelSchema)
        .safeParse(
          parsed.data.models.filter((model) => model.visibility === "list"),
        );
      if (!listed.success) throw new BoundaryError("invalid_response");
      return listed.data.map((model) => ({
        slug: model.slug,
        displayName: model.display_name,
      }));
    },
    signal.aborted ? "cancelled" : "network",
  ).then((result) => (signal.aborted ? failure("cancelled") : result));
