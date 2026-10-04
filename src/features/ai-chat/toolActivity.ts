import type { AgentLoopEvent } from "../ai-agent/runAgentLoop";

export type ToolActivityStatus = "running" | "completed" | "failed";

export type ToolActivity = {
  assistantMessageId?: string;
  createdAt?: string;
  detail?: string;
  id?: string;
  label: string;
  status: ToolActivityStatus;
  toolCallId: string;
  toolName: string;
};

export type ToolActivitySummary = Omit<ToolActivity, "createdAt" | "id">;

const toolNamesWithPath = new Set(["Read", "Edit", "Create"]);
const toolNamesWithQuery = new Set(["Grep", "Search"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function shortText(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
}

function targetFor(toolName: string, payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }
  if (toolNamesWithPath.has(toolName)) {
    return shortText(payload.path);
  }
  if (toolName === "DelegateWriting") return shortText(payload.targetPath);
  if (toolName === "PlaceDroppedTextFile") {
    return shortText(payload.targetPath) ?? shortText(payload.path);
  }
  if (toolName === "ReadDroppedTextFile") {
    return shortText(payload.name);
  }
  if (toolName === "Glob") {
    return shortText(payload.pattern);
  }
  if (toolNamesWithQuery.has(toolName)) {
    return shortText(payload.query);
  }
  if (toolName === "UseSkill") {
    return shortText(payload.skillId);
  }
  return null;
}

function resultCount(output: unknown): number | null {
  if (!isRecord(output)) {
    return null;
  }
  if (Array.isArray(output.results)) {
    return Math.min(output.results.length, 10);
  }
  if (Array.isArray(output.matches)) {
    return Math.min(output.matches.length, 10);
  }
  if (Array.isArray(output.files)) {
    return Math.min(output.files.length, 10);
  }
  return null;
}

function errorDetail(output: unknown): string | null {
  if (!isRecord(output)) {
    return null;
  }
  return shortText(output.error) ?? shortText(output.message);
}

function completionDetail(output: unknown): string | undefined {
  if (!isRecord(output)) {
    return undefined;
  }
  const count = resultCount(output);
  if (count !== null) {
    return count >= 10 ? "10件まで表示" : `${count}件`;
  }
  if (output.truncated === true) {
    return "結果は切り詰められました";
  }
  if (typeof output.displayName === "string" && output.displayName.trim() !== "") {
    return shortText(output.displayName) ?? undefined;
  }
  return undefined;
}

export function summarizeToolActivity(
  event: AgentLoopEvent,
  previous?: ToolActivitySummary,
): ToolActivitySummary | null {
  if (event.type !== "tool-call" && event.type !== "tool-result") {
    return null;
  }

  const payload = event.type === "tool-call" ? event.input : event.output;
  const target = targetFor(event.toolName, payload);
  const label = target ? `${event.toolName} ${target}` : event.toolName;

  if (event.type === "tool-call") {
    return {
      detail: event.toolName === "DelegateWriting" ? "本文を生成中・応答を待っています" : "実行中",
      label,
      status: "running",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
    };
  }

  const failedDetail = errorDetail(event.output);
  if (failedDetail) {
    return {
      detail: failedDetail,
      label: previous?.label ?? label,
      status: "failed",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
    };
  }

  const completedLabel =
    event.toolName === "ReadDroppedTextFile" && target
      ? label
      : (previous?.label ?? label);
  return {
    detail: completionDetail(event.output),
    label: completedLabel,
    status: "completed",
    toolCallId: event.toolCallId,
    toolName: event.toolName,
  };
}

export function updateToolActivityRecord(
  previous: ToolActivity | undefined,
  summary: ToolActivitySummary,
): Required<Pick<ToolActivity, "createdAt" | "id">> & ToolActivitySummary {
  return {
    ...summary,
    assistantMessageId: previous?.assistantMessageId ?? summary.assistantMessageId,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    id: previous?.id ?? crypto.randomUUID(),
  };
}
