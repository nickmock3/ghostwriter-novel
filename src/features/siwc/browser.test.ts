// @vitest-environment node
import { ChildProcess, spawn } from "node:child_process";
import { PassThrough } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { openSiwcBrowser } from "./api";

vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), spawn: vi.fn() }));
const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
afterEach(() => { Object.defineProperty(process, "platform", platformDescriptor); vi.mocked(spawn).mockReset(); });
function child(exit: number | Error = 0) {
  // OSプロセスの代替はイベントとstdinだけ。実ブラウザはこの単体テストでは起動しない。
  const process = new ChildProcess();
  process.stdin = new PassThrough();
  vi.spyOn(process.stdin, "end");
  vi.mocked(spawn).mockImplementation(() => {
    queueMicrotask(() => exit instanceof Error ? process.emit("error", exit) : process.emit("close", exit));
    return process;
  });
  return process;
}
it("Windowsは認証URLをコードや引数へ埋め込まずstdinで渡す", async () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  const fake = child();
  const url = "https://auth.openai.com/authorize?state=a&value=';$(test)|%22&nonce=%E6%97%A5";
  await openSiwcBrowser(url);
  expect(fake.stdin?.end).toHaveBeenCalledWith(url);
  const [command, args, options] = vi.mocked(spawn).mock.calls[0]!;
  expect(command).toMatch(/powershell\.exe$/i);
  expect(args).toEqual(expect.arrayContaining(["-WindowStyle", "Hidden"]));
  expect(JSON.stringify(args)).not.toContain(url);
  expect(options).toMatchObject({ windowsHide: true, shell: false });
});
it.each(["http://auth.openai.com/", "https://auth.openai.com.evil.test/", "https://user:password@auth.openai.com/", "file:///C:/secret", "not-a-url"])("不正URL %s はプロセスを作らず拒否する", async url => {
  await expect(openSiwcBrowser(url)).rejects.toMatchObject({ code: "invalid_response" });
  expect(spawn).not.toHaveBeenCalled();
});
it.each([1, new Error("private-url")])("Windows起動失敗は固定分類だけを返す", async failure => {
  Object.defineProperty(process, "platform", { value: "win32" });
  child(failure);
  await expect(openSiwcBrowser("https://auth.openai.com/authorize")).rejects.toMatchObject({ code: "authorization_failed", message: "authorization_failed" });
});
it.each([ ["darwin", "open"], ["linux", "xdg-open"] ])("%sの既存ブラウザ起動を維持する", async (platform, command) => {
  Object.defineProperty(process, "platform", { value: platform });
  child();
  const url = "https://auth.openai.com/authorize?state=a&nonce=b";
  await openSiwcBrowser(url);
  expect(spawn).toHaveBeenCalledWith(command, [url], expect.objectContaining({ shell: false, stdio: "ignore" }));
});
