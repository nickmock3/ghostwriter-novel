import { describe, expect, it } from "vitest";
import { summarizeToolActivity } from "./toolActivity";

describe("tool activity summaries", () => {
  it("keeps tool progress concise without exposing raw file contents or long results", () => {
    expect(
      summarizeToolActivity({
        input: { path: "src/App.tsx" },
        toolCallId: "read-1",
        toolName: "Read",
        type: "tool-call",
      }),
    ).toMatchObject({
      label: "Read src/App.tsx",
      status: "running",
      toolName: "Read",
    });

    expect(
      summarizeToolActivity({
        output: {
          content: "secret\n".repeat(300),
          lines: Array.from({ length: 200 }, (_, index) => `line ${index}`),
          path: "src/App.tsx",
          truncated: true,
        },
        toolCallId: "read-1",
        toolName: "Read",
        type: "tool-result",
      }),
    ).toMatchObject({
      detail: "結果は切り詰められました",
      label: "Read src/App.tsx",
      status: "completed",
    });
  });

  it("summarizes search-like tools with capped counts and query terms", () => {
    expect(
      summarizeToolActivity({
        input: { query: "runAgentLoop" },
        toolCallId: "grep-1",
        toolName: "Grep",
        type: "tool-call",
      }),
    ).toMatchObject({
      label: "Grep runAgentLoop",
      status: "running",
    });

    expect(
      summarizeToolActivity({
        output: {
          results: Array.from({ length: 12 }, (_, index) => ({ path: `file-${index}.ts` })),
          truncated: true,
        },
        toolCallId: "grep-1",
        toolName: "Grep",
        type: "tool-result",
      }),
    ).toMatchObject({
      detail: "10件まで表示",
      status: "completed",
    });
  });

  it("marks failed tool results with the stage that failed", () => {
    expect(
      summarizeToolActivity({
        output: { error: "File is outside workspace" },
        toolCallId: "read-2",
        toolName: "Read",
        type: "tool-result",
      }),
    ).toMatchObject({
      detail: "File is outside workspace",
      status: "failed",
      toolName: "Read",
    });
  });

  it("summarizes skill activation without exposing skill instructions", () => {
    expect(
      summarizeToolActivity({
        input: { skillId: "focused-implementation" },
        toolCallId: "skill-1",
        toolName: "UseSkill",
        type: "tool-call",
      }),
    ).toMatchObject({
      label: "UseSkill focused-implementation",
      status: "running",
    });

    expect(
      summarizeToolActivity({
        output: {
          displayName: "Focused implementation",
          skillId: "focused-implementation",
          status: "activated",
        },
        toolCallId: "skill-1",
        toolName: "UseSkill",
        type: "tool-result",
      }),
    ).toMatchObject({
      detail: "Focused implementation",
      label: "UseSkill focused-implementation",
      status: "completed",
    });
  });

  it("shows dropped file names and placement targets without exposing opaque IDs", () => {
    const readCall = summarizeToolActivity({
      input: { droppedFileId: "opaque-secret-id" },
      toolCallId: "drop-read-1",
      toolName: "ReadDroppedTextFile",
      type: "tool-call",
    });
    expect(readCall).toMatchObject({
      label: "ReadDroppedTextFile",
      status: "running",
    });
    expect(JSON.stringify(readCall)).not.toContain("opaque-secret-id");

    expect(
      summarizeToolActivity(
        {
          output: {
            content: "raw dropped content",
            name: "資料.txt",
            totalLines: 1,
            truncated: false,
          },
          toolCallId: "drop-read-1",
          toolName: "ReadDroppedTextFile",
          type: "tool-result",
        },
        readCall ?? undefined,
      ),
    ).toMatchObject({
      label: "ReadDroppedTextFile 資料.txt",
      status: "completed",
    });

    const placeCall = summarizeToolActivity({
      input: {
        droppedFileId: "opaque-secret-id",
        targetPath: "設定/資料.txt",
      },
      toolCallId: "drop-place-1",
      toolName: "PlaceDroppedTextFile",
      type: "tool-call",
    });
    expect(placeCall).toMatchObject({
      label: "PlaceDroppedTextFile 設定/資料.txt",
      status: "running",
    });
    expect(JSON.stringify(placeCall)).not.toContain("opaque-secret-id");
  });
});
