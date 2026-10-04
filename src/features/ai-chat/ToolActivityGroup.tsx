import { FaCheckCircle, FaCircleNotch, FaExclamationTriangle } from "react-icons/fa";
import type { Conversation } from "./conversationSchemas";
import type { ToolActivitySummary } from "./toolActivity";

export type RenderableToolActivity = ToolActivitySummary | Conversation["toolActivities"][number];

function toolActivityKey(activity: RenderableToolActivity) {
  return "id" in activity ? activity.id : activity.toolCallId;
}

function toolActivityStatusLabel(status: ToolActivitySummary["status"]) {
  if (status === "running") {
    return "実行中";
  }
  if (status === "completed") {
    return "完了";
  }
  return "失敗";
}

function toolActivityStatusIcon(status: ToolActivitySummary["status"]) {
  if (status === "running") {
    return <FaCircleNotch className="tool-activity-status-icon" aria-hidden="true" />;
  }
  if (status === "completed") {
    return <FaCheckCircle className="tool-activity-status-icon" aria-hidden="true" />;
  }
  return <FaExclamationTriangle className="tool-activity-status-icon" aria-hidden="true" />;
}

function toolActivitySummaryStatus(activities: RenderableToolActivity[]) {
  if (activities.some((activity) => activity.status === "running")) {
    return "running" as const;
  }
  if (activities.some((activity) => activity.status === "failed")) {
    return "failed" as const;
  }
  return "completed" as const;
}

function toolActivitySummaryStatusLabel(status: ReturnType<typeof toolActivitySummaryStatus>) {
  if (status === "running") {
    return "実行中";
  }
  if (status === "failed") {
    return "一部失敗";
  }
  return "完了";
}

function toolActivitySummaryBreakdown(activities: RenderableToolActivity[]) {
  const counts = new Map<string, number>();
  for (const activity of activities) {
    counts.set(activity.toolName, (counts.get(activity.toolName) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([toolName, count]) => (count > 1 ? `${toolName} x${count}` : toolName))
    .join("・");
}

type ToolActivityListProps = {
  activities: RenderableToolActivity[];
  feedbackToolCallIds?: Set<string>;
};

function ToolActivityList({ activities, feedbackToolCallIds }: ToolActivityListProps) {
  return (
    <div className="tool-activity-list">
      {activities.map((activity) => {
        const hasCompletionFeedback =
          activity.status === "completed" && feedbackToolCallIds?.has(activity.toolCallId) === true;
        return (
          <section
            className={`tool-activity is-${activity.status}${hasCompletionFeedback ? " has-completion-feedback" : ""}`}
            key={toolActivityKey(activity)}
          >
            <div className="tool-activity-heading">
              <h3>{activity.label}</h3>
              {activity.status === "completed" && activity.detail ? <p>{activity.detail}</p> : null}
              <span
                aria-label={`${activity.toolName} ${toolActivityStatusLabel(activity.status)}`}
                className={`tool-activity-status is-${activity.status}`}
              >
                {toolActivityStatusIcon(activity.status)}
                {activity.status === "completed" ? null : activity.status}
              </span>
            </div>
            {activity.status !== "completed" && activity.detail ? <p>{activity.detail}</p> : null}
          </section>
        );
      })}
    </div>
  );
}

export type ToolActivityGroupProps = {
  activities: RenderableToolActivity[];
  feedbackToolCallIds?: Set<string>;
  groupId: string;
  isExpanded: boolean;
  onToggle: () => void;
};

export function ToolActivityGroup({
  activities,
  feedbackToolCallIds,
  groupId,
  isExpanded,
  onToggle,
}: ToolActivityGroupProps) {
  if (activities.length === 0) {
    return null;
  }

  const status = toolActivitySummaryStatus(activities);
  const statusLabel = toolActivitySummaryStatusLabel(status);
  const breakdown = toolActivitySummaryBreakdown(activities);
  const writingProgress = activities.filter((activity) => activity.toolName === "DelegateWriting" && activity.status === "running");

  return (
    <div className={`message-tool-activities is-${status}`}>
      <button
        aria-expanded={isExpanded}
        className="tool-activity-summary"
        onClick={onToggle}
        type="button"
      >
        <span className="tool-activity-summary-title">ツール履歴 {activities.length}件</span>
        <span className={`tool-activity-status is-${status}`}>
          {toolActivityStatusIcon(status)}
          {statusLabel}
        </span>
        <span className="tool-activity-summary-breakdown">{breakdown}</span>
      </button>
      {!isExpanded && writingProgress.map((activity) => (
        <p className="writing-generation-progress" key={toolActivityKey(activity)}>{activity.label}: {activity.detail}</p>
      ))}
      {isExpanded ? <ToolActivityList activities={activities} feedbackToolCallIds={feedbackToolCallIds} /> : null}
    </div>
  );
}

export function toolActivityGroupId(activities: RenderableToolActivity[]) {
  return activities.map(toolActivityKey).join(":");
}
