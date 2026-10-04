// @vitest-environment node
import { ChildProcess, execFile } from "node:child_process";
import { PassThrough } from "node:stream";
import { expect, it, vi } from "vitest";
import { checkWindowsCredentialPermissions } from "./windowsCredentialPermissions";

vi.mock("node:child_process", async original => ({
  ...await original<typeof import("node:child_process")>(), execFile: vi.fn(),
}));

it("ACL確認はPowerShell自身にも非表示を指定し、pathはstdinへ渡す", async () => {
  const child = new ChildProcess();
  child.stdin = new PassThrough();
  const end = vi.spyOn(child.stdin, "end");
  vi.mocked(execFile).mockReturnValue(child);
  // 実ACLはwindowsStore.test.tsが担当。ここではウィンドウの起動契約を保証する。
  const pending = checkWindowsCredentialPermissions("private-directory");
  const [command, args, options, callback] = vi.mocked(execFile).mock.calls[0]!;
  callback?.(null, "", "");
  await pending;
  expect(command).toMatch(/powershell\.exe$/i);
  expect(args).toEqual(expect.arrayContaining(["-WindowStyle", "Hidden"]));
  expect(options).toMatchObject({ windowsHide: true });
  expect(JSON.stringify(args)).not.toContain("private-directory");
  expect(end).toHaveBeenCalledWith(expect.stringContaining("private-directory"));
});
