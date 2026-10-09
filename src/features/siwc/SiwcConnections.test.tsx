import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ChatPane } from "../ai-chat/ChatPane";
import { AiAssistPane } from "../ai-assist/AiAssistPane";
import { StartGuideModal } from "../workspace/StartGuideModal";
import type { LlmProviderChoice } from "../llm/selection/llmSelection";
const providers: LlmProviderChoice[] = [{ id: "openai-chatgpt", displayName: "ChatGPT", models: [] }];
let signedIn = false;
const requests: Record<string, unknown>[] = [];
beforeEach(() => {
  localStorage.clear(); signedIn = false; requests.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (String(url).startsWith("/api/conversations")) return Response.json({ activeConversation: null, conversations: [], errors: [] });
    if (String(url) === "/api/siwc/models") return Response.json(signedIn ? { ok: true, value: { accountId: "00000000-0000-4000-8000-000000000001", models: [{ slug: "dynamic", displayName: "Dynamic" }] } } : { ok: false, error: "not_signed_in" });
    if (String(url) === "/api/chat/messages") { requests.push(JSON.parse(String(init?.body))); return Response.json({ message: "usage_limit" }, { status: 400 }); }
    return new Response(null, { status: 404 });
  }));
});
it("guides a new user to ChatGPT, refreshes after login and sends the selected billing path", async () => {
  render(<ChatPane mode="chat" fileContext={{ workspaceRoot: "/tmp/test" }} llm={{ providers }} />);
  await screen.findByText("ChatGPTでログインしてください。");
  fireEvent.change(screen.getByPlaceholderText("書きたいこと、相談したいことを入力"), { target: { value: "test" } });
  expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
  expect(screen.queryByRole("link", { name: "APIキーを設定" })).not.toBeInTheDocument();
  signedIn = true;
  fireEvent.click(screen.getByRole("button", { name: "モデルを再取得" }));
  await waitFor(() => expect(screen.getByLabelText("ChatGPTモデル")).toHaveValue("dynamic"));
  fireEvent.click(screen.getByRole("button", { name: "送信" }));
  await waitFor(() => expect(requests).toHaveLength(1));
  expect(requests[0]).toMatchObject({ modelSelection: { providerId: "openai-chatgpt", modelId: "dynamic" } });
  expect(requests[0]?.llmProfileId).toBeUndefined();
  expect(await screen.findByText(/ChatGPTプランの利用上限/)).toBeInTheDocument();
  expect(screen.getByLabelText("会話の実行方式")).toHaveValue("chatgpt");
  expect(requests).toHaveLength(1);
});
it("executes SIWC-only assist with explicit model and leaves Apply to the user", async () => {
  signedIn = true;
  const onExecute = vi.fn().mockRejectedValue(new Error("test completed"));
  render(<AiAssistPane executionOptions={[{ id: "chatgpt", label: "ChatGPTプラン", runtime: "vercel-ai" }]} llmProviders={providers} target={{ path: "draft.txt", content: "before", isDirty: false, selection: null }} onApply={vi.fn()} onReject={vi.fn()} onExecute={onExecute} />);
  await waitFor(() => expect(screen.getByLabelText("AIアシストChatGPTモデル")).toHaveValue("dynamic"));
  fireEvent.click(screen.getByRole("button", { name: "推敲を実行" }));
  await waitFor(() => expect(onExecute).toHaveBeenCalledWith(expect.objectContaining({ executionOptionId: "chatgpt", standardModelSelection: { kind: "model", providerId: "openai-chatgpt", modelId: "dynamic" } })));
});
it("puts login in the first-use guide only when SIWC is enabled", () => {
  render(<StartGuideModal siwcEnabled workspaceRoot="/tmp/test" onDismiss={vi.fn()} onIdeaConsult={vi.fn()} onOpenPath={vi.fn()} />);
  expect(screen.getByRole("link", { name: "ChatGPTでログイン" })).toHaveAttribute("href", "/settings");
});
it("restores the assist API model across remount without changing to ChatGPT", async () => {
  const options = [{ id: "standard", label: "APIキー接続", runtime: "vercel-ai" as const }, { id: "chatgpt", label: "ChatGPTプラン", runtime: "vercel-ai" as const }];
  const api = { id: "openai", displayName: "API", models: [{ id: "chosen", displayName: "Chosen", available: true, supportsTools: true }] };
  const props = { executionOptions: options, llmProviders: [...providers, api], target: { path: "draft.txt", content: "before", isDirty: false, selection: null }, onApply: vi.fn(), onReject: vi.fn(), onExecute: vi.fn() };
  const first = render(<AiAssistPane {...props} />);
  fireEvent.change(screen.getByLabelText("実行方式"), { target: { value: "standard" } });
  fireEvent.change(screen.getByLabelText("AIアシストLLMモデル"), { target: { value: "openai:chosen" } });
  first.unmount();
  render(<AiAssistPane {...props} />);
  expect(screen.getByLabelText("実行方式")).toHaveValue("standard");
  expect(screen.getByLabelText("AIアシストLLMモデル")).toHaveValue("openai:chosen");
});
it("does not send a legacy SIWC model through a newly selected API connection", async () => {
  localStorage.setItem("ghostwriter:ai-connection:chat", JSON.stringify({ legacy: true, connection: "api" }));
  render(<ChatPane mode="chat" fileContext={{ workspaceRoot: "/tmp/test" }} llm={{ providers, modelSelection: { providerId: "openai-chatgpt", modelId: "old" } }} />);
  await screen.findByText("APIキー接続のモデルを選択してください。");
  fireEvent.change(screen.getByPlaceholderText("書きたいこと、相談したいことを入力"), { target: { value: "test" } });
  expect(screen.getByRole("button", { name: "送信" })).toBeDisabled();
  expect(requests).toHaveLength(0);
});
