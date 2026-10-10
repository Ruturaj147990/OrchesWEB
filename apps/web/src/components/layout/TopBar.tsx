import React from "react";
import { NavPage } from "./Sidebar";

interface TopBarProps {
  currentPage: NavPage;
  projectName?: string;
  backendHealthy: boolean;
  ideStatus: "disconnected" | "detecting" | "connected" | "ready" | "error";
  workspaceMatch: boolean;
  isRunActive: boolean;
  activeProviderName: string;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onNavigate: (page: NavPage) => void;
}

const PAGE_TITLES: Record<NavPage, { title: string; section: string }> = {
  overview: { title: "Overview", section: "Main" },
  projects: { title: "Projects & Workspaces", section: "Main" },
  runs: { title: "Runs & Tasks", section: "Main" },
  ide: { title: "Antigravity IDE Integration", section: "Connections" },
  providers: { title: "Providers & Models", section: "Connections" },
  policies: { title: "Policies & Profiles", section: "Controls" },
  git: { title: "Git & Recovery", section: "Controls" },
  timeline: { title: "Event Timeline", section: "Observability" },
  diagnostics: { title: "Diagnostics & Logs", section: "Observability" },
  settings: { title: "Application Settings", section: "Configuration" },
};

export function TopBar({
  currentPage,
  projectName,
  backendHealthy,
  ideStatus,
  workspaceMatch,
  isRunActive,
  activeProviderName,
  theme,
  onToggleTheme,
  onNavigate,
}: TopBarProps) {
  const pageInfo = PAGE_TITLES[currentPage] || { title: "Dashboard", section: "Main" };

  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <div>
          <div style={{ fontSize: "0.7rem", color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {pageInfo.section} &gt;
          </div>
          <h1 className="page-title">{pageInfo.title}</h1>
        </div>
      </div>

      <div className="top-bar-right">
        {/* Backend Status */}
        <div
          className={`badge ${backendHealthy ? "badge-success" : "badge-danger"}`}
          title={backendHealthy ? "Backend active at 127.0.0.1:4317" : "Backend unreachable"}
        >
          <span className={`dot-indicator ${backendHealthy ? "pulse" : ""}`}></span>
          {backendHealthy ? "Backend: Online" : "Backend: Offline"}
        </div>

        {/* Antigravity IDE Status */}
        <div
          className={`badge ${
            ideStatus === "ready"
              ? "badge-success"
              : ideStatus === "connected"
              ? "badge-info"
              : ideStatus === "detecting"
              ? "badge-warning"
              : "badge-unknown"
          }`}
          onClick={() => onNavigate("ide")}
          style={{ cursor: "pointer" }}
          title="Click to view Antigravity IDE connection deck"
        >
          <span className="dot-indicator"></span>
          IDE: {ideStatus === "ready" ? "Ready" : ideStatus === "connected" ? "Connected" : "Disconnected"}
        </div>

        {/* Workspace Match Badge */}
        {ideStatus === "ready" && (
          <div
            className={`badge ${workspaceMatch ? "badge-success" : "badge-danger"}`}
            title={workspaceMatch ? "IDE workspace matches project root" : "Workspace mismatch alert"}
          >
            {workspaceMatch ? "Workspace: Matched" : "Workspace: Mismatch"}
          </div>
        )}

        {/* Active Run Status */}
        {isRunActive && (
          <div
            className="badge badge-info"
            onClick={() => onNavigate("runs")}
            style={{ cursor: "pointer" }}
          >
            <span className="dot-indicator pulse"></span>
            Run Active
          </div>
        )}

        {/* Theme Toggle Button */}
        <button
          className="btn btn-sm btn-secondary"
          onClick={onToggleTheme}
          title={`Switch to ${theme === "light" ? "Dark" : "Light"} theme`}
          style={{ padding: "0.3rem 0.6rem" }}
        >
          {theme === "light" ? "🌙 Dark" : "☀️ Light"}
        </button>

        {/* Settings Button */}
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => onNavigate("settings")}
          title="Open Settings"
          style={{ padding: "0.3rem 0.6rem" }}
        >
          ⚙️
        </button>
      </div>
    </header>
  );
}
