import {
  APICallError,
  JSONParseError,
  NoObjectGeneratedError,
  TypeValidationError,
} from "ai";
import { z } from "zod";
import type { ResolvedLlmProfile } from "./llmProfiles";
import { tokenUsageFromUnknown } from "./agentTokenUsage";

export type DelegateWritingFailureClassification =
  | "empty_response"
  | "json_parse_failure"
  | "post_generate_validation_failure"
  | "provider_error"
  | "schema_validation_failure"
  | "unknown";

export type DelegateWritingDiagnosticCauseLink = {
  errorName: string;
  errorType: string;
};

export type DelegateWritingDiagnostic = {
  causeChain: DelegateWritingDiagnosticCauseLink[];
  classification: DelegateWritingFailureClassification;
  errorMessage: string;
  errorName: string;
  errorType: string;
  finishReason?: string;
  hasRawText: boolean;
  llmProfileId: string;
  llmProfileRole: "writing";
  modelId: string;
  providerId: string;
  providerResponse?: {
    isRetryable: boolean;
    statusCode?: number;
  };
  rawTextLength: number;
  responseMetadata?: {
    id: string;
    modelId: string;
    timestamp: string;
  };
  targetPath: string;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  type: "delegate-writing-error";
};

export type DelegateWritingDiagnosticObserver = (
  diagnostic: DelegateWritingDiagnostic,
) => void | Promise<void>;

const SAFE_ERROR_MESSAGES: Record<DelegateWritingFailureClassification, string> = {
  empty_response: "No object generated: the model did not return a response.",
  json_parse_failure: "No object generated: could not parse the response.",
  post_generate_validation_failure: "Writing delegation result did not match schema.",
  provider_error: "Provider request failed",
  schema_validation_failure: "No object generated: response did not match schema.",
  unknown: "Writing delegation failed",
};

const MAX_CAUSE_CHAIN_DEPTH = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}


function* walkErrorChain(error: unknown): Generator<unknown> {
  const visited = new Set<unknown>();
  let current: unknown = error;
  let depth = 0;

  while (current !== undefined && depth < MAX_CAUSE_CHAIN_DEPTH) {
    if (visited.has(current)) {
      break;
    }
    visited.add(current);
    yield current;
    depth += 1;
    current = isRecord(current) ? current.cause : undefined;
  }
}

function findAPICallErrorInChain(error: unknown): APICallError | undefined {
  for (const link of walkErrorChain(error)) {
    if (APICallError.isInstance(link)) {
      return link;
    }
  }
  return undefined;
}

function errorIdentity(error: unknown): DelegateWritingDiagnosticCauseLink | null {
  if (NoObjectGeneratedError.isInstance(error)) {
    return { errorName: "AI_NoObjectGeneratedError", errorType: "NoObjectGeneratedError" };
  }
  if (APICallError.isInstance(error)) {
    return { errorName: "AI_APICallError", errorType: "APICallError" };
  }
  if (JSONParseError.isInstance(error)) {
    return { errorName: "AI_JSONParseError", errorType: "JSONParseError" };
  }
  if (TypeValidationError.isInstance(error)) {
    return { errorName: "AI_TypeValidationError", errorType: "TypeValidationError" };
  }
  if (error instanceof z.ZodError) {
    return { errorName: "ZodError", errorType: "ZodError" };
  }
  return null;
}

function summarizeCauseChain(error: unknown): DelegateWritingDiagnosticCauseLink[] {
  const chain: DelegateWritingDiagnosticCauseLink[] = [];
  let isRoot = true;

  for (const link of walkErrorChain(error)) {
    if (isRoot) {
      isRoot = false;
      continue;
    }

    const identity = errorIdentity(link);
    if (identity) {
      chain.push(identity);
    }
  }

  return chain;
}

function classifyDelegateWritingFailure(error: unknown): DelegateWritingFailureClassification {
  if (error instanceof z.ZodError) {
    return "post_generate_validation_failure";
  }

  if (NoObjectGeneratedError.isInstance(error)) {
    if (JSONParseError.isInstance(error.cause)) {
      return "json_parse_failure";
    }
    if (TypeValidationError.isInstance(error.cause)) {
      return "schema_validation_failure";
    }
    if (error.message.includes("did not return a response")) {
      return "empty_response";
    }
    if (error.message.includes("could not parse the response")) {
      return "json_parse_failure";
    }
    if (error.message.includes("did not match schema")) {
      return "schema_validation_failure";
    }
    if (findAPICallErrorInChain(error)) {
      return "provider_error";
    }
    return "unknown";
  }

  if (findAPICallErrorInChain(error)) {
    return "provider_error";
  }

  return "unknown";
}

function rootErrorIdentity(error: unknown): DelegateWritingDiagnosticCauseLink {
  const identity = errorIdentity(error);
  if (identity) {
    return identity;
  }

  if (error instanceof Error) {
    return { errorName: "Error", errorType: "Error" };
  }

  return { errorName: "Unknown", errorType: "Unknown" };
}

function responseMetadataFromNoObjectError(
  error: NoObjectGeneratedError,
): DelegateWritingDiagnostic["responseMetadata"] | undefined {
  const response = error.response;
  if (
    !response ||
    typeof response.id !== "string" ||
    typeof response.modelId !== "string" ||
    !(response.timestamp instanceof Date) ||
    Number.isNaN(response.timestamp.getTime())
  ) {
    return undefined;
  }

  return {
    id: response.id,
    modelId: response.modelId,
    timestamp: response.timestamp.toISOString(),
  };
}

function providerResponseFromError(
  error: unknown,
): DelegateWritingDiagnostic["providerResponse"] | undefined {
  const apiCallError = findAPICallErrorInChain(error);
  if (!apiCallError) {
    return undefined;
  }

  return {
    isRetryable: apiCallError.isRetryable,
    ...(apiCallError.statusCode !== undefined ? { statusCode: apiCallError.statusCode } : {}),
  };
}

function rawTextStats(error: unknown): { hasRawText: boolean; rawTextLength: number } {
  if (!NoObjectGeneratedError.isInstance(error) || typeof error.text !== "string") {
    return { hasRawText: false, rawTextLength: 0 };
  }

  return {
    hasRawText: true,
    rawTextLength: error.text.length,
  };
}

function tokenUsageForDiagnostic(error: unknown): DelegateWritingDiagnostic["tokenUsage"] | undefined {
  if (NoObjectGeneratedError.isInstance(error) && error.usage !== undefined) {
    return tokenUsageFromUnknown(error.usage) ?? undefined;
  }
  return undefined;
}

export function extractDelegateWritingDiagnostic(input: {
  error: unknown;
  targetPath: string;
  writingProfile: ResolvedLlmProfile;
}): DelegateWritingDiagnostic {
  const classification = classifyDelegateWritingFailure(input.error);
  const { errorName, errorType } = rootErrorIdentity(input.error);
  const { hasRawText, rawTextLength } = rawTextStats(input.error);
  const responseMetadata = NoObjectGeneratedError.isInstance(input.error)
    ? responseMetadataFromNoObjectError(input.error)
    : undefined;
  const providerResponse = providerResponseFromError(input.error);
  const tokenUsage = tokenUsageForDiagnostic(input.error);

  return {
    causeChain: summarizeCauseChain(input.error),
    classification,
    errorMessage: SAFE_ERROR_MESSAGES[classification],
    errorName,
    errorType,
    ...(NoObjectGeneratedError.isInstance(input.error) && input.error.finishReason !== undefined
      ? { finishReason: input.error.finishReason }
      : {}),
    hasRawText,
    llmProfileId: input.writingProfile.id,
    llmProfileRole: "writing",
    modelId: input.writingProfile.modelId,
    providerId: input.writingProfile.providerId,
    ...(providerResponse ? { providerResponse } : {}),
    rawTextLength,
    ...(responseMetadata ? { responseMetadata } : {}),
    targetPath: input.targetPath,
    ...(tokenUsage ? { tokenUsage } : {}),
    type: "delegate-writing-error",
  };
}

export async function safeNotifyDelegateWritingDiagnostic(
  observer: DelegateWritingDiagnosticObserver | undefined,
  diagnostic: DelegateWritingDiagnostic,
): Promise<void> {
  if (!observer) {
    return;
  }

  try {
    await observer(diagnostic);
  } catch {
    // Observer failures must not affect DelegateWriting error handling.
  }
}
