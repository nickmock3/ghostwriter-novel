import { siwcExecutionMessage } from "./useAiConnection";

export function ChatGptUsageLink() {
  return <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">利用状況を管理</a>;
}

export function ChatGptRecoveryLink({ code }: { code: string }) {
  if (code === "usage_limit") return <ChatGptUsageLink />;
  if (code === "ineligible") return null;
  return <a href="/settings">ChatGPT接続設定</a>;
}

export function ChatGptExecutionError({ code }: { code: string }) {
  return <>{siwcExecutionMessage(code)} <ChatGptRecoveryLink code={code} /></>;
}
