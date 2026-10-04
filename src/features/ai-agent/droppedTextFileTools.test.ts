import { describe, expect, it, vi } from "vitest";
import {
  createAgentTools,
  placeDroppedTextFileToolInputSchema,
  readDroppedTextFileToolInputSchema,
} from "./agentTools";
import {
  chatModeAgentProfile,
  mainAgentProfile,
  selectProfileTools,
} from "./agentProfiles";

describe("dropped text file agent tools", () => {
  it("accepts only opaque IDs and workspace-relative placement paths", () => {
    expect(readDroppedTextFileToolInputSchema.parse({ droppedFileId: "opaque-1" })).toEqual({
      droppedFileId: "opaque-1",
    });
    expect(() =>
      readDroppedTextFileToolInputSchema.parse({
        droppedFileId: "opaque-1",
        workspaceRoot: "/must-not-be-model-input",
      }),
    ).toThrow();

    expect(
      placeDroppedTextFileToolInputSchema.parse({
        droppedFileId: "opaque-1",
        targetPath: "資料/メモ.txt",
      }),
    ).toEqual({
      droppedFileId: "opaque-1",
      targetPath: "資料/メモ.txt",
    });
    expect(() =>
      placeDroppedTextFileToolInputSchema.parse({
        content: "must not be model input",
        droppedFileId: "opaque-1",
        targetPath: "資料/メモ.txt",
      }),
    ).toThrow();
  });

  it("delegates read and placement through run-scoped services without exposing workspaceRoot", async () => {
    const readDroppedTextFile = vi.fn(async () => ({
      content: "原文",
      name: "memo.txt",
      totalLines: 1,
      truncated: false,
    }));
    const placeDroppedTextFile = vi.fn(async () => ({
      operation: "create" as const,
      path: "資料/memo.txt",
      status: "applied" as const,
    }));
    const tools = createAgentTools({
      placeDroppedTextFile,
      readDroppedTextFile,
      workspaceRoot: "/workspace",
    });

    await expect(
      Promise.resolve(
        tools.ReadDroppedTextFile.execute?.({ droppedFileId: "opaque-1" }, {} as never),
      ),
    ).resolves.toMatchObject({ content: "原文", name: "memo.txt" });
    expect(readDroppedTextFile).toHaveBeenCalledWith({ droppedFileId: "opaque-1" });

    await expect(
      Promise.resolve(
        tools.PlaceDroppedTextFile.execute?.(
          { droppedFileId: "opaque-1", targetPath: "資料/memo.txt" },
          {} as never,
        ),
      ),
    ).resolves.toMatchObject({
      operation: "create",
      path: "資料/memo.txt",
      status: "applied",
    });
    expect(placeDroppedTextFile).toHaveBeenCalledWith({
      droppedFileId: "opaque-1",
      targetPath: "資料/memo.txt",
    });
  });

  it("allows the tools only for the chat-mode profile", () => {
    const tools = createAgentTools({
      placeDroppedTextFile: vi.fn(),
      readDroppedTextFile: vi.fn(),
      workspaceRoot: "/workspace",
    });
    const completeProfileTools = {
      ...tools,
      CreateWritingEditProposal: tools.Read,
      DelegateWriting: tools.Read,
      SpawnSubAgent: tools.Read,
    };

    expect(selectProfileTools(chatModeAgentProfile, completeProfileTools)).toMatchObject({
      PlaceDroppedTextFile: expect.anything(),
      ReadDroppedTextFile: expect.anything(),
    });
    expect(selectProfileTools(mainAgentProfile, completeProfileTools)).not.toHaveProperty(
      "ReadDroppedTextFile",
    );
    expect(selectProfileTools(mainAgentProfile, completeProfileTools)).not.toHaveProperty(
      "PlaceDroppedTextFile",
    );
  });

  it("fails safely when a chat request has no staged dropped text files", async () => {
    const tools = createAgentTools({ workspaceRoot: "/workspace" });

    expect(() =>
      tools.ReadDroppedTextFile.execute?.({ droppedFileId: "opaque-1" }, {} as never),
    ).toThrow("No dropped text file is available for this request");
    expect(() =>
      tools.PlaceDroppedTextFile.execute?.(
          { droppedFileId: "opaque-1", targetPath: "資料/memo.txt" },
          {} as never,
      ),
    ).toThrow("No dropped text file is available for this request");
  });
});
