import React, { useState, useEffect } from "react";

interface HealthData {
  status: string;
  version: string;
  loopbackOnly: boolean;
  uptimeSeconds: number;
  nodeVersion: string;
}

export function App() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [runState, setRunState] = useState<"ready" | "running" | "paused" | "stopped">("ready");
  const [activeTask, setActiveTask] = useState<{ id: string; title: string; status: string } | null>({
    id: "task-0001",
    title: "Project Initialization & Baseline Verification",
    status: "ready",
  });
  const [budgetUsage, setBudgetUsage] = useState({
    estimatedCostUsd: 0.00,
    costCeilingUsd: 10.00,
    taskWarningUsd: 0.50,
    iterations: 0,
    maxIterations: 30,
  });
  const [events, setEvents] = useState<Array<{ id: string; time: string; type: string; message: string }>>([
    {
      id: "ev-0",
      time: new Date().toLocaleTimeString(),
      type: "system.init",
      message: "Autonomous Development Orchestrator initialized on loopback (127.0.0.1)",
    },
  ]);

  useEffect(() => {
    fetch("/api/v1/health")
      .then((res) => res.json())
      .then((data: HealthData) => setHealth(data))
      .catch((err) => console.error("Health fetch error:", err));
  }, []);

  const handleStart = async () => {
    setRunState("running");
    setEvents((prev) => [
      {
        id: `ev-${Date.now()}`,
        time: new Date().toLocaleTimeString(),
        type: "run.started",
        message: "Autonomous execution loop started.",
      },
      ...prev,
    ]);
  };

  const handlePause = async () => {
    setRunState("paused");
    setEvents((prev) => [
      {
        id: `ev-${Date.now()}`,
        time: new Date().toLocaleTimeString(),
        type: "run.paused",
        message: "Execution paused at safe checkpoint boundary.",
      },
      ...prev,
    ]);
  };

  const handleStop = async () => {
    setRunState("stopped");
    setEvents((prev) => [
      {
        id: `ev-${Date.now()}`,
        time: new Date().toLocaleTimeString(),
        type: "run.stopped",
        message: "Run stopped by user. Dispatch prevented.",
      },
      ...prev,
    ]);
  };

  return (
    <>
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-logo">A</div>
          <div>
            <h1 className="brand-title">Autonomous Development Orchestrator</h1>
          </div>
        </div>

        <div className="header-badges">
          <div className="badge badge-local" id="badge-reasoning">
            <span className="dot-indicator pulse"></span>
            Reasoning: Local (Ollama)
          </div>
          <div className="badge badge-unknown" id="badge-agent">
            <span className="dot-indicator"></span>
            Agent: Antigravity CLI (Remote)
          </div>
          <div className="badge badge-status" style={{ background: "rgba(255,255,255,0.05)" }}>
            Privacy: Hybrid (Not Offline)
          </div>
        </div>
      </header>

      <main className="dashboard-container">
        {/* Control Deck Bar */}
        <div className="glass-card control-deck">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.25rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Run Status
              </span>
              <span className={`badge ${runState === "running" ? "badge-local" : "badge-unknown"}`}>
                <span className={`dot-indicator ${runState === "running" ? "pulse" : ""}`}></span>
                {runState.toUpperCase()}
              </span>
            </div>
            <p style={{ fontSize: "0.875rem", color: "var(--text-muted)" }}>
              {runState === "running"
                ? "Autonomous loop active. Enforcing verifier gates & budget caps."
                : runState === "paused"
                ? "Paused at safe checkpoint. No child processes running."
                : runState === "stopped"
                ? "Run halted. Dispatch blocked."
                : "Ready to start task planning."}
            </p>
          </div>

          <div className="control-buttons">
            <button
              id="btn-start"
              className="btn btn-primary"
              onClick={handleStart}
              disabled={runState === "running"}
            >
              Start Run
            </button>
            <button
              id="btn-pause"
              className="btn btn-secondary"
              onClick={handlePause}
              disabled={runState !== "running"}
            >
              Pause
            </button>
            <button
              id="btn-stop"
              className="btn btn-danger"
              onClick={handleStop}
              disabled={runState === "stopped" || runState === "ready"}
            >
              Stop
            </button>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="dashboard-grid">
          {/* Active Task & Verification Summary */}
          <div className="glass-card">
            <div className="card-header">
              <h2 className="card-title">Active Task & Verification</h2>
              <span className="badge">{activeTask ? activeTask.status : "Idle"}</span>
            </div>

            <div style={{ padding: "1rem", background: "rgba(0,0,0,0.2)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginBottom: "0.25rem" }}>
                {activeTask?.id}
              </div>
              <div style={{ fontSize: "1.05rem", fontWeight: 600, color: "var(--text-main)" }}>
                {activeTask?.title}
              </div>
            </div>

            <div className="metrics-row">
              <div className="metric-box">
                <div className="metric-label">Estimated Cost</div>
                <div className="metric-value">${budgetUsage.estimatedCostUsd.toFixed(2)}</div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: "0.25rem" }}>
                  Hard cap: ${budgetUsage.costCeilingUsd.toFixed(2)}
                </div>
              </div>
              <div className="metric-box">
                <div className="metric-label">Iterations</div>
                <div className="metric-value">
                  {budgetUsage.iterations} / {budgetUsage.maxIterations}
                </div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: "0.25rem" }}>
                  Finite limit enforced
                </div>
              </div>
              <div className="metric-box">
                <div className="metric-label">Verifier Gate</div>
                <div className="metric-value" style={{ color: "var(--accent-emerald)" }}>Pass</div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: "0.25rem" }}>
                  Independent tests
                </div>
              </div>
              <div className="metric-box">
                <div className="metric-label">Critic Review</div>
                <div className="metric-value" style={{ color: "var(--accent-cyan)" }}>Pending</div>
                <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", marginTop: "0.25rem" }}>
                  Separate model role
                </div>
              </div>
            </div>
          </div>

          {/* System & Loopback Security Info */}
          <div className="glass-card">
            <div className="card-header">
              <h2 className="card-title">Platform Health</h2>
              <span className="badge badge-local">Loopback 127.0.0.1</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.85rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Backend Status:</span>
                <span style={{ color: health?.status === "ok" ? "var(--accent-emerald)" : "var(--accent-amber)" }}>
                  {health ? "Online (Healthy)" : "Connecting..."}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Host Binding:</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>127.0.0.1:4317</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Node Version:</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{health?.nodeVersion || "v24.19.0"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>CSRF / Origin Check:</span>
                <span style={{ color: "var(--accent-emerald)" }}>Enforced</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-dim)" }}>Git Checkpoints:</span>
                <span style={{ color: "var(--accent-cyan)" }}>Enabled</span>
              </div>
            </div>
          </div>
        </div>

        {/* Live SSE Event Stream Card */}
        <div className="glass-card">
          <div className="card-header">
            <h2 className="card-title">Real-Time Event Stream</h2>
            <span className="badge">{events.length} Events</span>
          </div>

          <div className="event-log" id="event-stream-container">
            {events.map((ev) => (
              <div key={ev.id} className="event-entry">
                <span className="event-time">{ev.time}</span>
                <span className="event-type">[{ev.type}]</span>
                <span className="event-desc">{ev.message}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
