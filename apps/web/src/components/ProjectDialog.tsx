import { FormEvent, useEffect, useState } from "react";
import { Modal } from "./Modal";
import { api, ApiError, AutonomyMode, AUTONOMY_MODE_LABELS, Project, ProjectProfileDefinition } from "../api";

interface Props {
  project?: Project;
  onClose: () => void;
  onSaved: (project: Project) => void;
  onRemoved?: () => void;
}

const DEFAULT_PROFILES: Array<{ id: string; name: string; description: string }> = [
  { id: "general", name: "General Software", description: "Standard software development project" },
  { id: "frontend", name: "Frontend Application", description: "Client-side web app with UI components and responsive layout" },
  { id: "backend", name: "Backend / API Service", description: "Server-side HTTP API, database, and background processing" },
  { id: "fullstack", name: "Full-Stack Application", description: "Combined frontend client, backend API, and persistence" },
  { id: "ai_ml", name: "AI / ML Project", description: "Machine learning model development, training pipeline, and inference" },
  { id: "data_science", name: "Data Science & Analytics", description: "Data transformation pipelines and statistical modeling" },
  { id: "cli_tool", name: "CLI / Developer Tool", description: "Command-line utilities and developer tooling" },
  { id: "embedded_iot", name: "Embedded / IoT", description: "Hardware-adjacent code and resource-constrained systems" },
  { id: "docs_research", name: "Documentation & Research", description: "Technical specifications and verified documentation" },
  { id: "custom", name: "Custom / Blank", description: "Open-ended project without specialized framework assumptions" },
];

/** Create a project for a workspace folder, or edit an existing one. */
export function ProjectDialog({ project, onClose, onSaved, onRemoved }: Props) {
  const editing = Boolean(project);
  const [name, setName] = useState(project?.name ?? "");
  const [objective, setObjective] = useState(project?.objective ?? "");
  const [rootPath, setRootPath] = useState(project?.rootPath ?? "");
  const [profileId, setProfileId] = useState(project?.profileId ?? "general");
  const [autonomyMode, setAutonomyMode] = useState<AutonomyMode>(project?.autonomyMode ?? "creative_within_constraints");
  const [profiles, setProfiles] = useState<Array<{ id: string; name: string; description: string }>>(DEFAULT_PROFILES);
  const [createFolder, setCreateFolder] = useState(false);
  const [commands, setCommands] = useState((project?.verificationCommands ?? []).join("\n"));
  const [autoCommit, setAutoCommit] = useState(project?.autoCommit ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .profiles()
      .then((res) => {
        if (Array.isArray(res) && res.length > 0) setProfiles(res);
      })
      .catch(() => {});
  }, []);

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
            objective,
            ...(rootPath.trim() !== project!.rootPath ? { rootPath: rootPath.trim() } : {}),
            profileId,
            autonomyMode,
            verificationCommands,
            autoCommit,
          })
        : await api.createProject({
            name: derivedName,
            objective,
            rootPath: rootPath.trim(),
            createFolder,
            profileId,
            autonomyMode,
            verificationCommands,
            autoCommit,
          });
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

        <label className="field">
          <span>Project Specification & Instructions</span>
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={7}
            spellCheck={false}
            placeholder={`Enter any combination of:
• High-level ideas or comprehensive project specifications
• Mandatory tech stack, required libraries, exact versions, and forbidden frameworks
• Architecture patterns, API endpoints, contracts, schemas, and data models
• UI/UX expectations, design system rules, accessibility, responsive behavior
• Coding standards, test runner commands, and strict acceptance criteria
• Large AI prompts from ChatGPT or other models`}
          />
          <small>
            Universal specification and instructions. Preserves formatting, Markdown, code blocks, and strict rules across all tasks and repair iterations.
          </small>
        </label>

        <label className="field">
          <span>Project Profile (Domain & Conventions)</span>
          <select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.description}
              </option>
            ))}
          </select>
          <small>Influences reasoning model engineering guidelines, verification focus, and technical brief structure.</small>
        </label>

        <label className="field">
          <span>Autonomy & Creativity Mode</span>
          <select value={autonomyMode} onChange={(e) => setAutonomyMode(e.target.value as AutonomyMode)}>
            {(Object.keys(AUTONOMY_MODE_LABELS) as AutonomyMode[]).map((m) => (
              <option key={m} value={m}>
                {AUTONOMY_MODE_LABELS[m].label} — {AUTONOMY_MODE_LABELS[m].description}
              </option>
            ))}
          </select>
          <small>Controls how strictly instructions are followed versus freedom to explore architectural improvements.</small>
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
