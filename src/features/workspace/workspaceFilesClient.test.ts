import { afterEach, describe, expect, it, vi } from "vitest";
import { resetApiTransportForTests } from "../../shared/client/apiTransport";
import { fetchFileContent, fetchFileTree } from "./workspaceFilesClient";

afterEach(() => {
  resetApiTransportForTests();
  vi.unstubAllGlobals();
});

describe("workspaceFilesClient", () => {
  it("parses a successful file tree response", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        {
          items: [{ kind: "file", path: "README.md" }],
          limit: 100,
          truncated: false,
        },
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchFileTree({
        filter: "README",
        includeNoisyDirectories: true,
        workspaceRoot: "/tmp/novel",
      }),
    ).resolves.toEqual({
      items: [{ kind: "file", path: "README.md" }],
      limit: 100,
      truncated: false,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/tree?workspaceRoot=%2Ftmp%2Fnovel&filter=README&includeNoisyDirectories=true",
      undefined,
    );
  });

  it("throws when the file tree response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ message: "ワークスペースが見つかりません" }, { status: 404 }),
      ),
    );

    await expect(fetchFileTree({ workspaceRoot: "/tmp/missing" })).rejects.toThrow(
      "ワークスペースが見つかりません",
    );
  });

  it("throws when the file tree response body is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ items: "broken" }, { status: 200 })),
    );

    await expect(fetchFileTree({ workspaceRoot: "/tmp/novel" })).rejects.toThrow();
  });

  it("parses a successful file content response", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ content: "本文", path: "小説/第001章/本文.txt" }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const signal = new AbortController().signal;
    await expect(
      fetchFileContent({
        path: "小説/第001章/本文.txt",
        signal,
        workspaceRoot: "/tmp/novel",
      }),
    ).resolves.toEqual({ content: "本文", path: "小説/第001章/本文.txt" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/files/content?workspaceRoot=%2Ftmp%2Fnovel&path=%E5%B0%8F%E8%AA%AC%2F%E7%AC%AC001%E7%AB%A0%2F%E6%9C%AC%E6%96%87.txt",
      { signal },
    );
  });

  it("throws when the file content response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: "ファイルが見つかりません" }, { status: 404 })),
    );

    await expect(
      fetchFileContent({ path: "missing.txt", workspaceRoot: "/tmp/novel" }),
    ).rejects.toThrow("ファイルが見つかりません");
  });

  it("throws when the file content response body is invalid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ path: 123 }, { status: 200 })),
    );

    await expect(
      fetchFileContent({ path: "broken.txt", workspaceRoot: "/tmp/novel" }),
    ).rejects.toThrow();
  });
});
