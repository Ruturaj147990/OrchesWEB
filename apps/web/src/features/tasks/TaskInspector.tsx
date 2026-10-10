import React, { useState, useEffect } from "react";

interface VerificationRun {
  id: string;
  check_type: string;
  command: string;
  status: string;
  exit_code: number | null;
  duration_ms: number;
  output_artifact_id: string | null;
  stdout_snippet: string;
  stderr_snippet: string;
  timestamp: string;
}

interface CriticReview {
  id: string;
  verdict: string;
  per_criterion_json: string;
  findings_json: string;
  repair_instructions_json: string;
  rationale: string;
  created_at: string;
}

interface TaskAttempt {
  id: string;
  attempt_number: number;
  adapter_id: string;
  status: string;
  base_commit: string | null;
  task_branch: string | null;
  started_at: string;
  ended_at: string | null;
}

interface TaskDetail {
  id: string;
  title: string;
  objective: string;
  roadmap_item_id: string;
  status: string;
  priority: string;
  risk: string;
  created_at: string;
  updated_at: string;
}

interface TaskInspectorProps {
  isOpen: boolean;
  onClose: () => void;
  taskId: string | null;
}

export function TaskInspector({ isOpen, onClose, taskId }: TaskInspectorProps) {
  const [loading, setLoading] = useState(false);
  const [taskData, setTaskData] = useState<{
    task: TaskDetail;
    attempts: TaskAttempt[];
    verifications: VerificationRun[];
    criticReviews: CriticReview[];
  } | null>(null);
  const [activeTab, setActiveTab] = useState<"verifications" | "browser" | "critic" | "attempts">("verifications");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !taskId) return;
    setLoading(true);
    fetch(`/api/v1/tasks/${taskId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Task not found");
        return res.json();
      })
      .then((data) => {
        setTaskData(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load task:", err);
        setLoading(false);
      });
  }, [isOpen, taskId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const browserVerifications = taskData?.verifications.filter((v) => v.check_type === "browser_ui") || [];

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 100 }}>
      <div
        className="glass-card modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "900px",
          maxWidth: "95vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          padding: "1.5rem",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "0.75rem" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <span style={{ fontSize: "0.8rem", color: "var(--accent-cyan)", fontFamily: "var(--font-mono)" }}>
                {taskId}
              </span>
              <span className={`badge ${taskData?.task.status === "succeeded" ? "badge-local" : "badge-unknown"}`}>
                {taskData?.task.status?.toUpperCase() || "LOADING"}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>
                Linked to {taskData?.task.roadmap_item_id}
              </span>
            </div>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 600, color: "var(--text-main)" }}>
              {taskData?.task.title || "Loading Task Details..."}
            </h2>
          </div>
          <button
            className="btn btn-secondary"
            onClick={onClose}
            style={{ padding: "0.3rem 0.6rem", fontSize: "0.85rem" }}
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div style={{ padding: "3rem", textAlign: "center", color: "var(--text-muted)" }}>
            Loading Task Evidence & Verifications...
          </div>
        ) : !taskData ? (
          <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-dim)" }}>
            No task data found. The task may still be initializing.
          </div>
        ) : (
          <>
            {/* Objective Bar */}
            <div style={{ background: "rgba(0,0,0,0.3)", padding: "0.75rem 1rem", borderRadius: "var(--radius-sm)", marginBottom: "1rem", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", textTransform: "uppercase" }}>Objective</div>
              <div style={{ fontSize: "0.875rem", color: "var(--text-main)", marginTop: "0.2rem" }}>
                {taskData.task.objective}
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: "0.5rem", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "0.5rem", marginBottom: "1rem" }}>
              <button
                className={`btn ${activeTab === "verifications" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setActiveTab("verifications")}
                style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}
              >
                Verifier Checks ({taskData.verifications.length})
              </button>
              <button
                className={`btn ${activeTab === "browser" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setActiveTab("browser")}
                style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}
              >
                Browser Visuals ({browserVerifications.length})
              </button>
              <button
                className={`btn ${activeTab === "critic" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setActiveTab("critic")}
                style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}
              >
                Independent Critic ({taskData.criticReviews.length})
              </button>
              <button
                className={`btn ${activeTab === "attempts" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setActiveTab("attempts")}
                style={{ fontSize: "0.8rem", padding: "0.4rem 0.8rem" }}
              >
                Attempts & Branches ({taskData.attempts.length})
              </button>
            </div>

            {/* Tab Body */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "1rem" }}>
              {activeTab === "verifications" && (
                <div>
                  {taskData.verifications.length === 0 ? (
                    <div style={{ color: "var(--text-dim)", fontSize: "0.85rem", padding: "1rem" }}>
                      No verifications recorded yet for this task.
                    </div>
                  ) : (
                    taskData.verifications.map((v) => (
                      <div
                        key={v.id}
                        style={{
                          background: "rgba(255,255,255,0.02)",
                          border: `1px solid ${v.exit_code === 0 ? "rgba(16, 185, 129, 0.3)" : "rgba(244, 63, 94, 0.3)"}`,
                          borderRadius: "var(--radius-sm)",
                          padding: "0.75rem",
                          marginBottom: "0.75rem",
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.4rem" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--text-main)", fontSize: "0.85rem" }}>
                              {v.command}
                            </span>
                            <span className={`badge ${v.exit_code === 0 ? "badge-local" : "badge-unknown"}`}>
                              {v.exit_code === 0 ? "PASSED (exit 0)" : `FAILED (exit ${v.exit_code})`}
                            </span>
                          </div>
                          <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>
                            {v.duration_ms}ms • {new Date(v.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        {(v.stdout_snippet || v.stderr_snippet) && (
                          <pre
                            style={{
                              background: "#05070a",
                              padding: "0.5rem",
                              borderRadius: "var(--radius-sm)",
                              fontSize: "0.75rem",
                              fontFamily: "var(--font-mono)",
                              overflowX: "auto",
                              color: v.exit_code === 0 ? "var(--text-muted)" : "var(--accent-rose)",
                              maxHeight: "150px",
                            }}
                          >
                            {v.stdout_snippet || v.stderr_snippet}
                          </pre>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {activeTab === "browser" && (
                <div>
                  {browserVerifications.length === 0 ? (
                    <div style={{ color: "var(--text-dim)", fontSize: "0.85rem", padding: "1rem" }}>
                      No Playwright browser verification artifacts recorded. UI tasks automatically capture dual-viewport screenshots (Desktop 1440x900 & Mobile 390x844).
                    </div>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
                      {browserVerifications.map((bv) => (
                        <div
                          key={bv.id}
                          style={{
                            background: "rgba(0,0,0,0.3)",
                            border: "1px solid var(--border-subtle)",
                            borderRadius: "var(--radius-md)",
                            overflow: "hidden",
                          }}
                        >
                          <div style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid var(--border-subtle)", display: "flex", justifyContent: "space-between", fontSize: "0.75rem" }}>
                            <span style={{ color: "var(--text-main)", fontWeight: 500 }}>
                              {bv.command}
                            </span>
                            <span style={{ color: bv.exit_code === 0 ? "var(--accent-emerald)" : "var(--accent-rose)" }}>
                              {bv.exit_code === 0 ? "Verified UI" : "Assertions Failed"}
                            </span>
                          </div>
                          {bv.output_artifact_id ? (
                            <div style={{ position: "relative", cursor: "pointer", background: "#05070b" }} onClick={() => setSelectedImage(`/api/v1/artifacts/${bv.output_artifact_id}`)}>
                              <img
                                src={`/api/v1/artifacts/${bv.output_artifact_id}`}
                                alt="Playwright Screenshot Evidence"
                                style={{ width: "100%", height: "200px", objectFit: "cover", display: "block" }}
                                onError={(e) => {
                                  // Fallback display if not available directly
                                  (e.target as HTMLElement).style.display = "none";
                                }}
                              />
                              <div style={{ position: "absolute", bottom: "6px", right: "6px", background: "rgba(0,0,0,0.7)", padding: "2px 6px", borderRadius: "4px", fontSize: "0.7rem", color: "var(--text-dim)" }}>
                                Click to enlarge
                              </div>
                            </div>
                          ) : (
                            <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-dim)", fontSize: "0.8rem" }}>
                              Screenshot saved to artifacts
                            </div>
                          )}
                          <div style={{ padding: "0.5rem 0.75rem", fontSize: "0.75rem", color: "var(--text-muted)" }}>
                            {bv.stdout_snippet || "All UI assertions passed"}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === "critic" && (
                <div>
                  {taskData.criticReviews.length === 0 ? (
                    <div style={{ color: "var(--text-dim)", fontSize: "0.85rem", padding: "1rem" }}>
                      No independent critic reviews recorded yet.
                    </div>
                  ) : (
                    taskData.criticReviews.map((cr) => {
                      let criteriaList: Array<{ criterion_id: string; status: string; reason: string }> = [];
                      try {
                        criteriaList = JSON.parse(cr.per_criterion_json);
                      } catch {}

                      let repairList: string[] = [];
                      try {
                        repairList = JSON.parse(cr.repair_instructions_json);
                      } catch {}

                      return (
                        <div
                          key={cr.id}
                          style={{
                            background: "rgba(255,255,255,0.02)",
                            border: `1px solid ${cr.verdict === "accept" ? "rgba(16, 185, 129, 0.4)" : "rgba(245, 158, 11, 0.4)"}`,
                            borderRadius: "var(--radius-md)",
                            padding: "1rem",
                            marginBottom: "1rem",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-main)" }}>Critic Verdict:</span>
                              <span className={`badge ${cr.verdict === "accept" ? "badge-local" : "badge-unknown"}`}>
                                {cr.verdict.toUpperCase()}
                              </span>
                            </div>
                            <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>
                              {new Date(cr.created_at).toLocaleTimeString()}
                            </span>
                          </div>

                          <div style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.75rem", lineHeight: 1.4 }}>
                            {cr.rationale}
                          </div>

                          {criteriaList.length > 0 && (
                            <div style={{ marginBottom: "0.75rem" }}>
                              <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", textTransform: "uppercase", marginBottom: "0.3rem" }}>
                                Criteria Evaluation:
                              </div>
                              {criteriaList.map((c, i) => (
                                <div key={i} style={{ fontSize: "0.8rem", color: "var(--text-muted)", display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.2rem" }}>
                                  <span style={{ color: c.status === "passed" ? "var(--accent-emerald)" : "var(--accent-rose)" }}>
                                    {c.status === "passed" ? "✓" : "✗"}
                                  </span>
                                  <span>{c.criterion_id}: {c.reason}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {repairList.length > 0 && (
                            <div style={{ background: "rgba(245, 158, 11, 0.08)", padding: "0.5rem", borderRadius: "var(--radius-sm)" }}>
                              <div style={{ fontSize: "0.75rem", color: "var(--accent-amber)", fontWeight: 600, marginBottom: "0.2rem" }}>
                                Required Repairs:
                              </div>
                              <ul style={{ paddingLeft: "1.2rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
                                {repairList.map((r, i) => (
                                  <li key={i}>{r}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {activeTab === "attempts" && (
                <div>
                  {taskData.attempts.length === 0 ? (
                    <div style={{ color: "var(--text-dim)", fontSize: "0.85rem", padding: "1rem" }}>
                      No attempts registered yet.
                    </div>
                  ) : (
                    taskData.attempts.map((att) => (
                      <div
                        key={att.id}
                        style={{
                          background: "rgba(0,0,0,0.25)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: "var(--radius-sm)",
                          padding: "0.75rem",
                          marginBottom: "0.5rem",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-main)" }}>
                            Attempt #{att.attempt_number} ({att.adapter_id})
                          </div>
                          <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginTop: "0.2rem" }}>
                            Branch: {att.task_branch || "N/A"} | Base: {att.base_commit?.slice(0, 7) || "HEAD"}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <span className={`badge ${att.status === "succeeded" ? "badge-local" : "badge-unknown"}`}>
                            {att.status.toUpperCase()}
                          </span>
                          <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: "0.2rem" }}>
                            {att.ended_at ? `Completed ${new Date(att.ended_at).toLocaleTimeString()}` : "In Progress"}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* Image Modal Preview */}
        {selectedImage && (
          <div
            className="modal-backdrop"
            style={{ zIndex: 110 }}
            onClick={() => setSelectedImage(null)}
          >
            <div style={{ maxWidth: "90vw", maxHeight: "90vh", position: "relative" }}>
              <img
                src={selectedImage}
                alt="Enlarged Visual Evidence"
                style={{ maxWidth: "100%", maxHeight: "85vh", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}
              />
              <button
                className="btn btn-secondary"
                onClick={() => setSelectedImage(null)}
                style={{ position: "absolute", top: "10px", right: "10px" }}
              >
                ✕ Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
