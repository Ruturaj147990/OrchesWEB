import { FormEvent, useState } from "react";
import { Modal } from "./Modal";
import { api, ApiError, Project } from "../api";

interface Props {
  project?: Project;
  onClose: () => void;
  onSaved: (project: Project) => void;
  onRemoved?: () => void;
}

/** Create a project for a workspace folder, or edit an existing one. */
export function ProjectDialog({ project, onClose, onSaved, onRemoved }: Props) {
  const editing = Boolean(project);
  const [name, setName] = useState(project?.name ?? "");
  const [rootPath, setRootPath] = useState(project?.rootPath ?? "");
  const [createFolder, setCreateFolder] = useState(false);
  const [commands, setCommands] = useState((project?.verificationCommands ?? []).join("\n"));
  const [autoCommit, setAutoCommit] = useState(project?.autoCommit ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const verificationCommands = commands
      .split(/\r?\n/)
      .map((c) => c.trim())
      .filter(Boolean);
    const derivedName = name.trim() || rootPath.trim().split(/[\\/]/).filter(Boolean).pop() || "";
    if (!derivedName) return setError("Enter a name or a folder path.");
    if (!rootPath.trim()) return setError("Enter the absolute path of the project folder.");
    setBusy(true);
    try {
      const saved = editing
        ? await api.updateProject(project!.id, {
            name: derivedName,
            ...(rootPath.trim() !== project!.rootPath ? { rootPath: rootPath.trim() } : {}),
            verificationCommands,
            autoCommit,
          })
        : await api.createProject({ name: derivedName, rootPath: rootPath.trim(), createFolder, verificationCommands, autoCommit });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!project || !window.confirm(`Remove "${project.name}" from the dashboard? Files in the folder are not touched.`)) return;
    try {
      await api.removeProject(project.id);
      onRemoved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <Modal
      title={editing ? "Project settings" : "Add a project"}
      onClose={onClose}
      footer={
        <>
          {editing && (
            <button type="button" className="btn btn-ghost btn-danger-text" onClick={remove}>
              Remove project
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="project-form" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save" : "Add project"}
          </button>
        </>
      }
    >
      <form id="project-form" className="form" onSubmit={submit}>
        <label className="field">
          <span>Workspace folder</span>
          <input
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            placeholder="C:\Users\you\projects\my-app"
            spellCheck={false}
            autoComplete="off"
            required
          />
          <small>Absolute path. The orchestrator only ever writes inside this folder.</small>
        </label>
        {!editing && (
          <label className="check">
            <input type="checkbox" checked={createFolder} onChange={(e) => setCreateFolder(e.target.checked)} />
            Create the folder if it does not exist
          </label>
        )}
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Defaults to the folder name" />
        </label>
        <details className="advanced" open={editing && project!.verificationCommands.length > 0}>
          <summary>Advanced</summary>
          <label className="field">
            <span>Verification commands</span>
            <textarea
              value={commands}
              onChange={(e) => setCommands(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder={"npm test\nnpm run lint"}
            />
            <small>One per line. Leave empty to detect checks from the project (npm scripts, pytest, go test, cargo test).</small>
          </label>
          <label className="check">
            <input type="checkbox" checked={autoCommit} onChange={(e) => setAutoCommit(e.target.checked)} />
            Commit accepted changes when the folder is a clean Git repository
          </label>
        </details>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
