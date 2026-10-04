import { ChatGptModelControls } from "../siwc/ChatGptModelControls";
import type { AiConnectionState } from "../siwc/useAiConnection";
import type { AvailableLlmProvider } from "../ai-agent/modelProvider";
import {
  ChatModelSelector,
  ChatModelUnavailableReasons,
} from "../ai-chat/ChatModelSelector";
import type { LlmProfileWithAvailability } from "../ai-chat/chatModelSelection";
import type { SelectedModel } from "../settings/settingsStorage";
import type { AiAssistExecutionOption } from "./aiAssistContracts";

export type AiAssistModelControlsProps = {
  connection?: AiConnectionState;
  additionalInstruction: string;
  blockReason: string | null;
  chatModelValue: string;
  executionOptions: AiAssistExecutionOption[];
  instructionPlaceholder: string;
  isBusy: boolean;
  isExecutionBlocked: boolean;
  llmProviders: AvailableLlmProvider[];
  onAdditionalInstructionChange: (value: string) => void;
  onExecutionOptionChange: (optionId: string) => void;
  onStandardModelChange: (value: string) => void;
  resolvedWritingSelection: SelectedModel | null;
  selectedExecutionOptionId: string;
  unavailableReasons: Array<{ id: string; reason: string }>;
  userDefinedProfiles: LlmProfileWithAvailability[];
};

export function AiAssistModelControls({
  connection,
  additionalInstruction,
  blockReason,
  chatModelValue,
  executionOptions,
  instructionPlaceholder,
  isBusy,
  isExecutionBlocked,
  llmProviders,
  onAdditionalInstructionChange,
  onExecutionOptionChange,
  onStandardModelChange,
  resolvedWritingSelection,
  selectedExecutionOptionId,
  unavailableReasons,
  userDefinedProfiles,
}: AiAssistModelControlsProps) {
  return (
    <div aria-label="AIアシスト設定" className="ai-assist-composer" role="group">
      <textarea
        aria-label="追加指示（任意）"
        className="ai-assist-composer-instruction"
        disabled={isExecutionBlocked || isBusy}
        maxLength={500}
        onChange={(event) => onAdditionalInstructionChange(event.target.value)}
        placeholder={instructionPlaceholder}
        rows={3}
        value={additionalInstruction}
      />
      {executionOptions.length > 0 || connection?.connection === "chatgpt" || connection?.connection === "codex" ? (
        <div className="ai-assist-composer-footer">
          <label className="chat-model-selector ai-assist-runtime-selector">
            <select
              aria-label="実行方式"
              className="ai-assist-composer-runtime"
              disabled={isBusy || Boolean(blockReason)}
              onChange={(event) => onExecutionOptionChange(event.target.value)}
              value={selectedExecutionOptionId}
            >
              {!executionOptions.some(option => option.id === selectedExecutionOptionId) ? <option value={selectedExecutionOptionId} disabled>{selectedExecutionOptionId === "chatgpt" ? "ChatGPTプラン" : selectedExecutionOptionId === "codex" ? "旧接続（廃止）" : "APIキー接続"}（利用不可）</option> : null}
              {executionOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {connection?.connection === "chatgpt" ? <ChatGptModelControls state={connection} disabled={isBusy} label="AIアシストChatGPTモデル" /> : connection?.connection === "codex" ? null : (
            <ChatModelSelector
              ariaLabel="AIアシストLLMモデル"
              chatModelValue={chatModelValue}
              disabled={
                isBusy ||
                Boolean(blockReason) ||
                (userDefinedProfiles.length === 0 && llmProviders.length === 0)
              }
              llmProviders={llmProviders.filter(provider => provider.id !== "openai-chatgpt")}
              onChange={onStandardModelChange}
              resolvedMainSelection={resolvedWritingSelection}
              userDefinedProfiles={userDefinedProfiles.filter(profile => profile.providerId !== "openai-chatgpt")}
            />
          )}
        </div>
      ) : null}
      {connection?.connection === "codex" ? <p role="status">旧Codex連携は廃止されました。接続を選び直してください。</p> : null}
      {!executionOptions.some(option => option.id === selectedExecutionOptionId) ? <p role="status">選択した接続を利用できません。<a href="/settings">設定を確認</a>してください。</p> : null}
      {connection?.connection !== "chatgpt" ? <ChatModelUnavailableReasons reasons={unavailableReasons} /> : null}
    </div>
  );
}
