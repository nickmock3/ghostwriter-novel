import type { AgentPlan } from "./conversationSchemas";

function planItemStatusLabel(status: AgentPlan["items"][number]["status"]) {
  if (status === "completed") {
    return "完了";
  }
  if (status === "in_progress") {
    return "進行中";
  }
  if (status === "blocked") {
    return "保留";
  }
  if (status === "skipped") {
    return "スキップ";
  }
  return "待機";
}

export type AgentPlanViewProps = {
  plan: Pick<AgentPlan, "items"> | null | undefined;
};

export function AgentPlanView({ plan }: AgentPlanViewProps) {
  if (!plan || plan.items.length === 0) {
    return null;
  }

  return (
    <section className="agent-plan" role="group" aria-label="Plan">
      <div className="agent-plan-heading">
        <h3>Plan</h3>
      </div>
      <ol className="agent-plan-items">
        {plan.items.map((item) => (
          <li className={`plan-item is-${item.status}`} key={item.id}>
            <span className={`plan-item-status is-${item.status}`}>{planItemStatusLabel(item.status)}</span>
            <div className="plan-item-body">
              <span className="plan-item-title">{item.title}</span>
              {item.detail ? <p>{item.detail}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export type AgentPlansViewProps = {
  plans: AgentPlan[];
};

export function AgentPlansView({ plans }: AgentPlansViewProps) {
  if (plans.length === 0) {
    return null;
  }

  return (
    <div className="message-plans">
      {plans.map((plan) => (
        <div key={plan.id}>
          <AgentPlanView plan={plan} />
        </div>
      ))}
    </div>
  );
}
