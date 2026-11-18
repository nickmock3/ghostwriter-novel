import { ChatGptUsageLink } from "./ChatGptUsage";
import type { AiConnectionState } from "./useAiConnection";

const fixedModelHint = "この会話ではモデルを変更できません。変更するには新規会話を開始してください。";

export function ChatGptModelControls({ state, disabled = false, fixed = false, showPlanUsage = true, label = "ChatGPTモデル" }: {
  state: AiConnectionState; disabled?: boolean; fixed?: boolean; showPlanUsage?: boolean; label?: string;
}) {
  const selectedLabel = state.models.find(model => model.slug === state.selection?.modelId)?.displayName
    ?? state.selection?.modelId ?? "モデル未選択";
  return <div className="chatgpt-model-controls">
    <span title={fixed ? `${selectedLabel}\n${fixedModelHint}` : undefined}>
      <select
        title={fixed ? undefined : selectedLabel}
        aria-label={label}
        aria-description={fixed ? fixedModelHint : undefined}
        disabled={disabled || fixed || state.loading}
        value={state.selection?.modelId ?? ""}
        onChange={event => state.chooseModel(event.target.value)}
      >
        {!state.models.some(model => model.slug === state.selection?.modelId) ? <option value={state.selection?.modelId ?? ""}>{state.selection?.modelId ?? "モデル未選択"}</option> : null}
        {state.models.map(model => <option key={model.slug} value={model.slug}>{model.displayName}</option>)}
      </select>
    </span>
    {showPlanUsage && !state.blocked ? <p className="chatgpt-plan-usage"><span>ChatGPTプラン利用中</span> <ChatGptUsageLink /></p> : null}
    {state.message ? <p role="status">{state.message}</p> : null}
    {state.inventoryError === "usage_limit" ? <ChatGptUsageLink /> :
      state.blocked && state.enabled && state.inventoryError !== "ineligible" ? <><a href="/settings">ChatGPTでログイン・接続設定</a><button type="button" disabled={disabled || state.loading} onClick={() => { void state.refresh(); }}>モデルを再取得</button></> : null}
  </div>;
}
