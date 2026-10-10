import React, { useState } from "react";
import { ProjectData } from "./OverviewPage";
import { NavPage } from "../components/layout/Sidebar";

interface ProjectsPageProps {
  projects: ProjectData[];
  activeProject: ProjectData | null;
  onSelectProject: (p: ProjectData) => void;
  onProjectCreated: (p: ProjectData) => void;
  onNavigate: (page: NavPage) => void;
}

export function ProjectsPage({
  projects,
  activeProject,
  onSelectProject,
  onProjectCreated,
  onNavigate,
}: ProjectsPageProps) {
  const [search, setSearch] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [rootPath, setRootPath] = useState("c:\\Users\\limbk\\OneDrive\\Desktop\\orches");
  const [autonomyMode, setAutonomyMode] = useState("creative_within_constraints");
  const [profileId, setProfileId] = useState("general");
  const [blueprintText, setBlueprintText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.rootPath && p.rootPath.toLowerCase().includes(search.toLowerCase())) ||
      p.objective.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      // 1. Create project
      const res = await fetch("/api/v1/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Untitled Project",
          objective: objective.trim(),
          rootPath: rootPath.trim(),
          autonomyMode,
          profileId,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to create project");
      }

      const newProj: ProjectData = await res.json();

      // 2. If blueprint provided, import it
      if (blueprintText.trim()) {
        await fetch(`/api/v1/projects/${newProj.id}/blueprints`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: "blueprint.md",
            contentText: blueprintText.trim(),
          }),
        });
      }

      onProjectCreated(newProj);
      setShowCreateModal(false);
      setName("");
      setObjective("");
      setBlueprintText("");
    } catch (err: unknown) {
      setError((err as Error).message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="content-container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-main)" }}>Projects & Workspaces</h1>
          <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            Manage registered repositories and active target workspace directories.
          </p>
        </div>

        <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
          + New Project
        </button>
      </div>

      {/* Search and Filters */}
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1.25rem" }}>
        <input
          type="text"
          className="form-input"
          placeholder="Search projects by name, path, or objective..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>

      {/* Projects Table */}
      <div className="card">
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: "2.5rem 1rem", color: "var(--text-dim)" }}>
            <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>📁</div>
            <div>No matching projects found.</div>
            <button className="btn btn-primary" onClick={() => setShowCreateModal(true)} style={{ marginTop: "1rem" }}>
              Create Your First Project
            </button>
          </div>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Project Name</th>
                <th>Workspace Directory</th>
                <th>Autonomy Mode</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isActive = activeProject?.id === p.id;
                return (
                  <tr key={p.id} style={isActive ? { background: "rgba(99, 102, 241, 0.05)" } : {}}>
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--text-main)" }}>
                        {p.name} {isActive && <span className="badge badge-success" style={{ marginLeft: "0.5rem" }}>Active</span>}
                      </div>
                      <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: "0.2rem" }}>
                        {p.objective || "No objective description"}
                      </div>
                    </td>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem", wordBreak: "break-all" }}>
                      {p.rootPath || "Not set"}
                    </td>
                    <td>
                      <span className="badge badge-info">{p.autonomyMode}</span>
                    </td>
                    <td>
                      <span className="badge badge-success">{p.status}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: "0.4rem" }}>
                        {!isActive && (
                          <button className="btn btn-sm btn-secondary" onClick={() => onSelectProject(p)}>
                            Select
                          </button>
                        )}
                        <button className="btn btn-sm btn-outline" onClick={() => onNavigate("runs")}>
                          Runs
                        </button>
                        <button className="btn btn-sm btn-outline" onClick={() => onNavigate("ide")}>
                          IDE
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Project Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="card-header">
              <h2 className="card-title">Create / Import Project</h2>
              <button className="btn btn-sm btn-outline" onClick={() => setShowCreateModal(false)}>
                ✕
              </button>
            </div>

            {error && (
              <div style={{ padding: "0.75rem", background: "var(--accent-rose-subtle)", color: "var(--accent-rose)", borderRadius: "var(--radius-sm)", marginBottom: "1rem", fontSize: "0.85rem" }}>
                {error}
              </div>
            )}

            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label">Project Name *</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  placeholder="e.g. Autonomous E-Commerce Core"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Target Workspace Directory *</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  placeholder="Absolute canonical directory path"
                  value={rootPath}
                  onChange={(e) => setRootPath(e.target.value)}
                />
                <span style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>
                  Must be an accessible directory. Verified against active Antigravity IDE window.
                </span>
              </div>

              <div className="form-group">
                <label className="form-label">Objective</label>
                <textarea
                  className="form-textarea"
                  rows={2}
                  placeholder="What is the high-level development goal?"
                  value={objective}
                  onChange={(e) => setObjective(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Autonomy Mode</label>
                <select
                  className="form-select"
                  value={autonomyMode}
                  onChange={(e) => setAutonomyMode(e.target.value)}
                >
                  <option value="strict_blueprint_adherence">Strict Blueprint Adherence (Zero deviation)</option>
                  <option value="creative_within_constraints">Creative Within Constraints (Recommended)</option>
                  <option value="creative_exploration">Creative Exploration (Unbounded prototype)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Initial Blueprint (Optional Markdown)</label>
                <textarea
                  className="form-textarea"
                  rows={4}
                  placeholder="Paste specification, architecture blueprint, or requirements..."
                  value={blueprintText}
                  onChange={(e) => setBlueprintText(e.target.value)}
                  style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "1.25rem" }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={isLoading}>
                  {isLoading ? "Creating..." : "Save Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
