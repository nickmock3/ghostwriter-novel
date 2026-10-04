import type { AiConnectionState } from "./useAiConnection";
export function ChatGptModelControls({ state, disabled = false, fixed = false, label = "ChatGPTモデル" }: {
  state: AiConnectionState; disabled?: boolean; fixed?: boolean; label?: string;
}) {
  return <div className="chatgpt-model-controls">
    <select aria-label={label} disabled={disabled || fixed || state.loading} value={state.selection?.modelId ?? ""} onChange={event => state.chooseModel(event.target.value)}>
      {!state.models.some(model => model.slug === state.selection?.modelId) ? <option value={state.selection?.modelId ?? ""}>{state.selection?.modelId ?? "モデル未選択"}</option> : null}
      {state.models.map(model => <option key={model.slug} value={model.slug}>{model.displayName}</option>)}
    </select>
    {fixed ? <p>この会話のモデルは固定されています。接続・モデルの変更は新規会話から行えます。</p> : null}
    {state.message ? <p role="status">{state.message}</p> : null}
    {state.blocked && state.enabled ? <><a href="/settings">ChatGPTでログイン・接続設定</a><button type="button" disabled={disabled || state.loading} onClick={() => { void state.refresh(); }}>モデルを再取得</button></> : null}
  </div>;
}
