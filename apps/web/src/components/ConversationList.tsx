import { ConversationSummary } from "../api";
import { Badge } from "./RunResult";

interface Props {
  conversations: ConversationSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export function ConversationList({ conversations, selectedId, onSelect, onNew, onDelete }: Props) {
  return (
    <section className="card history" aria-label="Conversation History">
      <div className="card-head">
        <h2 className="card-title">Conversations</h2>
        <button className="btn btn-secondary btn-sm" onClick={onNew} title="Start a fresh conversation thread">
          + New Chat
        </button>
      </div>
      {conversations.length === 0 ? (
        <p className="muted small">No conversations yet for this project. Start a run or create a new session.</p>
      ) : (
        <ul className="history-list" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {conversations.map((c) => {
            const isSelected = c.id === selectedId;
            return (
              <li key={c.id} style={{ marginBottom: "6px" }}>
                <div
                  className={`history-row${isSelected ? " selected" : ""}`}
                  style={{ display: "flex", flexDirection: "column", position: "relative" }}
                >
                  <button
                    onClick={() => onSelect(c.id)}
                    style={{
                      background: "none",
                      border: "none",
                      padding: 0,
                      textAlign: "left",
                      cursor: "pointer",
                      width: "100%",
                      color: "inherit",
                    }}
                  >
                    <span className="history-title" style={{ fontWeight: 600, display: "block" }}>
                      {c.title || "Untitled Session"}
                    </span>
                    <span className="history-meta" style={{ marginTop: "4px", display: "flex", flexWrap: "wrap", gap: "6px" }}>
                      <Badge tone={c.status === "active" ? "running" : "neutral"}>
                        {c.status === "active" ? "Active" : c.status}
                      </Badge>
                      {c.hasMemorySnapshot && <Badge tone="success">Snapshot</Badge>}
                      <span className="muted small">
                        {c.messageCount} msg{c.messageCount === 1 ? "" : "s"}
                      </span>
                      <time className="muted small">
                        {c.lastActivityAt
                          ? new Date(c.lastActivityAt).toLocaleString([], {
                              month: "short",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                          : ""}
                      </time>
                    </span>
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Delete conversation "${c.title}"? This permanently removes its messages and memory snapshots.`)) {
                        onDelete(c.id);
                      }
                    }}
                    title="Delete conversation from server"
                    style={{
                      position: "absolute",
                      right: "6px",
                      top: "6px",
                      padding: "2px 6px",
                      fontSize: "12px",
                      opacity: 0.7,
                    }}
                    aria-label={`Delete conversation ${c.title}`}
                  >
                    ✕
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
