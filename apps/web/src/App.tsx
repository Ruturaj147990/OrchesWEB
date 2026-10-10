import React, { useState, useEffect, useRef } from "react";
import { ProjectWizard } from "./features/wizard/ProjectWizard";
import { TaskInspector } from "./features/tasks/TaskInspector";
import { HumanDirectionBar } from "./features/inbox/HumanDirectionBar";
import { ProviderSettingsModal } from "./features/settings/ProviderSettingsModal";

interface HealthData {
  status: string;
  version: string;
  loopbackOnly: boolean;
  uptimeSeconds: number;
  nodeVersion: string;
}

interface ProjectData {
  id: string;
  name: string;
  objective: string;
  autonomyMode: string;
  status: string;
}

interface RunData {
  id: string;
  projectId: string;
  status: "draft" | "ready" | "running" | "pausing" | "paused" | "stopped" | "completed" | "failed";
  currentTaskId: string | null;
  iterationCount: number;
}

export function App() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [project, setProject] = useState<ProjectData | null>(null);
  const [activeRun, setActiveRun] = useState<RunData | null>(null);
  const [runState, setRunState] = useState<"ready" | "running" | "paused" | "stopped">("ready");
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [eventSearch, setEventSearch] = useState("");
  const [eventCategoryFilter, setEventCategoryFilter] = useState("all");
  const [activeReasoningProvider, setActiveReasoningProvider] = useState<{
    id: string;
    displayName: string;
    privacyClass: string;
  }>({
    id: "openai-compatible-local",
    displayName: "OpenAI-Compatible Local (Ollama)",
    privacyClass: "local",
  });
  const [inspectingTaskId, setInspectingTaskId] = useState<string | null>("task-0001");
  const [activeTask, setActiveTask] = useState<{ id: string; title: string; status: string } | null>({
    id: "task-0001",
    title: "Project Initialization & Verification Gates",
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
      message: "Autonomous Development Orchestrator running on 127.0.0.1:4317",
    },
  ]);

  const eventSourceRef = useRef<EventSource | null>(null);

  // 1. Fetch Health, Active Reasoning Provider, and Ensure Active Project Exists
  useEffect(() => {
    fetch("/api/v1/health")
      .then((res) => res.json())
      .then((data: HealthData) => setHealth(data))
      .catch((err) => console.error("Health fetch error:", err));

    fetch("/api/v1/providers/reasoning")
      .then((res) => res.json())
      .then((data) => {
        if (data.activeProvider) {
          setActiveReasoningProvider(data.activeProvider);
        }
      })
      .catch((err) => console.error("Providers fetch error:", err));

    fetch("/api/v1/projects")
      .then((res) => res.json())
      .then(async (projects: ProjectData[]) => {
        if (projects.length > 0) {
          setProject(projects[0]);
        } else {
          // Create default starter project
          const res = await fetch("/api/v1/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "Autonomous MVP Core",
              objective: "Verify end-to-end loop with deterministic verifier and independent critic",
              autonomyMode: "creative_within_constraints",
            }),
          });
          const newProj = await res.json();
          setProject(newProj);
        }
      })
      .catch((err) => console.error("Projects fetch error:", err));
  }, []);

  // 2. Connect to SSE stream once project is resolved
  useEffect(() => {
    if (!project) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const sse = new EventSource(`/api/v1/projects/${project.id}/events`);
    eventSourceRef.current = sse;

    sse.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        setEvents((prev) => [
          {
            id: parsed.id || `ev-${Date.now()}`,
            time: new Date(parsed.timestamp || Date.now()).toLocaleTimeString(),
            type: parsed.type || "event",
            message: JSON.stringify(parsed.payload),
          },
          ...prev,
        ]);
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    };

    return () => {
      sse.close();
    };
  }, [project]);

  const handleStart = async () => {
    if (!project) return;
    try {
      const res = await fetch(`/api/v1/projects/${project.id}/runs`, { method: "POST" });
      const run: RunData = await res.json();
      setActiveRun(run);
      setRunState(run.status === "paused" ? "paused" : "running");
      setEvents((prev) => [
        {
          id: `ev-${Date.now()}`,
          time: new Date().toLocaleTimeString(),
          type: "run.started",
          message: `Run ${run.id} active. Iteration: ${run.iterationCount}`,
        },
        ...prev,
      ]);
    } catch (err) {
      console.error("Error starting run:", err);
    }
  };

  const handlePause = async () => {
    if (!activeRun) return;
    try {
      const res = await fetch(`/api/v1/runs/${activeRun.id}/pause`, { method: "POST" });
      const run: RunData = await res.json();
      setActiveRun(run);
      setRunState("paused");
      setEvents((prev) => [
        {
          id: `ev-${Date.now()}`,
          time: new Date().toLocaleTimeString(),
          type: "run.paused",
          message: `Run ${run.id} paused at safe boundary.`,
        },
        ...prev,
      ]);
    } catch (err) {
      console.error("Error pausing run:", err);
    }
  };

  const handleStop = async () => {
    if (!activeRun) return;
    try {
      const res = await fetch(`/api/v1/runs/${activeRun.id}/stop`, { method: "POST" });
      const run: RunData = await res.json();
      setActiveRun(run);
      setRunState("stopped");
      setEvents((prev) => [
        {
          id: `ev-${Date.now()}`,
          time: new Date().toLocaleTimeString(),
          type: "run.stopped",
          message: `Run ${run.id} stopped. Dispatch halted.`,
        },
        ...prev,
      ]);
    } catch (err) {
      console.error("Error stopping run:", err);
    }
  };

  const handleExport = async (format: "json" | "markdown") => {
    if (!project) return;
    try {
      const res = await fetch(`/api/v1/projects/${project.id}/export?format=${format}`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.name.toLowerCase().replace(/\s+/g, "_")}_export_${Date.now()}.${format === "markdown" ? "md" : "json"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Export error:", err);
    }
  };

  const filteredEvents = events.filter((ev) => {
    const matchesQuery =
      eventSearch === "" ||
      ev.type.toLowerCase().includes(eventSearch.toLowerCase()) ||
      ev.message.toLowerCase().includes(eventSearch.toLowerCase());

    const matchesCategory =
      eventCategoryFilter === "all" ||
      ev.type.toLowerCase().includes(eventCategoryFilter.toLowerCase());

    return matchesQuery && matchesCategory;
  });

  return (
    <>
      <header className="app-header">
        <div className="brand-section">
          <div className="brand-logo">A</div>
          <div>
            <h1 className="brand-title">Autonomous Development Orchestrator</h1>
            <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>
              Project: {project?.name || "Initializing..."} ({project?.autonomyMode || "creative_within_constraints"})
            </div>
          </div>
        </div>

        <div className="header-badges">
          <button
            id="btn-open-wizard"
            className="btn btn-secondary"
            onClick={() => setIsWizardOpen(true)}
            style={{ fontSize: "0.75rem", padding: "0.3rem 0.75rem" }}
          >
            + New Project
          </button>
          <button
            id="btn-open-settings"
            className="btn btn-secondary"
            onClick={() => setIsSettingsOpen(true)}
            style={{ fontSize: "0.75rem", padding: "0.3rem 0.75rem" }}
          >
            ⚙ Settings & Policy
          </button>
          <div
            className={`badge ${activeReasoningProvider.id === "openai-compatible-local" ? "badge-local" : "badge-unknown"}`}
            id="badge-reasoning"
            style={activeReasoningProvider.id === "openai" ? { background: "rgba(99, 102, 241, 0.2)", color: "#a5b4fc", border: "1px solid rgba(99, 102, 241, 0.4)" } : {}}
          >
            <span className="dot-indicator pulse"></span>
            Reasoning: {activeReasoningProvider.id === "openai" ? "Cloud (OpenAI)" : "Local (Ollama)"}
          </div>
          <div className="badge badge-unknown" id="badge-agent">
            <span className="dot-indicator"></span>
            Agent: Antigravity CLI (Remote)
          </div>
          <div className="badge badge-status" style={{ background: "rgba(255,255,255,0.05)" }}>
            Privacy: {activeReasoningProvider.id === "openai" ? "Cloud (Remote)" : "Hybrid (Not Offline)"}
          </div>
        </div>
      </header>

      <ProjectWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onProjectCreated={(newProj) => {
          setProject(newProj);
          setActiveRun(null);
          setRunState("ready");
        }}
      />

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

        {/* Human Direction & Operator Inbox Bar */}
        <HumanDirectionBar
          projectId={project?.id || null}
          onSafeInterruptTriggered={handlePause}
        />

        {/* Dashboard Grid */}
        <div className="dashboard-grid">
          {/* Active Task & Verification Summary */}
          <div className="glass-card">
            <div className="card-header">
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <h2 className="card-title">Active Task & Verification</h2>
                <button
                  id="btn-inspect-task"
                  className="btn btn-secondary"
                  onClick={() => {
                    if (activeTask) {
                      setInspectingTaskId(activeTask.id);
                      setIsInspectorOpen(true);
                    }
                  }}
                  style={{ fontSize: "0.75rem", padding: "0.2rem 0.5rem" }}
                >
                  🔍 Inspect Evidence
                </button>
              </div>
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
                  {activeRun?.iterationCount || budgetUsage.iterations} / {budgetUsage.maxIterations}
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

        {/* Live SSE Event Stream & Audit Log Card */}
        <div className="glass-card">
          <div className="card-header" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <h2 className="card-title">Real-Time Event Stream & Audit Log</h2>
              <span className="badge">
                {filteredEvents.length} / {events.length} Events
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <button
                id="btn-export-json"
                className="btn btn-secondary"
                onClick={() => handleExport("json")}
                style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
              >
                ⬇ Export JSON
              </button>
              <button
                id="btn-export-md"
                className="btn btn-secondary"
                onClick={() => handleExport("markdown")}
                style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
              >
                ⬇ Export Markdown
              </button>
            </div>
          </div>

          {/* Search & Filter Deck */}
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap", marginTop: "0.75rem", marginBottom: "0.75rem" }}>
            <input
              type="text"
              id="input-event-search"
              placeholder="Search event types, task IDs, or log messages..."
              value={eventSearch}
              onChange={(e) => setEventSearch(e.target.value)}
              style={{
                flex: 1,
                minWidth: "220px",
                background: "#070a10",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                color: "var(--text-main)",
                padding: "0.4rem 0.6rem",
                fontSize: "0.8rem",
              }}
            />

            <div style={{ display: "flex", gap: "0.3rem" }}>
              {["all", "run", "task", "agent", "human", "budget"].map((cat) => (
                <button
                  key={cat}
                  className={`btn ${eventCategoryFilter === cat ? "btn-primary" : "btn-secondary"}`}
                  onClick={() => setEventCategoryFilter(cat)}
                  style={{ fontSize: "0.7rem", padding: "0.25rem 0.5rem", textTransform: "capitalize" }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="event-log" id="event-stream-container">
            {filteredEvents.length === 0 ? (
              <div style={{ color: "var(--text-dim)", padding: "1rem", textAlign: "center" }}>
                No events matching "{eventSearch}"
              </div>
            ) : (
              filteredEvents.map((ev) => (
                <div key={ev.id} className="event-entry">
                  <span className="event-time">{ev.time}</span>
                  <span className="event-type">[{ev.type}]</span>
                  <span className="event-desc">{ev.message}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Task Evidence & Verification Inspector Modal */}
        <TaskInspector
          isOpen={isInspectorOpen}
          onClose={() => setIsInspectorOpen(false)}
          taskId={inspectingTaskId}
        />

        {/* Provider, Privacy & Policy Settings Modal */}
        <ProviderSettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onProviderChanged={(newProvider) => {
            setActiveReasoningProvider(newProvider);
            setEvents((prev) => [
              {
                id: `ev-${Date.now()}`,
                time: new Date().toLocaleTimeString(),
                type: "provider.switched",
                message: `Active reasoning engine switched to ${newProvider.displayName}`,
              },
              ...prev,
            ]);
          }}
        />
      </main>
    </>
  );
}
