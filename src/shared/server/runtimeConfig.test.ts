import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRipgrepExecutable, resolveServerDataRoot } from "./runtimeConfig";

describe("resolveServerDataRoot", () => {
  it("prefers an explicitly injected data root", () => {
    expect(
      resolveServerDataRoot({
        cwd: "/app",
        dataRoot: "/desktop/app-data",
        env: { GHOSTWRITER_DATA_DIR: "/env/data" },
      }),
    ).toBe(path.resolve("/desktop/app-data"));
  });

  it("resolves GHOSTWRITER_DATA_DIR relative to the runtime cwd", () => {
    expect(
      resolveServerDataRoot({
        cwd: "/app",
        env: { GHOSTWRITER_DATA_DIR: "runtime-data" },
      }),
    ).toBe(path.resolve("/app/runtime-data"));
  });

  it("prefers GHOSTWRITER_DATA_DIR while retaining legacy read compatibility", () => {
    expect(
      resolveServerDataRoot({
        cwd: "/app",
        env: {
          GHOSTWRITER_DATA_DIR: "current-data",
          SIMPLE_AI_AGENT_DATA_DIR: "legacy-data",
        },
      }),
    ).toBe(path.resolve("/app/current-data"));
    expect(
      resolveServerDataRoot({
        cwd: "/app",
        env: { SIMPLE_AI_AGENT_DATA_DIR: "legacy-data" },
      }),
    ).toBe(path.resolve("/app/legacy-data"));
  });

  it("falls back to the development .data directory", () => {
    expect(resolveServerDataRoot({ cwd: "/app", env: {} })).toBe(
      path.resolve("/app/.data"),
    );
  });
});

describe("resolveRipgrepExecutable", () => {
  it("uses the explicitly injected desktop ripgrep executable", () => {
    expect(
      resolveRipgrepExecutable({
        GHOSTWRITER_RG_EXECUTABLE: " /Applications/Ghostwriter.app/Contents/Resources/bin/rg ",
      }),
    ).toBe("/Applications/Ghostwriter.app/Contents/Resources/bin/rg");
  });

  it("falls back to PATH lookup for web development", () => {
    expect(resolveRipgrepExecutable({})).toBe("rg");
  });
});
