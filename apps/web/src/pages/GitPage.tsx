import React, { useState, useEffect } from "react";
import { ProjectData } from "../types";

interface GitStatusData {
  isGitRepo: boolean;
  hasRemote: boolean;
  remoteUrl: string | null;
  activeBranch: string | null;
  baselineCommit: string | null;
  isDirty: boolean;
  modifiedFiles: string[];
  safetyMode: "git" | "local_snapshot";
  snapshotCount?: number;
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
  const [isInitializingGit, setIsInitializingGit] = useState(false);

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
    const isGit = gitStatus?.isGitRepo;
    const msg = checkpointMsg.trim() || `Manual operator checkpoint at ${new Date().toLocaleTimeString()}`;
    try {
      const res = await fetch(`/api/v1/projects/${project.id}/git/checkpoint`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionNotice(
          isGit
            ? `Checkpoint committed! Git Commit SHA: ${data.commitSha}`
            : `Safety snapshot created! Snapshot ID: ${data.commitSha}`
        );
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
    const target = rollbackSha.trim();
    if (!confirm(`Are you sure you want to restore baseline ${target}?`)) return;

    try {
      const res = await fetch(`/api/v1/projects/${project.id}/git/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commitSha: target }),
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

  const handleInitLocalGit = async () => {
    if (!project) return;
    const confirmed = confirm(
      "Initialize a local Git repository in this folder?\n\nThis will run 'git init' locally. It will NEVER create a remote or push to GitHub."
    );
    if (!confirmed) return;

    setIsInitializingGit(true);
    try {
      const res = await fetch(`/api/v1/projects/${project.id}/git/init`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionNotice("✓ Local Git repository initialized successfully! No remotes configured.");
        fetchStatus();
      } else {
        alert(data.error || "Failed to initialize Git repository");
      }
    } catch (err) {
      alert("Error initializing Git repository");
    } finally {
      setIsInitializingGit(false);
    }
  };

  const isGit = Boolean(gitStatus?.isGitRepo);

  return (
    <div className="content-container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <div>
          <h1 style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--text-main)" }}>
            Version Control & State Recovery
          </h1>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
            Track code changes, inspect diffs, create safety checkpoints, and restore baselines.
          </p>
        </div>

        <button className="btn btn-sm btn-secondary" onClick={fetchStatus} disabled={isLoading}>
          {isLoading ? "Refreshing..." : "↻ Refresh Status"}
        </button>
      </div>

      {actionNotice && (
        <div style={{ padding: "0.75rem 1rem", background: "var(--accent-emerald-subtle)", color: "var(--accent-emerald)", borderRadius: "var(--radius-sm)", marginBottom: "1.25rem", border: "1px solid rgba(5, 150, 105, 0.3)", fontSize: "0.85rem" }}>
          {actionNotice}
        </div>
      )}

      {/* Safety Mode Indicator Banner */}
      {!isGit ? (
        <div
          style={{
            padding: "0.85rem 1rem",
            background: "rgba(59, 130, 246, 0.1)",
            border: "1px solid rgba(59, 130, 246, 0.3)",
            borderRadius: "var(--radius-sm)",
            marginBottom: "1.25rem",
            fontSize: "0.82rem",
            color: "var(--text-main)",
          }}
        >
          <div style={{ fontWeight: 700, color: "var(--accent-cyan)", marginBottom: "0.3rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span>📂 Non-Git Project: Local File Snapshot Safety Active</span>
          </div>
          <div>
            This project directory is not a Git repository. GitHub integration is entirely optional.
            The autonomous loop operates with <strong>automatic local snapshots</strong> before every agent modification, guaranteeing safe rollbacks without needing Git or remote connections.
          </div>
        </div>
      ) : gitStatus?.hasRemote ? (
        <div
          style={{
            padding: "0.6rem 0.85rem",
            background: "rgba(16, 185, 129, 0.1)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            borderRadius: "var(--radius-sm)",
            marginBottom: "1.25rem",
            fontSize: "0.8rem",
            color: "var(--text-main)",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
          }}
        >
          <span style={{ color: "var(--accent-emerald)", fontWeight: 600 }}>✓ Git Repository (Connected Remote):</span>
          <code style={{ fontSize: "0.75rem", fontFamily: "var(--font-mono)" }}>{gitStatus.remoteUrl}</code>
          <span style={{ color: "var(--text-dim)", fontSize: "0.75rem" }}>(Pushing to remote is never performed automatically)</span>
        </div>
      ) : (
        <div
          style={{
            padding: "0.6rem 0.85rem",
            background: "rgba(16, 185, 129, 0.1)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            borderRadius: "var(--radius-sm)",
            marginBottom: "1.25rem",
            fontSize: "0.8rem",
            color: "var(--text-main)",
          }}
        >
          <span style={{ color: "var(--accent-emerald)", fontWeight: 600 }}>✓ Local Git Repository:</span> Operating 100% locally. No remote repository or GitHub account required.
        </div>
      )}

      {/* Repository Status Header Strip */}
      <div className="metrics-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.75rem", marginBottom: "1.25rem" }}>
        <div className="metric-box">
          <div className="metric-label" style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>Safety Mode</div>
          <div className="metric-value" style={{ fontSize: "0.85rem", fontWeight: 700, color: isGit ? "var(--accent-emerald)" : "var(--accent-cyan)" }}>
            {isGit ? "Git VCS" : "Local Snapshots"}
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-label" style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>Working Tree</div>
          <div className="metric-value" style={{ fontSize: "0.85rem", fontWeight: 700, color: gitStatus?.isDirty ? "var(--accent-amber)" : "var(--accent-emerald)" }}>
            {gitStatus?.isDirty ? "Modified" : "Clean"}
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-label" style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>Baseline Reference</div>
          <div className="metric-value" style={{ fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}>
            {gitStatus?.baselineCommit ? gitStatus.baselineCommit.slice(0, 14) : "None"}
          </div>
        </div>

        <div className="metric-box">
          <div className="metric-label" style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>Modified Files</div>
          <div className="metric-value" style={{ fontSize: "0.85rem", fontWeight: 700 }}>
            {gitStatus?.modifiedFiles.length || 0}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: "1rem" }}>
        {/* Left: Code Diff Viewer */}
        <div className="card" style={{ padding: "1rem" }}>
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <h2 className="card-title" style={{ fontSize: "0.95rem" }}>
              {isGit ? "Live Working Tree Diff (`git diff HEAD`)" : "Live Working Tree Diff (vs Local Snapshot)"}
            </h2>
            <span className="badge" style={{ fontSize: "0.7rem" }}>{gitStatus?.modifiedFiles.length || 0} Files Changed</span>
          </div>

          <pre className="code-block" style={{ maxHeight: "450px", minHeight: "220px", fontSize: "0.75rem", overflowY: "auto" }}>
            {diffText}
          </pre>
        </div>

        {/* Right: Checkpoint & Recovery Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Create Checkpoint */}
          <div className="card" style={{ padding: "1rem" }}>
            <h3 className="card-title" style={{ fontSize: "0.9rem", marginBottom: "0.3rem" }}>
              {isGit ? "Create Git Checkpoint" : "Create Snapshot Checkpoint"}
            </h3>
            <p className="card-subtitle" style={{ fontSize: "0.75rem", marginBottom: "0.75rem" }}>
              {isGit
                ? "Atomically commits current modifications to create a named rollback point."
                : "Captures a full local file snapshot to create a named rollback point without Git."}
            </p>

            <div className="form-group" style={{ marginBottom: "0.75rem" }}>
              <label className="form-label" style={{ fontSize: "0.75rem" }}>Checkpoint Description</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Verified auth routes working"
                value={checkpointMsg}
                onChange={(e) => setCheckpointMsg(e.target.value)}
              />
            </div>

            <button
              className="btn btn-sm btn-primary"
              onClick={handleCreateCheckpoint}
              disabled={!gitStatus?.isDirty}
              style={{ width: "100%" }}
            >
              {isGit ? "Commit Git Checkpoint" : "Save Safety Snapshot"}
            </button>
          </div>

          {/* Rollback to Baseline */}
          <div className="card" style={{ padding: "1rem" }}>
            <h3 className="card-title" style={{ fontSize: "0.9rem", marginBottom: "0.3rem" }}>
              {isGit ? "Rollback to Commit" : "Rollback to Snapshot"}
            </h3>
            <p className="card-subtitle" style={{ fontSize: "0.75rem", marginBottom: "0.75rem" }}>
              Restores files to a specified baseline. Pre-existing untracked files are preserved safely.
            </p>

            <div className="form-group" style={{ marginBottom: "0.75rem" }}>
              <label className="form-label" style={{ fontSize: "0.75rem" }}>
                {isGit ? "Target Commit SHA" : "Target Snapshot ID"}
              </label>
              <input
                type="text"
                className="form-input"
                style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}
                placeholder={gitStatus?.baselineCommit || (isGit ? "commit SHA..." : "snap-...")}
                value={rollbackSha}
                onChange={(e) => setRollbackSha(e.target.value)}
              />
            </div>

            <button
              className="btn btn-sm btn-danger"
              onClick={handleRollback}
              disabled={!rollbackSha.trim()}
              style={{ width: "100%" }}
            >
              Restore Baseline (Rollback)
            </button>
          </div>

          {/* Initialize Local Git Option (Explicit Consent) */}
          {!isGit && (
            <div className="card" style={{ padding: "1rem", background: "var(--bg-card)" }}>
              <h3 className="card-title" style={{ fontSize: "0.9rem", marginBottom: "0.3rem" }}>
                Initialize Local Git Repository
              </h3>
              <p className="card-subtitle" style={{ fontSize: "0.75rem", marginBottom: "0.75rem" }}>
                Optional: Switch from local snapshots to local Git branches and commits. Never pushes to GitHub or configures remotes.
              </p>

              <button
                className="btn btn-sm btn-outline"
                onClick={handleInitLocalGit}
                disabled={isInitializingGit}
                style={{ width: "100%", fontWeight: 600 }}
              >
                {isInitializingGit ? "Initializing..." : "🌿 Initialize Local Git Repository"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
