import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useAiConnection } from "./useAiConnection";
import type { LlmProviderChoice } from "../ai-agent/llmSelection";

const providers: LlmProviderChoice[] = [
  { id: "openai", displayName: "API", models: [{ id: "api-model", displayName: "API", available: true, supportsTools: true }] },
  { id: "openai-chatgpt", displayName: "ChatGPT", models: [] },
];
it("blocks saved retired connections until a current connection is explicitly selected", () => {
  localStorage.setItem("ghostwriter:ai-connection:assist", JSON.stringify({ legacy: true, connection: "codex" }));
  const { result } = renderHook(() => useAiConnection({ scope: "assist", providers, legacySelection: null }));
  expect(result.current.connection).toBe("codex");
  expect(result.current.blocked).toBe(true);
  expect(result.current.message).toContain("廃止");
  expect(fetch).not.toHaveBeenCalled();
  act(() => result.current.chooseConnection("api"));
  expect(result.current.connection).toBe("api");
  expect(result.current.blocked).toBe(false);
});
beforeEach(() => { localStorage.clear(); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: true, value: { accountId: "00000000-0000-4000-8000-000000000001", models: [{ slug: "dynamic-model", displayName: "Dynamic" }] } }))); });
it("defaults a new user to ChatGPT and chooses a model from the authenticated inventory", async () => {
  const { result } = renderHook(() => useAiConnection({ scope: "chat", providers, legacySelection: null }));
  expect(result.current.connection).toBe("chatgpt");
  await waitFor(() => expect(result.current.selection?.modelId).toBe("dynamic-model"));
});
it("retains ChatGPT after logout or a failed inventory request without API fallback", async () => {
  const { result } = renderHook(() => useAiConnection({ scope: "chat", providers, legacySelection: null }));
  await waitFor(() => expect(result.current.selection).not.toBeNull());
  vi.mocked(fetch).mockResolvedValue(Response.json({ ok: false, error: "token_expired" }));
  await act(() => result.current.refresh());
  expect(result.current.connection).toBe("chatgpt");
  expect(result.current.blocked).toBe(true);
  expect(result.current.selection?.providerId).toBe("openai-chatgpt");
});
it("preserves explicit API choice across remount and login", async () => {
  const first = renderHook(() => useAiConnection({ scope: "assist", providers, legacySelection: null }));
  act(() => first.result.current.chooseConnection("api"));
  first.unmount();
  const next = renderHook(() => useAiConnection({ scope: "assist", providers, legacySelection: null }));
  expect(next.result.current.connection).toBe("api");
});
it("does not expose ChatGPT with the preview disabled", () => {
  const { result } = renderHook(() => useAiConnection({ scope: "chat", providers: providers.slice(0, 1), legacySelection: null }));
  expect(result.current.enabled).toBe(false);
  expect(result.current.connection).toBe("api");
});
it("keeps existing model selections even before providers load", () => {
  localStorage.setItem("ghostwriter:user-settings:v1", JSON.stringify({ modelSelection: { providerId: "openai", modelId: "api-model" } }));
  const { result } = renderHook(() => useAiConnection({ scope: "chat", providers, legacySelection: { providerId: "openai", modelId: "api-model" } }));
  expect(result.current.connection).toBe("api");
});
it("restores a bound conversation's model and blocks a different authenticated account", async () => {
  const { result } = renderHook(() => useAiConnection({ scope: "chat", providers, legacySelection: null, binding: { modelId: "saved-model", accountId: "00000000-0000-4000-8000-000000000002" } }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.selection?.modelId).toBe("saved-model");
  expect(result.current.blocked).toBe(true);
  expect(result.current.message).toContain("異なるアカウント");
});
it("retains explicit API preference when SIWC becomes available", () => {
  localStorage.setItem("ghostwriter:ai-connection:chat", JSON.stringify({ legacy: true }));
  const { result, rerender } = renderHook(({ choices }) => useAiConnection({ scope: "chat", providers: choices, legacySelection: { providerId: "openai", modelId: "api-model" } }), { initialProps: { choices: providers.slice(0, 1) } });
  rerender({ choices: providers });
  expect(result.current.connection).toBe("api");
});
it("keeps a saved ChatGPT choice blocked when preview is disabled", () => {
  localStorage.setItem("ghostwriter:ai-connection:chat", JSON.stringify({ legacy: false, connection: "chatgpt", modelId: "saved" }));
  const { result } = renderHook(() => useAiConnection({ scope: "chat", providers: providers.slice(0, 1), legacySelection: null }));
  expect(result.current.connection).toBe("chatgpt");
  expect(result.current.blocked).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});
it("shows retry guidance for empty inventory and preserves the choice", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ ok: true, value: { accountId: "00000000-0000-4000-8000-000000000001", models: [] } }));
  const { result } = renderHook(() => useAiConnection({ scope: "chat", providers, legacySelection: null }));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.message).toContain("再取得");
  expect(result.current.blocked).toBe(true);
  expect(result.current.connection).toBe("chatgpt");
});
