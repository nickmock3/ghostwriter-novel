// Adapted from ChatGPT Plan Playground (MIT); see LICENSE.
export type ErrorCode =
  | "not_signed_in"
  | "token_expired"
  | "refresh_not_ready"
  | "refresh_schedule"
  | "refresh_uncertain"
  | "missing_scope"
  | "ineligible"
  | "usage_limit"
  | "service_unavailable"
  | "unsupported_request"
  | "incomplete"
  | "disconnected"
  | "step_limit"
  | "invalid_model"
  | "tool_failed"
  | "cancelled"
  | "timeout"
  | "denied"
  | "invalid_callback"
  | "invalid_identity"
  | "invalid_response"
  | "network"
  | "invalid_grant"
  | "authorization_failed"
  | "storage"
  | "busy"
  | "unsafe_storage"
  | "account_not_found"
  | "account_changed"
  | "unsupported_platform";

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ErrorCode };

export const success = <T>(value: T): Result<T> => ({ ok: true, value });
export const failure = (error: ErrorCode): Result<never> => ({
  ok: false,
  error,
});

// I/O境界でのみ使用。第三者例外のmessage/causeは保持しない。
export class BoundaryError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = "BoundaryError";
  }
}

export const safely = async <T>(
  action: () => Promise<T>,
  fallback: ErrorCode,
): Promise<Result<T>> => {
  try {
    return success(await action());
  } catch (error: unknown) {
    return failure(error instanceof BoundaryError ? error.code : fallback);
  }
};
