import { describeRun, Run } from "../api";
import { Badge } from "./RunResult";

interface Props {
  runs: Run[];
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}

export function RunHistory({ runs, selectedRunId, onSelect }: Props) {
  return (
    <section className="card history" aria-label="History">
      <h2 className="card-title">History</h2>
      {runs.length === 0 ? (
        <p className="muted small">No runs yet for this project.</p>
      ) : (
        <ul className="history-list">
          {runs.map((r) => {
            const s = describeRun(r);
            return (
              <li key={r.id}>
                <button className={`history-row${r.id === selectedRunId ? " selected" : ""}`} onClick={() => onSelect(r.id)} aria-current={r.id === selectedRunId}>
                  <span className="history-title">{r.title || r.taskText || "Task"}</span>
                  <span className="history-meta">
                    <Badge tone={s.tone}>{s.label}</Badge>
                    <time className="muted small">{r.startedAt ? new Date(r.startedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</time>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
