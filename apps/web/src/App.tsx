import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, IdeStatus, Project, Run, RunDetail, RunEvent, Settings, WorkspaceInfo } from "./api";
import { WorkspacePanel } from "./components/WorkspacePanel";
import { TaskComposer } from "./components/TaskComposer";
import { RunResult } from "./components/RunResult";
import { RunHistory } from "./components/RunHistory";
import { ActivityLog } from "./components/ActivityLog";
import { SettingsDialog } from "./components/SettingsDialog";
import { ProjectDialog } from "./components/ProjectDialog";
import { BlueprintDialog } from "./components/BlueprintDialog";
import { ConversationList } from "./components/ConversationList";
import { ConversationModal } from "./components/ConversationModal";
import { ConversationSummary } from "./api";

type Theme = "light" | "dark" | "system";

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

export function App() {
  const [serverUp, setServerUp] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string | null>(readStored("orches.project"));
  const [settings, setSettings] = useState<Settings | null>(null);
  const [providerReady, setProviderReady] = useState<boolean | null>(null);
  const [providerMessage, setProviderMessage] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [ide, setIde] = useState<IdeStatus | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [connection, setConnection] = useState<"connecting" | "live" | "offline">("connecting");
  const [livePhase, setLivePhase] = useState<{ phase: string; attempt: number | null } | null>(null);
  const [dialog, setDialog] = useState<"settings" | "new-project" | "edit-project" | "blueprints" | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [sidebarTab, setSidebarTab] = useState<"runs" | "conversations">("runs");
  const [conversationModalId, setConversationModalId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: "error" | "info" } | null>(null);
  const [stopping, setStopping] = useState(false);
  const [theme, setTheme] = useState<Theme>((readStored("orches.theme") as Theme) || "system");

  const project = projects.find((p) => p.id === projectId) ?? null;
  const activeRun = runs.find((r) => r.status === "running" || r.status === "ready") ?? null;

  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    store("orches.theme", theme);
  }, [theme]);

  const showNotice = useCallback((text: string, tone: "error" | "info" = "info") => {
    setNotice({ text, tone });
  }, []);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), notice.tone === "error" ? 8000 : 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // --- Loading -----------------------------------------------------------------------------
  const loadProjects = useCallback(async () => {
    const list = await api.projects();
    setProjects(list);
    setProjectId((current) => (current && list.some((p) => p.id === current) ? current : list[0]?.id ?? null));
    return list;
  }, []);

  const checkProvider = useCallback(async (s: Settings) => {
    setProviderReady(null);
    try {
      const h = await api.checkProvider(s.activeProviderId);
      setProviderReady(h.ok);
      setProviderMessage(h.ok ? null : h.message ?? "The reasoning model is not ready.");
    } catch (err) {
      setProviderReady(false);
      setProviderMessage(err instanceof ApiError ? err.message : String(err));
    }
  }, []);

  const boot = useCallback(async () => {
    try {
      await api.health();
      setServerUp(true);
      const [s] = await Promise.all([api.settings(), loadProjects()]);
      setSettings(s);
      checkProvider(s);
    } catch {
      setServerUp(false);
    }
  }, [loadProjects, checkProvider]);

  useEffect(() => {
    boot();
  }, [boot]);
  useEffect(() => {
    if (serverUp !== false) return;
    const t = setInterval(boot, 3000);
    return () => clearInterval(t);
  }, [serverUp, boot]);

  useEffect(() => store("orches.project", projectId), [projectId]);

  const workspaceInFlight = useRef<string | null>(null);
  const refreshWorkspace = useCallback(async () => {
    if (!projectId || workspaceInFlight.current === projectId) return;
    workspaceInFlight.current = projectId;
    await Promise.all([
      api.workspace(projectId).then(setWorkspace).catch(() => setWorkspace(null)),
      api.ideStatus(projectId).then(setIde).catch(() => setIde(null)),
    ]);
    workspaceInFlight.current = null;
  }, [projectId]);

  const refreshRuns = useCallback(async () => {
    if (!projectId) return [];
    const { runs } = await api.runs(projectId);
    setRuns(runs);
    return runs;
  }, [projectId]);

  const refreshConversations = useCallback(async () => {
    if (!projectId) return [];
    try {
      const { conversations: list } = await api.conversations(projectId);
      setConversations(list);
      return list;
    } catch {
      return [];
    }
  }, [projectId]);

  const refreshDetail = useCallback(async (runId: string | null) => {
    if (!runId) return setDetail(null);
    try {
      setDetail(await api.runDetail(runId));
    } catch {
      setDetail(null);
    }
  }, []);

  // Project switch: reset run state and load everything for the new project.
  useEffect(() => {
    setWorkspace(null);
    setIde(null);
    setRuns([]);
    setConversations([]);
    setDetail(null);
    setSelectedRunId(null);
    setSelectedConversationId(null);
    setEvents([]);
    setLivePhase(null);
    if (!projectId) return;
    refreshWorkspace();
    refreshRuns().then((list) => setSelectedRunId(list[0]?.id ?? null)).catch(() => {});
    refreshConversations().catch(() => {});
  }, [projectId, refreshWorkspace, refreshRuns, refreshConversations]);

  useEffect(() => {
    refreshDetail(selectedRunId);
  }, [selectedRunId, refreshDetail]);

  // --- Live events -----------------------------------------------------------------------------
  const selectedRef = useRef(selectedRunId);
  selectedRef.current = selectedRunId;
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!projectId || !serverUp) return;
    setConnection("connecting");
    const source = new EventSource(`/api/v1/projects/${projectId}/events?tail=300`);
    source.onopen = () => setConnection("live");
    source.onerror = () => setConnection("offline");
    source.onmessage = (msg) => {
      let ev: RunEvent;
      try {
        ev = JSON.parse(msg.data);
      } catch {
        return;
      }
      setEvents((prev) => (prev.some((p) => p.eventSeq === ev.eventSeq) ? prev : [...prev.slice(-999), ev]));
      if (ev.type === "run.phase") setLivePhase({ phase: ev.payload.phase, attempt: ev.payload.attempt ?? null });
      if (ev.type === "run.finished") {
        setLivePhase(null);
        refreshWorkspace();
        refreshConversations();
      }
      if (ev.runId && /^(run\.|attempt\.|task\.)/.test(ev.type) && ev.type !== "run.log") {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => {
          refreshRuns().catch(() => {});
          if (ev.runId === selectedRef.current) refreshDetail(ev.runId);
        }, 250);
      }
    };
    return () => {
      source.close();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [projectId, serverUp, refreshRuns, refreshDetail, refreshWorkspace]);

  // Safety net if the event stream is interrupted: poll while a run is active.
  useEffect(() => {
    if (!activeRun) return;
    const t = setInterval(() => {
      refreshRuns().catch(() => {});
      if (selectedRef.current) refreshDetail(selectedRef.current);
    }, 4000);
    return () => clearInterval(t);
  }, [activeRun?.id, refreshRuns, refreshDetail]);

  // --- Actions -----------------------------------------------------------------------------
  const startRun = async (task: string): Promise<boolean> => {
    if (!projectId) return false;
    try {
      const run = await api.startRun(projectId, task);
      setLivePhase({ phase: "preparing", attempt: null });
      await refreshRuns();
      setSelectedRunId(run.id);
      return true;
    } catch (err) {
      showNotice(err instanceof ApiError ? err.message : String(err), "error");
      return false;
    }
  };

  const stopRun = async () => {
    if (!detail) return;
    setStopping(true);
    try {
      await api.stopRun(detail.run.id);
      showNotice("Stopping — the current step is being cancelled and its changes rolled back.");
    } catch (err) {
      showNotice(err instanceof ApiError ? err.message : String(err), "error");
    } finally {
      setStopping(false);
    }
  };

  const sendGuidance = async (text: string) => {
    if (!projectId) return;
    try {
      await api.sendGuidance(projectId, text);
      showNotice("Guidance will be included in the next attempt.");
    } catch (err) {
      showNotice(err instanceof ApiError ? err.message : String(err), "error");
    }
  };

  const handleResumeConversation = async (convoId: string, taskText: string): Promise<boolean> => {
    try {
      const res = await api.resumeConversation(convoId, taskText);
      setLivePhase({ phase: "preparing", attempt: null });
      await Promise.all([refreshRuns(), refreshConversations()]);
      setSelectedRunId(res.run.id);
      showNotice(`Resumed conversation "${res.conversation.title}" with new run.`);
      return true;
    } catch (err) {
      showNotice(err instanceof ApiError ? err.message : String(err), "error");
      return false;
    }
  };

  const handleDeleteConversation = async (convoId: string) => {
    try {
      await api.deleteConversation(convoId);
      await refreshConversations();
      if (selectedConversationId === convoId) setSelectedConversationId(null);
      if (conversationModalId === convoId) setConversationModalId(null);
      showNotice("Conversation deleted from server.");
    } catch (err) {
      showNotice(err instanceof ApiError ? err.message : String(err), "error");
    }
  };

  const handleNewConversation = async () => {
    if (!projectId) return;
    try {
      const res = await api.createConversation(projectId);
      await refreshConversations();
      setSelectedConversationId(res.conversation.id);
      setConversationModalId(res.conversation.id);
      showNotice("Created new conversation session.");
    } catch (err) {
      showNotice(err instanceof ApiError ? err.message : String(err), "error");
    }
  };

  const disabledReason = !project
    ? "Add a project first."
    : workspace && !workspace.exists
      ? "The workspace folder is missing."
      : providerReady === false
        ? `Reasoning model not ready: ${providerMessage ?? "check Settings."}`
        : null;

  // --- Render ------------------------------------------------------------------------------
  if (serverUp === false) {
    return (
      <div className="center-screen">
        <div className="card narrow-card">
          <h1>Orches can't reach its server</h1>
          <p className="muted">
            Start it with <code>npm run dev</code> (or <code>npm start</code>) in the orches folder. This page reconnects automatically.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" aria-label="Orches">
          <span className="brand-mark" aria-hidden>◆</span> Orches
        </div>
        <div className="project-picker">
          <label htmlFor="project-select" className="sr-only">
            Project
          </label>
          <select id="project-select" value={projectId ?? ""} onChange={(e) => setProjectId(e.target.value || null)} disabled={projects.length === 0}>
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn btn-secondary btn-sm" onClick={() => setDialog("new-project")}>
            + Add project
          </button>
        </div>
        <span className="spacer" />
        <button className="provider-pill" onClick={() => setDialog("settings")} title={providerMessage ?? "Reasoning model"}>
          <span className={`dot dot-${providerReady === null ? "neutral" : providerReady ? "ok" : "bad"}`} aria-hidden />
          {settings ? "ChatGPT Web · Browser" : "…"}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")}
          aria-label={`Theme: ${theme}`}
          title={`Theme: ${theme}`}
        >
          {theme === "dark" ? "◐ Dark" : theme === "light" ? "◐ Light" : "◐ Auto"}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={() => setDialog("settings")} disabled={!settings}>
          Settings
        </button>
      </header>

      {notice && (
        <div className={`notice notice-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          <span>{notice.text}</span>
          <button className="btn btn-ghost btn-icon" onClick={() => setNotice(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      {serverUp === null ? (
        <div className="center-screen muted">Loading…</div>
      ) : !project ? (
        <div className="center-screen">
          <div className="card narrow-card onboarding">
            <h1>Point Orches at a project folder</h1>
            <p className="muted">
              Pick the folder you want changed. Orches plans the task with your reasoning model, writes the code, runs the project's own checks, has the result reviewed, and keeps the
              change only if it holds up — otherwise every file is restored.
            </p>
            <button className="btn btn-primary" onClick={() => setDialog("new-project")}>
              Add a project
            </button>
          </div>
        </div>
      ) : (
        <main className="layout">
          <div className="col-main">
            <WorkspacePanel
              project={project}
              workspace={workspace}
              ide={ide}
              runActive={Boolean(activeRun)}
              onEdit={() => setDialog("edit-project")}
              onRefresh={refreshWorkspace}
              onOpenBlueprints={() => setDialog("blueprints")}
              onNotice={showNotice}
            />
            <TaskComposer
              project={project}
              settings={settings}
              providerReady={providerReady}
              runActive={Boolean(activeRun)}
              disabledReason={disabledReason}
              onRun={startRun}
              onGuidance={sendGuidance}
              onOpenSettings={() => setDialog("settings")}
            />
            <RunResult detail={detail} livePhase={detail?.run.status === "running" ? livePhase : null} onStop={stopRun} stopping={stopping} />
          </div>
          <aside className="col-side">
            <div style={{ display: "flex", gap: "6px", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "4px" }}>
              <button
                className={`btn btn-sm ${sidebarTab === "runs" ? "btn-secondary" : "btn-ghost"}`}
                style={{ flex: 1 }}
                onClick={() => setSidebarTab("runs")}
              >
                Runs ({runs.length})
              </button>
              <button
                className={`btn btn-sm ${sidebarTab === "conversations" ? "btn-secondary" : "btn-ghost"}`}
                style={{ flex: 1 }}
                onClick={() => setSidebarTab("conversations")}
              >
                Chats ({conversations.length})
              </button>
            </div>
            {sidebarTab === "runs" ? (
              <RunHistory runs={runs} selectedRunId={selectedRunId} onSelect={setSelectedRunId} />
            ) : (
              <ConversationList
                conversations={conversations}
                selectedId={selectedConversationId}
                onSelect={(id) => {
                  setSelectedConversationId(id);
                  setConversationModalId(id);
                }}
                onNew={handleNewConversation}
                onDelete={handleDeleteConversation}
              />
            )}
            <ActivityLog events={events} selectedRunId={selectedRunId} connection={connection} />
          </aside>
        </main>
      )}

      {conversationModalId && (
        <ConversationModal
          conversationId={conversationModalId}
          onClose={() => setConversationModalId(null)}
          onResume={handleResumeConversation}
          onDeleted={async () => {
            await refreshConversations();
            setSelectedConversationId(null);
            showNotice("Conversation deleted from server.");
          }}
        />
      )}

      {dialog === "settings" && settings && (
        <SettingsDialog
          settings={settings}
          ide={ide}
          runActive={Boolean(activeRun)}
          onClose={() => setDialog(null)}
          onSaved={(s) => {
            setDialog(null);
            setSettings(s);
            checkProvider(s);
          }}
        />
      )}
      {(dialog === "new-project" || dialog === "edit-project") && (
        <ProjectDialog
          project={dialog === "edit-project" ? project ?? undefined : undefined}
          onClose={() => setDialog(null)}
          onSaved={async (p) => {
            setDialog(null);
            await loadProjects();
            setProjectId(p.id);
            refreshWorkspace();
            showNotice(dialog === "new-project" ? `Added ${p.name}.` : "Project updated.");
          }}
          onRemoved={async () => {
            setDialog(null);
            setProjectId(null);
            await loadProjects();
          }}
        />
      )}
      {dialog === "blueprints" && project && (
        <BlueprintDialog
          projectId={project.id}
          projectName={project.name}
          onClose={() => setDialog(null)}
          onChanged={() => {
            refreshWorkspace();
          }}
        />
      )}
    </div>
  );
}
