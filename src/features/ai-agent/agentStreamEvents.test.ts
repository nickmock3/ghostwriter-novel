import { describe, expect, it } from "vitest";
import { mapAgentStreamPart } from "./agentStreamEvents";

describe("mapAgentStreamPart", () => {
  it("propagates stream failures instead of dropping them", () => {
    const error = new Error("provider failed");
    expect(() => mapAgentStreamPart({ type: "error", error })).toThrow(error);
  });
  it("turns tool errors into failed tool results without exposing raw errors", () => {
    expect(mapAgentStreamPart({ type: "tool-error", toolCallId: "t1", toolName: "Read", error: new Error("secret raw input") }))
      .toEqual({ type: "tool-result", toolCallId: "t1", toolName: "Read", output: { status: "error", message: "ツールの実行に失敗しました。" } });
  });
  it("forwards readable reasoning deltas without exposing provider metadata", () => {
    expect(mapAgentStreamPart({ type: "reasoning-delta", text: "確認しています", id: "r1", providerMetadata: { encrypted: "hidden" } }))
      .toEqual({ type: "reasoning-delta", text: "確認しています" });
    expect(mapAgentStreamPart({ type: "reasoning-delta", text: null })).toBeNull();
  });
  it("maps supported AI SDK stream parts and ignores malformed or unknown parts", () => {
    expect(mapAgentStreamPart({ text: "Hello", type: "text-delta" })).toEqual({
      text: "Hello",
      type: "text-delta",
    });
    expect(mapAgentStreamPart({
      args: { path: "notes.md" },
      toolCallId: "call-1",
      toolName: "Read",
      type: "tool-call",
    })).toEqual({
      input: { path: "notes.md" },
      toolCallId: "call-1",
      toolName: "Read",
      type: "tool-call",
    });
    expect(mapAgentStreamPart({
      finishReason: "stop",
      totalUsage: { totalTokens: 4 },
      type: "finish",
    })).toEqual({
      finishReason: "stop",
      totalUsage: { totalTokens: 4 },
      type: "finish",
    });
    expect(mapAgentStreamPart({ type: "tool-call" })).toBeNull();
    expect(mapAgentStreamPart(null)).toBeNull();
  });
});
