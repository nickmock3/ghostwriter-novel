// @vitest-environment node
import { execFile } from "node:child_process";
import { link, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCredentialStore } from "./store";
import { testAccount, testNow } from "./test-support";
import type { Credentials } from "./credentials";
import { checkWindowsCredentialPermissions } from "./windowsCredentialPermissions";
import * as protection from "./windowsCredentialProtection";
import { createSiwcService } from "./service";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...original, rename: vi.fn(original.rename) };
});

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
const legacyCredentials = {
  version: 1,
  hostId: "urn:uuid:12345678-1234-4321-8912-123456789abc",
  accounts: [{ ...testAccount, identity: { ...testAccount.identity, email: "reader@example.com" } }],
  activeAccountId: testAccount.id,
} satisfies Credentials;
const legacyJson = JSON.stringify(legacyCredentials);

async function seedLegacyCredentials() {
  await checkWindowsCredentialPermissions(directory, { ensure: true });
  const file = join(directory, "credentials.json");
  await writeFile(file, legacyJson, { flag: "wx" });
  return file;
}

describe.skipIf(process.platform !== "win32")("Windowsの実資格情報保護", () => {
  it("旧形式の初回読込でロックを尊重し、登録とセッションを保ったまま再読込可能な暗号化形式に移行する", async () => {
    const file = await seedLegacyCredentials();
    const lock = join(directory, "operation.lock");
    await mkdir(lock);
    expect(await createCredentialStore(directory).read()).toEqual({ ok: false, error: "busy" });
    expect(await readFile(file, "utf8")).toBe(legacyJson);
    await rmdir(lock);

    const migrated = await createCredentialStore(directory).read();
    expect(migrated).toEqual({ ok: true, value: legacyCredentials });
    const encrypted = await readFile(file, "utf8");
    expect(encrypted).not.toContain(testAccount.id);
    expect(encrypted).not.toContain(testAccount.clientId);
    expect(encrypted).not.toContain(legacyCredentials.hostId);
    expect(encrypted).not.toContain("reader@example.com");
    expect(await createCredentialStore(directory).read()).toEqual(migrated);
    expect(await readFile(file, "utf8")).toBe(encrypted);
    expect(await readdir(directory)).toEqual(["credentials.json"]);
  }, 60_000);

  it("初回の状態取得とモデル一覧を並行しても既存登録を引き継ぐ", async () => {
    directory = join(parent, "siwc");
    await seedLegacyCredentials();
    const service = createSiwcService({
      dataRoot: parent,
      now: () => testNow,
      fetch: async () => Response.json({ models: [{ slug: "test-model", display_name: "Test model", visibility: "list" }] }),
    });
    const [status, inventory] = await Promise.all([service.status(), service.models()]);
    expect(status).toMatchObject({ ok: true, value: { accounts: [{ id: testAccount.id, active: true }] } });
    expect(inventory).toMatchObject({ ok: true, value: { accountId: testAccount.id } });
  }, 60_000);

  it.each(["暗号化", "置換"])("%sに失敗したとき旧ファイルを保持し、次回に移行できる", async operation => {
    const file = await seedLegacyCredentials();
    const failure = new Error("synthetic migration failure");
    const fault = operation === "暗号化"
      ? vi.spyOn(protection, "protectWindowsCredentialData").mockRejectedValueOnce(failure)
      : vi.mocked(rename).mockClear().mockRejectedValueOnce(failure);
    try {
      expect(await createCredentialStore(directory).read()).toEqual({ ok: false, error: "storage" });
      expect(fault).toHaveBeenCalledOnce();
      expect(await readFile(file, "utf8")).toBe(legacyJson);
      expect(await readdir(directory)).toEqual(["credentials.json"]);
    } finally {
      fault.mockRestore();
    }
    expect(await createCredentialStore(directory).read()).toEqual({ ok: true, value: legacyCredentials });
    expect(await readFile(file, "utf8")).not.toBe(legacyJson);
  }, 60_000);

  it("破損した暗号化ファイルを未登録として作り直さない", async () => {
    expect((await initialize()).ok).toBe(true);
    const file = join(directory, "credentials.json");
    const protectedFile = JSON.parse(await readFile(file, "utf8"));
    expect(protectedFile.format).toBe("windows-dpapi-v1");
    const damaged = JSON.stringify({ ...protectedFile, ciphertext: "AAAA" });
    await writeFile(file, damaged);

    expect(await createCredentialStore(directory).read()).toEqual({ ok: false, error: "storage" });
    expect(await initialize()).toEqual({ ok: false, error: "storage" });
    expect(await readFile(file, "utf8")).toBe(damaged);
    expect(await readdir(directory)).toEqual(["credentials.json"]);
  }, 60_000);

  it("本人だけのACLで保存し、別インスタンスの再読込と置換後も保持する", async () => {
    const first = await initialize();
    expect(first.ok).toBe(true);
    expect(await initialize()).toEqual(first);
    expect(await createCredentialStore(directory).read()).toMatchObject({ ok: true, value: { accounts: [testAccount] } });
    const protectedContents = await readFile(join(directory, "credentials.json"), "utf8");
    expect(protectedContents).not.toContain(testAccount.clientId);
    expect(protectedContents).not.toContain("dummy-access-token");
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
