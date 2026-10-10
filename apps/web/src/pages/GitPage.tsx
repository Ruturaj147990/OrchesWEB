import React, { useState, useEffect } from "react";
import { ProjectData } from "../types";

interface GitStatusData {
  isGitRepo: boolean;
  baselineCommit: string | null;
  isDirty: boolean;
  modifiedFiles: string[];
}

interface GitPageProps {
  project: ProjectData | null;
}

export function GitPage({ project }: GitPageProps) {
  const [gitStatus, setGitStatus] = useState<GitStatusData | null>(null);
  const [diffText, setDiffText] = useState<string>("");
  const [checkpointMsg, setCheckpointMsg] = useState("");
  const [rollbackSha, setRollbackSha] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const fetchStatus = async () => {
    if (!project) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/v1/projects/${project.id}/git/status`);
      if (res.ok) {
        const data = await res.json();
        setGitStatus(data);
      }

      const diffRes = await fetch(`/api/v1/projects/${project.id}/git/diff`);
      if (diffRes.ok) {
        const diffData = await diffRes.json();
        setDiffText(diffData.diff || "No uncommitted diff detected.");
      }
    } catch (err) {
      console.error("Git status fetch error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, [project]);

  const handleCreateCheckpoint = async () => {
    if (!project) return;
    const msg = checkpointMsg.trim() || `Manual operator checkpoint at ${new Date().toLocaleTimeString()}`;
    try {
      const res = await fetch(`/api/v1/projects/${project.id}/git/checkpoint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionNotice(`Checkpoint created! Commit SHA: ${data.commitSha}`);
        setCheckpointMsg("");
        fetchStatus();
      } else {
        alert(data.error || "Checkpoint creation failed");
      }
    } catch (err) {
      alert("Error creating checkpoint");
    }
  };

  const handleRollback = async () => {
    if (!project || !rollbackSha.trim()) return;
    if (!confirm(`Are you sure you want to restore baseline commit ${rollbackSha}?`)) return;

    try {
      const res = await fetch(`/api/v1/projects/${project.id}/git/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitSha: rollbackSha.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionNotice(`Rollback complete: Restored to ${data.targetCommit}`);
        setRollbackSha("");
        fetchStatus();
      } else {
        alert(data.error || "Rollback failed");
      }
    } catch (err) {
      alert("Error rolling back");
    }
  };

  return (
    <div className="content-container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-main)" }}>Git Checkpoints & State Recovery</h1>
          <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
            Track version-control baselines, inspect code diffs, create safety checkpoints, and restore repository state.
          </p>
        </div>

        <button className="btn btn-secondary" onClick={fetchStatus} disabled={isLoading}>
          {isLoading ? "Refreshing..." : "↻ Refresh Git Status"}
        </button>
      </div>

      {actionNotice && (
        <div style={{ padding: "0.75rem 1rem", background: "var(--accent-emerald-subtle)", color: "var(--accent-emerald)", borderRadius: "var(--radius-sm)", marginBottom: "1.25rem", border: "1px solid rgba(5, 150, 105, 0.3)", fontSize: "0.85rem" }}>
          {actionNotice}
        </div>
      )}

      {/* Repository Status Header Strip */}
      <div className="metrics-row">
        <div className="metric-box">
          <div className="metric-label">Git Repository</div>
          <div className="metric-value" style={{ color: gitStatus?.isGitRepo ? "var(--accent-emerald)" : "var(--accent-rose)" }}>
            {gitStatus?.isGitRepo ? "Active" : "Not Found"}
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-label">Working Tree State</div>
          <div className="metric-value" style={{ color: gitStatus?.isDirty ? "var(--accent-amber)" : "var(--accent-emerald)" }}>
            {gitStatus?.isDirty ? "Dirty (Modified)" : "Clean"}
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-label">Baseline Commit</div>
          <div className="metric-value" style={{ fontSize: "0.85rem", fontFamily: "var(--font-mono)" }}>
            {gitStatus?.baselineCommit ? gitStatus.baselineCommit.slice(0, 12) : "None"}
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-label">Modified Files</div>
          <div className="metric-value">{gitStatus?.modifiedFiles.length || 0}</div>
        </div>
      </div>

      <div className="two-col-grid">
        {/* Left: Code Diff Viewer */}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Live Working Tree Diff (`git diff HEAD`)</h2>
            <span className="badge">{gitStatus?.modifiedFiles.length || 0} Files Changed</span>
          </div>

          <pre className="code-block" style={{ maxHeight: "500px", minHeight: "250px" }}>
            {diffText}
          </pre>
        </div>

        {/* Right: Checkpoint & Recovery Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Create Checkpoint */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: "0.5rem" }}>Create Orchestrator Checkpoint</h3>
            <p className="card-subtitle" style={{ marginBottom: "1rem" }}>
              Atomically commits all current modifications to create a named rollback point.
            </p>

            <div className="form-group">
              <label className="form-label">Checkpoint Description</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Verified auth routes working"
                value={checkpointMsg}
                onChange={(e) => setCheckpointMsg(e.target.value)}
              />
            </div>

            <button
              className="btn btn-primary"
              onClick={handleCreateCheckpoint}
              disabled={!gitStatus?.isGitRepo || !gitStatus?.isDirty}
              style={{ width: "100%" }}
            >
              Commit Safety Checkpoint
            </button>
          </div>

          {/* Rollback to Baseline */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: "0.5rem" }}>Rollback to Checkpoint</h3>
            <p className="card-subtitle" style={{ marginBottom: "1rem" }}>
              Restores repository files to a specified commit SHA. Pre-existing untracked files are preserved safely.
            </p>

            <div className="form-group">
              <label className="form-label">Target Commit SHA</label>
              <input
                type="text"
                className="form-input"
                style={{ fontFamily: "var(--font-mono)" }}
                placeholder={gitStatus?.baselineCommit || "commit SHA..."}
                value={rollbackSha}
                onChange={(e) => setRollbackSha(e.target.value)}
              />
            </div>

            <button
              className="btn btn-danger"
              onClick={handleRollback}
              disabled={!gitStatus?.isGitRepo || !rollbackSha.trim()}
              style={{ width: "100%" }}
            >
              Restore Commit (Rollback)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
