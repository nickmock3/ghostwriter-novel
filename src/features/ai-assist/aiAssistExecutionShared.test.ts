import { describe, expect, it, vi } from "vitest";

import { getBuiltInAiAssist } from "./aiAssistContracts";
import { prepareAiAssistExecution } from "./aiAssistExecutionShared";

const savedContent = "冒頭です。\n重複。\n結びです。";

function createDeps(options: {
  resolveAiAssist?: Parameters<typeof prepareAiAssistExecution>[1]["resolveAiAssist"];
  savedFileContent?: string;
  savedFilePath?: string;
} = {}) {
  return {
    readSavedFile: vi.fn(async () => ({
      content: options.savedFileContent ?? savedContent,
      path: options.savedFilePath ?? "小説/第001章/本文.txt",
    })),
    ...(options.resolveAiAssist ? { resolveAiAssist: options.resolveAiAssist } : {}),
  };
}

const baseInput = {
  assistId: "polish",
  editorContent: savedContent,
  targetRange: { end: 5, start: 0 },
  workspaceRelativePath: "小説/第001章/本文.txt",
  workspaceRoot: "/tmp/novel",
};

describe("prepareAiAssistExecution", () => {
  it("resolves assist, verifies saved content, and extracts target text", async () => {
    const deps = createDeps();

    const prepared = await prepareAiAssistExecution(baseInput, deps);

    expect(prepared.assist).toEqual(getBuiltInAiAssist("polish"));
    expect(prepared.savedFile).toEqual({
      content: savedContent,
      path: "小説/第001章/本文.txt",
    });
    expect(prepared.targetText).toBe("冒頭です。");
    expect(deps.readSavedFile).toHaveBeenCalledWith({
      path: "小説/第001章/本文.txt",
      workspaceRoot: "/tmp/novel",
    });
  });

  it("rejects an unknown assist before reading the saved file", async () => {
    const deps = createDeps({
      resolveAiAssist: async () => null,
    });

    await expect(
      prepareAiAssistExecution({ ...baseInput, assistId: "missing-assist" }, deps),
    ).rejects.toThrow("Unknown AI assist: missing-assist");
    expect(deps.readSavedFile).not.toHaveBeenCalled();
  });

  it("rejects unsaved editor changes before validating the target range", async () => {
    const deps = createDeps({ savedFileContent: "保存済みの本文" });

    await expect(prepareAiAssistExecution(baseInput, deps)).rejects.toThrow(
      "unsaved editor changes detected for the target file",
    );
  });

  it("rejects a target range outside the saved content", async () => {
    const deps = createDeps();

    await expect(
      prepareAiAssistExecution(
        {
          ...baseInput,
          targetRange: { end: savedContent.length + 1, start: 0 },
        },
        deps,
      ),
    ).rejects.toThrow("target range is out of bounds for the saved file content");
  });

  it("rejects empty target text", async () => {
    const deps = createDeps({ savedFileContent: "" });

    await expect(
      prepareAiAssistExecution(
        {
          ...baseInput,
          editorContent: "",
          targetRange: { end: 0, start: 0 },
        },
        deps,
      ),
    ).rejects.toThrow("target text is empty");
  });

  it("uses the full saved content when the target range is a caret", async () => {
    const deps = createDeps();

    const prepared = await prepareAiAssistExecution(
      {
        ...baseInput,
        targetRange: { end: 0, start: 0 },
      },
      deps,
    );

    expect(prepared.targetText).toBe(savedContent);
  });
});
