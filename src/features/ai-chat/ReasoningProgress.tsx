import { useId, useState } from "react";

export function ReasoningProgress({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);
  const contentId = useId();

  if (!content.trim()) {
    return <p className="reasoning-progress-hint">途中経過が届くとここに表示します。モデルによっては表示されません。</p>;
  }

  const preview = content.trim().slice(-160);
  return (
    <section className="reasoning-progress" aria-label="推論の途中経過" aria-live="off">
      <button
        type="button"
        className="reasoning-progress-toggle"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span aria-hidden="true">{expanded ? "▾" : "▸"}</span> 推論の途中経過
      </button>
      {!expanded ? <p className="reasoning-progress-preview">{content.trim().length > 160 ? "…" : ""}{preview}</p> : null}
      <div id={contentId} hidden={!expanded}>
        {expanded ? <>
        <p className="reasoning-progress-hint">モデルから届いた途中経過です。最終回答ではありません。長い場合は直近の部分を表示します。</p>
        <div className="reasoning-progress-content" role="region" aria-label="推論の詳細" tabIndex={0}>{content}</div>
        </> : null}
      </div>
    </section>
  );
}
