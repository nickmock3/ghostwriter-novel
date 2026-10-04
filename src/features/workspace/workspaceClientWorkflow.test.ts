import { afterEach, describe, expect, it, vi } from "vitest";

const {
  isTauriDesktopMock,
  selectDesktopWorkspaceDirectoryMock,
} = vi.hoisted(() => ({
  isTauriDesktopMock: vi.fn(),
  selectDesktopWorkspaceDirectoryMock: vi.fn(),
}));

vi.mock("../../shared/client/desktopRuntime", () => ({
  isTauriDesktop: isTauriDesktopMock,
}));

vi.mock("../../shared/client/desktopWorkspaceDialog", () => ({
  selectDesktopWorkspaceDirectory: selectDesktopWorkspaceDirectoryMock,
}));

import {
  applyWorkspaceTemplate,
  listWorkspaceTemplates,
  pickWorkspaceRoot,
  validateWorkspaceRoot,
} from "./workspaceClientWorkflow";

describe("workspaceClientWorkflow", () => {
  afterEach(() => {
    isTauriDesktopMock.mockReset();
    selectDesktopWorkspaceDirectoryMock.mockReset();
    vi.restoreAllMocks();
  });

  it("selects a web workspace through the server picker", async () => {
    isTauriDesktopMock.mockReturnValue(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ workspaceRoot: "/Users/example/web-workspace" }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(pickWorkspaceRoot()).resolves.toBe("/Users/example/web-workspace");
    expect(fetchSpy).toHaveBeenCalledWith("/api/workspace/select", { method: "POST" });
  });

  it("validates a desktop picker result and represents cancellation as null", async () => {
    isTauriDesktopMock.mockReturnValue(true);
    selectDesktopWorkspaceDirectoryMock.mockResolvedValue("/Users/example/desktop-workspace");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ workspaceRoot: "/Users/example/desktop-workspace" }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(pickWorkspaceRoot()).resolves.toBe("/Users/example/desktop-workspace");
    expect(fetchSpy).toHaveBeenCalledWith("/api/workspace/validate", {
      body: JSON.stringify({ workspaceRoot: "/Users/example/desktop-workspace" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    selectDesktopWorkspaceDirectoryMock.mockResolvedValue(null);
    fetchSpy.mockClear();
    await expect(pickWorkspaceRoot()).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("validates manual roots and preserves the server error message", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ workspaceRoot: "/Users/example/manual-workspace" }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(validateWorkspaceRoot("/tmp/manual")).resolves.toBe(
      "/Users/example/manual-workspace",
    );
    expect(fetchSpy).toHaveBeenCalledWith("/api/workspace/validate", {
      body: JSON.stringify({ workspaceRoot: "/tmp/manual" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });

    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: "workspace_selection_failed", message: "Workspace does not exist" }),
        { headers: { "content-type": "application/json" }, status: 400 },
      ),
    );
    await expect(validateWorkspaceRoot("/tmp/missing")).rejects.toThrow("Workspace does not exist");
  });

  it("lists templates and applies a selected template through validated responses", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            templates: [
              {
                id: "built-in/basic-workspace",
                items: [],
                name: "小説ワークスペース",
                source: "built-in",
              },
            ],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            createdDirectories: ["小説"],
            createdFiles: ["AGENTS.md"],
            skippedExisting: [],
            workspaceRoot: "/Users/example/new-workspace",
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
      );

    await expect(listWorkspaceTemplates()).resolves.toEqual([
      {
        id: "built-in/basic-workspace",
        items: [],
        name: "小説ワークスペース",
        source: "built-in",
      },
    ]);
    await expect(
      applyWorkspaceTemplate({
        templateId: "built-in/basic-workspace",
        workspaceRoot: "/Users/example/new-workspace",
      }),
    ).resolves.toMatchObject({ createdFiles: ["AGENTS.md"] });
    expect(fetchSpy).toHaveBeenLastCalledWith("/api/workspace/template", {
      body: JSON.stringify({
        templateId: "built-in/basic-workspace",
        workspaceRoot: "/Users/example/new-workspace",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });
});
