import { beforeEach, describe, expect, it } from "vitest";
import { readStoredWorkMode, writeStoredWorkMode } from "./workspaceSessionStorage";

describe("work mode storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores work mode per workspace and rejects invalid stored values", () => {
    writeStoredWorkMode("/novel-a", "editor");
    writeStoredWorkMode("/novel-b", "chat");

    expect(readStoredWorkMode("/novel-a")).toBe("editor");
    expect(readStoredWorkMode("/novel-b")).toBe("chat");

    localStorage.setItem("ghostwriter:last-work-mode:/novel-a", "reader");
    expect(readStoredWorkMode("/novel-a")).toBeNull();
  });
});
