import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFileSession } from "./useFileSession";

const fileContents = new Map<string, string>();

function mockFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? new URL(input, window.location.origin) : new URL(input.toString());

    if (url.pathname === "/api/files/content" && (!init?.method || init.method === "GET")) {
      const content = fileContents.get(url.searchParams.get("path") ?? "");
      return content === undefined
        ? Response.json({ message: "not found" }, { status: 404 })
        : Response.json({ content, path: url.searchParams.get("path") }, { status: 200 });
    }

    if (url.pathname === "/api/files/content" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { content: string; path: string };
      fileContents.set(body.path, body.content);
      return Response.json({ content: body.content, path: body.path }, { status: 200 });
    }

    return Response.json({ message: "unexpected request" }, { status: 500 });
  });
}

describe("useFileSession", () => {
  beforeEach(() => {
    fileContents.clear();
    fileContents.set("src/app.ts", "app v1");
    vi.stubGlobal("fetch", mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads a selected file, tracks dirty content, saves it, and refreshes the open tab", async () => {
    const { result, rerender } = renderHook(
      ({ refreshKey, selectedPath }) =>
        useFileSession({ refreshKey, selectedPath, workspaceRoot: "/workspace" }),
      { initialProps: { refreshKey: 0, selectedPath: "src/app.ts" } },
    );

    await waitFor(() => {
      expect(result.current.activeTab?.content).toBe("app v1");
    });

    act(() => {
      result.current.updateActiveContent("changed");
    });
    await waitFor(() => {
      expect(result.current.isDirty).toBe(true);
    });

    await act(async () => {
      await result.current.saveFile();
    });
    expect(fileContents.get("src/app.ts")).toBe("changed");
    expect(result.current.isDirty).toBe(false);

    fileContents.set("src/app.ts", "refreshed externally");
    rerender({ refreshKey: 1, selectedPath: "src/app.ts" });

    await waitFor(() => {
      expect(result.current.activeTab?.content).toBe("refreshed externally");
    });
  });

  it("refreshes inactive tabs without switching the active tab", async () => {
    fileContents.set("notes.txt", "notes v1");
    const { result, rerender } = renderHook(
      ({ refreshKey, selectedPath }) => useFileSession({ refreshKey, selectedPath, workspaceRoot: "/workspace" }),
      { initialProps: { refreshKey: 0, selectedPath: "src/app.ts" } },
    );
    await waitFor(() => expect(result.current.activeTab?.content).toBe("app v1"));
    rerender({ refreshKey: 0, selectedPath: "notes.txt" });
    await waitFor(() => expect(result.current.activeTab?.content).toBe("notes v1"));
    fileContents.set("src/app.ts", "app v2");
    rerender({ refreshKey: 1, selectedPath: "notes.txt" });
    await waitFor(() => expect(result.current.tabs[0].content).toBe("app v2"));
    expect(result.current.activePath).toBe("notes.txt");
    expect(result.current.activeTab?.content).toBe("notes v1");
  });

  it("preserves unsaved content when a refresh discovers another version", async () => {
    const { result, rerender } = renderHook(
      ({ refreshKey }) => useFileSession({ refreshKey, selectedPath: "src/app.ts", workspaceRoot: "/workspace" }),
      { initialProps: { refreshKey: 0 } },
    );
    await waitFor(() => expect(result.current.activeTab?.content).toBe("app v1"));
    act(() => result.current.updateActiveContent("my draft"));
    fileContents.set("src/app.ts", "app v2");
    rerender({ refreshKey: 1 });
    await waitFor(() => expect(result.current.activeTab?.externalContent).toBe("app v2"));
    expect(result.current.activeTab?.content).toBe("my draft");
    expect(result.current.activeTab?.savedContent).toBe("app v1");
    await act(async () => { await result.current.saveFile(); });
    expect(fileContents.get("src/app.ts")).toBe("app v2");
  });

  it("protects typing started while a refresh is in flight", async () => {
    const { result, rerender } = renderHook(
      ({ refreshKey }) => useFileSession({ refreshKey, selectedPath: "src/app.ts", workspaceRoot: "/workspace" }),
      { initialProps: { refreshKey: 0 } },
    );
    await waitFor(() => expect(result.current.activeTab?.content).toBe("app v1"));
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    rerender({ refreshKey: 1 });
    act(() => result.current.updateActiveContent("typing during refresh"));
    await act(async () => { finish(Response.json({ content: "app v2", path: "src/app.ts" })); });
    expect(result.current.activeTab?.content).toBe("typing during refresh");
    expect(result.current.activeTab?.externalContent).toBe("app v2");
  });

  it("does not report a conflict when only another file changed", async () => {
    const { result, rerender } = renderHook(
      ({ refreshKey }) => useFileSession({ refreshKey, selectedPath: "src/app.ts", workspaceRoot: "/workspace" }),
      { initialProps: { refreshKey: 0 } },
    );
    await waitFor(() => expect(result.current.activeTab?.content).toBe("app v1"));
    act(() => result.current.updateActiveContent("my draft"));
    await act(async () => { rerender({ refreshKey: 1 }); });
    expect(result.current.activeTab?.content).toBe("my draft");
    expect(result.current.activeTab?.externalContent).toBeUndefined();
    await act(async () => { await result.current.saveFile(); });
    expect(fileContents.get("src/app.ts")).toBe("my draft");
  });

  it("ignores an older refresh even if its transport completes after cancellation", async () => {
    const { result, rerender } = renderHook(
      ({ refreshKey }) => useFileSession({ refreshKey, selectedPath: "src/app.ts", workspaceRoot: "/workspace" }),
      { initialProps: { refreshKey: 0 } },
    );
    await waitFor(() => expect(result.current.activeTab?.content).toBe("app v1"));
    const finishes: Array<(response: Response) => void> = [];
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finishes.push(resolve); })));
    rerender({ refreshKey: 1 });
    rerender({ refreshKey: 2 });
    await act(async () => { finishes[1](Response.json({ content: "newest", path: "src/app.ts" })); });
    await act(async () => { finishes[0](Response.json({ content: "outdated", path: "src/app.ts" })); });
    expect(result.current.activeTab?.content).toBe("newest");
  });

  it("ignores an old workspace refresh after opening the same path in a new workspace", async () => {
    const { result, rerender } = renderHook(
      ({ refreshKey, selectedPath, workspaceRoot }) => useFileSession({ refreshKey, selectedPath, workspaceRoot }),
      { initialProps: { refreshKey: 0, selectedPath: "src/app.ts" as string | null, workspaceRoot: "/workspace-a" } },
    );
    await waitFor(() => expect(result.current.activeTab?.content).toBe("app v1"));
    let finish!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    rerender({ refreshKey: 1, selectedPath: "src/app.ts", workspaceRoot: "/workspace-a" });
    vi.stubGlobal("fetch", mockFetch());
    rerender({ refreshKey: 1, selectedPath: null, workspaceRoot: "/workspace-b" });
    fileContents.set("src/app.ts", "new workspace content");
    rerender({ refreshKey: 1, selectedPath: "src/app.ts", workspaceRoot: "/workspace-b" });
    await waitFor(() => expect(result.current.activeTab?.content).toBe("new workspace content"));
    await act(async () => { finish(Response.json({ content: "old workspace", path: "src/app.ts" })); });
    expect(result.current.activeTab?.content).toBe("new workspace content");
  });

  it("clears retained tabs when the workspace changes", async () => {
    const { result, rerender } = renderHook(
      ({ selectedPath, workspaceRoot }) =>
        useFileSession({ selectedPath, workspaceRoot }),
      {
        initialProps: {
          selectedPath: "src/app.ts" as string | null,
          workspaceRoot: "/workspace-a" as string | null,
        },
      },
    );

    await waitFor(() => {
      expect(result.current.activeTab?.content).toBe("app v1");
    });
    act(() => {
      result.current.updateActiveContent("unsaved in workspace a");
    });

    rerender({ selectedPath: null, workspaceRoot: "/workspace-b" });
    await waitFor(() => {
      expect(result.current.tabs).toEqual([]);
      expect(result.current.activePath).toBeNull();
    });
  });
});
