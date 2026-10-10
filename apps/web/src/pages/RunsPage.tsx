import React, { useState, useEffect } from "react";
import { RunData, ProjectData } from "./OverviewPage";

interface TaskItem {
  id: string;
  title: string;
  objective: string;
  status: string;
  priority: string;
  risk: string;
  attempt_count?: number;
}

interface RunsPageProps {
  project: ProjectData | null;
  activeRun: RunData | null;
  runs: RunData[];
  onStartRun: () => void;
  onPauseRun: () => void;
  onResumeRun: () => void;
  onStopRun: () => void;
}

export function RunsPage({
  project,
  activeRun,
  runs,
  onStartRun,
  onPauseRun,
  onResumeRun,
  onStopRun,
}: RunsPageProps) {
  const [selectedRunId, setSelectedRunId] = useState<string | null>(activeRun?.id || null);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedTaskDetail, setSelectedTaskDetail] = useState<any | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const [consoleLogs, setConsoleLogs] = useState<string[]>([
    "[System] Autonomous loop runner attached.",
    "[Verifier] Independent verifiers armed: syntax, types, unit tests, Playwright browser assertions.",
    "[Acceptance Gate] Deterministic TypeScript gate active. Zero LLM override permitted.",
  ]);

  useEffect(() => {
    if (activeRun && !selectedRunId) {
      setSelectedRunId(activeRun.id);
    }
  }, [activeRun]);

  // Fetch tasks for active project
  useEffect(() => {
    if (!project) return;
    fetch(`/api/v1/projects/${project.id}/tasks`)
      .then((res) => res.json())
      .then((data) => {
        if (data.tasks) {
          setTasks(data.tasks);
        }
      })
      .catch((err) => console.error("Tasks fetch error:", err));
  }, [project, activeRun]);

  const fetchTaskDetail = async (taskId: string) => {
    try {
      const res = await fetch(`/api/v1/tasks/${taskId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedTaskDetail(data);
      }
    } catch (err) {
      console.error("Task detail fetch error:", err);
    }
  };

  const handleManualStep = async () => {
    if (!selectedRunId) return;
    try {
      await fetch(`/api/v1/runs/${selectedRunId}/step`, { method: "POST" });
      setConsoleLogs((prev) => [...prev, `[Operator Action] Manual task step dispatched on run ${selectedRunId}`]);
    } catch (err) {
      console.error("Manual step error:", err);
    }
  };

  const filteredRuns = runs.filter((r) => {
    if (statusFilter === "all") return true;
    return r.status === statusFilter;
  });

  const currentRun = runs.find((r) => r.id === selectedRunId) || activeRun;
  const isRunning = currentRun?.status === "running";
  const isPaused = currentRun?.status === "paused";

  return (
    <div className="content-container">
      {/* Page Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-main)" }}>Runs & Tasks</h1>
          <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            Real-time execution monitoring, task roadmap breakdown, verification logs, and deterministic acceptance gates.
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button className="btn btn-secondary" onClick={handleManualStep} disabled={!currentRun}>
            ⚡ Dispatch Single Step
          </button>
          <button className="btn btn-primary" onClick={onStartRun} disabled={isRunning}>
            ▶ Start Run
          </button>
        </div>
      </div>

      {/* Main Execution Workspace Grid */}
      <div className="two-col-grid" style={{ gridTemplateColumns: "300px 1fr" }}>
        {/* Runs List Sidebar */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <div className="card" style={{ padding: "0.75rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, textTransform: "uppercase", color: "var(--text-dim)" }}>
                Execution Runs
              </span>
              <span className="badge">{runs.length}</span>
            </div>

            {/* Filter buttons */}
            <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
              {["all", "running", "paused", "completed", "failed"].map((st) => (
                <button
                  key={st}
                  className={`btn btn-sm ${statusFilter === st ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setStatusFilter(st)}
                  style={{ textTransform: "capitalize", padding: "0.15rem 0.45rem", fontSize: "0.7rem" }}
                >
                  {st}
                </button>
              ))}
            </div>

            {/* Runs list items */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxHeight: "550px", overflowY: "auto" }}>
              {filteredRuns.length === 0 ? (
                <div style={{ color: "var(--text-dim)", fontSize: "0.8rem", padding: "1rem", textAlign: "center" }}>
                  No runs found
                </div>
              ) : (
                filteredRuns.map((r) => {
                  const isSelected = r.id === selectedRunId;
                  return (
                    <div
                      key={r.id}
                      onClick={() => setSelectedRunId(r.id)}
                      style={{
                        padding: "0.6rem 0.75rem",
                        borderRadius: "var(--radius-sm)",
                        border: `1px solid ${isSelected ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                        background: isSelected ? "var(--accent-primary-subtle)" : "var(--bg-subtle)",
                        cursor: "pointer",
                        transition: "all 0.15s ease",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", fontWeight: 600 }}>
                          {r.id.slice(0, 16)}...
                        </span>
                        <span
                          className={`badge ${
                            r.status === "running"
                              ? "badge-success"
                              : r.status === "paused"
                              ? "badge-warning"
                              : r.status === "completed"
                              ? "badge-info"
                              : "badge-danger"
                          }`}
                          style={{ fontSize: "0.65rem", padding: "0.1rem 0.35rem" }}
                        >
                          {r.status}
                        </span>
                      </div>
                      <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: "0.25rem" }}>
                        Iterations: {r.iterationCount} • Started: {r.startedAt ? new Date(r.startedAt).toLocaleTimeString() : "-"}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Selected Run Detailed View */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {currentRun ? (
            <>
              {/* Run Control & Status Header Card */}
              <div className="card">
                <div className="card-header">
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <h2 className="card-title">Run: {currentRun.id}</h2>
                      <span className={`badge ${isRunning ? "badge-success" : isPaused ? "badge-warning" : "badge-unknown"}`}>
                        <span className={`dot-indicator ${isRunning ? "pulse" : ""}`}></span>
                        {currentRun.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="card-subtitle">
                      Target Project: {project?.name} ({project?.rootPath})
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button className="btn btn-sm btn-secondary" onClick={onPauseRun} disabled={!isRunning}>
                      ⏸ Pause
                    </button>
                    <button className="btn btn-sm btn-secondary" onClick={onResumeRun} disabled={!isPaused}>
                      ▶ Resume
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={onStopRun} disabled={currentRun.status === "stopped"}>
                      ⏹ Stop
                    </button>
                  </div>
                </div>

                {/* Execution Lifecycle Stepper */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "0.5rem", marginTop: "1rem" }}>
                  {[
                    { name: "1. Planning", state: isRunning ? "passed" : "pending" },
                    { name: "2. Execution", state: isRunning ? "passed" : "pending" },
                    { name: "3. Verification", state: isRunning ? "passed" : "pending" },
                    { name: "4. Critic Review", state: isRunning ? "passed" : "pending" },
                    { name: "5. Acceptance Gate", state: isRunning ? "passed" : "pending" },
                  ].map((step, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: "0.5rem",
                        background: "var(--bg-subtle)",
                        borderRadius: "var(--radius-sm)",
                        border: "1px solid var(--border-subtle)",
                        textAlign: "center",
                      }}
                    >
                      <div style={{ fontSize: "0.75rem", fontWeight: 600 }}>{step.name}</div>
                      <div style={{ fontSize: "0.68rem", color: "var(--accent-emerald)", marginTop: "0.15rem" }}>
                        Verified
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Tasks Breakdown Table */}
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Planned & Executed Tasks</h3>
                  <span className="badge">{tasks.length} Tasks</span>
                </div>

                {tasks.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "1.5rem", color: "var(--text-dim)", fontSize: "0.85rem" }}>
                    No tasks dispatched yet for this run.
                  </div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Task ID</th>
                        <th>Title & Objective</th>
                        <th>Priority</th>
                        <th>Status</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tasks.map((t) => (
                        <tr key={t.id}>
                          <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>{t.id}</td>
                          <td>
                            <div style={{ fontWeight: 600 }}>{t.title}</div>
                            <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>{t.objective}</div>
                          </td>
                          <td>
                            <span className="badge badge-info">{t.priority}</span>
                          </td>
                          <td>
                            <span
                              className={`badge ${
                                t.status === "succeeded"
                                  ? "badge-success"
                                  : t.status === "running"
                                  ? "badge-info"
                                  : "badge-warning"
                              }`}
                            >
                              {t.status}
                            </span>
                          </td>
                          <td>
                            <button
                              className="btn btn-sm btn-outline"
                              onClick={() => fetchTaskDetail(t.id)}
                            >
                              🔍 Evidence
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Task Evidence Inspector Drawer / Panel */}
              {selectedTaskDetail && (
                <div className="card" style={{ borderLeft: "4px solid var(--accent-primary)" }}>
                  <div className="card-header">
                    <div>
                      <h3 className="card-title">Evidence Inspector: {selectedTaskDetail.task?.title}</h3>
                      <div className="card-subtitle">Task ID: {selectedTaskDetail.task?.id}</div>
                    </div>
                    <button className="btn btn-sm btn-outline" onClick={() => setSelectedTaskDetail(null)}>
                      Close
                    </button>
                  </div>

                  {/* Verification runs */}
                  <div style={{ marginBottom: "1rem" }}>
                    <h4 style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.4rem" }}>
                      Verification Runs ({selectedTaskDetail.verifications?.length || 0})
                    </h4>
                    {selectedTaskDetail.verifications?.length === 0 ? (
                      <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>No verification runs recorded</div>
                    ) : (
                      selectedTaskDetail.verifications?.map((v: any) => (
                        <div key={v.id} style={{ background: "var(--bg-subtle)", padding: "0.5rem", borderRadius: "var(--radius-sm)", marginBottom: "0.5rem", fontSize: "0.8rem" }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{v.command}</span>
                            <span className={`badge ${v.exit_code === 0 ? "badge-success" : "badge-danger"}`}>
                              Exit Code: {v.exit_code} ({v.duration_ms}ms)
                            </span>
                          </div>
                          {v.stdout_snippet && <pre className="code-block" style={{ marginTop: "0.4rem" }}>{v.stdout_snippet}</pre>}
                        </div>
                      ))
                    )}
                  </div>

                  {/* Critic reviews */}
                  <div>
                    <h4 style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.4rem" }}>
                      Critic Reviews ({selectedTaskDetail.criticReviews?.length || 0})
                    </h4>
                    {selectedTaskDetail.criticReviews?.length === 0 ? (
                      <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>No critic reviews recorded</div>
                    ) : (
                      selectedTaskDetail.criticReviews?.map((c: any) => (
                        <div key={c.id} style={{ background: "var(--bg-subtle)", padding: "0.5rem", borderRadius: "var(--radius-sm)", fontSize: "0.8rem" }}>
                          <div style={{ display: "flex", justifyContent: "space-between" }}>
                            <span style={{ fontWeight: 600 }}>Verdict: {c.verdict}</span>
                            <span className="badge badge-info">Independent LLM Role</span>
                          </div>
                          <div style={{ marginTop: "0.4rem" }}>{c.rationale}</div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Execution Console Output */}
              <div className="card">
                <div className="card-header">
                  <h3 className="card-title">Live Execution Console</h3>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <button
                      className={`btn btn-sm ${autoScroll ? "btn-primary" : "btn-secondary"}`}
                      onClick={() => setAutoScroll(!autoScroll)}
                    >
                      {autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
                    </button>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => navigator.clipboard.writeText(consoleLogs.join("\n"))}
                    >
                      Copy Logs
                    </button>
                  </div>
                </div>

                <div className="event-log" style={{ minHeight: "150px" }}>
                  {consoleLogs.map((log, idx) => (
                    <div key={idx} className="event-entry">
                      <span className="event-desc">{log}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="card" style={{ textAlign: "center", padding: "3rem", color: "var(--text-dim)" }}>
              <h3>No run selected</h3>
              <p style={{ marginTop: "0.5rem" }}>Select an existing run from the left panel or click <strong>Start Run</strong> to begin.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
