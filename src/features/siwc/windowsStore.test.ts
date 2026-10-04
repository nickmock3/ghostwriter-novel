// @vitest-environment node
import { execFile } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCredentialStore } from "./store";
import { testAccount } from "./test-support";

// 実ACLを検証する。OAuth/実アカウントは使用しない。
function powershell(script: string, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference = 'Stop'; [Console]::InputEncoding = [Text.UTF8Encoding]::new($false); " + script],
      { windowsHide: true }, (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.end(path);
  });
}
let parent: string;
let directory: string;
beforeEach(async () => {
  parent = await mkdtemp(join(tmpdir(), "siwc-windows-"));
  directory = join(parent, "日本語 [private] & 'store");
});
afterEach(async () => { await rm(parent, { recursive: true, force: true }); });
const initialize = () => createCredentialStore(directory).update(async state => ({
  state: { ...state, accounts: [testAccount], activeAccountId: testAccount.id }, value: state.hostId,
}));
describe.skipIf(process.platform !== "win32")("Windowsの実資格情報保護", () => {
  it("本人だけのACLで保存し、別インスタンスの再読込と置換後も保持する", async () => {
    const first = await initialize();
    expect(first.ok).toBe(true);
    expect(await initialize()).toEqual(first);
    expect(await createCredentialStore(directory).read()).toMatchObject({ ok: true, value: { accounts: [testAccount] } });
    for (const path of [directory, join(directory, "credentials.json")]) {
      const check = await powershell(`
        $p = [Console]::In.ReadToEnd()
        $info = if ([IO.Directory]::Exists($p)) { [IO.DirectoryInfo]::new($p) } else { [IO.FileInfo]::new($p) }
        $acl = $info.GetAccessControl()
        $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
        $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
        if ($acl.GetOwner([Security.Principal.SecurityIdentifier]) -ne $sid) { exit 2 }
        if ($rules.Count -ne 1 -or $rules[0].IdentityReference -ne $sid -or $rules[0].AccessControlType -ne 'Allow' -or $rules[0].FileSystemRights -ne 'FullControl') { exit 3 }
        if ([IO.Directory]::Exists($p) -and -not $acl.AreAccessRulesProtected) { exit 4 }
        [Console]::Out.Write('private')`, path);
      expect(check).toBe("private");
    }
    expect(await readdir(directory)).toEqual(["credentials.json"]);
  }, 60_000);
  it.each(["directory", "file"])("広い%s ACLを自動修復せず読み書きとも拒否する", async target => {
    expect((await initialize()).ok).toBe(true);
    const file = join(directory, "credentials.json");
    const before = await readFile(file, "utf8");
    await powershell(`
      $p = [Console]::In.ReadToEnd()
      $info = if ([IO.Directory]::Exists($p)) { [IO.DirectoryInfo]::new($p) } else { [IO.FileInfo]::new($p) }
      $acl = $info.GetAccessControl()
      $rule = [Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-1-0'), 'Read', 'Allow')
      $acl.AddAccessRule($rule)
      $info.SetAccessControl($acl)`, target === "file" ? file : directory);
    expect(await createCredentialStore(directory).read()).toEqual({ ok: false, error: "unsafe_storage" });
    expect(await initialize()).toEqual({ ok: false, error: "unsafe_storage" });
    expect(await readFile(file, "utf8")).toBe(before);
  }, 60_000);
  it("既存の継承ACLディレクトリを拒否して資格情報を作らない", async () => {
    await mkdir(directory);
    expect(await initialize()).toEqual({ ok: false, error: "unsafe_storage" });
    expect(await readdir(directory)).toEqual([]);
  });
  it("junction保存先とその配下への書込みを拒否する", async () => {
    const outside = join(parent, "outside");
    await mkdir(outside);
    await symlink(outside, directory, "junction");
    expect(await initialize()).toEqual({ ok: false, error: "unsafe_storage" });
    expect(await createCredentialStore(join(directory, "child")).update(async state => ({ state, value: null })))
      .toEqual({ ok: false, error: "unsafe_storage" });
    expect(await readdir(outside)).toEqual([]);
  });
  it("hardlinkを拒否し、失敗した更新は元ファイルと排他状態を維持する", async () => {
    expect((await initialize()).ok).toBe(true);
    const file = join(directory, "credentials.json");
    const before = await readFile(file, "utf8");
    expect(await createCredentialStore(directory).update(async () => { throw new Error("dummy-secret"); }))
      .toEqual({ ok: false, error: "storage" });
    expect(await readFile(file, "utf8")).toBe(before);
    expect(await readdir(directory)).toEqual(["credentials.json"]);
    await link(file, join(parent, "alias.json"));
    expect(await createCredentialStore(directory).read()).toEqual({ ok: false, error: "unsafe_storage" });
    expect(await initialize()).toEqual({ ok: false, error: "unsafe_storage" });
    expect(await readFile(file, "utf8")).toBe(before);
  }, 60_000);
});
