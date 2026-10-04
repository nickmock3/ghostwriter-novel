import type { IconType } from "react-icons";
import { FiCheckCircle, FiEdit3, FiLoader, FiStar, FiType } from "react-icons/fi";
import type { AiAssistDefinition } from "./aiAssistContracts";

const assistIconById: Record<string, IconType> = {
  polish: FiEdit3,
  proofread: FiCheckCircle,
  "ruby-suggestions": FiType,
};

const assistVariantClassById: Record<string, string> = {
  polish: "ai-assist-item--polish",
  proofread: "ai-assist-item--proofread",
  "ruby-suggestions": "ai-assist-item--ruby",
};

export type AiAssistListProps = {
  builtInAssists: readonly AiAssistDefinition[];
  canManageCustomAssists: boolean;
  customAssists: readonly AiAssistDefinition[];
  executingAssistId: string | null;
  isBusy: boolean;
  isExecutionBlocked: boolean;
  onExecute: (assistId: string) => void;
  onOpenManageDialog: () => void;
  onPreviewAssist: (assistId: string) => void;
  onPreviewAssistEnd: (assistId: string, element: HTMLButtonElement) => void;
  tooltipIdBase: string;
};

function AssistItem(input: {
  assist: AiAssistDefinition;
  executingAssistId: string | null;
  isBusy: boolean;
  isExecutionBlocked: boolean;
  onExecute: (assistId: string) => void;
  onPreviewAssist: (assistId: string) => void;
  onPreviewAssistEnd: (assistId: string, element: HTMLButtonElement) => void;
  tooltipIdBase: string;
  variantClass: string;
  AssistIcon: IconType;
}) {
  const {
    assist,
    executingAssistId,
    isBusy,
    isExecutionBlocked,
    onExecute,
    onPreviewAssist,
    onPreviewAssistEnd,
    tooltipIdBase,
    variantClass,
    AssistIcon,
  } = input;
  const isThisExecuting = executingAssistId === assist.id;
  const tooltipId = `${tooltipIdBase}-${assist.id}`;

  return (
    <div className="ai-assist-item-wrapper" role="listitem">
      <button
        aria-describedby={tooltipId}
        aria-label={isThisExecuting ? `${assist.name}を実行中…` : `${assist.name}を実行`}
        className={`ai-assist-item ${variantClass}${isThisExecuting ? " is-executing" : ""}`}
        disabled={isBusy || isExecutionBlocked}
        onBlur={(event) => {
          onPreviewAssistEnd(assist.id, event.currentTarget);
        }}
        onClick={() => {
          onExecute(assist.id);
        }}
        onFocus={() => {
          onPreviewAssist(assist.id);
        }}
        onMouseEnter={() => {
          onPreviewAssist(assist.id);
        }}
        onMouseLeave={(event) => {
          onPreviewAssistEnd(assist.id, event.currentTarget);
        }}
        type="button"
      >
        <span aria-hidden="true" className="ai-assist-item-icon">
          <AssistIcon />
        </span>
        <span className="ai-assist-item-body">
          <span className="ai-assist-name">{assist.name}</span>
          {isThisExecuting ? (
            <span className="ai-assist-item-status">
              <FiLoader aria-hidden="true" className="ai-assist-item-spinner" />
              実行中…
            </span>
          ) : null}
        </span>
      </button>
      <span className="ai-assist-item-tooltip" id={tooltipId} role="tooltip">
        {assist.description}
      </span>
    </div>
  );
}

export function AiAssistList({
  builtInAssists,
  canManageCustomAssists,
  customAssists,
  executingAssistId,
  isBusy,
  isExecutionBlocked,
  onExecute,
  onOpenManageDialog,
  onPreviewAssist,
  onPreviewAssistEnd,
  tooltipIdBase,
}: AiAssistListProps) {
  return (
    <>
      <div className="ai-assist-list" role="list" aria-label="組み込みアシスト">
        {builtInAssists.map((assist) => (
          <AssistItem
            key={assist.id}
            AssistIcon={assistIconById[assist.id] ?? FiEdit3}
            assist={assist}
            executingAssistId={executingAssistId}
            isBusy={isBusy}
            isExecutionBlocked={isExecutionBlocked}
            onExecute={onExecute}
            onPreviewAssist={onPreviewAssist}
            onPreviewAssistEnd={onPreviewAssistEnd}
            tooltipIdBase={tooltipIdBase}
            variantClass={assistVariantClassById[assist.id] ?? ""}
          />
        ))}
      </div>

      {customAssists.length > 0 ? (
        <div className="ai-assist-list ai-assist-list--custom" role="list" aria-label="カスタムアシスト">
          {customAssists.map((assist) => (
            <AssistItem
              key={assist.id}
              AssistIcon={FiStar}
              assist={assist}
              executingAssistId={executingAssistId}
              isBusy={isBusy}
              isExecutionBlocked={isExecutionBlocked}
              onExecute={onExecute}
              onPreviewAssist={onPreviewAssist}
              onPreviewAssistEnd={onPreviewAssistEnd}
              tooltipIdBase={tooltipIdBase}
              variantClass="ai-assist-item--custom"
            />
          ))}
        </div>
      ) : canManageCustomAssists ? (
        <div className="ai-assist-list ai-assist-list--custom" role="list" aria-label="カスタムアシスト" />
      ) : null}

      {canManageCustomAssists ? (
        <div className="ai-assist-manage-action">
          <button
            className="secondary-action ai-assist-manage-open"
            onClick={onOpenManageDialog}
            type="button"
          >
            カスタムアシストを管理
          </button>
        </div>
      ) : null}

      {canManageCustomAssists ? (
        <p className="ai-assist-execution-hint">
          アシストを押すと実行します。選択範囲があれば選択範囲、なければ開いているファイル全体が対象です。
        </p>
      ) : null}
    </>
  );
}
