import { useEffect, useMemo, useRef, useState } from "react";
import { RunEvent } from "../api";

interface Line {
  seq: number;
  time: string;
  level: "info" | "warn" | "error" | "success";
  text: string;
  runId: string | null;
}

const PHASE_TEXT: Record<string, string> = {
  preparing: "Preparing workspace and checking the reasoning model…",
  baseline: "Running the project's checks before any change (baseline)…",
  planning: "Planning the task…",
  coding: "Writing code…",
  verifying: "Verifying the changes…",
  reviewing: "Independent review of the diff…",
};

/** Turns raw run events into readable log lines; unknown/internal events are skipped. */
export function formatEvent(ev: RunEvent): Line | null {
  const p = ev.payload || {};
  const base = { seq: ev.eventSeq, time: ev.timestamp, runId: ev.runId };
  switch (ev.type) {
    case "run.started":
      return { ...base, level: "info", text: `Run started — ${p.provider?.name ?? ""} (${p.provider?.model ?? ""}) with ${p.agent?.name ?? ""}: “${String(p.task ?? "").slice(0, 160)}”` };
    case "run.log":
      return { ...base, level: p.level === "warn" ? "warn" : p.level === "error" ? "error" : "info", text: String(p.message ?? "") };
    case "run.phase":
      return { ...base, level: "info", text: `${p.attempt ? `[attempt ${p.attempt}] ` : ""}${PHASE_TEXT[p.phase] ?? p.phase}` };
    case "task.planned":
      return { ...base, level: "info", text: `Plan: ${p.title} — ${(p.criteria ?? []).length} acceptance criteria${p.source === "fallback" ? " (task text used directly)" : ""}` };
    case "attempt.started":
      return { ...base, level: "info", text: `Attempt ${p.attempt} of ${p.maxAttempts} started` };
    case "attempt.evaluated":
      return {
        ...base,
        level: p.accepted ? "success" : "warn",
        text: p.accepted ? `Attempt ${p.attempt} accepted (${p.outcome})` : `Attempt ${p.attempt} rejected: ${(p.blockers ?? []).join(" · ")}`,
      };
    case "attempt.rolled_back": {
      const n = (p.restored?.length ?? 0) + (p.removed?.length ?? 0);
      const failed = p.failed?.length ?? 0;
      return { ...base, level: failed ? "error" : "info", text: failed ? `Rollback INCOMPLETE for ${failed} file(s)` : `Rolled back ${n} file(s)` };
    }
    case "run.finished":
      return { ...base, level: p.outcome === "verified" ? "success" : p.outcome === "unverified" || p.outcome === "cancelled" ? "warn" : "error", text: String(p.summary ?? "Run finished") };
    case "project.created":
      return { ...base, level: "info", text: `Project added: ${p.rootPath}` };
    case "git.initialized":
      return { ...base, level: "info", text: "Initialized a local Git repository" };
    case "human_message.created":
      return { ...base, level: "info", text: `Guidance queued for the next attempt: ${p.content ?? ""}` };
    default:
      return null;
  }
}

interface Props {
  events: RunEvent[];
  selectedRunId: string | null;
  connection: "connecting" | "live" | "offline";
}

export function ActivityLog({ events, selectedRunId, connection }: Props) {
  const [onlySelected, setOnlySelected] = useState(true);
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  const lines = useMemo(() => {
    const all = events.map(formatEvent).filter((l): l is Line => l !== null);
    return onlySelected && selectedRunId ? all.filter((l) => l.runId === selectedRunId) : all;
  }, [events, onlySelected, selectedRunId]);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines, follow]);

  return (
    <section className="card log-card" aria-label="Activity">
      <div className="card-head">
        <h2 className="card-title">Activity</h2>
        <span className={`conn conn-${connection}`} title="Live event stream">
          {connection === "live" ? "live" : connection === "connecting" ? "connecting…" : "offline — retrying"}
        </span>
      </div>
      <div className="log-tools small">
        <label className="check">
          <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} disabled={!selectedRunId} />
          Selected run only
        </label>
        <label className="check">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Follow
        </label>
      </div>
      <div className="log" ref={box} role="log" aria-live="polite" tabIndex={0}>
        {lines.length === 0 && <p className="muted small">No activity yet.</p>}
        {lines.map((l) => (
          <div key={l.seq} className={`log-line log-${l.level}`}>
            <time>{new Date(l.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
            <span>{l.text}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
