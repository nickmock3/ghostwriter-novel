import { describe, expect, it, vi } from "vitest";
import { createDesktopWorkspaceDirectoryPicker } from "./desktopWorkspaceDialog";

describe("createDesktopWorkspaceDirectoryPicker", () => {
  it("opens a single-directory picker and returns the selected absolute path", async () => {
    const openDialog = vi.fn(async () => "/Users/example/novel");
    const selectDirectory = createDesktopWorkspaceDirectoryPicker(openDialog);

    await expect(selectDirectory()).resolves.toBe("/Users/example/novel");
    expect(openDialog).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "ワークスペースを選択してください",
    });
  });

  it("returns null when the user cancels the dialog", async () => {
    const selectDirectory = createDesktopWorkspaceDirectoryPicker(async () => null);

    await expect(selectDirectory()).resolves.toBeNull();
  });

  it("rejects an unexpected multiple-selection result", async () => {
    const selectDirectory = createDesktopWorkspaceDirectoryPicker(
      async () => ["/Users/example/one", "/Users/example/two"],
    );

    await expect(selectDirectory()).rejects.toThrow(
      "デスクトップのワークスペース選択結果が不正です",
    );
  });
});
