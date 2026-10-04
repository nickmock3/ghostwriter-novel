import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { apiFetch } from "../../shared/client/apiTransport";

const statusSchema = z.object({ ok: z.literal(true), value: z.object({
  busy: z.boolean(), loginPending: z.boolean().optional(), accounts: z.array(z.object({
    id: z.uuid(), active: z.boolean(), status: z.enum(["signed-in", "signed-out", "expired", "reauth-required"]),
    expiresAt: z.number().nullable(), directPermission: z.boolean(),
  })),
}) });
type Status = z.infer<typeof statusSchema>["value"];
const actionSchema = z.union([z.object({ ok: z.literal(true), value: z.unknown() }), z.object({ ok: z.literal(false), error: z.string() })]);
const statusLabels = { "signed-in": "サインイン済み", "signed-out": "サインアウト済み", expired: "更新が必要です", "reauth-required": "再サインインが必要です" };
function errorText(code: string): string {
  switch (code) {
    case "busy": return "ChatGPTで処理中です。完了後に操作してください。";
    case "cancelled": return "サインインをキャンセルしました。";
    case "denied": return "サインインが許可されませんでした。";
    case "missing_scope": return "このアカウントでは推論の許可が付与されていません。";
    case "ineligible": return "このアカウントはChatGPTプラン共有の対象ではありません。";
    case "usage_limit": return "ChatGPTプランの利用上限に達しました。";
    case "refresh_uncertain": case "token_expired": return "再サインインが必要です。";
    case "refresh_not_ready": return "まだ認証を更新できません。しばらく待ってください。";
    case "unsupported_platform": return "このOSではChatGPT接続をまだ利用できません。";
    default: return "ChatGPTへの接続に失敗しました。時間をおいて再度お試しください。";
  }
}
export function SiwcSettingsSection({ onChanged }: { onChanged?: () => Promise<void> } = {}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const response = await apiFetch("/api/siwc/status");
    if (response.status === 404) { setStatus(null); return false; }
    const parsed = statusSchema.safeParse(await response.json());
    if (parsed.success) setStatus(parsed.data.value);
    return parsed.success;
  }, []);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void refresh().then(enabled => {
      if (enabled && !disposed) timer = setInterval(() => { void refresh().catch(() => {}); }, 2000);
    }).catch(() => {});
    return () => { disposed = true; clearInterval(timer); };
  }, [refresh]);
  const perform = async (action: string, body: object = {}) => {
    if (action !== "login/cancel") setPending(action);
    setMessage(null);
    try {
      const response = await apiFetch(`/api/siwc/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = actionSchema.parse(await response.json());
      if (!result.ok) setMessage(errorText(result.error));
      else {
        if (action === "logout" && z.object({ remoteRevocationConfirmed: z.literal(false) }).safeParse(result.value).success) setMessage("このアプリからサインアウトしました。サーバー側の失効は確認できていません。");
        if (action !== "login/cancel") { window.dispatchEvent(new Event("ghostwriter:siwc-changed")); await onChanged?.(); }
      }
      await refresh();
    } catch { setMessage(errorText("network")); }
    finally { if (action !== "login/cancel") setPending(null); }
  };
  if (!status) return null;
  const active = status.accounts.find(account => account.active);
  const busy = Boolean(pending) || status.busy || Boolean(status.loginPending);
  const signedIn = active?.status === "signed-in" && active.directPermission;
  const loginLabel = !active || active.status === "signed-out" ? "ChatGPTでログイン" : "もう一度ログイン";
  return <section className="settings-section" aria-label="ChatGPTプラン接続">
    <h3>ChatGPT プラン（おすすめ）</h3>
    <p>実験版です。ChatGPTプランを使って執筆します。ログイン後はチャット・AIアシストで「ChatGPTプラン」を選んで利用できます。</p>
    {active ? <p>{statusLabels[active.status]}{!active.directPermission && active.status === "signed-in" ? " — 推論の許可が必要です" : ""}</p> : <p>サインインしていません。</p>}
    <div className="settings-actions">
      {signedIn
        ? <button type="button" disabled={busy} onClick={() => { void perform("logout"); }}>ログアウト</button>
        : <button className="primary-action" type="button" disabled={busy} onClick={() => { void perform("login", active ? { accountId: active.id } : {}); }}>{loginLabel}</button>}
      {active && !signedIn && active.status !== "signed-out" ? <button type="button" disabled={busy} onClick={() => { void perform("logout"); }}>ログアウト</button> : null}
      {pending === "login" || status.loginPending ? <button type="button" onClick={() => { void perform("login/cancel"); }}>サインインをキャンセル</button> : null}
    </div>
    {message ? <p role="status">{message}</p> : null}
  </section>;
}
