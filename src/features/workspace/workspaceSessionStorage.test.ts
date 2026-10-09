import { beforeEach, describe, expect, it } from "vitest";
import { clearStoredWorkspaceRoot, readStoredWorkspaceRoot, writeStoredWorkspaceRoot } from "./workspaceSessionStorage";

describe("workspaceSessionStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("prefers the current workspace key while retaining legacy read compatibility", () => {
    localStorage.setItem("simple-ai-agent:last-workspace-root", "/legacy");
    expect(readStoredWorkspaceRoot()).toBe("/legacy");

    localStorage.setItem("ghostwriter:last-workspace-root", "/current");
    expect(readStoredWorkspaceRoot()).toBe("/current");
  });

  it("writes only the current workspace key and clears both workspace keys", () => {
    localStorage.setItem("simple-ai-agent:last-workspace-root", "/legacy");

    writeStoredWorkspaceRoot("/current");

    expect(localStorage.getItem("ghostwriter:last-workspace-root")).toBe("/current");
    expect(localStorage.getItem("simple-ai-agent:last-workspace-root")).toBe("/legacy");

    clearStoredWorkspaceRoot();

    expect(localStorage.getItem("ghostwriter:last-workspace-root")).toBeNull();
    expect(localStorage.getItem("simple-ai-agent:last-workspace-root")).toBeNull();
  });

});
