import React, { useState, useEffect } from "react";

export interface IdeStageInfo {
  status: "pending" | "in_progress" | "passed" | "failed";
  message?: string;
  updatedAt?: string;
}

export interface IdeWorkspaceInfo {
  id: string;
  folderUri: string;
  canonicalPath: string;
  name: string;
  isMatchingProject: boolean;
  isActiveWindow: boolean;
  processId?: number | null;
  lastHeartbeat?: string | null;
}

export interface IdeConnectionState {
  status: "disconnected" | "detecting" | "connected" | "ready" | "error";
  stages: {
    ide_detected: IdeStageInfo;
    workspace_identified: IdeStageInfo;
    connection_established: IdeStageInfo;
    workspace_confirmed: IdeStageInfo;
    agent_tested: IdeStageInfo;
    ready: IdeStageInfo;
  };
  detectedWorkspaces: IdeWorkspaceInfo[];
  selectedWorkspace: IdeWorkspaceInfo | null;
  activeMode: "visible_ide" | "headless_cli";
  agentBridgeType: "agentapi_native" | "ide_workspace_bridge" | "headless_cli";
  lastHeartbeat: string | null;
  errorMessage: string | null;
}

interface IdeConnectionDeckProps {
  projectRootPath?: string;
  runState?: "ready" | "running" | "paused" | "stopped";
  onPauseResume?: () => void;
}

const STAGES_CONFIG = [
  { key: "ide_detected", label: "IDE Detected", number: "1" },
  { key: "workspace_identified", label: "Workspace Identified", number: "2" },
  { key: "connection_established", label: "Connection Established", number: "3" },
  { key: "workspace_confirmed", label: "Workspace Confirmed", number: "4" },
  { key: "agent_tested", label: "Agent Tested", number: "5" },
  { key: "ready", label: "Ready", number: "6" },
] as const;

export function IdeConnectionDeck({ projectRootPath, runState, onPauseResume }: IdeConnectionDeckProps) {
  const [ideState, setIdeState] = useState<IdeConnectionState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Poll IDE status every 3.5 seconds
  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/v1/ide/status");
      if (res.ok) {
        const data = await res.json();
        setIdeState(data);
      }
    } catch (err) {
      console.error("Failed to fetch IDE status:", err);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3500);
    return () => clearInterval(interval);
  }, []);

  const handleDetect = async () => {
    setIsLoading(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/v1/ide/detect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRootPath }),
      });
      if (res.ok) {
        const data = await res.json();
        setIdeState(data);
        setActionMessage("Detection completed: scan finished.");
      }
    } catch (err) {
      setActionMessage("Detection failed. See console.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async () => {
    setIsLoading(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/v1/ide/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRootPath }),
      });
      const data = await res.json();
      setIdeState(data);
      if (data.status === "ready") {
        setActionMessage("Connected & verified! Ready for autonomous execution.");
      } else if (data.errorMessage) {
        setActionMessage(`Connection halted: ${data.errorMessage}`);
      }
    } catch (err) {
      setActionMessage("Connection request failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestAgent = async () => {
    setIsLoading(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/v1/ide/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRootPath }),
      });
      const data = await res.json();
      if (data.state) setIdeState(data.state);
      setActionMessage(data.details || (data.success ? "Agent test passed!" : "Agent test failed."));
    } catch (err) {
      setActionMessage("Agent test request failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setIsLoading(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/v1/ide/disconnect", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        setIdeState(data);
        setActionMessage("Disconnected from IDE.");
      }
    } catch (err) {
      setActionMessage("Disconnect request failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectWorkspace = async (workspaceId: string) => {
    setIsLoading(true);
    setActionMessage(null);
    try {
      const res = await fetch("/api/v1/ide/select-workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, projectRootPath }),
      });
      if (res.ok) {
        const data = await res.json();
        setIdeState(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleMode = async (mode: "visible_ide" | "headless_cli") => {
    try {
      const res = await fetch("/api/v1/ide/mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      if (res.ok) {
        const data = await res.json();
        setIdeState(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const activeMode = ideState?.activeMode || "visible_ide";
  const status = ideState?.status || "disconnected";
  const selectedWs = ideState?.selectedWorkspace;

  return (
    <div
      id="ide-connection-deck"
      style={{
        backgroundColor: "var(--bg-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        padding: "1.25rem",
        marginBottom: "1.5rem",
        boxShadow: "var(--shadow-md)",
        backdropFilter: "var(--glass-blur)",
      }}
    >
      {/* Header & Mode Switcher */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div
            style={{
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              backgroundColor:
                status === "ready"
                  ? "var(--accent-emerald)"
                  : status === "connected"
                  ? "var(--accent-cyan)"
                  : status === "error"
                  ? "var(--accent-rose)"
                  : "var(--text-dim)",
              boxShadow:
                status === "ready"
                  ? "0 0 10px rgba(16, 185, 129, 0.6)"
                  : status === "error"
                  ? "0 0 10px rgba(244, 63, 94, 0.6)"
                  : "none",
            }}
          />
          <h2 style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--text-main)", margin: 0 }}>
            Antigravity IDE Integration
          </h2>
          <span
            style={{
              fontSize: "0.75rem",
              padding: "0.2rem 0.5rem",
              borderRadius: "4px",
              fontWeight: 500,
              backgroundColor:
                status === "ready"
                  ? "rgba(16, 185, 129, 0.15)"
                  : status === "connected"
                  ? "rgba(6, 182, 212, 0.15)"
                  : status === "error"
                  ? "rgba(244, 63, 94, 0.15)"
                  : "rgba(255, 255, 255, 0.05)",
              color:
                status === "ready"
                  ? "var(--accent-emerald)"
                  : status === "connected"
                  ? "var(--accent-cyan)"
                  : status === "error"
                  ? "var(--accent-rose)"
                  : "var(--text-muted)",
              border: `1px solid ${
                status === "ready"
                  ? "rgba(16, 185, 129, 0.3)"
                  : status === "error"
                  ? "rgba(244, 63, 94, 0.3)"
                  : "var(--border-subtle)"
              }`,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
            }}
          >
            {status}
          </span>
        </div>

        {/* Explicit Mode Selector */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            backgroundColor: "rgba(0, 0, 0, 0.3)",
            padding: "0.25rem",
            borderRadius: "var(--radius-md)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <button
            type="button"
            onClick={() => handleToggleMode("visible_ide")}
            style={{
              padding: "0.35rem 0.75rem",
              fontSize: "0.8rem",
              fontWeight: 600,
              borderRadius: "var(--radius-sm)",
              border: "none",
              cursor: "pointer",
              transition: "all 0.2s ease",
              backgroundColor: activeMode === "visible_ide" ? "var(--accent-primary)" : "transparent",
              color: activeMode === "visible_ide" ? "#ffffff" : "var(--text-muted)",
              boxShadow: activeMode === "visible_ide" ? "0 2px 8px rgba(99, 102, 241, 0.4)" : "none",
            }}
          >
            Visible Antigravity IDE (Native Editor)
          </button>
          <button
            type="button"
            onClick={() => handleToggleMode("headless_cli")}
            style={{
              padding: "0.35rem 0.75rem",
              fontSize: "0.8rem",
              fontWeight: 600,
              borderRadius: "var(--radius-sm)",
              border: "none",
              cursor: "pointer",
              transition: "all 0.2s ease",
              backgroundColor: activeMode === "headless_cli" ? "rgba(255, 255, 255, 0.15)" : "transparent",
              color: activeMode === "headless_cli" ? "#ffffff" : "var(--text-muted)",
            }}
          >
            Headless CLI (agy)
          </button>
        </div>
      </div>

      {/* 6-Stage Stepper Tracker */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "0.5rem",
          marginBottom: "1.25rem",
          padding: "0.75rem",
          backgroundColor: "rgba(0, 0, 0, 0.25)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        {STAGES_CONFIG.map(({ key, label, number }) => {
          const stage: IdeStageInfo = ideState?.stages ? ideState.stages[key] : { status: "pending" };
          const stageStatus = stage?.status || "pending";
          const isPassed = stageStatus === "passed";
          const isFailed = stageStatus === "failed";
          const isInProgress = stageStatus === "in_progress";

          return (
            <div
              key={key}
              title={stage.message || label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                textAlign: "center",
                padding: "0.5rem 0.25rem",
                borderRadius: "var(--radius-sm)",
                backgroundColor: isPassed
                  ? "rgba(16, 185, 129, 0.08)"
                  : isFailed
                  ? "rgba(244, 63, 94, 0.1)"
                  : "transparent",
                border: isPassed
                  ? "1px solid rgba(16, 185, 129, 0.25)"
                  : isFailed
                  ? "1px solid rgba(244, 63, 94, 0.3)"
                  : "1px solid transparent",
                transition: "all 0.2s ease",
              }}
            >
              <div
                style={{
                  width: "24px",
                  height: "24px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  marginBottom: "0.35rem",
                  backgroundColor: isPassed
                    ? "var(--accent-emerald)"
                    : isFailed
                    ? "var(--accent-rose)"
                    : isInProgress
                    ? "var(--accent-amber)"
                    : "rgba(255, 255, 255, 0.1)",
                  color: isPassed || isFailed ? "#ffffff" : "var(--text-muted)",
                }}
              >
                {isPassed ? "✓" : isFailed ? "✕" : number}
              </div>
              <span
                style={{
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  color: isPassed
                    ? "var(--accent-emerald)"
                    : isFailed
                    ? "var(--accent-rose)"
                    : "var(--text-muted)",
                }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Workspace Selector & Metadata Banner */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          padding: "0.75rem 1rem",
          backgroundColor: "rgba(14, 19, 31, 0.6)",
          borderRadius: "var(--radius-md)",
          border: "1px solid var(--border-subtle)",
          marginBottom: "1rem",
        }}
      >
        <div style={{ flex: "1 1 300px" }}>
          <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginBottom: "0.25rem" }}>
            Active Visible Workspace
          </div>
          {ideState && ideState.detectedWorkspaces.length > 1 ? (
            <select
              value={selectedWs?.id || ""}
              onChange={(e) => handleSelectWorkspace(e.target.value)}
              style={{
                width: "100%",
                maxWidth: "400px",
                padding: "0.4rem 0.6rem",
                borderRadius: "var(--radius-sm)",
                backgroundColor: "var(--bg-base)",
                color: "var(--text-main)",
                border: "1px solid var(--border-subtle)",
                fontSize: "0.85rem",
                fontFamily: "var(--font-mono)",
              }}
            >
              {ideState.detectedWorkspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name} {ws.isMatchingProject ? "★ (Matches Project)" : ""} — {ws.canonicalPath}
                </option>
              ))}
            </select>
          ) : (
            <div
              style={{
                fontSize: "0.85rem",
                fontFamily: "var(--font-mono)",
                color: "var(--text-main)",
                wordBreak: "break-all",
              }}
            >
              {selectedWs ? selectedWs.canonicalPath : "No workspace selected"}
              {selectedWs?.isMatchingProject && (
                <span
                  style={{
                    marginLeft: "0.5rem",
                    fontSize: "0.7rem",
                    padding: "0.1rem 0.4rem",
                    borderRadius: "4px",
                    backgroundColor: "rgba(16, 185, 129, 0.15)",
                    color: "var(--accent-emerald)",
                    fontWeight: 600,
                  }}
                >
                  Matches Project Root
                </span>
              )}
            </div>
          )}
        </div>

        {/* Live Process & Heartbeat info */}
        <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", fontSize: "0.8rem" }}>
          <div>
            <span style={{ color: "var(--text-dim)", display: "block" }}>Window Process</span>
            <span style={{ color: "var(--text-main)", fontWeight: 500, fontFamily: "var(--font-mono)" }}>
              {selectedWs?.processId ? `PID ${selectedWs.processId}` : "Running"}
            </span>
          </div>
          <div>
            <span style={{ color: "var(--text-dim)", display: "block" }}>Agent Bridge</span>
            <span style={{ color: "var(--accent-cyan)", fontWeight: 500 }}>
              {ideState?.agentBridgeType === "agentapi_native"
                ? "agentapi native"
                : ideState?.agentBridgeType === "ide_workspace_bridge"
                ? "Live Editor Sync"
                : "CLI Headless"}
            </span>
          </div>
          <div>
            <span style={{ color: "var(--text-dim)", display: "block" }}>Last Heartbeat</span>
            <span style={{ color: "var(--text-main)", fontFamily: "var(--font-mono)" }}>
              {ideState?.lastHeartbeat ? new Date(ideState.lastHeartbeat).toLocaleTimeString() : "Never"}
            </span>
          </div>
        </div>
      </div>

      {/* Error or Warning Alert */}
      {(ideState?.errorMessage || actionMessage) && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "var(--radius-md)",
            fontSize: "0.85rem",
            marginBottom: "1rem",
            backgroundColor: ideState?.errorMessage
              ? "rgba(244, 63, 94, 0.12)"
              : "rgba(99, 102, 241, 0.12)",
            border: `1px solid ${
              ideState?.errorMessage ? "rgba(244, 63, 94, 0.3)" : "rgba(99, 102, 241, 0.3)"
            }`,
            color: ideState?.errorMessage ? "var(--accent-rose)" : "var(--text-main)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div>
            <strong>{ideState?.errorMessage ? "Connection Alert: " : "Notice: "}</strong>
            {ideState?.errorMessage || actionMessage}
          </div>
        </div>
      )}

      {/* Control Buttons Deck */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={handleDetect}
            disabled={isLoading}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.85rem",
              fontWeight: 600,
              borderRadius: "var(--radius-sm)",
              backgroundColor: "rgba(255, 255, 255, 0.08)",
              color: "var(--text-main)",
              border: "1px solid var(--border-subtle)",
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            Detect IDE
          </button>
          <button
            type="button"
            onClick={handleConnect}
            disabled={isLoading}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.85rem",
              fontWeight: 600,
              borderRadius: "var(--radius-sm)",
              backgroundColor: "var(--accent-primary)",
              color: "#ffffff",
              border: "none",
              cursor: isLoading ? "not-allowed" : "pointer",
              boxShadow: "0 2px 8px rgba(99, 102, 241, 0.35)",
            }}
          >
            Connect & Verify
          </button>
          <button
            type="button"
            onClick={handleTestAgent}
            disabled={isLoading}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.85rem",
              fontWeight: 600,
              borderRadius: "var(--radius-sm)",
              backgroundColor: "rgba(6, 182, 212, 0.15)",
              color: "var(--accent-cyan)",
              border: "1px solid rgba(6, 182, 212, 0.3)",
              cursor: isLoading ? "not-allowed" : "pointer",
            }}
          >
            Test Connection
          </button>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={isLoading || status === "disconnected"}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.85rem",
              fontWeight: 600,
              borderRadius: "var(--radius-sm)",
              backgroundColor: "rgba(244, 63, 94, 0.1)",
              color: "var(--accent-rose)",
              border: "1px solid rgba(244, 63, 94, 0.2)",
              cursor: isLoading || status === "disconnected" ? "not-allowed" : "pointer",
            }}
          >
            Disconnect
          </button>
        </div>

        {/* Loop Pause / Resume Control */}
        {onPauseResume && (
          <button
            type="button"
            onClick={onPauseResume}
            style={{
              padding: "0.5rem 1.25rem",
              fontSize: "0.85rem",
              fontWeight: 600,
              borderRadius: "var(--radius-sm)",
              backgroundColor:
                runState === "running" ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.15)",
              color: runState === "running" ? "var(--accent-amber)" : "var(--accent-emerald)",
              border: `1px solid ${
                runState === "running" ? "rgba(245, 158, 11, 0.3)" : "rgba(16, 185, 129, 0.3)"
              }`,
              cursor: "pointer",
            }}
          >
            {runState === "running" ? "Pause Autonomous Loop" : "Resume Autonomous Loop"}
          </button>
        )}
      </div>
    </div>
  );
}
