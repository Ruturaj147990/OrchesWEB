import { useEffect, useState } from "react";
import { api, ApiError, AUTONOMY_MODE_LABELS, IdeStatus, Project, WorkspaceInfo } from "../api";

interface Props {
  project: Project;
  workspace: WorkspaceInfo | null;
  ide: IdeStatus | null;
  runActive: boolean;
  onEdit: () => void;
  onRefresh: () => void;
  onOpenBlueprints: () => void;
  onNotice: (msg: string, tone?: "error" | "info") => void;
}

export function WorkspacePanel({ project, workspace, ide, runActive, onEdit, onRefresh, onOpenBlueprints, onNotice }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [blueprintCount, setBlueprintCount] = useState<number | null>(null);
  const [requirementCount, setRequirementCount] = useState<number | null>(null);
  const profile = workspace?.profile;
  const git = workspace?.git;

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.blueprints(project.id), api.requirements(project.id)])
      .then(([bps, reqs]) => {
        if (!cancelled) {
          setBlueprintCount(bps.length);
          setRequirementCount(reqs.length);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBlueprintCount(0);
          setRequirementCount(0);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project.id]);

  const act = async (label: string, fn: () => Promise<{ message: string }>) => {
    setBusy(label);
    try {
      const r = await fn();
      onNotice(r.message, "info");
      onRefresh();
    } catch (err) {
      onNotice(err instanceof ApiError ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(project.rootPath);
      onNotice("Folder path copied.", "info");
    } catch {
      onNotice("Could not access the clipboard.", "error");
    }
  };

  const modeLabel = AUTONOMY_MODE_LABELS[project.autonomyMode]?.label ?? project.autonomyMode;

  return (
    <section className="card workspace" aria-label="Workspace">
      <div className="card-head">
        <h2 className="card-title">Workspace</h2>
        <div className="row tight">
          <button className="btn btn-ghost btn-sm" onClick={onOpenBlueprints} title="Manage master blueprints">
            Blueprints {blueprintCount ? `(${blueprintCount})` : ""}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onRefresh} title="Re-inspect the folder">
            Refresh
          </button>
          <button className="btn btn-ghost btn-sm" onClick={onEdit} disabled={runActive}>
            Edit
          </button>
        </div>
      </div>
      <button className="path" onClick={copy} title="Copy path">
        {project.rootPath}
      </button>

      {workspace && !workspace.exists ? (
        <p className="callout callout-danger small">This folder no longer exists. Edit the project to point it at the right folder.</p>
      ) : (
        <dl className="facts">
          <div>
            <dt>Profile & Mode</dt>
            <dd>
              <span className="chip" title="Project Profile">{project.profileId.replace(/_/g, " ")}</span>
              {" · "}
              <span className="chip" title={AUTONOMY_MODE_LABELS[project.autonomyMode]?.description}>{modeLabel}</span>
            </dd>
          </div>
          <div>
            <dt>Blueprint</dt>
            <dd>
              {blueprintCount !== null ? (
                blueprintCount > 0 ? (
                  <>
                    <span>{blueprintCount} attached ({requirementCount} reqs)</span>{" "}
                    <button className="link" onClick={onOpenBlueprints}>
                      view / upload
                    </button>
                  </>
                ) : (
                  <>
                    <span className="muted">None attached</span>{" "}
                    <button className="link" onClick={onOpenBlueprints}>
                      + attach blueprint
                    </button>
                  </>
                )
              ) : (
                "…"
              )}
            </dd>
          </div>
          <div>
            <dt>Specification</dt>
            <dd>
              {project.objective?.trim() ? (
                <>
                  <span>{project.objective.trim().length} chars</span>{" "}
                  <button className="link" onClick={onEdit}>
                    view / edit
                  </button>
                </>
              ) : (
                <>
                  <span className="muted">None configured</span>{" "}
                  <button className="link" onClick={onEdit}>
                    + add instructions
                  </button>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Project</dt>
            <dd>{profile ? (profile.isEmpty ? "Empty folder" : `${profile.fileCount} files · ${profile.languages.join(", ") || "unknown type"}`) : "…"}</dd>
          </div>
          <div>
            <dt>Checks</dt>
            <dd>
              {profile ? (
                profile.checks.length ? (
                  profile.checks.map((c) => (
                    <span key={c.id} className="chip" title={c.source}>
                      {c.label}
                    </span>
                  ))
                ) : (
                  <span className="muted">None detected — results can't be test-verified</span>
                )
              ) : (
                "…"
              )}
            </dd>
          </div>
          <div>
            <dt>Safety</dt>
            <dd>
              {git ? (
                git.isGitRepo ? (
                  <>
                    Git · {git.activeBranch ?? "detached"} · {git.isDirty ? <span className="warn-text">{git.dirtyFiles.length} uncommitted</span> : "clean"}
                  </>
                ) : (
                  <>
                    Snapshots (no Git){" "}
                    <button className="link" onClick={() => act("git", () => api.initGit(project.id))} disabled={busy !== null || runActive}>
                      {busy === "git" ? "initializing…" : "init Git"}
                    </button>
                  </>
                )
              ) : (
                "…"
              )}
            </dd>
          </div>
          <div>
            <dt>IDE</dt>
            <dd>
              {ide ? (
                ide.installed ? (
                  <>
                    Antigravity {ide.running ? (ide.workspaceOpen ? "· this folder is open" : "· running") : "· not running"}
                    {ide.nativeAgent.available ? " · agent reachable" : ""}{" "}
                    {!ide.workspaceOpen && (
                      <button className="link" onClick={() => act("ide", () => api.openInIde(project.id))} disabled={busy !== null}>
                        {busy === "ide" ? "opening…" : "open folder"}
                      </button>
                    )}
                  </>
                ) : (
                  <span className="muted">Antigravity not found</span>
                )
              ) : (
                "…"
              )}
            </dd>
          </div>
        </dl>
      )}
      {profile?.notes.map((n, i) => (
        <p key={i} className="callout callout-warning small">
          {n}
        </p>
      ))}
    </section>
  );
}
