import { ChatGptModelControls } from "../siwc/ChatGptModelControls";
import type { AiConnection, AiConnectionState } from "../siwc/useAiConnection";
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { FaArrowUp } from "react-icons/fa";
import type { LlmProviderChoice, SelectedModel } from "../settings/settingsStorage";
import type { DroppedTextFileStatus } from "./chatConversationClient";
import {
  ChatModelSelector,
  ChatModelUnavailableReasons,
  handleChatModelSelectorChange,
} from "./ChatModelSelector";
import type { LlmProfileWithAvailability } from "./chatModelSelection";
import { ChatTokenUsageIndicator } from "./ChatTokenUsageIndicator";
import type { Conversation, MainContextSnapshot, TokenUsage } from "./conversationSchemas";
import { slashCommandSuggestions, type SlashCommandDefinition } from "./slashCommands";
import { formatDroppedTextFileSize } from "./useChatDroppedTextFiles";
import type {
  DroppedTextFilesRequestStatus,
  PendingDroppedTextFile,
} from "./useChatDroppedTextFileState";

export type ChatComposerProps = {
  connection?: AiConnectionState;
  connectionFixed?: boolean;
  onConnectionChange?: (connection: AiConnection) => void;
  chatModelValue: string;
  composerPlaceholder: string;
  draft: string;
  droppedTextFileError: string | null;
  droppedTextFileResults: DroppedTextFileStatus[];
  droppedTextFiles: PendingDroppedTextFile[];
  droppedTextFilesRequestStatus: DroppedTextFilesRequestStatus;
  handleComposerDragOver: (event: DragEvent<HTMLTextAreaElement>) => void;
  handleComposerFileDrop: (event: DragEvent<HTMLTextAreaElement>) => boolean;
  isCodexRuntime: boolean;
  isLoading: boolean;
  isWorkspaceUnavailable: boolean;
  isModelSelectorDisabled: boolean;
  llmProviders: LlmProviderChoice[];
  mainContextSnapshot: MainContextSnapshot | null;
  mode?: "chat" | "editor";
  onAgentRuntimeChange: (runtime: Conversation["agentRuntime"]) => void;
  onMainLlmModelSelectionChange?: (modelSelection: SelectedModel | null) => void;
  onMainLlmProfileIdChange?: (profileId: string | null) => void;
  onModelSelectionChange?: (modelSelection: SelectedModel | null) => void;
  onRemoveDroppedTextFile: (id: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  resolvedMainSelection: SelectedModel | null;
  selectedAgentRuntime: Conversation["agentRuntime"];
  sessionUsage: TokenUsage | null;
  setDraft: (value: string | ((current: string) => string)) => void;
  setShowApiKeySetupGuidance: (show: boolean) => void;
  showTokenUsageIndicator: boolean;
  unavailableReasons: Array<{ id: string; reason: string }>;
  userDefinedProfiles: LlmProfileWithAvailability[];
  workspaceRoot: string | null;
  agentRunState: "idle" | "running" | "failed";
  composerRef?: RefObject<HTMLTextAreaElement | null>;
};

export function ChatComposer({
  connection, connectionFixed, onConnectionChange,
  agentRunState,
  chatModelValue,
  composerPlaceholder,
  composerRef: externalComposerRef,
  draft,
  droppedTextFileError,
  droppedTextFileResults,
  droppedTextFiles,
  droppedTextFilesRequestStatus,
  handleComposerDragOver,
  handleComposerFileDrop,
  isCodexRuntime,
  isLoading,
  isModelSelectorDisabled,
  isWorkspaceUnavailable,
  llmProviders,
  mainContextSnapshot,
  mode,
  onAgentRuntimeChange,
  onMainLlmModelSelectionChange,
  onMainLlmProfileIdChange,
  onModelSelectionChange,
  onRemoveDroppedTextFile,
  onSubmit,
  resolvedMainSelection,
  selectedAgentRuntime,
  sessionUsage,
  setDraft,
  setShowApiKeySetupGuidance,
  showTokenUsageIndicator,
  unavailableReasons,
  userDefinedProfiles,
  workspaceRoot,
}: ChatComposerProps) {
  const internalComposerRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = externalComposerRef ?? internalComposerRef;
  const [dismissedSlashInput, setDismissedSlashInput] = useState<string | null>(null);
  const [selectedSlashCommandIndex, setSelectedSlashCommandIndex] = useState(0);
  const slashCommandCandidates =
    draft === dismissedSlashInput ? [] : slashCommandSuggestions(draft);
  const isSlashCommandPaletteOpen = slashCommandCandidates.length > 0;

  useEffect(() => {
    setSelectedSlashCommandIndex(0);
  }, [draft]);

  function selectSlashCommand(command: SlashCommandDefinition) {
    setDraft(command.name);
    setDismissedSlashInput(command.name);
    composerRef.current?.focus();
    window.requestAnimationFrame(() => {
      const nextCaretPosition = command.name.length;
      composerRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition);
    });
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isSlashCommandPaletteOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setSelectedSlashCommandIndex((current) =>
          (current + direction + slashCommandCandidates.length) % slashCommandCandidates.length
        );
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedSlashInput(draft);
        return;
      }

      if (event.key === "Enter") {
        const selectedCommand = slashCommandCandidates[selectedSlashCommandIndex];
        if (selectedCommand) {
          event.preventDefault();
          selectSlashCommand(selectedCommand);
          return;
        }
      }
    }

    if (event.key !== "Enter") {
      return;
    }

    const { isComposing, keyCode } = event.nativeEvent;
    if (isComposing || keyCode === 229) {
      return;
    }

    if (event.shiftKey) {
      return;
    }

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  function handleComposerDrop(event: DragEvent<HTMLTextAreaElement>) {
    if (handleComposerFileDrop(event)) {
      return;
    }

    const droppedText = event.dataTransfer.getData("text/plain");
    if (!droppedText) {
      return;
    }

    event.preventDefault();

    const textarea = event.currentTarget;
    const selectionStart = textarea.selectionStart ?? draft.length;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const nextDraft = `${draft.slice(0, selectionStart)}${droppedText}${draft.slice(selectionEnd)}`;
    const nextCaretPosition = selectionStart + droppedText.length;

    setDraft(nextDraft);
    window.requestAnimationFrame(() => {
      composerRef.current?.setSelectionRange(nextCaretPosition, nextCaretPosition);
      composerRef.current?.focus();
    });
  }

  return (
    <form
      className={`chat-form${isWorkspaceUnavailable ? " chat-form--disabled" : ""}`}
      onSubmit={onSubmit}
    >
      {droppedTextFileResults.length > 0 ? (
        <section aria-label="添付ファイルの処理結果" className="chat-dropped-text-file-results">
          {droppedTextFileResults.map((file) => (
            <div className="chat-dropped-text-file-result" key={file.index}>
              <span className="chat-dropped-text-file-name">{file.name}</span>
              <span className="chat-dropped-text-file-result-status">
                {file.status === "placed"
                  ? file.targetPath
                    ? `配置済み: ${file.targetPath}`
                    : "配置済み"
                  : file.status === "failed"
                    ? "配置失敗"
                    : file.status === "unplaced"
                      ? "未配置"
                      : "配置先を判断中"}
              </span>
            </div>
          ))}
        </section>
      ) : null}
      {droppedTextFiles.length > 0 ? (
        <div aria-label="添付ファイル" className="chat-dropped-text-files">
          {droppedTextFiles.map((file) => (
            <div className="chat-dropped-text-file" key={file.id}>
              <span className="chat-dropped-text-file-name">{file.name}</span>
              <span className="chat-dropped-text-file-size">
                {formatDroppedTextFileSize(file.sizeBytes)}
              </span>
              <span className="chat-dropped-text-file-status" role="status">
                {droppedTextFilesRequestStatus === "sending"
                  ? "送信中"
                  : droppedTextFilesRequestStatus === "failed"
                    ? "送信失敗"
                    : "送信待ち"}
              </span>
              <button
                aria-label={`${file.name} を添付から削除`}
                className="chat-dropped-text-file-remove"
                disabled={isLoading}
                onClick={() => onRemoveDroppedTextFile(file.id)}
                type="button"
              >
                削除
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {droppedTextFileError ? (
        <p className="chat-dropped-text-file-error" role="alert">{droppedTextFileError}</p>
      ) : null}
      {droppedTextFilesRequestStatus === "accepted" ? (
        <p className="chat-dropped-text-file-accepted" role="status">
          添付テキストファイルを受理しました。AIが保存先を判断します。
        </p>
      ) : null}
      {isSlashCommandPaletteOpen ? (
        <div
          aria-label="スラッシュコマンド"
          className="slash-command-palette"
          id="chat-slash-command-palette"
          role="listbox"
        >
          {slashCommandCandidates.map((command, index) => (
            <div
              aria-selected={index === selectedSlashCommandIndex}
              className="slash-command-option"
              id={`chat-slash-command-${command.id}`}
              key={command.id}
              onClick={() => selectSlashCommand(command)}
              onMouseDown={(event) => event.preventDefault()}
              role="option"
            >
              <span className="slash-command-name">{command.name}</span>
              <span className="slash-command-aliases">{command.aliases.join(" ")}</span>
              <span className="slash-command-description">{command.description}</span>
            </div>
          ))}
        </div>
      ) : null}
      {connection?.connection === "codex" ? <p role="status">{connection.message}</p> : null}
      <textarea
        aria-activedescendant={
          isSlashCommandPaletteOpen
            ? `chat-slash-command-${slashCommandCandidates[selectedSlashCommandIndex]?.id}`
            : undefined
        }
        aria-controls={isSlashCommandPaletteOpen ? "chat-slash-command-palette" : undefined}
        aria-expanded={isSlashCommandPaletteOpen}
        aria-haspopup="listbox"
        className="chat-composer-input"
        data-resizable-composer="vertical"
        disabled={!workspaceRoot}
        onChange={(event) => {
          setDismissedSlashInput(null);
          setDraft(event.target.value);
        }}
        onDragOver={handleComposerDragOver}
        onDrop={handleComposerDrop}
        onKeyDown={handleComposerKeyDown}
        placeholder={composerPlaceholder}
        ref={composerRef}
        value={draft}
      />
      <div className="chat-form-footer">
        <label className="chat-model-selector">
          <select
            aria-label="会話の実行方式"
            disabled={!workspaceRoot || isLoading}
            onChange={(event) => {
              if (connection) onConnectionChange?.((event.target.value === "codex-app-server" ? "codex" : event.target.value === "vercel-ai" ? "api" : "chatgpt"));
              else void onAgentRuntimeChange(event.target.value as Conversation["agentRuntime"]);
            }}
            value={connection?.connection === "chatgpt" ? "chatgpt" : connection?.connection === "codex" ? "codex-app-server" : selectedAgentRuntime}
          >
            {connection?.enabled || connection?.connection === "chatgpt" ? <option value="chatgpt" disabled={!connection.enabled}>ChatGPTプラン{!connection.enabled ? "（利用不可）" : ""}</option> : null}
            <option value="vercel-ai">APIキー接続</option>
            {connection?.connection === "codex" ? <option value="codex-app-server" disabled>旧Codex接続（廃止）</option> : null}
          </select>
        </label>
        {connection?.connection === "chatgpt" ? <ChatGptModelControls state={connection} disabled={isLoading} fixed={connectionFixed} /> : connection?.connection === "codex" ? null : (
          <ChatModelSelector
            chatModelValue={chatModelValue}
            disabled={isModelSelectorDisabled}
            llmProviders={llmProviders.filter(provider => provider.id !== "openai-chatgpt")}
            onChange={(value) => {
              setShowApiKeySetupGuidance(false);
              handleChatModelSelectorChange(value, {
                onMainLlmProfileIdChange,
                onMainLlmModelSelectionChange,
                onModelSelectionChange,
              });
            }}
            resolvedMainSelection={resolvedMainSelection}
            userDefinedProfiles={userDefinedProfiles.filter(profile => profile.providerId !== "openai-chatgpt")}
          />
        )}
        {showTokenUsageIndicator ? (
          <ChatTokenUsageIndicator
            isRunning={agentRunState === "running"}
            mainContextSnapshot={mainContextSnapshot}
            sessionUsage={sessionUsage}
          />
        ) : null}
        <button
          className="send-action"
          disabled={!workspaceRoot || isLoading || connection?.blocked || draft.trim() === ""}
          type="submit"
          aria-label="送信"
        >
          <FaArrowUp className="send-action-icon" aria-hidden="true" />
        </button>
      </div>
      {!isCodexRuntime && connection?.connection !== "chatgpt" ? <ChatModelUnavailableReasons reasons={unavailableReasons} /> : null}
    </form>
  );
}
