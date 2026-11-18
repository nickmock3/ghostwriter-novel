import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { SiwcSettingsSection } from "./SiwcSettingsSection";
const id = "00000000-0000-4000-8000-000000000001";
const status = { ok: true, value: { busy: false, accounts: [{ id, active: true, status: "signed-in", expiresAt: 2000000000000, directPermission: true }] } };
const dialogMethods = {
  showModal(this: HTMLDialogElement) { this.open = true; },
  close(this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event("close")); },
};
const missingDialogMethods = (Object.keys(dialogMethods) as (keyof typeof dialogMethods)[])
  .filter(method => typeof HTMLDialogElement.prototype[method] !== "function");
beforeAll(() => {
  // jsdomにないdialog操作だけ補う。実際のモーダル操作はPlaywrightで確認する。
  for (const method of missingDialogMethods) {
    Object.defineProperty(HTMLDialogElement.prototype, method, { configurable: true, value: dialogMethods[method] });
  }
});
afterAll(() => {
  for (const method of missingDialogMethods) Reflect.deleteProperty(HTMLDialogElement.prototype, method);
});
afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
it("previewが無効なら設定を出さない", async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetcher);
  render(<SiwcSettingsSection />);
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(screen.queryByRole("region", { name: "ChatGPTプラン接続" })).not.toBeInTheDocument();
});
it("公開状態だけ表示し、logout成功後にモデル一覧を更新する", async () => {
  const changed = vi.fn(async () => {});
  const fetcher = vi.fn(async (url: string) => url.endsWith("/logout") ? Response.json({ ok: true, value: { remoteRevocationConfirmed: true } }) : Response.json(status));
  vi.stubGlobal("fetch", fetcher);
  render(<SiwcSettingsSection onChanged={changed} />);
  const button = await screen.findByRole("button", { name: "ログアウト" });
  expect(screen.queryByRole("button", { name: "Continue with ChatGPT" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "再サインイン" })).not.toBeInTheDocument();
  expect(screen.getByText("サインイン済み")).toBeInTheDocument();
  fireEvent.click(button);
  await waitFor(() => expect(changed).toHaveBeenCalledOnce());
  expect(fetcher).toHaveBeenCalledWith("/api/siwc/logout", expect.objectContaining({ method: "POST", body: "{}" }));
});
it("ログイン待ちにキャンセル操作ができ、外部エラー本文を表示しない", async () => {
  let finish: (response: Response) => void = () => {};
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("/login")) return new Promise<Response>(resolve => { finish = resolve; });
    if (url.endsWith("/login/cancel")) { finish(Response.json({ ok: false, error: "cancelled", detail: "dummy-token" })); return Response.json({ ok: true, value: null }); }
    return Response.json({ ok: true, value: { busy: false, accounts: [] } });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<SiwcSettingsSection />);
  fireEvent.click(await screen.findByRole("button", { name: "Continue with ChatGPT" }));
  expect(fetcher).toHaveBeenCalledWith("/api/siwc/login", expect.objectContaining({ body: "{}" }));
  fireEvent.click(await screen.findByRole("button", { name: "サインインをキャンセル" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: "サインインをキャンセル" })).not.toBeInTheDocument());
  expect(document.body.textContent).not.toContain("dummy-token");
});
it("実行中はlogoutを無効にする", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ...status, value: { ...status.value, busy: true } })));
  render(<SiwcSettingsSection />);
  expect(await screen.findByRole("button", { name: "ログアウト" })).toBeDisabled();
});

it.each(["signed-out", "expired", "reauth-required"])("%sでは選択中の登録を再利用する", async (accountStatus) => {
  const fetcher = vi.fn(async (url: string) => url.endsWith("/login")
    ? Response.json({ ok: false, error: "cancelled" })
    : Response.json({ ...status, value: { ...status.value, accounts: [{ ...status.value.accounts[0], status: accountStatus }] } }));
  vi.stubGlobal("fetch", fetcher);
  render(<SiwcSettingsSection />);
  fireEvent.click(await screen.findByRole("button", { name: "Continue with ChatGPT" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/siwc/login", expect.objectContaining({ body: JSON.stringify({ accountId: id }) })));
  expect(screen.queryByRole("button", { name: "再サインイン" })).not.toBeInTheDocument();
});

it("現在の登録を表示し、保存済み登録を選ぶ操作と新規登録を区別する", async () => {
  const otherId = "00000000-0000-4000-8000-000000000002";
  let activeId = id;
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/select")) {
      activeId = JSON.parse(String(init?.body)).accountId;
      return Response.json({ ok: true, value: activeId });
    }
    if (url.endsWith("/login")) return Response.json({ ok: false, error: "cancelled" });
    return Response.json({ ok: true, value: { busy: false, accounts: [id, otherId].map(accountId => ({
      ...status.value.accounts[0], id: accountId, active: accountId === activeId,
    })) } });
  });
  vi.stubGlobal("fetch", fetcher);
  render(<SiwcSettingsSection />);
  const picker = await screen.findByRole("combobox", { name: "ChatGPTアカウント" });
  expect(picker).toHaveValue(id);
  fireEvent.change(picker, { target: { value: otherId } });
  await waitFor(() => expect(picker).toHaveValue(otherId));
  expect(fetcher).toHaveBeenCalledWith("/api/siwc/select", expect.objectContaining({ body: JSON.stringify({ accountId: otherId }) }));
  fireEvent.click(screen.getByRole("button", { name: "別のアカウントを追加" }));
  expect(fetcher).toHaveBeenCalledWith("/api/siwc/login", expect.objectContaining({ body: "{}" }));
});

it("プラン利用が許可されたサインインの直後だけ、使用状況の案内を表示する", async () => {
  let registered = false;
  let signedIn = false;
  let allowed = false;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url.endsWith("/login")) {
      registered = signedIn = true;
      return Response.json({ ok: true, value: id });
    }
    if (url.endsWith("/logout")) {
      signedIn = false;
      return Response.json({ ok: true, value: { remoteRevocationConfirmed: true } });
    }
    return Response.json({ ok: true, value: { busy: false, accounts: registered ? [{
      ...status.value.accounts[0], status: signedIn ? "signed-in" : "signed-out", directPermission: signedIn && allowed,
    }] : [] } });
  }));
  const settings = render(<SiwcSettingsSection />);
  fireEvent.click(await screen.findByRole("button", { name: "Continue with ChatGPT" }));
  await screen.findByText(/推論の許可が必要です/);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  allowed = true;
  fireEvent.click(screen.getByRole("button", { name: "Continue with ChatGPT" }));
  const dialog = await screen.findByRole("dialog", { name: "ChatGPTプランを利用できます" });
  expect(dialog).toHaveTextContent("対象のAIリクエスト");
  expect(screen.getByRole("link", { name: "利用状況を管理" })).toHaveAttribute("href", "https://chatgpt.com/settings/usage");
  fireEvent.click(screen.getByRole("button", { name: "わかりました" }));
  settings.unmount();
  render(<SiwcSettingsSection />);
  fireEvent.click(await screen.findByRole("button", { name: "ログアウト" }));
  fireEvent.click(await screen.findByRole("button", { name: "Continue with ChatGPT" }));
  await screen.findByText("サインイン済み");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("認証切れでも保存済み接続をログアウトできる", async () => {
  const fetcher = vi.fn(async (url: string) => url.endsWith("/logout")
    ? Response.json({ ok: true, value: { remoteRevocationConfirmed: true } })
    : Response.json({ ...status, value: { ...status.value, accounts: [{ ...status.value.accounts[0], status: "expired" }] } }));
  vi.stubGlobal("fetch", fetcher);
  render(<SiwcSettingsSection />);
  fireEvent.click(await screen.findByRole("button", { name: "ログアウト" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/siwc/logout", expect.objectContaining({ body: "{}" })));
});

it("推論許可が不足した登録は再利用して認証をやり直せる", async () => {
  const fetcher = vi.fn(async (url: string) => url.endsWith("/login") ? Response.json({ ok: false, error: "cancelled" })
    : Response.json({ ...status, value: { ...status.value, accounts: [{ ...status.value.accounts[0], directPermission: false }] } }));
  vi.stubGlobal("fetch", fetcher);
  render(<SiwcSettingsSection />);
  fireEvent.click(await screen.findByRole("button", { name: "Continue with ChatGPT" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/siwc/login", expect.objectContaining({ body: JSON.stringify({ accountId: id }) })));
});

it("別画面で開始したログイン待ちも重複開始を防ぎキャンセルできる", async () => {
  const fetcher = vi.fn(async () => Response.json({ ok: true, value: { busy: false, loginPending: true, accounts: [] } }));
  vi.stubGlobal("fetch", fetcher);
  render(<SiwcSettingsSection />);
  expect(await screen.findByRole("button", { name: "Continue with ChatGPT" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "サインインをキャンセル" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/siwc/login/cancel", expect.objectContaining({ method: "POST" })));
});
