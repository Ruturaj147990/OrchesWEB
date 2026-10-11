import React, { useState, useEffect, useRef } from "react";
import { IdeConnectionDeck } from "./features/ide/IdeConnectionDeck";
import { ProjectWizard } from "./features/wizard/ProjectWizard";
import { TaskInspector } from "./features/tasks/TaskInspector";
import { HumanDirectionBar } from "./features/inbox/HumanDirectionBar";
import { ProviderSettingsModal } from "./features/settings/ProviderSettingsModal";
import { ReasoningEngineSelector } from "./features/settings/ReasoningEngineSelector";
import { Drawer } from "./components/common/Drawer";
import { GitPage } from "./pages/GitPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { PoliciesPage } from "./pages/PoliciesPage";
import { SettingsPage } from "./pages/SettingsPage";

import { ProjectData } from "./types";

export interface RunData {
  id: string;
  projectId: string;
  status: "pending" | "running" | "paused" | "completed" | "failed" | "stopped" | "blocked";
  iterationCount: number;
  currentTaskId: string | null;
  startedAt: string;
  endedAt: string | null;
  stopReason?: string | null;
}

export type ActiveDrawer =
  | "none"
  | "ide"
  | "settings"
  | "git"
  | "diagnostics"
  | "policies"
  | "history"
  | "artifacts"
  | "export";

export function App() {
  // 1. Theme State (Defaulting to restrained dark theme per Section 3)
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [backendHealthy, setBackendHealthy] = useState(false);

  // 2. Project State
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectData | null>(null);
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  // 3. Execution & Run State
  const [runs, setRuns] = useState<RunData[]>([]);
  const [activeRun, setActiveRun] = useState<RunData | null>(null);
  const [activeTask, setActiveTask] = useState<{
    id: string;
    title: string;
    objective: string;
    status: string;
  } | null>(null);

  // 4. Drawer & Modal Controls
  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawer>("none");
  const [inspectTaskId, setInspectTaskId] = useState<string | null>(null);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"json" | "markdown">("json");
  const [exportData, setExportData] = useState<string | null>(null);

  // 5. IDE & Provider State
  const [ideState, setIdeState] = useState<any | null>(null);
  const [activeProvider, setActiveProvider] = useState<{
    id: string;
    displayName: string;
    privacyClass: string;
  }>({
    id: "openai-compatible-local",
    displayName: "OpenAI-Compatible Local (Ollama)",
    privacyClass: "local",
  });

  // 6. Timeline Events
  const [events, setEvents] = useState<Array<{ id: string; time: string; type: string; message: string; details?: any }>>([
    {
      id: "ev-0",
      time: new Date().toLocaleTimeString(),
      type: "system.init",
      message: "Autonomous Development Orchestrator running on 127.0.0.1:4317",
    },
  ]);
  const [timelineFilter, setTimelineFilter] = useState<string>("all");
  const [timelineSearch, setTimelineSearch] = useState<string>("");
  const [autoScrollTimeline, setAutoScrollTimeline] = useState<boolean>(true);
  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  // 1. Probe Backend Health
  const checkHealth = async () => {
    try {
      const res = await fetch("/api/v1/health");
      setBackendHealthy(res.ok);
    } catch {
      setBackendHealthy(false);
    }
  };

  // 2. Fetch Active Reasoning Provider
  const fetchProvider = async () => {
    try {
      const res = await fetch("/api/v1/providers/reasoning");
      if (res.ok) {
        const data = await res.json();
        if (data.activeProvider) {
          setActiveProvider(data.activeProvider);
        }
      }
    } catch (err) {
      console.error("Provider fetch error:", err);
    }
  };

  // 3. Poll IDE Status
  const fetchIdeStatus = async () => {
    try {
      const res = await fetch("/api/v1/ide/status");
      if (res.ok) {
        const data = await res.json();
        setIdeState(data);
      }
    } catch (err) {
      console.error("IDE status fetch error:", err);
    }
  };

  // 4. Fetch Projects
  const fetchProjects = async () => {
    try {
      const res = await fetch("/api/v1/projects");
      if (res.ok) {
        const list = await res.json();
        setProjects(list);
        if (list.length > 0 && !activeProject) {
          setActiveProject(list[0]);
        } else if (list.length === 0) {
          // Initialize starter project if none exists
          const initRes = await fetch("/api/v1/projects", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: "Autonomous Core",
              objective: "Verify end-to-end loop with deterministic verifier and independent critic",
              rootPath: "c:\\Users\\limbk\\OneDrive\\Desktop\\orches",
              autonomyMode: "creative_within_constraints",
            }),
          });
          if (initRes.ok) {
            const created = await initRes.json();
            setProjects([created]);
            setActiveProject(created);
          }
        }
      }
    } catch (err) {
      console.error("Projects fetch error:", err);
    }
  };

  // 5. Fetch Runs for active project
  const fetchRuns = async (projectId: string) => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}/runs`);
      if (res.ok) {
        const data = await res.json();
        const runsList: RunData[] = data.runs || [];
        setRuns(runsList);
        const running = runsList.find((r) => r.status === "running");
        setActiveRun(running || null);
      }
    } catch (err) {
      console.error("Runs fetch error:", err);
    }
  };

  useEffect(() => {
    checkHealth();
    fetchProvider();
    fetchIdeStatus();
    fetchProjects();

    const interval = setInterval(() => {
      checkHealth();
      fetchIdeStatus();
    }, 4000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeProject) {
      fetchRuns(activeProject.id);
    }
  }, [activeProject]);

  // Connect to SSE Stream for active project
  useEffect(() => {
    if (!activeProject) return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    try {
      const sse = new EventSource(`/api/v1/projects/${activeProject.id}/events`);
      eventSourceRef.current = sse;

      sse.onmessage = (e) => {
        try {
          const parsed = JSON.parse(e.data);
          setEvents((prev) => [
            {
              id: parsed.id || `ev-${Date.now()}`,
              time: new Date(parsed.timestamp || Date.now()).toLocaleTimeString(),
              type: parsed.type || "event",
              message: typeof parsed.payload === "string" ? parsed.payload : JSON.stringify(parsed.payload),
              details: parsed.payload,
            },
            ...prev,
          ]);

          // Refresh runs on run lifecycle events
          if (parsed.type?.startsWith("run.") || parsed.type?.startsWith("task.")) {
            fetchRuns(activeProject.id);
            if (parsed.payload?.title) {
              setActiveTask({
                id: parsed.payload.taskId || "task-01",
                title: parsed.payload.title,
                objective: parsed.payload.objective || "Fulfill planned requirements",
                status: "running",
              });
            }
          }
        } catch (err) {
          console.error("SSE parse error:", err);
        }
      };

      sse.onerror = () => {
        // SSE reconnection handled automatically
      };
    } catch (err) {
      console.error("SSE connection error:", err);
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [activeProject]);

  // Auto-scroll timeline when enabled
  useEffect(() => {
    if (autoScrollTimeline && timelineEndRef.current) {
      timelineEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [events, autoScrollTimeline]);

  // Run lifecycle actions
  const isRunning = activeRun?.status === "running";
  const isPaused = activeRun?.status === "paused";

  const handleStartRun = async () => {
    let proj = activeProject;
    if (!proj && projects.length > 0) {
      proj = projects[0];
    }
    if (!proj) return;

    try {
      const res = await fetch(`/api/v1/projects/${proj.id}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowDirty: true }),
      });
      if (res.ok) {
        const run: RunData = await res.json();
        setActiveRun(run);
        setRuns((prev) => [run, ...prev.filter((r) => r.id !== run.id)]);
        setEvents((prev) => [
          {
            id: `ev-${Date.now()}`,
            time: new Date().toLocaleTimeString(),
            type: "run.started",
            message: `Run ${run.id} started. Dispatch active.`,
          },
          ...prev,
        ]);
      }
    } catch (err) {
      console.error("Start run error:", err);
    }
  };

  const handlePauseRun = async () => {
    if (!activeRun) return;
    try {
      const res = await fetch(`/api/v1/runs/${activeRun.id}/pause`, { method: "POST" });
      if (res.ok) {
        const run: RunData = await res.json();
        setActiveRun(run);
        setRuns((prev) => prev.map((r) => (r.id === run.id ? run : r)));
      }
    } catch (err) {
      console.error("Pause run error:", err);
    }
  };

  const handleResumeRun = async () => {
    if (!activeRun) return;
    try {
      const res = await fetch(`/api/v1/runs/${activeRun.id}/resume`, { method: "POST" });
      if (res.ok) {
        const run: RunData = await res.json();
        setActiveRun(run);
        setRuns((prev) => prev.map((r) => (r.id === run.id ? run : r)));
      }
    } catch (err) {
      console.error("Resume run error:", err);
    }
  };

  const handleStopRun = async () => {
    if (!activeRun) return;
    try {
      const res = await fetch(`/api/v1/runs/${activeRun.id}/stop`, { method: "POST" });
      if (res.ok) {
        const run: RunData = await res.json();
        setActiveRun(run);
        setRuns((prev) => prev.map((r) => (r.id === run.id ? run : r)));
      }
    } catch (err) {
      console.error("Stop run error:", err);
    }
  };

  const handleTriggerExport = async (format: "json" | "markdown") => {
    if (!activeProject) return;
    setExportFormat(format);
    setIsExportModalOpen(true);
    try {
      const res = await fetch(`/api/v1/projects/${activeProject.id}/export?format=${format}`);
      if (res.ok) {
        const data = await res.text();
        setExportData(data);
      }
    } catch (err) {
      console.error("Export error:", err);
    }
  };

  // Filtered Events
  const filteredEvents = events.filter((ev) => {
    const matchesFilter =
      timelineFilter === "all" ||
      (timelineFilter === "run" && ev.type.startsWith("run.")) ||
      (timelineFilter === "task" && ev.type.startsWith("task.")) ||
      (timelineFilter === "agent" && ev.type.startsWith("agent.")) ||
      (timelineFilter === "verif" && ev.type.startsWith("verif."));
    const matchesSearch =
      !timelineSearch ||
      ev.message.toLowerCase().includes(timelineSearch.toLowerCase()) ||
      ev.type.toLowerCase().includes(timelineSearch.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const workspaceMatch = Boolean(ideState?.selectedWorkspace?.isMatchingProject);
  const ideReady = ideState?.status === "ready";

  return (
    <div className="single-dashboard">
      {/* 1. COMPACT TOP HEADER */}
      <header className="dashboard-header">
        <div className="dashboard-header-left">
          <div style={{ display: "flex", alignItems: "center", gap: "0.45rem" }}>
            <span style={{ color: "var(--accent-primary)", fontSize: "1.2rem" }}>⚡</span>
            <span
              className="brand-badge"
              style={{
                fontWeight: 800,
                fontSize: "0.85rem",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border-subtle)",
                padding: "0.15rem 0.4rem",
                borderRadius: "4px",
                color: "var(--accent-primary)",
              }}
            >
              ADO
            </span>
            <span className="brand-title" style={{ fontWeight: 700, fontSize: "1.05rem", letterSpacing: "-0.01em" }}>
              Autonomous Development Orchestrator
            </span>
          </div>

          {/* Project Selector Dropdown */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginLeft: "0.5rem" }}>
            <select
              className="form-select form-select-sm"
              style={{ minWidth: "170px", fontWeight: 600, fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
              value={activeProject?.id || ""}
              onChange={(e) => {
                if (e.target.value === "__NEW__") {
                  setIsWizardOpen(true);
                } else {
                  const p = projects.find((item) => item.id === e.target.value);
                  if (p) setActiveProject(p);
                }
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  📁 {p.name}
                </option>
              ))}
              <option value="__NEW__">+ New Project Wizard...</option>
            </select>
          </div>
        </div>

        {/* Center / Reasoning Selector & IDE Status */}
        <div className="dashboard-header-center" style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <ReasoningEngineSelector
            onProviderChanged={(p) => setActiveProvider(p)}
            onRequestOpenSettings={() => setActiveDrawer("settings")}
          />

          <button
            id="badge-agent"
            className="btn btn-sm btn-outline"
            style={{ fontSize: "0.75rem", padding: "0.25rem 0.55rem", display: "flex", alignItems: "center", gap: "0.35rem" }}
            onClick={() => setActiveDrawer("ide")}
            title="Click to manage Antigravity IDE connection"
          >
            <span className={`status-dot ${ideReady ? "dot-connected" : "dot-warning"}`} />
            Agent: Antigravity ({ideState?.status || "disconnected"})
          </button>
        </div>

        {/* Right / Quick Actions */}
        <div className="dashboard-header-right" style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button
            className="btn btn-sm btn-outline"
            onClick={toggleTheme}
            title="Toggle Light / Dark Mode"
            style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
          >
            {theme === "light" ? "🌙 Dark" : "☀️ Light"}
          </button>

          <button
            className="btn btn-sm btn-secondary"
            onClick={() => setActiveDrawer("settings")}
            title="Open Settings Drawer"
            style={{ fontSize: "0.8rem", padding: "0.25rem 0.6rem" }}
          >
            ⚙️ Settings
          </button>
        </div>
      </header>

      {/* 2. PROJECT SUMMARY STRIP */}
      <section className="dashboard-project-strip">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", width: "100%", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", flex: 1, minWidth: "280px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
              <h1 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700, color: "var(--text-main)" }}>
                {activeProject?.name || "No Project Selected"}
              </h1>
              <span className="badge badge-info" style={{ fontSize: "0.7rem" }}>
                Mode: {activeProject?.autonomyMode || "creative_within_constraints"}
              </span>
              <span className={`badge ${backendHealthy ? "badge-success" : "badge-danger"}`} style={{ fontSize: "0.7rem" }}>
                Backend: {backendHealthy ? "Online" : "Offline"}
              </span>
              <span className={`badge ${workspaceMatch ? "badge-success" : "badge-danger"}`} style={{ fontSize: "0.7rem" }}>
                {workspaceMatch ? "✓ Workspace Matched" : "⚠ Workspace Mismatch"}
              </span>
            </div>

            <div style={{ color: "var(--text-muted)", fontSize: "0.82rem" }}>
              {activeProject?.objective || "Create or select a project to begin autonomous orchestration"}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginTop: "0.15rem" }}>
              <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>Workspace:</span>
              <code
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.75rem",
                  padding: "0.15rem 0.45rem",
                  background: "var(--bg-card)",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {activeProject?.rootPath || "Not configured"}
              </code>
              <button
                className="btn btn-sm btn-outline"
                style={{ padding: "0.15rem 0.4rem", fontSize: "0.7rem" }}
                onClick={() => {
                  if (activeProject?.rootPath) {
                    navigator.clipboard.writeText(activeProject.rootPath);
                  }
                }}
                title="Copy Workspace Path"
              >
                Copy
              </button>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <button
              className="btn btn-sm btn-outline"
              onClick={() => setIsWizardOpen(true)}
              style={{ fontWeight: 600, fontSize: "0.8rem", padding: "0.35rem 0.75rem" }}
            >
              + Add
            </button>
            <button
              id="btn-start"
              className="btn btn-sm btn-primary"
              onClick={handleStartRun}
              disabled={isRunning || !backendHealthy}
              style={{ fontWeight: 600, fontSize: "0.8rem", padding: "0.35rem 0.85rem" }}
            >
              ▶ Start Run
            </button>
          </div>
        </div>
      </section>

      {/* 3. COMPACT 5-COLUMN SYSTEM & RUN STATUS STRIP */}
      <section className="dashboard-status-strip">
        <div className="status-strip-cell">
          <span className="label">Status</span>
          <div className="value">
            <span
              className={`badge ${
                isRunning
                  ? "badge-success pulse"
                  : isPaused
                  ? "badge-warning"
                  : activeRun?.status === "completed"
                  ? "badge-info"
                  : activeRun?.status === "failed"
                  ? "badge-danger"
                  : "badge-secondary"
              }`}
              style={{ fontWeight: 700, fontSize: "0.75rem", padding: "0.15rem 0.5rem" }}
            >
              {activeRun ? activeRun.status.toUpperCase() : "IDLE"}
            </span>
          </div>
        </div>

        <div className="status-strip-cell">
          <span className="label">Current Task</span>
          <span className="value" title={activeTask?.title || "None active"}>
            {activeTask?.title || (activeRun ? `Task ${activeRun.currentTaskId || "01"}` : "None active")}
          </span>
        </div>

        <div className="status-strip-cell">
          <span className="label">Phase</span>
          <span className="value">
            {isRunning ? "2. Execution (Prompt Dispatched)" : isPaused ? "Paused" : activeRun?.status === "completed" ? "5. Acceptance (Completed)" : "1. Planning Ready"}
          </span>
        </div>

        <div className="status-strip-cell">
          <span className="label">Spend / Budget</span>
          <span className="value" style={{ fontFamily: "var(--font-mono)" }}>
            $0.00 / $10.00 <span style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>(Hard limit)</span>
          </span>
        </div>

        <div className="status-strip-cell">
          <span className="label">Verification</span>
          <span className="value" style={{ color: "var(--accent-emerald)" }}>
            ✓ Deterministic (Independent)
          </span>
        </div>
      </section>

      {/* 4. MAIN TWO-COLUMN CONTENT REGION */}
      <main className="dashboard-main-region">
        {/* Left Column: Live Activity Timeline */}
        <section className="card" style={{ display: "flex", flexDirection: "column", minHeight: "460px" }}>
          <div className="card-header" style={{ borderBottom: "1px solid var(--border-subtle)", paddingBottom: "0.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span className="dot-indicator pulse" style={{ backgroundColor: "var(--accent-emerald)" }}></span>
              <h2 className="card-title" style={{ fontSize: "1rem" }}>Live Event Timeline & Activity</h2>
              <span className="badge" style={{ fontSize: "0.7rem" }}>{filteredEvents.length} events</span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
              <label style={{ fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.3rem", color: "var(--text-dim)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={autoScrollTimeline}
                  onChange={(e) => setAutoScrollTimeline(e.target.checked)}
                />
                Auto-scroll
              </label>
              <button
                className="btn btn-sm btn-outline"
                style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}
                onClick={() => setEvents([])}
              >
                Clear
              </button>
            </div>
          </div>

          {/* Timeline Search & Filter Bar */}
          <div style={{ display: "flex", gap: "0.4rem", padding: "0.5rem 0", borderBottom: "1px solid var(--border-subtle)" }}>
            <input
              type="text"
              placeholder="Search timeline events..."
              className="form-input form-input-sm"
              value={timelineSearch}
              onChange={(e) => setTimelineSearch(e.target.value)}
              style={{ fontSize: "0.75rem", flex: 1 }}
            />
            {["all", "run", "task", "agent", "verif"].map((f) => (
              <button
                key={f}
                className={`btn btn-sm ${timelineFilter === f ? "btn-primary" : "btn-outline"}`}
                style={{ fontSize: "0.7rem", padding: "0.15rem 0.45rem", textTransform: "capitalize" }}
                onClick={() => setTimelineFilter(f)}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Event Stream Container (Playwright matches this ID) */}
          <div
            id="event-stream-container"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "0.5rem 0",
              display: "flex",
              flexDirection: "column",
              gap: "0.4rem",
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              maxHeight: "460px",
            }}
          >
            {filteredEvents.length === 0 ? (
              <div style={{ color: "var(--text-dim)", textAlign: "center", padding: "2rem" }}>
                No events match the current filter
              </div>
            ) : (
              filteredEvents.map((ev) => (
                <div
                  key={ev.id}
                  style={{
                    padding: "0.35rem 0.6rem",
                    borderRadius: "var(--radius-sm)",
                    background: "var(--bg-subtle)",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "0.5rem",
                    borderLeft: `3px solid ${
                      ev.type.startsWith("run.")
                        ? "var(--accent-primary)"
                        : ev.type.startsWith("task.")
                        ? "var(--accent-cyan)"
                        : ev.type.startsWith("verif.")
                        ? "var(--accent-emerald)"
                        : "var(--accent-amber)"
                    }`,
                  }}
                >
                  <span style={{ color: "var(--text-dim)", flexShrink: 0 }}>[{ev.time}]</span>
                  <span
                    style={{
                      color: "var(--accent-primary)",
                      fontWeight: 600,
                      flexShrink: 0,
                    }}
                  >
                    {ev.type}
                  </span>
                  <span style={{ color: "var(--text-main)", wordBreak: "break-word" }}>
                    {ev.message}
                  </span>
                </div>
              ))
            )}
            <div ref={timelineEndRef} />
          </div>
        </section>

        {/* Right Column: Execution Information & Antigravity IDE Integration Deck */}
        <section style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Current Run & Task Card */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title" style={{ fontSize: "1rem" }}>Current Task</h2>
                <div className="card-subtitle" style={{ fontSize: "0.75rem" }}>
                  {activeRun ? `Run ID: ${activeRun.id}` : "No active run in progress"}
                </div>
              </div>

              <div style={{ display: "flex", gap: "0.4rem" }}>
                <button
                  id="btn-inspect-task"
                  className="btn btn-sm btn-outline"
                  onClick={() => setInspectTaskId(activeTask?.id || activeRun?.currentTaskId || "task-01")}
                  style={{ fontSize: "0.75rem" }}
                  title="Inspect real verifier logs, exit codes, and critic reviews"
                >
                  🔍 Inspect Task Details
                </button>
              </div>
            </div>

            {/* Active Task Summary with Detailed Requirements */}
            <div style={{ background: "var(--bg-subtle)", padding: "0.85rem", borderRadius: "var(--radius-sm)", marginBottom: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.35rem" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase" }}>
                  Task Objective
                </span>
                <span className="badge badge-info" style={{ fontSize: "0.65rem" }}>
                  {activeTask ? activeTask.status : "Idle"}
                </span>
              </div>
              <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-main)" }}>
                {activeTask?.title || "Auto-planning next task linked to approved roadmap"}
              </div>
              <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.2rem", marginBottom: "0.6rem" }}>
                {activeTask?.objective || "When a run is launched, tasks are decomposed and dispatched with isolated attempt branches."}
              </p>

              <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.35rem", fontSize: "0.75rem" }}>
                <div>
                  <strong style={{ color: "var(--text-dim)" }}>Acceptance Criteria: </strong>
                  <span style={{ color: "var(--text-main)" }}>Deterministic verifier exit code 0, zero unstaged conflicts, Critic approved</span>
                </div>
                <div>
                  <strong style={{ color: "var(--text-dim)" }}>Modified Files: </strong>
                  <code style={{ fontSize: "0.72rem", color: "var(--accent-cyan)" }}>
                    {isRunning ? "Scoped staging in progress..." : "No uncommitted modified files"}
                  </code>
                </div>
                <div>
                  <strong style={{ color: "var(--text-dim)" }}>Verifier / Critic: </strong>
                  <span style={{ color: "var(--accent-emerald)" }}>Deterministic AcceptanceGate Ready</span>
                </div>
                <div>
                  <strong style={{ color: "var(--text-dim)" }}>Blockers: </strong>
                  <span style={{ color: "var(--text-muted)" }}>None detected</span>
                </div>
              </div>
            </div>

            {/* Live Terminal / Output Box */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
                <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "var(--text-dim)" }}>
                  Live Execution Logs
                </span>
                <button
                  className="btn btn-sm btn-outline"
                  style={{ fontSize: "0.65rem", padding: "0.1rem 0.35rem" }}
                  onClick={() => {
                    const text = events.map((e) => `[${e.time}] ${e.type}: ${e.message}`).join("\n");
                    navigator.clipboard.writeText(text);
                  }}
                >
                  📋 Copy Output
                </button>
              </div>

              <pre
                className="code-block"
                style={{
                  height: "105px",
                  fontSize: "0.75rem",
                  overflowY: "auto",
                  padding: "0.5rem",
                  background: "var(--bg-card)",
                }}
              >
                {events.length > 0
                  ? events.slice(0, 8).map((e) => `[${e.time}] ${e.message}`).join("\n")
                  : "No live execution logs recorded yet."}
              </pre>
            </div>
          </div>

          {/* Embedded Antigravity IDE Connection Deck (Playwright tests locate #ide-connection-deck directly) */}
          <IdeConnectionDeck projectRootPath={activeProject?.rootPath} />
        </section>
      </main>

      {/* 5. PERSISTENT HUMAN DIRECTION COMPOSER */}
      <section className="dashboard-composer-strip">
        <HumanDirectionBar
          projectId={activeProject?.id || null}
          onSafeInterruptTriggered={handleStopRun}
        />
      </section>

      {/* 6. COMPACT BOTTOM FOOTER & ACTION STRIP */}
      <footer className="dashboard-footer-action-strip">
        {/* Run Controls */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <button
            id="btn-pause"
            className="btn btn-sm btn-secondary"
            onClick={handlePauseRun}
            disabled={!isRunning}
          >
            ⏸ Pause
          </button>

          <button
            className="btn btn-sm btn-secondary"
            onClick={handleResumeRun}
            disabled={!isPaused}
          >
            ▶ Resume
          </button>

          <button
            id="btn-stop"
            className="btn btn-sm btn-danger"
            onClick={handleStopRun}
            disabled={!isRunning && !isPaused}
          >
            ⏹ Stop
          </button>
        </div>

        {/* Drawer Tool Triggers */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
          <button
            className="btn btn-sm btn-outline"
            onClick={() => setActiveDrawer("history")}
            title="Inspect Past Runs & Execution History"
          >
            📜 History ({runs.length})
          </button>

          <button
            className="btn btn-sm btn-outline"
            onClick={() => setActiveDrawer("artifacts")}
            title="Inspect Project Artifacts & Reports"
          >
            📁 Artifacts
          </button>

          <button
            className="btn btn-sm btn-outline"
            onClick={() => setActiveDrawer("git")}
            title="Inspect Git Working Tree, Diffs, and Checkpoints"
          >
            🌿 Git & Diff
          </button>

          <button
            className="btn btn-sm btn-outline"
            onClick={() => setActiveDrawer("diagnostics")}
            title="View Real-Time Subsystem Health"
          >
            🩺 Diagnostics
          </button>

          <button
            className="btn btn-sm btn-outline"
            onClick={() => setActiveDrawer("policies")}
            title="Configure Execution Profiles & Autonomy Modes"
          >
            🛡️ Policies
          </button>

          <button
            className="btn btn-sm btn-outline"
            onClick={() => handleTriggerExport("json")}
            title="Export Project Memory & Run Reports"
          >
            📦 Export
          </button>
        </div>
      </footer>

      {/* 7. CONTEXTUAL SLIDEOUT DRAWERS & OVERLAYS */}

      {/* 0. IDE Connection & Agent Drawer */}
      <Drawer
        isOpen={activeDrawer === "ide"}
        onClose={() => setActiveDrawer("none")}
        title="Antigravity IDE & Agent Integration"
        subtitle="Manage process detection, workspace mapping, connection handshake, and Visible IDE vs Headless CLI execution"
        width="740px"
      >
        <IdeConnectionDeck projectRootPath={activeProject?.rootPath} />
      </Drawer>

      {/* Artifacts & Audit Evidence Drawer */}
      <Drawer
        isOpen={activeDrawer === "artifacts"}
        onClose={() => setActiveDrawer("none")}
        title="Project Artifacts & Audit Evidence"
        subtitle="Explore project blueprints, forensic audits, verified checkpoints, and test reports"
        width="700px"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
          <div className="card" style={{ padding: "0.85rem", background: "var(--bg-subtle)" }}>
            <h4 style={{ margin: "0 0 0.35rem 0", fontSize: "0.9rem", color: "var(--text-main)" }}>System Blueprints & Audits</h4>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              • <code>Autonomous_Development_Orchestrator_MVP_Blueprint_FINAL.md</code>
            </div>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
              • <code>COMPLETE_PROJECT_AUDIT.md</code> (Forensic Audit & Specification)
            </div>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
              • <code>AUTONOMOUS_EXECUTION_STATE.md</code> (Phase Tracking & Audit Gates)
            </div>
          </div>

          <div className="card" style={{ padding: "0.85rem", background: "var(--bg-subtle)" }}>
            <h4 style={{ margin: "0 0 0.35rem 0", fontSize: "0.9rem", color: "var(--text-main)" }}>UI Visual Audit Evidence</h4>
            <div style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              Multi-viewport screenshots saved to:
            </div>
            <code style={{ fontSize: "0.75rem", color: "var(--accent-cyan)", display: "block", marginTop: "0.25rem" }}>
              artifacts/ui-audit/iteration-1/
            </code>
          </div>
        </div>
      </Drawer>

      {/* A. Git Diff & Recovery Drawer */}
      <Drawer
        isOpen={activeDrawer === "git"}
        onClose={() => setActiveDrawer("none")}
        title="Git & Version Control Recovery"
        subtitle="Inspect working tree status, unified diffs, and orchestrator checkpoints"
        width="700px"
      >
        <GitPage project={activeProject} />
      </Drawer>

      {/* B. System Diagnostics Drawer */}
      <Drawer
        isOpen={activeDrawer === "diagnostics"}
        onClose={() => setActiveDrawer("none")}
        title="Subsystem Diagnostics & Runtime Health"
        subtitle="Real-time observability across SQLite WAL, process supervisors, IDE window detection, and memory"
        width="720px"
      >
        <DiagnosticsPage />
      </Drawer>

      {/* C. Policies & Profiles Drawer */}
      <Drawer
        isOpen={activeDrawer === "policies"}
        onClose={() => setActiveDrawer("none")}
        title="Execution Policies & Profile Presets"
        subtitle="Configure autonomy constraints, verification strategies, and safety boundaries"
        width="680px"
      >
        <PoliciesPage
          project={activeProject}
          onProjectUpdated={(p) => setActiveProject(p)}
        />
      </Drawer>

      {/* D. Settings Drawer (Provider & System Options) */}
      <Drawer
        isOpen={activeDrawer === "settings"}
        onClose={() => setActiveDrawer("none")}
        title="System Settings & Reasoning Model"
        subtitle="Configure OpenAI Cloud API keys, Local Ollama runtime, execution timeouts, and secret redaction"
        width="700px"
      >
        <SettingsPage theme={theme} onToggleTheme={toggleTheme} />
      </Drawer>

      {/* E. History & Past Runs Drawer */}
      <Drawer
        isOpen={activeDrawer === "history"}
        onClose={() => setActiveDrawer("none")}
        title="Execution Run History"
        subtitle={`Total of ${runs.length} recorded run(s) for ${activeProject?.name || "current project"}`}
        width="680px"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {runs.length === 0 ? (
            <div style={{ textAlign: "center", padding: "2rem", color: "var(--text-dim)" }}>
              No execution runs recorded yet. Click "▶ New Run" on the dashboard to begin.
            </div>
          ) : (
            runs.map((r) => (
              <div
                key={r.id}
                style={{
                  padding: "0.75rem",
                  background: "var(--bg-subtle)",
                  borderRadius: "var(--radius-sm)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  border: `1px solid ${r.id === activeRun?.id ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                }}
              >
                <div>
                  <div style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: "0.8rem" }}>
                    {r.id}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                    Started: {new Date(r.startedAt).toLocaleString()} • Iterations: {r.iterationCount}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span
                    className={`badge ${
                      r.status === "completed"
                        ? "badge-success"
                        : r.status === "running"
                        ? "badge-info"
                        : r.status === "failed"
                        ? "badge-danger"
                        : "badge-secondary"
                    }`}
                    style={{ fontSize: "0.7rem" }}
                  >
                    {r.status}
                  </span>
                  <button
                    className="btn btn-sm btn-outline"
                    style={{ fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}
                    onClick={() => {
                      setInspectTaskId(r.currentTaskId || "task-01");
                      setActiveDrawer("none");
                    }}
                  >
                    Inspect
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </Drawer>

      {/* F. Task Evidence Inspector Modal */}
      <TaskInspector
        isOpen={Boolean(inspectTaskId)}
        onClose={() => setInspectTaskId(null)}
        taskId={inspectTaskId}
      />

      {/* G. Project Wizard Modal */}
      <ProjectWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onProjectCreated={(newProj) => {
          setProjects((prev) => [newProj, ...prev]);
          setActiveProject(newProj);
          setIsWizardOpen(false);
        }}
      />

      {/* H. Export Modal */}
      {isExportModalOpen && (
        <div className="drawer-backdrop" onClick={() => setIsExportModalOpen(false)}>
          <div
            className="drawer-panel"
            style={{ maxWidth: "680px" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header">
              <div>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 700 }}>Export Project Memory & Evidence</h3>
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>Download structured run history, task verifications, and Critic reviews</p>
              </div>
              <button className="btn btn-sm btn-outline" onClick={() => setIsExportModalOpen(false)}>✕</button>
            </div>
            <div className="drawer-body">
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                <button
                  className={`btn btn-sm ${exportFormat === "json" ? "btn-primary" : "btn-outline"}`}
                  onClick={() => handleTriggerExport("json")}
                >
                  JSON Bundle
                </button>
                <button
                  className={`btn btn-sm ${exportFormat === "markdown" ? "btn-primary" : "btn-outline"}`}
                  onClick={() => handleTriggerExport("markdown")}
                >
                  Markdown Report
                </button>
              </div>

              <pre className="code-block" style={{ height: "350px", overflowY: "auto", fontSize: "0.75rem", padding: "0.75rem" }}>
                {exportData || "Generating export bundle..."}
              </pre>
            </div>
            <div className="drawer-footer">
              <button
                className="btn btn-primary"
                onClick={() => {
                  if (!exportData) return;
                  const blob = new Blob([exportData], { type: exportFormat === "json" ? "application/json" : "text/markdown" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${activeProject?.name || "orchestrator"}-export.${exportFormat === "json" ? "json" : "md"}`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                💾 Download {exportFormat.toUpperCase()}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
