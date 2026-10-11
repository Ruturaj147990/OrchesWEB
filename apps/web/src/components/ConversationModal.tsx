import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { api, ApiError, ConversationDetail, ConversationMessage } from "../api";
import { Badge } from "./RunResult";

interface Props {
  conversationId: string;
  onClose: () => void;
  onResume: (conversationId: string, taskText: string) => Promise<boolean>;
  onDeleted: (conversationId: string) => void;
}

export function ConversationModal({ conversationId, onClose, onResume, onDeleted }: Props) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"messages" | "snapshot">("messages");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [resumeTask, setResumeTask] = useState("");
  const [resuming, setResuming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.conversationDetail(conversationId);
      setDetail(data);
      setTitleInput(data.conversation.title);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [conversationId]);

  const handleSaveTitle = async () => {
    if (!titleInput.trim() || titleInput === detail?.conversation.title) {
      setEditingTitle(false);
      return;
    }
    try {
      await api.updateConversation(conversationId, { title: titleInput.trim() });
      if (detail) {
        setDetail({
          ...detail,
          conversation: { ...detail.conversation, title: titleInput.trim() },
        });
      }
      setEditingTitle(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  const handleResume = async () => {
    const text = resumeTask.trim();
    if (text.length < 3) {
      setError("Please describe the next instruction or task to resume this session.");
      return;
    }
    setResuming(true);
    setError(null);
    try {
      const ok = await onResume(conversationId, text);
      if (ok) onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setResuming(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete this conversation? This will permanently delete its messages and context memory snapshots from the backend.")) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await api.deleteConversation(conversationId);
      onDeleted(conversationId);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setDeleting(false);
    }
  };

  return (
    <Modal
      title={detail ? `Session: ${detail.conversation.title}` : "Conversation History"}
      onClose={onClose}
      wide
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", width: "100%", alignItems: "center" }}>
          <button
            className="btn btn-ghost btn-sm btn-danger-text"
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? "Deleting…" : "Delete Conversation"}
          </button>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      }
    >
      {loading ? (
        <p className="muted">Loading conversation history…</p>
      ) : error ? (
        <div className="notice notice-error">{error}</div>
      ) : !detail ? (
        <p className="muted">Conversation not found.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {/* Header & Title editing */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
              {editingTitle ? (
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <input
                    type="text"
                    value={titleInput}
                    onChange={(e) => setTitleInput(e.target.value)}
                    className="input"
                    style={{ padding: "4px 8px", fontSize: "14px" }}
                    autoFocus
                  />
                  <button className="btn btn-primary btn-sm" onClick={handleSaveTitle}>
                    Save
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setEditingTitle(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <>
                  <h3 style={{ margin: 0, fontSize: "16px" }}>{detail.conversation.title}</h3>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setEditingTitle(true)}
                    title="Rename conversation"
                    style={{ padding: "2px 6px" }}
                  >
                    ✎
                  </button>
                </>
              )}
            </div>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <Badge tone={detail.conversation.status === "active" ? "running" : "neutral"}>
                {detail.conversation.status}
              </Badge>
              <span className="muted small">
                {detail.messages.length} message{detail.messages.length === 1 ? "" : "s"}
              </span>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid var(--border)", paddingBottom: "8px" }}>
            <button
              className={`btn btn-sm ${activeTab === "messages" ? "btn-secondary" : "btn-ghost"}`}
              onClick={() => setActiveTab("messages")}
            >
              Messages ({detail.messages.length})
            </button>
            <button
              className={`btn btn-sm ${activeTab === "snapshot" ? "btn-secondary" : "btn-ghost"}`}
              onClick={() => setActiveTab("snapshot")}
            >
              Memory Snapshot {detail.latestSnapshot ? `(${detail.latestSnapshot.tokenCount} tokens)` : "(None yet)"}
            </button>
          </div>

          {/* Content Area */}
          {activeTab === "messages" ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "10px",
                maxHeight: "45vh",
                overflowY: "auto",
                paddingRight: "6px",
              }}
            >
              {detail.messages.length === 0 ? (
                <p className="muted small">No messages in this conversation.</p>
              ) : (
                detail.messages.map((m: ConversationMessage) => {
                  const isUser = m.role === "user";
                  const isAssistant = m.role === "assistant";
                  const isOrchestrator = m.role === "orchestrator";
                  const isTool = m.role === "tool";

                  let roleBadgeTone: "neutral" | "running" | "success" | "warning" | "danger" = "neutral";
                  if (isUser) roleBadgeTone = "running";
                  else if (isAssistant) roleBadgeTone = "neutral";
                  else if (isOrchestrator) roleBadgeTone = "warning";
                  else if (isTool) roleBadgeTone = "success";

                  return (
                    <div
                      key={m.id}
                      style={{
                        padding: "10px 12px",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border)",
                        background: isUser ? "var(--surface-2)" : "var(--surface)",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "6px",
                        }}
                      >
                        <Badge tone={roleBadgeTone}>{m.role.toUpperCase()}</Badge>
                        <time className="muted small">
                          {new Date(m.createdAt).toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </time>
                      </div>
                      <div style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "13.5px" }}>
                        {m.content}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          ) : (
            <div style={{ maxHeight: "45vh", overflowY: "auto" }}>
              {detail.latestSnapshot ? (
                <div>
                  <div className="muted small" style={{ marginBottom: "8px" }}>
                    Snapshot ID: {detail.latestSnapshot.id} · Generated:{" "}
                    {new Date(detail.latestSnapshot.createdAt).toLocaleString()} · Approx Tokens:{" "}
                    {detail.latestSnapshot.tokenCount}
                  </div>
                  <pre
                    style={{
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      padding: "12px",
                      whiteSpace: "pre-wrap",
                      fontSize: "12.5px",
                      lineHeight: "1.5",
                      fontFamily: "var(--mono)",
                    }}
                  >
                    {detail.latestSnapshot.snapshotMarkdown}
                  </pre>
                </div>
              ) : (
                <p className="muted small">
                  No compacted memory snapshot has been generated yet for this session. A snapshot is
                  synthesized automatically as messages approach the context budget or when runs conclude.
                </p>
              )}
            </div>
          )}

          {/* Resume Session Section */}
          <div
            style={{
              borderTop: "1px solid var(--border)",
              paddingTop: "12px",
              marginTop: "4px",
              display: "flex",
              flexDirection: "column",
              gap: "8px",
            }}
          >
            <label htmlFor="resume-task-input" style={{ fontWeight: 600, fontSize: "13px" }}>
              Resume this conversation with saved context:
            </label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                id="resume-task-input"
                type="text"
                placeholder="Next instructions or follow-up task..."
                value={resumeTask}
                onChange={(e) => setResumeTask(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleResume()}
                className="input"
                style={{ flex: 1, padding: "6px 10px" }}
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleResume}
                disabled={resuming || resumeTask.trim().length < 3}
              >
                {resuming ? "Starting…" : "Resume Session"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
