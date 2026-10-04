export type AgentLoopEvent =
  | { type: "tool-progress"; toolName: "DelegateWriting"; toolCallId: string; targetPath: string; generatedCharacters: number }
  | { text: string; type: "reasoning-delta" }
  | { text: string; type: "text-delta" }
  | { input: unknown; toolCallId: string; toolName: string; type: "tool-call" }
  | { output: unknown; toolCallId: string; toolName: string; type: "tool-result" }
  | { finishReason: unknown; type: "finish-step"; usage: unknown }
  | { finishReason: unknown; totalUsage: unknown; type: "finish" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function mapAgentStreamPart(part: unknown): AgentLoopEvent | null {
  if (!isRecord(part)) return null;
  if (part.type === "error") {
    throw part.error instanceof Error ? part.error : new Error("AIの応答中にエラーが発生しました。");
  }
  if (part.type === "abort") throw new Error("AIの応答が中断されました。");
  if (part.type === "tool-error" && typeof part.toolCallId === "string" && typeof part.toolName === "string") {
    return {
      type: "tool-result", toolCallId: part.toolCallId, toolName: part.toolName,
      output: { status: "error", message: "ツールの実行に失敗しました。" },
    };
  }
  if (part.type === "reasoning-delta" && typeof part.text === "string") {
    return { text: part.text, type: "reasoning-delta" };
  }
  if (part.type === "text-delta" && typeof part.text === "string") {
    return { text: part.text, type: "text-delta" };
  }
  if (part.type === "tool-call" && typeof part.toolCallId === "string" && typeof part.toolName === "string") {
    return { input: part.input ?? part.args, toolCallId: part.toolCallId, toolName: part.toolName, type: "tool-call" };
  }
  if (part.type === "tool-result" && typeof part.toolCallId === "string" && typeof part.toolName === "string") {
    return { output: part.output ?? part.result, toolCallId: part.toolCallId, toolName: part.toolName, type: "tool-result" };
  }
  if (part.type === "finish-step") return { finishReason: part.finishReason, type: "finish-step", usage: part.usage };
  if (part.type === "finish") return { finishReason: part.finishReason, totalUsage: part.totalUsage, type: "finish" };
  return null;
}
