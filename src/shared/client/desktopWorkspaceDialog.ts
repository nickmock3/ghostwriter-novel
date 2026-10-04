export type WorkspaceDirectoryPickerOptions = {
  directory: true;
  multiple: false;
  title: "ワークスペースを選択してください";
};

export type OpenWorkspaceDirectoryDialog = (
  options: WorkspaceDirectoryPickerOptions,
) => Promise<string | string[] | null>;

const workspaceDirectoryPickerOptions: WorkspaceDirectoryPickerOptions = {
  directory: true,
  multiple: false,
  title: "ワークスペースを選択してください",
};

const invalidSelectionError = "デスクトップのワークスペース選択結果が不正です";

export function createDesktopWorkspaceDirectoryPicker(
  openDialog: OpenWorkspaceDirectoryDialog,
): () => Promise<string | null> {
  return async () => {
    const result = await openDialog(workspaceDirectoryPickerOptions);

    if (result === null) {
      return null;
    }

    if (Array.isArray(result)) {
      throw new Error(invalidSelectionError);
    }

    return result;
  };
}

export async function selectDesktopWorkspaceDirectory(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  return createDesktopWorkspaceDirectoryPicker(open)();
}
