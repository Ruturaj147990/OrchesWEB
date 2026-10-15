import { ChangeEvent, useEffect, useState } from "react";
import { Modal } from "./Modal";
import { api, ApiError, CandidateRequirement, ImportedBlueprint } from "../api";

interface Props {
  projectId: string;
  projectName: string;
  onClose: () => void;
  onChanged?: () => void;
}

export function BlueprintDialog({ projectId, projectName, onClose, onChanged }: Props) {
  const [blueprints, setBlueprints] = useState<ImportedBlueprint[]>([]);
  const [requirements, setRequirements] = useState<CandidateRequirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [docs, reqs] = await Promise.all([api.blueprints(projectId), api.requirements(projectId)]);
      setBlueprints(docs);
      setRequirements(reqs);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [projectId]);

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setSuccess(null);
    setUploading(true);

    try {
      const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
      const isBinary = [".pdf", ".docx"].includes(ext);

      if (isBinary) {
        const reader = new FileReader();
        reader.onload = async () => {
          try {
            const base64 = (reader.result as string).split(",")[1];
            const res = await api.uploadBlueprint(projectId, file.name, undefined, base64);
            setSuccess(`Imported "${file.name}" (${res.requirements.length} requirement(s) extracted).`);
            await load();
            onChanged?.();
          } catch (err) {
            setError(err instanceof ApiError ? err.message : String(err));
          } finally {
            setUploading(false);
          }
        };
        reader.onerror = () => {
          setError("Failed to read file.");
          setUploading(false);
        };
        reader.readAsDataURL(file);
      } else {
        const text = await file.text();
        const res = await api.uploadBlueprint(projectId, file.name, text);
        setSuccess(`Imported "${file.name}" (${res.requirements.length} requirement(s) extracted).`);
        await load();
        onChanged?.();
        setUploading(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      setUploading(false);
    } finally {
      e.target.value = "";
    }
  };

  const deleteBlueprint = async (blueprintId: string, filename: string) => {
    if (!window.confirm(`Delete blueprint "${filename}" and its extracted requirements?`)) return;
    try {
      await api.deleteBlueprint(projectId, blueprintId);
      setSuccess(`Removed "${filename}".`);
      await load();
      onChanged?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  return (
    <Modal
      title={`Master Blueprints — ${projectName}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="blueprint-dialog-content">
        <section className="blueprint-upload-section">
          <h3>Upload Master Blueprint</h3>
          <p className="small muted">
            Attach a project specification, architecture document, or PRD (.md, .txt, .json, .yaml, .pdf, .docx). Extracted requirements will guide the reasoning brain and Antigravity Agent.
          </p>
          <div className="upload-box">
            <label className="btn btn-primary btn-sm">
              {uploading ? "Importing & Extracting…" : "Select blueprint file"}
              <input
                type="file"
                accept=".md,.txt,.json,.yaml,.yml,.pdf,.docx"
                onChange={handleFileUpload}
                disabled={uploading}
                style={{ display: "none" }}
              />
            </label>
            <span className="small muted">Supported: Markdown, Text, JSON, YAML, PDF, DOCX (up to 10MB)</span>
          </div>
        </section>

        {error && <p className="callout callout-danger small">{error}</p>}
        {success && <p className="callout callout-info small">{success}</p>}

        <section className="blueprint-list-section">
          <h3>Attached Documents ({blueprints.length})</h3>
          {loading ? (
            <p className="muted small">Loading blueprints…</p>
          ) : blueprints.length === 0 ? (
            <p className="muted small">No master blueprints attached to this project yet.</p>
          ) : (
            <ul className="file-list">
              {blueprints.map((b) => (
                <li key={b.id} className="file-row blueprint-row">
                  <div>
                    <strong>{b.filename}</strong>
                    <span className="muted small"> · {(b.byteSize / 1024).toFixed(1)} KB · {new Date(b.importedAt).toLocaleDateString()}</span>
                    {b.warnings.length > 0 && <span className="warn-text small"> ({b.warnings.join("; ")})</span>}
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-danger-text btn-sm"
                    onClick={() => deleteBlueprint(b.id, b.filename)}
                    title="Remove blueprint"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {requirements.length > 0 && (
          <section className="requirements-list-section">
            <h3>Extracted Requirements ({requirements.length})</h3>
            <p className="small muted">These requirements are automatically integrated into engineering briefs and acceptance planning.</p>
            <div className="requirements-scroll">
              <ul className="requirements-list">
                {requirements.map((r) => (
                  <li key={r.id} className={`requirement-item provenance-${r.provenanceKind}`}>
                    <div className="req-header">
                      <span className="req-id">{r.id.match(/REQ-\d+$/)?.[0] ?? r.id}</span>
                      <span className={`badge badge-${r.provenanceKind === "explicit" ? "success" : "neutral"} small`}>
                        {r.provenanceKind}
                      </span>
                      <strong className="req-title">{r.title}</strong>
                      <span className="req-source muted small">{r.sourceReference}</span>
                    </div>
                    <p className="req-desc small">{r.description}</p>
                    <div className="req-test small muted">
                      <em>Test:</em> {r.proposedAcceptanceTest}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
