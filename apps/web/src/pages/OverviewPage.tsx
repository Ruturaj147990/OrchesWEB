import React from "react";
import { NavPage } from "../components/layout/Sidebar";
import { IdeConnectionDeck } from "../features/ide/IdeConnectionDeck";

export interface ProjectData {
  id: string;
  name: string;
  objective: string;
  rootPath?: string;
  autonomyMode: string;
  status: string;
}

export interface RunData {
  id: string;
  projectId: string;
  status: "draft" | "ready" | "running" | "pausing" | "paused" | "stopped" | "completed" | "failed";
  currentTaskId: string | null;
  iterationCount: number;
  startedAt?: string;
  endedAt?: string | null;
}

export interface IdeConnectionState {
  status: "disconnected" | "detecting" | "connected" | "ready" | "error";
  selectedWorkspace: {
    canonicalPath: string;
    name: string;
    isMatchingProject: boolean;
  } | null;
  detectedWorkspaces: Array<{
    canonicalPath: string;
    name: string;
    isMatchingProject: boolean;
  }>;
  activeMode: string;
}

interface OverviewPageProps {
  project: ProjectData | null;
  activeRun: RunData | null;
  recentRuns: RunData[];
  ideState: IdeConnectionState | null;
  backendHealthy: boolean;
  activeProvider: { id: string; displayName: string; privacyClass: string };
  events: Array<{ id: string; time: string; type: string; message: string }>;
  onStartRun: () => void;
  onPauseRun: () => void;
  onResumeRun: () => void;
  onStopRun: () => void;
  onNavigate: (page: NavPage) => void;
  onOpenWizard: () => void;
}

export function OverviewPage({
  project,
  activeRun,
  recentRuns,
  ideState,
  backendHealthy,
  activeProvider,
  events,
  onStartRun,
  onPauseRun,
  onResumeRun,
  onStopRun,
  onNavigate,
  onOpenWizard,
}: OverviewPageProps) {
  const isRunning = activeRun?.status === "running";
  const isPaused = activeRun?.status === "paused";
  const isStopped = activeRun?.status === "stopped" || activeRun?.status === "completed" || activeRun?.status === "failed";
  const workspaceMatch = Boolean(ideState?.selectedWorkspace?.isMatchingProject);
  const ideReady = ideState?.status === "ready";

  // Derive contextual status message
  let statusMessage = "Ready to start a run.";
  if (!backendHealthy) {
    statusMessage = "The orchestrator is not connected to the backend (127.0.0.1:4317).";
  } else if (!ideReady) {
    statusMessage = "Antigravity IDE connection required before autonomous execution.";
  } else if (!workspaceMatch) {
    statusMessage = "Workspace mismatch: Connected IDE workspace does not match target project.";
  } else if (isRunning) {
    statusMessage = "Autonomous loop active. Planning, executing, verifying, and committing tasks.";
  } else if (isPaused) {
    statusMessage = "Run execution is paused at safe boundary. No child processes active.";
  }

  return (
    <div className="content-container">
      {/* Page Heading & Primary Actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-main)" }}>Overview</h1>
            <span className={`badge ${isRunning ? "badge-success" : isPaused ? "badge-warning" : "badge-unknown"}`}>
              <span className={`dot-indicator ${isRunning ? "pulse" : ""}`}></span>
              {isRunning ? "RUNNING" : isPaused ? "PAUSED" : "IDLE"}
            </span>
          </div>
          <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            {statusMessage}
          </p>
        </div>

        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button id="btn-open-wizard" className="btn btn-secondary" onClick={onOpenWizard}>
            + New Project
          </button>
          <button
            id="btn-start"
            className="btn btn-primary"
            onClick={onStartRun}
            disabled={isRunning || !backendHealthy}
          >
            ▶ New Run
          </button>
        </div>
      </div>

      {/* System Readiness Strip */}
      <div className="readiness-strip">
        {/* 1. Backend */}
        <div className="readiness-item">
          <div className="readiness-label">1. Backend API</div>
          <div className="readiness-status" style={{ color: backendHealthy ? "var(--accent-emerald)" : "var(--accent-rose)" }}>
            <span className={`dot-indicator ${backendHealthy ? "pulse" : ""}`}></span>
            {backendHealthy ? "Ready (4317)" : "Disconnected"}
          </div>
        </div>

        {/* 2. Antigravity Process */}
        <div className="readiness-item" style={{ cursor: "pointer" }} onClick={() => onNavigate("ide")}>
          <div className="readiness-label">2. Antigravity IDE</div>
          <div
            className="readiness-status"
            id="badge-agent"
            style={{ color: ideReady ? "var(--accent-emerald)" : ideState?.status === "connected" ? "var(--accent-cyan)" : "var(--accent-amber)" }}
          >
            <span className="dot-indicator"></span>
            Agent: Antigravity ({ideState?.status || "disconnected"})
          </div>
        </div>

        {/* 3. Workspace Match */}
        <div className="readiness-item" style={{ cursor: "pointer" }} onClick={() => onNavigate("ide")}>
          <div className="readiness-label">3. Workspace Match</div>
          <div className="readiness-status" style={{ color: workspaceMatch ? "var(--accent-emerald)" : "var(--accent-rose)" }}>
            <span className="dot-indicator"></span>
            {workspaceMatch ? "Matched" : ideReady ? "Mismatch" : "Pending"}
          </div>
        </div>

        {/* 4. Reasoning Provider */}
        <div className="readiness-item" style={{ cursor: "pointer" }} onClick={() => onNavigate("providers")}>
          <div className="readiness-label">4. Reasoning Model</div>
          <div
            className="readiness-status"
            id="badge-reasoning"
            style={{ color: "var(--accent-primary)" }}
          >
            <span className="dot-indicator"></span>
            Reasoning: {activeProvider.id === "openai" ? "Cloud (OpenAI)" : "Local (Ollama)"}
          </div>
        </div>

        {/* 5. Coding Agent Readiness */}
        <div className="readiness-item">
          <div className="readiness-label">5. Coding Agent</div>
          <div className="readiness-status" style={{ color: ideReady ? "var(--accent-emerald)" : "var(--accent-amber)" }}>
            <span className="dot-indicator"></span>
            {ideReady ? "Ready (Verified)" : "Unverified"}
          </div>
        </div>

        {/* 6. Policy Readiness */}
        <div className="readiness-item" style={{ cursor: "pointer" }} onClick={() => onNavigate("policies")}>
          <div className="readiness-label">6. Policy Mode</div>
          <div className="readiness-status" style={{ color: "var(--accent-cyan)" }}>
            <span className="dot-indicator"></span>
            {project?.autonomyMode || "creative_within_constraints"}
          </div>
        </div>
      </div>

      {/* Summary Metrics */}
      <div className="metrics-row">
        <div className="metric-box">
          <div className="metric-label">Active Runs</div>
          <div className="metric-value">{isRunning ? "1" : "0"}</div>
        </div>
        <div className="metric-box">
          <div className="metric-label">Completed Runs</div>
          <div className="metric-value">
            {recentRuns.filter((r) => r.status === "completed").length}
          </div>
        </div>
        <div className="metric-box">
          <div className="metric-label">Failed / Stalled</div>
          <div className="metric-value" style={{ color: "var(--accent-rose)" }}>
            {recentRuns.filter((r) => r.status === "failed" || r.status === "stopped").length}
          </div>
        </div>
        <div className="metric-box">
          <div className="metric-label">Target Directory</div>
          <div className="metric-value" style={{ fontSize: "0.85rem", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
            {project?.rootPath || "Not configured"}
          </div>
        </div>
        <div className="metric-box">
          <div className="metric-label">Cost Ceiling</div>
          <div className="metric-value" style={{ color: "var(--accent-emerald)" }}>$10.00</div>
        </div>
      </div>

      {/* Visible Antigravity IDE Integration Deck */}
      <IdeConnectionDeck projectRootPath={project?.rootPath} />

      {/* Two Column Main Grid */}
      <div className="two-col-grid">
        {/* Main Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Active Run Card */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Current Execution</h2>
                <div className="card-subtitle">
                  {activeRun ? `Run ID: ${activeRun.id}` : "No active run in progress"}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <button
                  id="btn-pause"
                  className="btn btn-sm btn-secondary"
                  onClick={onPauseRun}
                  disabled={!isRunning}
                >
                  ⏸ Pause
                </button>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={onResumeRun}
                  disabled={!isPaused}
                >
                  ▶ Resume
                </button>
                <button
                  id="btn-stop"
                  className="btn btn-sm btn-danger"
                  onClick={onStopRun}
                  disabled={!isRunning && !isPaused}
                >
                  ⏹ Stop
                </button>
                <button
                  className="btn btn-sm btn-outline"
                  onClick={() => onNavigate("runs")}
                >
                  View Details &rarr;
                </button>
              </div>
            </div>

            {activeRun ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.85rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem", background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)" }}>
                  <span style={{ color: "var(--text-dim)" }}>Iteration / Attempt:</span>
                  <span style={{ fontWeight: 600 }}>{activeRun.iterationCount}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem", background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)" }}>
                  <span style={{ color: "var(--text-dim)" }}>Active Task ID:</span>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{activeRun.currentTaskId || "Auto-planning next task"}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "0.5rem", background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)" }}>
                  <span style={{ color: "var(--text-dim)" }}>Status Phase:</span>
                  <span className={`badge ${activeRun.status === "running" ? "badge-success" : "badge-warning"}`}>
                    {activeRun.status.toUpperCase()}
                  </span>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "2rem 1rem", color: "var(--text-dim)" }}>
                <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>⚡</div>
                <div>No active autonomous development run.</div>
                <div style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
                  Ensure your Antigravity IDE workspace is verified and click <strong>New Run</strong> to begin.
                </div>
              </div>
            )}
          </div>

          {/* Recent Runs History */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Recent Run History</h2>
              <button className="btn btn-sm btn-outline" onClick={() => onNavigate("runs")}>
                All Runs &rarr;
              </button>
            </div>

            {recentRuns.length === 0 ? (
              <div style={{ textAlign: "center", padding: "1.5rem", color: "var(--text-dim)", fontSize: "0.85rem" }}>
                No past runs recorded yet.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Run ID</th>
                    <th>Status</th>
                    <th>Iterations</th>
                    <th>Started</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRuns.slice(0, 5).map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>{r.id.slice(0, 16)}...</td>
                      <td>
                        <span className={`badge ${r.status === "completed" ? "badge-success" : r.status === "running" ? "badge-info" : "badge-danger"}`}>
                          {r.status}
                        </span>
                      </td>
                      <td>{r.iterationCount}</td>
                      <td style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>
                        {r.startedAt ? new Date(r.startedAt).toLocaleTimeString() : "-"}
                      </td>
                      <td>
                        <button className="btn btn-sm btn-outline" onClick={() => onNavigate("runs")}>
                          Inspect
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Secondary Column */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Antigravity IDE Status Card */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Antigravity IDE</h2>
              <span className={`badge ${ideReady ? "badge-success" : "badge-warning"}`}>
                {ideState?.status || "disconnected"}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", fontSize: "0.8rem" }}>
              <div>
                <span style={{ color: "var(--text-dim)" }}>Connected Workspace:</span>
                <div style={{ fontFamily: "var(--font-mono)", wordBreak: "break-all", marginTop: "0.15rem" }}>
                  {ideState?.selectedWorkspace?.canonicalPath || "None selected"}
                </div>
              </div>

              <div>
                <span style={{ color: "var(--text-dim)" }}>Target Project Root:</span>
                <div style={{ fontFamily: "var(--font-mono)", wordBreak: "break-all", marginTop: "0.15rem" }}>
                  {project?.rootPath || "None configured"}
                </div>
              </div>

              <div style={{ marginTop: "0.5rem" }}>
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => onNavigate("ide")}
                  style={{ width: "100%" }}
                >
                  Manage Connection Deck &rarr;
                </button>
              </div>
            </div>
          </div>

          {/* Live Recent Activity */}
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Live Activity</h2>
              <span className="badge">{events.length} Events</span>
            </div>

            <div className="event-log" id="event-stream-container">
              {events.slice(0, 30).map((ev) => (
                <div key={ev.id} className="event-entry">
                  <span className="event-time">{ev.time}</span>
                  <span className="event-type">[{ev.type}]</span>
                  <span className="event-desc">{ev.message}</span>
                </div>
              ))}
            </div>

            <div style={{ marginTop: "0.75rem", display: "flex", justifyContent: "flex-end" }}>
              <button className="btn btn-sm btn-outline" onClick={() => onNavigate("timeline")}>
                Full Event Timeline &rarr;
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
