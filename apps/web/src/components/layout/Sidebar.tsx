import React from "react";

export type NavPage =
  | "overview"
  | "projects"
  | "runs"
  | "ide"
  | "providers"
  | "policies"
  | "git"
  | "timeline"
  | "diagnostics"
  | "settings";

interface SidebarProps {
  currentPage: NavPage;
  onNavigate: (page: NavPage) => void;
  projectName?: string;
  projectPath?: string;
  activeRunCount?: number;
  pendingInboxCount?: number;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function Sidebar({
  currentPage,
  onNavigate,
  projectName,
  projectPath,
  activeRunCount = 0,
  pendingInboxCount = 0,
  isCollapsed = false,
  onToggleCollapse,
}: SidebarProps) {
  return (
    <aside className={`sidebar ${isCollapsed ? "collapsed" : ""}`}>
      <div className="sidebar-header">
        <div className="brand-section">
          <div className="brand-logo">A</div>
          {!isCollapsed && <span className="brand-title">Autonomous Development Orchestrator</span>}
        </div>
        <button
          className="btn btn-sm btn-outline"
          onClick={onToggleCollapse}
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{ padding: "0.2rem 0.4rem", fontSize: "0.7rem", color: "var(--sidebar-dim)", border: "none" }}
        >
          {isCollapsed ? "▶" : "◀"}
        </button>
      </div>

      {!isCollapsed && (
        <div className="sidebar-project-select" onClick={() => onNavigate("projects")} style={{ cursor: "pointer" }}>
          <div className="sidebar-project-label">Active Project</div>
          <div className="sidebar-project-name">{projectName || "No Project Selected"}</div>
          <div className="sidebar-project-path">{projectPath || "Select workspace directory"}</div>
        </div>
      )}

      <nav className="sidebar-nav">
        {/* Main Section */}
        <div>
          {!isCollapsed && <div className="nav-section-title">Main</div>}
          <div
            className={`nav-item ${currentPage === "overview" ? "active" : ""}`}
            onClick={() => onNavigate("overview")}
            title="Overview"
          >
            <span className="nav-icon">📊</span>
            {!isCollapsed && <span>Overview</span>}
          </div>
          <div
            className={`nav-item ${currentPage === "projects" ? "active" : ""}`}
            onClick={() => onNavigate("projects")}
            title="Projects & Workspaces"
          >
            <span className="nav-icon">📁</span>
            {!isCollapsed && <span>Projects & Workspaces</span>}
          </div>
          <div
            className={`nav-item ${currentPage === "runs" ? "active" : ""}`}
            onClick={() => onNavigate("runs")}
            title="Runs & Tasks"
          >
            <span className="nav-icon">⚡</span>
            {!isCollapsed && <span>Runs & Tasks</span>}
            {!isCollapsed && activeRunCount > 0 && <span className="nav-badge">{activeRunCount}</span>}
          </div>
        </div>

        {/* Connections Section */}
        <div>
          {!isCollapsed && <div className="nav-section-title">Connections</div>}
          <div
            className={`nav-item ${currentPage === "ide" ? "active" : ""}`}
            onClick={() => onNavigate("ide")}
            title="Antigravity IDE"
          >
            <span className="nav-icon">💻</span>
            {!isCollapsed && <span>Antigravity IDE</span>}
          </div>
          <div
            className={`nav-item ${currentPage === "providers" ? "active" : ""}`}
            onClick={() => onNavigate("providers")}
            title="Providers & Models"
          >
            <span className="nav-icon">🧠</span>
            {!isCollapsed && <span>Providers & Models</span>}
          </div>
        </div>

        {/* Controls Section */}
        <div>
          {!isCollapsed && <div className="nav-section-title">Controls</div>}
          <div
            className={`nav-item ${currentPage === "policies" ? "active" : ""}`}
            onClick={() => onNavigate("policies")}
            title="Policies & Profiles"
          >
            <span className="nav-icon">🛡️</span>
            {!isCollapsed && <span>Policies & Profiles</span>}
          </div>
          <div
            className={`nav-item ${currentPage === "git" ? "active" : ""}`}
            onClick={() => onNavigate("git")}
            title="Git & Recovery"
          >
            <span className="nav-icon">🌿</span>
            {!isCollapsed && <span>Git & Recovery</span>}
          </div>
        </div>

        {/* Observability Section */}
        <div>
          {!isCollapsed && <div className="nav-section-title">Observability</div>}
          <div
            className={`nav-item ${currentPage === "timeline" ? "active" : ""}`}
            onClick={() => onNavigate("timeline")}
            title="Event Timeline"
          >
            <span className="nav-icon">📜</span>
            {!isCollapsed && <span>Event Timeline</span>}
          </div>
          <div
            className={`nav-item ${currentPage === "diagnostics" ? "active" : ""}`}
            onClick={() => onNavigate("diagnostics")}
            title="Diagnostics & Logs"
          >
            <span className="nav-icon">🩺</span>
            {!isCollapsed && <span>Diagnostics & Logs</span>}
          </div>
        </div>

        {/* Configuration Section */}
        <div>
          {!isCollapsed && <div className="nav-section-title">Configuration</div>}
          <div
            className={`nav-item ${currentPage === "settings" ? "active" : ""}`}
            onClick={() => onNavigate("settings")}
            title="Settings"
          >
            <span className="nav-icon">⚙️</span>
            {!isCollapsed && <span>Settings</span>}
          </div>
        </div>
      </nav>
    </aside>
  );
}
