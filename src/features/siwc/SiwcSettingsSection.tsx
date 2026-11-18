import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { apiFetch } from "../../shared/client/apiTransport";
import { ChatGptRecoveryLink, ChatGptUsageLink } from "./ChatGptUsage";
import chatGptLogo from "./chatgpt-logo-white.svg";

const statusSchema = z.object({ ok: z.literal(true), value: z.object({
  busy: z.boolean(), loginPending: z.boolean().optional(), accounts: z.array(z.object({
    id: z.uuid(), active: z.boolean(), status: z.enum(["signed-in", "signed-out", "expired", "reauth-required"]),
    expiresAt: z.number().nullable(), directPermission: z.boolean(), email: z.email().optional(),
  })),
}) });
type Status = z.infer<typeof statusSchema>["value"];
type SettingsAction = "login" | "login/cancel" | "logout" | "select";
const welcomeKey = "ghostwriter:siwc-plan-welcome";
const actionSchema = z.union([z.object({ ok: z.literal(true), value: z.unknown() }), z.object({ ok: z.literal(false), error: z.string() })]);
const statusLabels = { "signed-in": "サインイン済み", "signed-out": "サインアウト済み", expired: "更新が必要です", "reauth-required": "再サインインが必要です" };
function PlanWelcome({ onDismiss }: { onDismiss: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!dialog.current || dialog.current.open) return;
    dialog.current.showModal();
    try { localStorage.setItem(welcomeKey, "true"); } catch { /* Storage can be disabled in the browser. */ }
  }, []);
  return <dialog ref={dialog} className="siwc-welcome" aria-labelledby="siwc-welcome-title" onClose={onDismiss}>
    <h3 id="siwc-welcome-title">ChatGPTプランを利用できます</h3>
    <p>Ghostwriterの対象のAIリクエストには、ChatGPTプランの利用枠が使われます。使用状況と上限はChatGPTの設定で確認できます。</p>
    <ChatGptUsageLink />
    <div className="siwc-welcome-actions">
      <button className="primary-action" type="button" autoFocus onClick={() => dialog.current?.close()}>わかりました</button>
    </div>
  </dialog>;
}
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
  const [pending, setPending] = useState<SettingsAction | "refreshing" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [usageLimited, setUsageLimited] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const welcomeSeen = useRef(false);
  const refresh = useCallback(async () => {
    const response = await apiFetch("/api/siwc/status");
    if (response.status === 404) { setStatus(null); return null; }
    const parsed = statusSchema.safeParse(await response.json());
    if (parsed.success) setStatus(parsed.data.value);
    return parsed.success ? parsed.data.value : null;
  }, []);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void refresh().then(enabled => {
      if (enabled && !disposed) timer = setInterval(() => { void refresh().catch(() => {}); }, 2000);
    }).catch(() => {});
    return () => { disposed = true; clearInterval(timer); };
  }, [refresh]);
  const perform = async (action: SettingsAction, body: { accountId?: string } = {}) => {
    if (action !== "login/cancel") setPending(action);
    setMessage(null);
    setUsageLimited(false);
    try {
      const response = await apiFetch(`/api/siwc/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = actionSchema.parse(await response.json());
      if (action !== "login/cancel") setPending("refreshing");
      if (!result.ok) {
        setMessage(errorText(result.error));
        setUsageLimited(result.error === "usage_limit");
      }
      else if (action === "logout" && z.object({ remoteRevocationConfirmed: z.literal(false) }).safeParse(result.value).success) {
        setMessage("このアプリからサインアウトしました。サーバー側の失効は確認できていません。");
      }
      const latest = await refresh();
      if (result.ok && action === "login" &&
          latest?.accounts.some(account => account.id === result.value && account.active && account.status === "signed-in" && account.directPermission) &&
          !welcomeSeen.current) {
        welcomeSeen.current = true;
        let seen = false;
        try { seen = localStorage.getItem(welcomeKey) === "true"; } catch { /* Storage can be disabled in the browser. */ }
        if (!seen) setWelcome(true);
      }
      if (result.ok && action !== "login/cancel") {
        window.dispatchEvent(new Event("ghostwriter:siwc-changed"));
        await onChanged?.();
      }
    } catch { setMessage(errorText("network")); }
    finally { if (action !== "login/cancel") setPending(null); }
  };
  if (!status) return null;
  const active = status.accounts.find(account => account.active);
  const busy = Boolean(pending) || status.busy || Boolean(status.loginPending);
  const signedIn = active?.status === "signed-in" && active.directPermission;
  return <section className="settings-section" aria-label="ChatGPTプラン接続">
    <h3>ChatGPT プラン（おすすめ）</h3>
    <p>対応するChatGPTプランの利用枠で、チャットとAIアシストを利用できます（実験版）。</p>
    {active ? <label className="siwc-account-picker">
      ChatGPTアカウント
      <select disabled={busy} value={active.id} onChange={event => {
        const account = status.accounts.find(candidate => candidate.id === event.target.value);
        if (account && account.id !== active.id) {
          void perform(account.status === "signed-in" ? "select" : "login", { accountId: account.id });
        }
      }}>
        {status.accounts.map((account, index) => <option key={account.id} value={account.id}>
          {account.email ? `${account.email}（登録 ${index + 1}）` : `ChatGPTアカウント ${index + 1}`}
        </option>)}
      </select>
    </label> : null}
    {active ? <p>{statusLabels[active.status]}{!active.directPermission && active.status === "signed-in" ? " — 推論の許可が必要です" : ""}</p> : <p>サインインしていません。</p>}
    <div className="settings-actions">
      {signedIn
        ? <button type="button" disabled={busy} onClick={() => { void perform("logout"); }}>ログアウト</button>
        : <button className="siwc-sign-in" data-oai-siwc-button="" type="button" disabled={busy} onClick={() => { void perform("login", active ? { accountId: active.id } : {}); }}>
          <img src={chatGptLogo} width={21} height={21} alt="" />
          Continue with ChatGPT
        </button>}
      {active && !signedIn && active.status !== "signed-out" ? <button type="button" disabled={busy} onClick={() => { void perform("logout"); }}>ログアウト</button> : null}
      {pending === "login" || status.loginPending ? <button type="button" onClick={() => { void perform("login/cancel"); }}>サインインをキャンセル</button> : null}
      {active ? <button type="button" disabled={busy} onClick={() => { void perform("login"); }}>別のアカウントを追加</button> : null}
    </div>
    {message ? <p role="status">{message} {usageLimited ? <ChatGptRecoveryLink code="usage_limit" /> : null}</p> : null}
    {welcome ? <PlanWelcome onDismiss={() => setWelcome(false)} /> : null}
  </section>;
}
