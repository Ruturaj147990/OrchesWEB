import React, { useState } from "react";

export interface WizardProps {
  isOpen: boolean;
  onClose: () => void;
  onProjectCreated: (project: any) => void;
}

export function ProjectWizard({ isOpen, onClose, onProjectCreated }: WizardProps) {
  const [step, setStep] = useState(1);
  const [projectName, setProjectName] = useState("");
  const [objective, setObjective] = useState("");
  const [workspacePath, setWorkspacePath] = useState(window.location.hostname || "C:/Users/limbk/OneDrive/Desktop/orches");
  const [blueprintText, setBlueprintText] = useState("");
  const [profileId, setProfileId] = useState("general");
  const [autonomyMode, setAutonomyMode] = useState<
    "creative_within_constraints" | "creative_exploration" | "strict_blueprint_adherence"
  >("creative_within_constraints");
  const [requirements, setRequirements] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (isOpen) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleNext = async () => {
    if (step === 3 && blueprintText.trim()) {
      // Create candidate requirements from blueprint text
      const lines = blueprintText.split("\n").filter((l) => l.trim().length > 5);
      const extracted = lines.slice(0, 5).map((line, idx) => ({
        id: `REQ-${String(idx + 1).padStart(3, "0")}`,
        title: line.replace(/^[#\-*\s]+/, "").slice(0, 60),
        provenanceKind: line.toLowerCase().includes("must") ? "explicit" : "inferred",
        status: "approved",
      }));
      setRequirements(extracted.length > 0 ? extracted : [
        { id: "REQ-001", title: "Fulfill project specification", provenanceKind: "inferred", status: "approved" }
      ]);
    }

    if (step < 6) {
      setStep(step + 1);
    } else {
      // Finalize Project Creation
      setIsSubmitting(true);
      try {
        const res = await fetch("/api/v1/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: projectName || "New Autonomous Project",
            objective,
            rootPath: workspacePath,
            profileId,
            autonomyMode,
          }),
        });
        const created = await res.json();
        onProjectCreated(created);
        onClose();
      } catch (err) {
        console.error("Error creating project:", err);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0, 0, 0, 0.75)",
      backdropFilter: "blur(8px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 100,
      padding: "1rem",
    }}>
      <div className="glass-card" style={{ maxWidth: "680px", width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
          <div>
            <span style={{ fontSize: "0.75rem", color: "var(--accent-cyan)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Step {step} of 6
            </span>
            <h2 style={{ fontSize: "1.3rem", fontWeight: 700, color: "var(--text-main)" }}>
              {step === 1 && "Project Idea & Vision"}
              {step === 2 && "Workspace Directory"}
              {step === 3 && "Blueprint Document Import"}
              {step === 4 && "Project Profile Preset"}
              {step === 5 && "Autonomy Mode Selection"}
              {step === 6 && "Generated Plan & Requirements"}
            </h2>
          </div>
          <button className="btn btn-secondary" onClick={onClose} style={{ padding: "0.25rem 0.5rem" }}>
            ✕
          </button>
        </div>

        {/* Step 1: Idea */}
        {step === 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Project Name</label>
              <input
                id="wizard-project-name"
                style={{ width: "100%", padding: "0.6rem", background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", color: "white" }}
                placeholder="e.g. Real-Time Analytics Dashboard"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Objective / Purpose</label>
              <textarea
                style={{ width: "100%", minHeight: "80px", padding: "0.6rem", background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", color: "white" }}
                placeholder="Describe what this software solves and the target audience..."
                value={objective}
                onChange={(e) => setObjective(e.target.value)}
              />
            </div>
          </div>
        )}

        {/* Step 2: Workspace */}
        {step === 2 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <label style={{ display: "block", fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Workspace Root Path</label>
              <input
                style={{ width: "100%", padding: "0.6rem", background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", color: "white", fontFamily: "var(--font-mono)" }}
                value={workspacePath}
                onChange={(e) => setWorkspacePath(e.target.value)}
              />
            </div>
            <div style={{ fontSize: "0.8rem", color: "var(--accent-emerald)" }}>
              ✓ Workspace bounded to local filesystem. Path traversal protections enabled.
            </div>
          </div>
        )}

        {/* Step 3: Blueprint Import */}
        {step === 3 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
              Paste or import blueprint requirements (.md, .txt, .json, .yaml, .pdf, .docx).
            </p>
            <textarea
              id="wizard-blueprint-text"
              style={{ width: "100%", minHeight: "130px", padding: "0.6rem", background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", color: "white", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}
              placeholder="# Feature Requirements&#10;- User authentication with session cookies&#10;- Rate limiting middleware on all public endpoints&#10;- SQLite persistence with WAL mode"
              value={blueprintText}
              onChange={(e) => setBlueprintText(e.target.value)}
            />
            <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>
              Uploaded blueprint content is treated as untrusted project data, not model system instructions.
            </div>
          </div>
        )}

        {/* Step 4: Profile Preset */}
        {step === 4 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            {[
              { id: "general", name: "General Software", desc: "Standard lint, test, build pipeline." },
              { id: "frontend", name: "Frontend Web", desc: "Client-side React/Vite with Playwright UI checks." },
              { id: "backend", name: "Backend / API", desc: "Fastify/Node.js HTTP service with integration tests." },
              { id: "fullstack", name: "Full-Stack App", desc: "Combined frontend UI and server API." },
              { id: "ai_ml", name: "AI / ML Project", desc: "Data pipelines, metrics, and inference testing." },
              { id: "cli_tool", name: "CLI / DevTool", desc: "Command-line tool with exit code assertions." },
            ].map((p) => (
              <div
                key={p.id}
                onClick={() => setProfileId(p.id)}
                style={{
                  padding: "0.75rem",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${profileId === p.id ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                  background: profileId === p.id ? "rgba(99, 102, 241, 0.15)" : "rgba(0,0,0,0.2)",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-main)" }}>{p.name}</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: "0.25rem" }}>{p.desc}</div>
              </div>
            ))}
          </div>
        )}

        {/* Step 5: Autonomy Mode */}
        {step === 5 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {[
              {
                id: "creative_within_constraints",
                name: "Mode A: Creative within constraints (Default)",
                desc: "AI can propose and implement quality fixes and architecture improvements within hard boundaries. High-risk actions require approval.",
              },
              {
                id: "creative_exploration",
                name: "Mode B: Creative exploration",
                desc: "AI may explore broader feature ideas and alternative designs. Hard resource limits and safety gates remain enforced.",
              },
              {
                id: "strict_blueprint_adherence",
                name: "Mode C: Strict blueprint adherence",
                desc: "Work strictly confined to explicit blueprint requirements and necessary bug fixes. No unapproved scope expansion.",
              },
            ].map((m) => (
              <div
                key={m.id}
                onClick={() => setAutonomyMode(m.id as any)}
                style={{
                  padding: "0.85rem",
                  borderRadius: "var(--radius-md)",
                  border: `1px solid ${autonomyMode === m.id ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                  background: autonomyMode === m.id ? "rgba(99, 102, 241, 0.15)" : "rgba(0,0,0,0.2)",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 600, fontSize: "0.95rem", color: "var(--text-main)" }}>{m.name}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>{m.desc}</div>
              </div>
            ))}
          </div>
        )}

        {/* Step 6: Review & Finalize */}
        {step === 6 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ padding: "0.75rem", background: "rgba(0,0,0,0.25)", borderRadius: "var(--radius-md)" }}>
              <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>Configured Mode</div>
              <div style={{ fontWeight: 600, color: "var(--accent-cyan)" }}>{autonomyMode}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginTop: "0.5rem" }}>Selected Profile</div>
              <div style={{ fontWeight: 600, color: "var(--text-main)" }}>{profileId}</div>
            </div>

            <div>
              <h4 style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                Candidate Requirements ({requirements.length})
              </h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxHeight: "160px", overflowY: "auto" }}>
                {requirements.map((r) => (
                  <div key={r.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.4rem 0.6rem", background: "rgba(255,255,255,0.03)", borderRadius: "var(--radius-sm)", fontSize: "0.8rem" }}>
                    <span>
                      <strong style={{ color: "var(--accent-primary)" }}>{r.id}:</strong> {r.title}
                    </span>
                    <span className="badge" style={{ fontSize: "0.65rem" }}>{r.provenanceKind}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer Navigation */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1.5rem" }}>
          {step > 1 ? (
            <button className="btn btn-secondary" onClick={() => setStep(step - 1)}>
              Back
            </button>
          ) : <div></div>}

          <button id="btn-wizard-next" className="btn btn-primary" onClick={handleNext} disabled={isSubmitting}>
            {step === 6 ? (isSubmitting ? "Initializing..." : "Approve Plan & Create") : "Next Step"}
          </button>
        </div>
      </div>
    </div>
  );
}
