// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { listModels } from "./models";
import { testAccount, testNow } from "./test-support";

const signal = new AbortController().signal;
describe("モデル一覧", () => {
  it("models配列を読み、未知visibilityを除外して順序を保持する", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        models: [
          { slug: "b", display_name: "Second", visibility: "list" },
          {
            slug: "hidden",
            display_name: "Hidden",
            visibility: "future-value",
          },
          { slug: "a", display_name: "First", visibility: "list" },
        ],
      }),
    );
    expect(await listModels(testAccount, fetcher, signal, testNow)).toEqual({
      ok: true,
      value: [
        { slug: "b", displayName: "Second" },
        { slug: "a", displayName: "First" },
      ],
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/models",
      expect.objectContaining({
        headers: { authorization: "Bearer dummy-access-token" },
        redirect: "error",
      }),
    );
  });
  it.each([
    { data: [] },
    { models: null },
    { models: [{ slug: "a", display_name: null, visibility: "list" }] },
  ])("不正な形式 %j を拒否", async (body) => {
    expect(
      await listModels(
        testAccount,
        async () => Response.json(body),
        signal,
        testNow,
      ),
    ).toEqual({ ok: false, error: "invalid_response" });
  });
  it("期限切れ時は外部通信しない", async () => {
    const fetcher = vi.fn();
    expect(
      await listModels(testAccount, fetcher, signal, testNow + 3600000),
    ).toEqual({ ok: false, error: "token_expired" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("detailを表示せずHTTPステータスから安全なエラーにする", async () => {
    expect(
      await listModels(
        testAccount,
        async () => Response.json({ detail: "dummy-secret" }, { status: 403 }),
        signal,
        testNow,
      ),
    ).toEqual({ ok: false, error: "denied" });
  });
});
