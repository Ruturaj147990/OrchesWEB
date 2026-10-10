import React, { useState, useEffect, useRef } from "react";
import { Sidebar, NavPage } from "./components/layout/Sidebar";
import { TopBar } from "./components/layout/TopBar";
import { OverviewPage, ProjectData, RunData, IdeConnectionState } from "./pages/OverviewPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { RunsPage } from "./pages/RunsPage";
import { IdePage } from "./pages/IdePage";
import { ProvidersPage } from "./pages/ProvidersPage";
import { PoliciesPage } from "./pages/PoliciesPage";
import { GitPage } from "./pages/GitPage";
import { TimelinePage } from "./pages/TimelinePage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ProjectWizard } from "./features/wizard/ProjectWizard";

export function App() {
  const [currentPage, setCurrentPage] = useState<NavPage>("overview");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [backendHealthy, setBackendHealthy] = useState(false);

  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectData | null>(null);

  const [runs, setRuns] = useState<RunData[]>([]);
  const [activeRun, setActiveRun] = useState<RunData | null>(null);

  const [ideState, setIdeState] = useState<IdeConnectionState | null>(null);
  const [activeProvider, setActiveProvider] = useState<{
    id: string;
    displayName: string;
    privacyClass: string;
  }>({
    id: "openai-compatible-local",
    displayName: "OpenAI-Compatible Local (Ollama)",
    privacyClass: "local",
  });

  const [events, setEvents] = useState<Array<{ id: string; time: string; type: string; message: string }>>([
    {
      id: "ev-0",
      time: new Date().toLocaleTimeString(),
      type: "system.init",
      message: "Autonomous Development Orchestrator running on 127.0.0.1:4317",
    },
  ]);

  const [isWizardOpen, setIsWizardOpen] = useState(false);
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
      if (res.ok) {
        setBackendHealthy(true);
      } else {
        setBackendHealthy(false);
      }
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
        const list: ProjectData[] = await res.json();
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

  // 6. Connect to SSE Stream for active project
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
            },
            ...prev,
          ]);

          // Refresh runs on run lifecycle events
          if (parsed.type?.startsWith("run.") || parsed.type?.startsWith("task.")) {
            fetchRuns(activeProject.id);
          }
        } catch (err) {
          console.error("SSE parse error:", err);
        }
      };

      sse.onerror = () => {
        // Handle reconnection automatically
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

  // Run lifecycle actions
  const handleStartRun = async () => {
    let proj = activeProject;
    if (!proj && projects.length > 0) {
      proj = projects[0];
    }
    if (!proj) {
      try {
        const pRes = await fetch("/api/v1/projects");
        const list = await pRes.json();
        if (list.length > 0) {
          proj = list[0];
          setActiveProject(list[0]);
        }
      } catch {}
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

  const workspaceMatch = Boolean(ideState?.selectedWorkspace?.isMatchingProject);
  const isRunActive = activeRun?.status === "running";

  return (
    <div className="app-layout">
      {/* 1. Sidebar Navigation */}
      <Sidebar
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        projectName={activeProject?.name}
        projectPath={activeProject?.rootPath}
        activeRunCount={isRunActive ? 1 : 0}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />

      {/* 2. Main Content Area */}
      <div className="app-main">
        {/* Top Bar */}
        <TopBar
          currentPage={currentPage}
          projectName={activeProject?.name}
          backendHealthy={backendHealthy}
          ideStatus={ideState?.status || "disconnected"}
          workspaceMatch={workspaceMatch}
          isRunActive={isRunActive}
          activeProviderName={activeProvider.displayName}
          theme={theme}
          onToggleTheme={toggleTheme}
          onNavigate={setCurrentPage}
        />

        {/* Dynamic Page Router */}
        {currentPage === "overview" && (
          <OverviewPage
            project={activeProject}
            activeRun={activeRun}
            recentRuns={runs}
            ideState={ideState}
            backendHealthy={backendHealthy}
            activeProvider={activeProvider}
            events={events}
            onStartRun={handleStartRun}
            onPauseRun={handlePauseRun}
            onResumeRun={handleResumeRun}
            onStopRun={handleStopRun}
            onNavigate={setCurrentPage}
            onOpenWizard={() => setIsWizardOpen(true)}
          />
        )}

        {currentPage === "projects" && (
          <ProjectsPage
            projects={projects}
            activeProject={activeProject}
            onSelectProject={(p) => setActiveProject(p)}
            onProjectCreated={(p) => {
              setProjects((prev) => [p, ...prev]);
              setActiveProject(p);
            }}
            onNavigate={setCurrentPage}
          />
        )}

        {currentPage === "runs" && (
          <RunsPage
            project={activeProject}
            activeRun={activeRun}
            runs={runs}
            onStartRun={handleStartRun}
            onPauseRun={handlePauseRun}
            onResumeRun={handleResumeRun}
            onStopRun={handleStopRun}
          />
        )}

        {currentPage === "ide" && (
          <IdePage
            project={activeProject}
            onProjectUpdated={(p) => setActiveProject(p)}
          />
        )}

        {currentPage === "providers" && (
          <ProvidersPage
            onProviderChanged={(p) => setActiveProvider(p)}
          />
        )}

        {currentPage === "policies" && (
          <PoliciesPage
            project={activeProject}
            onProjectUpdated={(p) => setActiveProject(p)}
          />
        )}

        {currentPage === "git" && (
          <GitPage
            project={activeProject}
          />
        )}

        {currentPage === "timeline" && (
          <TimelinePage
            project={activeProject}
            events={events}
          />
        )}

        {currentPage === "diagnostics" && (
          <DiagnosticsPage />
        )}

        {currentPage === "settings" && (
          <SettingsPage
            theme={theme}
            onToggleTheme={toggleTheme}
          />
        )}
      </div>

      {/* Global Project Creation Wizard Modal */}
      <ProjectWizard
        isOpen={isWizardOpen}
        onClose={() => setIsWizardOpen(false)}
        onProjectCreated={(newProj) => {
          setProjects((prev) => [newProj, ...prev]);
          setActiveProject(newProj);
          setActiveRun(null);
        }}
      />
    </div>
  );
}
