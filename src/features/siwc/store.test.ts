// @vitest-environment node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCredentialStore } from "./store";


let directory: string;
let temporaryRoot: string;
beforeEach(async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "siwc-store-test-"));
  directory = join(temporaryRoot, "credentials");
});
afterEach(async () => {
  await rm(temporaryRoot, { recursive: true, force: true });
});
const initialize = () =>
  createCredentialStore(directory).update(async (state) => ({
    state,
    value: state.hostId,
  }));
describe("資格情報ストア", () => {
  it("別Bunプロセスが更新中でも同じlockで排他する", async () => {
    const script = `
      import { createCredentialStore } from './src/features/siwc/store.ts';
      const result = await createCredentialStore(process.env.SIWC_TEST_DIRECTORY).update(async state => {
        process.stdout.write('locked');
        await new Promise(resolve => process.stdin.once('data', resolve));
        return { state, value: null };
      });
      process.exit(result.ok ? 0 : 1);
    `;
    const child = spawn("bun", ["--eval", script], {
      env: { ...process.env, SIWC_TEST_DIRECTORY: directory },
      stdio: ["pipe", "pipe", "ignore"],
    });
    const exited = new Promise<number | null>((resolve) =>
      child.once("exit", resolve),
    );
    try {
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", () => reject(new Error("Lock worker exited early")));
        child.stdout.once("data", () => resolve());
      });
      expect(await initialize()).toEqual({ ok: false, error: "busy" });
      child.stdin.end("release\n");
      expect(await exited).toBe(0);
      expect((await initialize()).ok).toBe(true);
    } finally {
      if (child.exitCode === null) child.kill();
    }
  });
  it("host IDを一度だけ作り、owner-only権限でatomic保存する", async () => {
    const first = await initialize();
    expect(first.ok).toBe(true);
    expect(await initialize()).toEqual(first);
    if (process.platform !== "win32") {
      expect((await lstat(directory)).mode & 0o777).toBe(0o700);
      expect(
        (await lstat(join(directory, "credentials.json"))).mode & 0o777,
      ).toBe(0o600);
    }
    expect(await readdir(directory)).toEqual(["credentials.json"]);
  });
  it("更新失敗時は既存ファイルを維持してlockを解放する", async () => {
    await initialize();
    const previous = await readFile(
      join(directory, "credentials.json"),
      "utf8",
    );
    const result = await createCredentialStore(directory).update(async () => {
      throw new Error("dummy-secret");
    });
    expect(result).toEqual({ ok: false, error: "storage" });
    expect(await readFile(join(directory, "credentials.json"), "utf8")).toBe(
      previous,
    );
    expect(await readdir(directory)).toEqual(["credentials.json"]);
  });
  it("別ストアインスタンスからの同時更新を拒否する", async () => {
    const first = createCredentialStore(directory);
    const second = createCredentialStore(directory);
    let unlock = () => {};
    const blocked = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    let entered = () => {};
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = first.update(async (state) => {
      entered();
      await blocked;
      return { state, value: null };
    });
    await ready;
    try {
      expect(
        await second.update(async (state) => ({ state, value: null })),
      ).toEqual({ ok: false, error: "busy" });
    } finally {
      unlock();
    }
    expect((await pending).ok).toBe(true);
  });
  // Windowsの実ACL・junction/hardlinkはwindowsStore.test.tsで検証する。
  it.skipIf(process.platform === "win32")("広いPOSIXアクセス権を持つファイルを拒否する", async () => {
    await initialize();
    await chmod(join(directory, "credentials.json"), 0o644);
    expect(await createCredentialStore(directory).read()).toEqual({
      ok: false,
      error: "unsafe_storage",
    });
  });
  it.skipIf(process.platform === "win32")("symlinkをたどらない", async () => {
    await initialize();
    await unlink(join(directory, "credentials.json"));
    await writeFile(join(directory, "other"), "dummy-secret", { mode: 0o600 });
    await symlink(
      join(directory, "other"),
      join(directory, "credentials.json"),
    );
    expect((await createCredentialStore(directory).read()).ok).toBe(false);
    expect(await readFile(join(directory, "other"), "utf8")).toBe(
      "dummy-secret",
    );
  });
  it("壊れたJSONを空の登録として上書きしない", async () => {
    await initialize();
    const path = join(directory, "credentials.json");
    await writeFile(path, "not-json-dummy-secret", { mode: 0o600 });
    expect(await initialize()).toEqual({ ok: false, error: "storage" });
    expect(await readFile(path, "utf8")).toBe("not-json-dummy-secret");
  });
  it("schemaの不正なactive accountを保存しない", async () => {
    await initialize();
    const result = await createCredentialStore(directory).update(
      async (state) => ({
        state: { ...state, activeAccountId: randomUUID() },
        value: null,
      }),
    );
    expect(result).toEqual({ ok: false, error: "storage" });
  });
});
