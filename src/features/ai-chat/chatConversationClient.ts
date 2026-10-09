import { z } from "zod";
import { apiFetch } from "../../shared/client/apiTransport";
import type { LlmProfile } from "../llm/profiles/llmProfiles";
import type { SelectedModel } from "../llm/selection/llmSelection";
import {
  conversationListResponseSchema,
  conversationSchema,
  type AgentPlan,
  type Conversation,
} from "./conversationSchemas";
import type { ToolActivitySummary } from "./toolActivity";

export type DroppedTextFileInput = {
  contentBase64: string;
  name: string;
};

const droppedTextFileStatusSchema = z
  .object({
    index: z.number().int().nonnegative(),
    name: z.string().min(1),
    sizeBytes: z.number().int().nonnegative(),
    status: z.enum(["pending", "placed", "failed", "unplaced"]),
    targetPath: z.string().min(1).optional(),
  })
  .strict();

export type DroppedTextFileStatus = z.infer<typeof droppedTextFileStatusSchema>;

const deleteConversationResponseSchema = z.object({
  conversationId: z.string().min(1),
});

export async function fetchConversations(workspaceRoot: string) {
  const url = new URL("/api/conversations", window.location.origin);
  url.searchParams.set("workspaceRoot", workspaceRoot);
  const response = await apiFetch(`${url.pathname}${url.search}`);
  if (!response.ok) {
    throw new Error("会話履歴の読み込みに失敗しました。");
  }
  return conversationListResponseSchema.parse(await response.json());
}

export async function createNewConversation(
  workspaceRoot: string,
  agentRuntime: Conversation["agentRuntime"] = "vercel-ai",
): Promise<Conversation> {
  const response = await apiFetch("/api/conversations", {
    body: JSON.stringify(
      agentRuntime === "codex-app-server"
        ? { agentRuntime, workspaceRoot }
        : { workspaceRoot },
    ),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error("新規会話の作成に失敗しました。");
  }
  return conversationSchema.parse((await response.json()).conversation);
}

export async function sendChatMessage(
  workspaceRoot: string,
  conversationId: string | undefined,
  content: string,
  currentFilePath: string | null | undefined,
  modelSelection: SelectedModel | null,
  llmProfileId: string | undefined,
  userProfiles: LlmProfile[],
  options?: {
    autoCompactEnabled?: boolean;
    autoCompactThresholdRatio?: number;
    droppedTextFiles?: DroppedTextFileInput[];
    mode?: "chat" | "editor";
    onDroppedTextFileStatus?: (file: DroppedTextFileStatus) => void;
    onTextDelta?: (text: string) => void;
    onReasoningDelta?: (text: string) => void;
    onPlanUpdate?: (plan: Pick<AgentPlan, "items">) => void;
    onToolActivity?: (activity: ToolActivitySummary) => void;
  },
): Promise<Conversation> {
  const response = await apiFetch("/api/chat/messages", {
    body: JSON.stringify({
      autoCompactEnabled: options?.autoCompactEnabled ?? true,
      autoCompactThresholdRatio: options?.autoCompactThresholdRatio ?? 0.7,
      content,
      conversationId,
      ...(currentFilePath ? { currentFilePath } : {}),
      ...(options?.droppedTextFiles && options.droppedTextFiles.length > 0
        ? { droppedTextFiles: options.droppedTextFiles }
        : {}),
      ...(options?.mode ? { mode: options.mode } : {}),
      ...(llmProfileId ? { llmProfileId } : modelSelection ? { modelSelection } : {}),
      ...(userProfiles.length > 0 ? { userProfiles } : {}),
      workspaceRoot,
    }),
    headers: { accept: "application/x-ndjson", "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.message === "string" ? body.message : "AI応答の生成に失敗しました。");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-ndjson") && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let conversation: Conversation | null = null;

    const consumeLine = (line: string) => {
      if (!line) {
        return;
      }

      const parsed = JSON.parse(line) as
        | { activity: ToolActivitySummary; type: "tool-activity" }
        | { conversation: Conversation; type: "conversation" }
        | { file: unknown; type: "dropped-text-file-status" }
        | { plan: Pick<AgentPlan, "items">; type: "plan-update" }
        | { message?: string; text?: string; type: "error" | "text-delta" | "reasoning-delta" };

      if (parsed.type === "reasoning-delta") {
        const reasoning = z.object({ text: z.string() }).safeParse(parsed);
        if (reasoning.success) options?.onReasoningDelta?.(reasoning.data.text);
        return;
      }

      if (parsed.type === "tool-activity") {
        options?.onToolActivity?.(parsed.activity);
        return;
      }

      if (parsed.type === "dropped-text-file-status") {
        const status = droppedTextFileStatusSchema.safeParse(parsed.file);
        if (!status.success) {
          throw new Error("AI応答の生成に失敗しました。");
        }
        options?.onDroppedTextFileStatus?.(status.data);
        return;
      }

      if (parsed.type === "text-delta") {
        if (typeof parsed.text === "string") {
          options?.onTextDelta?.(parsed.text);
        }
        return;
      }

      if (parsed.type === "plan-update") {
        options?.onPlanUpdate?.(parsed.plan);
        return;
      }

      if (parsed.type === "conversation") {
        conversation = conversationSchema.parse(parsed.conversation);
        return;
      }

      throw new Error(typeof parsed.message === "string" ? parsed.message : "AI応答の生成に失敗しました。");
    };

    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        consumeLine(line);
        newlineIndex = buffer.indexOf("\n");
      }

      if (done) {
        const remainder = buffer.trim();
        if (remainder) {
          consumeLine(remainder);
        }
        break;
      }
    }

    if (!conversation) {
      throw new Error("AI応答の生成に失敗しました。");
    }

    return conversation;
  }

  return conversationSchema.parse((await response.json()).conversation);
}

export async function touchConversation(workspaceRoot: string, conversationId: string) {
  await apiFetch("/api/conversations", {
    body: JSON.stringify({
      action: "touch",
      conversationId,
      workspaceRoot,
    }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

export async function deleteConversation(workspaceRoot: string, conversationId: string) {
  const response = await apiFetch("/api/conversations", {
    body: JSON.stringify({
      action: "deleteConversation",
      conversationId,
      workspaceRoot,
    }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  if (!response.ok) {
    throw new Error("会話の削除に失敗しました。");
  }

  try {
    return deleteConversationResponseSchema.parse(await response.json());
  } catch {
    throw new Error("会話の削除に失敗しました。");
  }
}

export async function compactActiveConversation(workspaceRoot: string, conversationId: string) {
  const response = await apiFetch("/api/conversations", {
    body: JSON.stringify({
      action: "compactConversation",
      conversationId,
      workspaceRoot,
    }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof body?.message === "string" ? body.message : "会話圧縮に失敗しました。",
    );
  }

  return {
    conversation: conversationSchema.parse(body.conversation),
    reason: typeof body.reason === "string" ? body.reason : undefined,
    status: body.status as "compacted" | "skipped",
  };
}
