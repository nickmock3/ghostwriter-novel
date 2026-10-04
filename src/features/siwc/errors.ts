// Adapted from ChatGPT Plan Playground (MIT); see LICENSE.
import { z } from "zod";
import type { ErrorCode } from "./result";

const errorSchema = z.object({
  error: z.object({ code: z.string().nullish() }).nullish(),
});
export const responseError = (body: unknown, status?: number): ErrorCode => {
  const parsed = errorSchema.safeParse(body);
  const code = parsed.success ? parsed.data.error?.code : undefined;
  switch (code) {
    case "subscription_sharing_usage_limit_exceeded":
      return "usage_limit";
    case "subscription_sharing_user_not_eligible":
      return "ineligible";
    case "subscription_sharing_usage_unavailable":
    case "subscription_sharing_user_unavailable":
      return "service_unavailable";
    case "subscription_sharing_unsupported_capability":
    case "subscription_sharing_route_not_supported":
      return "unsupported_request";
    case "subscription_sharing_invalid_user":
    case "invalid_token":
    case "token_expired":
      return "token_expired";
    case "chatpass_v2_scope_not_authorized":
    case "chatpass_v2_invalid_authorization_context":
      return "missing_scope";
  }
  if (status === 401) return "authorization_failed";
  if (status === 403) return "denied";
  if (status === 429) return "usage_limit";
  if (status !== undefined && status >= 500) return "service_unavailable";
  if (status === 400 || status === 404) return "unsupported_request";
  return "network";
};
