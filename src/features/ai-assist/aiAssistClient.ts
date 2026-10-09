import type { EditorTarget } from "../editor/editorTarget";
import { z } from "zod";
import { llmProfileRoleAssignmentsSchema, llmProfileSchema } from "../llm/profiles/llmProfiles";
import { apiFetch } from "../../shared/client/apiTransport";
import { editProposalSchema, type EditProposal } from "../edit-proposals/editProposalSchemas";
import {
  aiAssistDefinitionInputSchema,
  aiAssistExecuteBodySchema,
  aiAssistListResponseSchema,
  aiAssistSaveResponseSchema,
  type AiAssistDefinition,
  type AiAssistDefinitionInput,
  type AiAssistExecutionOption,
  type CustomAiAssistDefinition,
} from "./aiAssistContracts";
import type { AiAssistStandardModelSelection } from "./aiAssistModelSelection";

const aiAssistExecuteResponseSchema = z.object({
  proposal: editProposalSchema,
  status: z.literal("completed"),
});

const aiAssistProposalResponseSchema = z.object({
  proposal: editProposalSchema,
});

export type { AiAssistExecutionOption } from "./aiAssistContracts";

export type ExecuteAiAssistInput = {
  additionalInstruction?: string;
  assistId: string;
  executionOptionId: string;
  executionOptions: AiAssistExecutionOption[];
  roleAssignments?: z.infer<typeof llmProfileRoleAssignmentsSchema>;
  standardModelSelection?: AiAssistStandardModelSelection;
  target: EditorTarget;
  userProfiles?: z.infer<typeof llmProfileSchema>[];
  workspaceRoot: string;
};

function formatApiMessage(body: unknown, fallbackMessage: string): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
  ) {
    return body.message;
  }

  return fallbackMessage;
}

function resolveTargetRange(target: EditorTarget) {
  if (target.selection) {
    return target.selection;
  }

  return { end: 0, start: 0 };
}

export async function fetchAiAssistDefinitions(): Promise<AiAssistDefinition[]> {
  const response = await apiFetch("/api/ai-assists");
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error("AIアシスト一覧の読み込みに失敗しました。");
  }

  const parsed = aiAssistListResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("AIアシスト一覧の読み込みに失敗しました。");
  }

  return parsed.data.assists;
}

export async function saveAiAssistDefinition(input: {
  assistId: string;
  input: AiAssistDefinitionInput;
}): Promise<CustomAiAssistDefinition> {
  const requestBody = aiAssistDefinitionInputSchema.parse(input.input);
  const response = await apiFetch(`/api/ai-assists/${encodeURIComponent(input.assistId)}`, {
    body: JSON.stringify(requestBody),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(formatApiMessage(body, "AIアシストの保存に失敗しました。"));
  }

  const parsed = aiAssistSaveResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("AIアシストの保存に失敗しました。");
  }

  return parsed.data.assist;
}

export async function deleteAiAssistDefinition(assistId: string): Promise<void> {
  const response = await apiFetch(`/api/ai-assists/${encodeURIComponent(assistId)}`, {
    method: "DELETE",
  });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(formatApiMessage(body, "AIアシストの削除に失敗しました。"));
  }
}

export async function executeAiAssist(input: ExecuteAiAssistInput): Promise<EditProposal> {
  const executionOption = input.executionOptions.find(
    (option) => option.id === input.executionOptionId,
  );
  if (!executionOption) {
    throw new Error("利用可能なモデルがありません。");
  }

  const requestInput = {
    additionalInstruction: input.additionalInstruction,
    assistId: input.assistId,
    editorContent: input.target.content,
    roleAssignments: input.roleAssignments,
    runtime: executionOption.runtime,
    targetRange: resolveTargetRange(input.target),
    userProfiles: input.userProfiles,
    workspaceRelativePath: input.target.path,
    workspaceRoot: input.workspaceRoot,
    ...(executionOption.runtime === "vercel-ai" && input.standardModelSelection
      ? { standardModelSelection: input.standardModelSelection }
      : {}),
  };
  const requestBody = aiAssistExecuteBodySchema.parse(requestInput);

  const response = await apiFetch("/api/ai-assists/execute", {
    body: JSON.stringify(requestBody),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
        ? body.message
        : "AIアシストを実行できませんでした。";
    throw new Error(message);
  }

  const parsed = aiAssistExecuteResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("AIアシストを実行できませんでした。");
  }

  return parsed.data.proposal;
}

export async function applyAiAssistProposal(input: {
  action?: "apply" | "undo";
  dirtyPaths: string[];
  proposal: EditProposal;
  workspaceRoot: string;
}): Promise<EditProposal> {
  const response = await apiFetch("/api/ai-assists/proposals", {
    body: JSON.stringify({
      action: input.action ?? "apply",
      dirtyPaths: input.dirtyPaths,
      proposal: input.proposal,
      workspaceRoot: input.workspaceRoot,
    }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
        ? body.message
        : "編集案を適用できませんでした。";
    throw new Error(message);
  }

  const parsed = aiAssistProposalResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("編集案を適用できませんでした。");
  }

  return parsed.data.proposal;
}

export async function rejectAiAssistProposal(input: {
  proposal: EditProposal;
  workspaceRoot: string;
}): Promise<EditProposal> {
  const response = await apiFetch("/api/ai-assists/proposals", {
    body: JSON.stringify({
      action: "reject",
      proposal: input.proposal,
      workspaceRoot: input.workspaceRoot,
    }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "message" in body &&
      typeof body.message === "string"
        ? body.message
        : "編集案を拒否できませんでした。";
    throw new Error(message);
  }

  const parsed = aiAssistProposalResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error("編集案を拒否できませんでした。");
  }

  return parsed.data.proposal;
}
