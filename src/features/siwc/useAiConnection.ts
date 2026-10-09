import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { apiFetch } from "../../shared/client/apiTransport";
import type { LlmProviderChoice, SelectedModel } from "../ai-agent/llmSelection";

export type AiConnection = "chatgpt" | "api" | "codex";
const preferenceSchema = z.object({ connection: z.enum(["chatgpt", "api", "codex"]).optional(), modelId: z.string().optional(), legacy: z.boolean() });
const inventorySchema = z.union([
  z.object({ ok: z.literal(true), value: z.object({ accountId: z.uuid(), models: z.array(z.object({ slug: z.string().min(1), displayName: z.string() })) }) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
const key = (scope: string) => `ghostwriter:ai-connection:${scope}`;
function readPreference(scope: string) {
  try {
    const saved = preferenceSchema.safeParse(JSON.parse(localStorage.getItem(key(scope)) ?? "null"));
    if (saved.success) return saved.data;
    const legacy = ["ghostwriter:user-settings:v1", "simple-ai-agent:user-settings:v1", "ghostwriter:llm-profile-settings:v1", "simple-ai-agent:llm-profile-settings:v1"].some(name => {
      const value = z.object({ modelSelection: z.object({ providerId: z.string(), modelId: z.string() }).nullish(), roleAssignments: z.record(z.string(), z.unknown()).optional() }).safeParse(JSON.parse(localStorage.getItem(name) ?? "null"));
      return value.success && Boolean(value.data.modelSelection || value.data.roleAssignments);
    });
    return { legacy };
  } catch { return { legacy: false }; }
}
// Capture migration intent before the old settings hooks persist generated defaults.
export function initializeAiConnectionPreferences() {
  for (const scope of ["chat", "assist"]) {
    try { localStorage.setItem(key(scope), JSON.stringify(readPreference(scope))); } catch { /* storage optional */ }
  }
}
export function siwcConnectionMessage(code: string): string {
  switch (code) {
    case "not_signed_in": case "not_authenticated": case "no_account": case "signed_out": return "ChatGPTでログインしてください。";
    case "reauth_required": case "token_expired": case "refresh_uncertain": case "authorization_failed": return "ChatGPTへの再ログインが必要です。";
    case "missing_scope": case "denied": return "このアカウントには推論の許可がありません。設定から認証を確認してください。";
    case "usage_limit": return "ChatGPTプランの利用上限に達しました。時間をおいて再度お試しください。";
    case "unsupported_platform": return "このOSではChatGPT接続をまだ利用できません。";
    case "ineligible": return "このアカウントはChatGPTプラン共有の対象ではありません。";
    case "invalid_model": return "選択したChatGPTモデルは利用できません。新規会話でモデルを選び直してください。";
    case "account_changed": return "アカウントが変わりました。設定で元のアカウントを選ぶか、新しい会話を開始してください。";
    case "empty": return "利用可能なChatGPTモデルがありません。再取得してください。";
    default: return "ChatGPTモデルを取得できません。設定でログインを確認するか、再取得してください。";
  }
}
export function siwcExecutionMessage(message: string): string {
  return ["not_signed_in", "token_expired", "refresh_uncertain", "authorization_failed", "missing_scope", "denied", "usage_limit", "ineligible", "invalid_model", "account_changed", "unsupported_platform"].includes(message)
    ? siwcConnectionMessage(message) : message;
}
export function useAiConnection(input: {
  scope: "chat" | "assist";
  providers: LlmProviderChoice[];
  legacySelection: SelectedModel | null;
  binding?: { modelId: string; accountId: string };
  fixedConnection?: AiConnection;
}) {
  const [preference, setPreference] = useState(() => readPreference(input.scope));
  const enabled = input.providers.some(provider => provider.id === "openai-chatgpt");
  const inferred = input.legacySelection?.providerId === "openai-chatgpt" ? "chatgpt" : preference.legacy ? "api" : enabled ? "chatgpt" : "api";
  const connection = input.binding ? "chatgpt" : input.fixedConnection ?? preference.connection ?? inferred;
  const [inventory, setInventory] = useState<z.infer<typeof inventorySchema> | null>(null);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoading(true);
    setInventory(null);
    try {
      const response = await apiFetch("/api/siwc/models");
      const parsed = inventorySchema.parse(await response.json());
      if (current === generation.current) setInventory(parsed);
    } catch {
      if (current === generation.current) setInventory({ ok: false, error: "network" });
    } finally { if (current === generation.current) setLoading(false); }
  }, []);
  useEffect(() => {
    if (!enabled || connection !== "chatgpt") return;
    void refresh();
    const changed = () => { void refresh(); };
    window.addEventListener("ghostwriter:siwc-changed", changed);
    window.addEventListener("focus", changed);
    return () => { ++generation.current; window.removeEventListener("ghostwriter:siwc-changed", changed); window.removeEventListener("focus", changed); };
  }, [enabled, connection, refresh]);
  const models = inventory?.ok ? inventory.value.models : [];
  const modelId = input.binding?.modelId ?? preference.modelId ?? (input.legacySelection?.providerId === "openai-chatgpt" ? input.legacySelection.modelId : undefined) ?? models[0]?.slug;
  useEffect(() => {
    if (connection !== "chatgpt" || !modelId || input.binding || preference.modelId) return;
    const next = { ...preference, connection: "chatgpt" as const, modelId };
    setPreference(next);
    try { localStorage.setItem(key(input.scope), JSON.stringify(next)); } catch { /* storage optional */ }
  }, [connection, modelId, input.binding, input.scope, preference]);
  const selection = connection === "chatgpt" && modelId ? { providerId: "openai-chatgpt", modelId } : null;
  const accountMismatch = Boolean(input.binding && inventory?.ok && input.binding.accountId !== inventory.value.accountId);
  const blocked = connection === "codex" || connection === "chatgpt" && (!enabled || loading || !inventory?.ok || !models.some(model => model.slug === modelId) || accountMismatch);
  const message = connection === "codex" ? "旧Codex接続は廃止されました。新しい会話でChatGPTプランまたはAPIキー接続を選択してください。" : connection !== "chatgpt" ? null : !enabled ? "ChatGPT接続は現在無効です。" : loading || !inventory ? "ChatGPTモデルを取得中…" : accountMismatch ? "この会話とは異なるアカウントです。設定で元のアカウントを選ぶか、新しい会話を開始してください。" : !inventory.ok ? siwcConnectionMessage(inventory.error) : models.length === 0 ? siwcConnectionMessage("empty") : !models.some(model => model.slug === modelId) ? "選択したChatGPTモデルは利用できません。モデルを選び直してください。" : null;
  function save(next: z.infer<typeof preferenceSchema>) {
    setPreference(next);
    try { localStorage.setItem(key(input.scope), JSON.stringify(next)); } catch { /* storage optional */ }
  }
  return { enabled, connection, selection, blocked, message, models, loading, refresh, hasExplicitConnection: preference.connection !== undefined,
    chooseConnection: (next: AiConnection) => save({ ...preference, connection: next }),
    chooseModel: (id: string) => save({ ...preference, connection: "chatgpt", modelId: id }),
  };
}
export type AiConnectionState = ReturnType<typeof useAiConnection>;
