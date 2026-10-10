import React, { useState, useEffect } from "react";

export interface HumanMessageItem {
  id: string;
  projectId: string;
  kind: "guidance" | "replan" | "safe_interrupt" | "priority_override" | "scope_change";
  content: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: "pending" | "consumed" | "canceled";
  createdAt: string;
  consumedAt: string | null;
}

interface HumanDirectionBarProps {
  projectId: string | null;
  onMessageSent?: () => void;
  onSafeInterruptTriggered?: () => void;
}

export function HumanDirectionBar({
  projectId,
  onMessageSent,
  onSafeInterruptTriggered,
}: HumanDirectionBarProps) {
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<HumanMessageItem["kind"]>("guidance");
  const [priority, setPriority] = useState<HumanMessageItem["priority"]>("normal");
  const [messages, setMessages] = useState<HumanMessageItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const fetchMessages = () => {
    if (!projectId) return;
    fetch(`/api/v1/projects/${projectId}/messages`)
      .then((res) => res.json())
      .then((data) => {
        if (data.messages) {
          setMessages(data.messages);
        }
      })
      .catch((err) => console.error("Failed to load messages:", err));
  };

  useEffect(() => {
    fetchMessages();
    const timer = setInterval(fetchMessages, 3000);
    return () => clearInterval(timer);
  }, [projectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!projectId || !content.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          content: content.trim(),
          priority,
        }),
      });

      if (res.ok) {
        setContent("");
        fetchMessages();
        if (kind === "safe_interrupt" && onSafeInterruptTriggered) {
          onSafeInterruptTriggered();
        }
        if (onMessageSent) {
          onMessageSent();
        }
      }
    } catch (err) {
      console.error("Failed to post message:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickSafeInterrupt = async () => {
    if (!projectId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "safe_interrupt",
          content: "Operator triggered immediate safe interrupt at task checkpoint.",
          priority: "urgent",
        }),
      });

      if (res.ok) {
        fetchMessages();
        if (onSafeInterruptTriggered) {
          onSafeInterruptTriggered();
        }
      }
    } catch (err) {
      console.error("Safe interrupt error:", err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (messageId: string) => {
    try {
      const res = await fetch(`/api/v1/messages/${messageId}/cancel`, {
        method: "POST",
      });
      if (res.ok) {
        fetchMessages();
      }
    } catch (err) {
      console.error("Cancel message error:", err);
    }
  };

  return (
    <div className="glass-card" style={{ marginBottom: "1.5rem" }}>
      <div className="card-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <h2 className="card-title">Operator Inbox & Human Direction</h2>
          <span className="badge badge-local">Active Interventions</span>
        </div>
        <button
          className="btn btn-danger"
          onClick={handleQuickSafeInterrupt}
          disabled={submitting || !projectId}
          style={{ fontSize: "0.75rem", padding: "0.3rem 0.75rem" }}
        >
          ⚡ Safe Interrupt Loop
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.5rem" }}>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as HumanMessageItem["kind"])}
          style={{
            background: "#090d16",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-main)",
            borderRadius: "var(--radius-sm)",
            padding: "0.5rem 0.75rem",
            fontSize: "0.85rem",
          }}
        >
          <option value="guidance">Guidance (Steer Next Task)</option>
          <option value="replan">Replan (Trigger Brain Replan)</option>
          <option value="safe_interrupt">Safe Interrupt (Halt at Boundary)</option>
          <option value="priority_override">Priority Override</option>
          <option value="scope_change">Scope Change</option>
        </select>

        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as HumanMessageItem["priority"])}
          style={{
            background: "#090d16",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-main)",
            borderRadius: "var(--radius-sm)",
            padding: "0.5rem 0.75rem",
            fontSize: "0.85rem",
          }}
        >
          <option value="normal">Normal Priority</option>
          <option value="high">High Priority</option>
          <option value="urgent">Urgent</option>
          <option value="low">Low Priority</option>
        </select>

        <input
          type="text"
          placeholder="Enter guidance instruction, constraint, or steering message..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={submitting}
          style={{
            flex: 1,
            minWidth: "240px",
            background: "#090d16",
            border: "1px solid var(--border-subtle)",
            color: "var(--text-main)",
            borderRadius: "var(--radius-sm)",
            padding: "0.5rem 0.75rem",
            fontSize: "0.85rem",
          }}
        />

        <button
          type="submit"
          className="btn btn-primary"
          disabled={submitting || !content.trim() || !projectId}
          style={{ fontSize: "0.85rem", padding: "0.5rem 1rem" }}
        >
          Send Direction
        </button>
      </form>

      {/* Message Queue / History */}
      {messages.length > 0 && (
        <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
          <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", textTransform: "uppercase" }}>
            Recent Directions & Interventions
          </div>
          <div style={{ maxHeight: "120px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {messages.slice(0, 5).map((m) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  background: "rgba(0,0,0,0.25)",
                  padding: "0.4rem 0.75rem",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.8rem",
                  borderLeft: `3px solid ${
                    m.kind === "safe_interrupt"
                      ? "var(--accent-rose)"
                      : m.status === "consumed"
                      ? "var(--accent-emerald)"
                      : "var(--accent-cyan)"
                  }`,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", overflow: "hidden" }}>
                  <span style={{ fontWeight: 600, color: "var(--text-main)", textTransform: "uppercase", fontSize: "0.7rem" }}>
                    [{m.kind}]
                  </span>
                  <span style={{ color: "var(--text-muted)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                    {m.content}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span className={`badge ${m.status === "consumed" ? "badge-local" : m.status === "pending" ? "badge-unknown" : ""}`}>
                    {m.status.toUpperCase()}
                  </span>
                  {m.status === "pending" && (
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleCancel(m.id)}
                      style={{ padding: "0.2rem 0.4rem", fontSize: "0.7rem" }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
