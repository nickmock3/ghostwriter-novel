import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SiwcSettingsSection } from "./SiwcSettingsSection";
const id = "00000000-0000-4000-8000-000000000001";
const status = { ok: true, value: { busy: false, accounts: [{ id, active: true, status: "signed-in", expiresAt: 2000000000000, directPermission: true }] } };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("previewが無効なら設定を出さない", async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 404 }));
  vi.stubGlobal("fetch", fetcher);
  render(<SiwcSettingsSection />);
  await waitFor(() => expect(fetcher).toHaveBeenCalled());
  expect(screen.queryByRole("heading", { name: "ChatGPT プラン" })).not.toBeInTheDocument();
});
it("公開状態だけ表示し、logout成功後にモデル一覧を更新する", async () => {
  const changed = vi.fn(async () => {});
  const fetcher = vi.fn(async (url: string) => url.endsWith("/logout") ? Response.json({ ok: true, value: { remoteRevocationConfirmed: true } }) : Response.json(status));
  vi.stubGlobal("fetch", fetcher);
  render(<SiwcSettingsSection onChanged={changed} />);
  const button = await screen.findByRole("button", { name: "ログアウト" });
  expect(screen.queryByRole("button", { name: "ChatGPTでログイン" })).not.toBeInTheDocument();
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
  fireEvent.click(await screen.findByRole("button", { name: "ChatGPTでログイン" }));
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

it.each([
  ["signed-out", "ChatGPTでログイン"],
  ["expired", "もう一度ログイン"],
  ["reauth-required", "もう一度ログイン"],
])("%sではログイン操作を1つにし、選択中の登録を再利用する", async (accountStatus, label) => {
  const fetcher = vi.fn(async (url: string) => url.endsWith("/login")
    ? Response.json({ ok: false, error: "cancelled" })
    : Response.json({ ...status, value: { ...status.value, accounts: [{ ...status.value.accounts[0], status: accountStatus }] } }));
  vi.stubGlobal("fetch", fetcher);
  render(<SiwcSettingsSection />);
  fireEvent.click(await screen.findByRole("button", { name: label }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/siwc/login", expect.objectContaining({ body: JSON.stringify({ accountId: id }) })));
  expect(screen.queryByRole("button", { name: "再サインイン" })).not.toBeInTheDocument();
});

it("保存済み登録があってもアカウント追加・切替の操作を提供しない", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(status)));
  render(<SiwcSettingsSection />);
  await screen.findByText("サインイン済み");
  expect(screen.queryByRole("combobox", { hidden: true })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "別のアカウントを追加", hidden: true })).not.toBeInTheDocument();
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
  fireEvent.click(await screen.findByRole("button", { name: "もう一度ログイン" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/siwc/login", expect.objectContaining({ body: JSON.stringify({ accountId: id }) })));
});

it("別画面で開始したログイン待ちも重複開始を防ぎキャンセルできる", async () => {
  const fetcher = vi.fn(async () => Response.json({ ok: true, value: { busy: false, loginPending: true, accounts: [] } }));
  vi.stubGlobal("fetch", fetcher);
  render(<SiwcSettingsSection />);
  expect(await screen.findByRole("button", { name: "ChatGPTでログイン" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "サインインをキャンセル" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith("/api/siwc/login/cancel", expect.objectContaining({ method: "POST" })));
});
