import React, { useState } from "react";
import { ProjectData } from "../types";

interface PoliciesPageProps {
  project: ProjectData | null;
  onProjectUpdated?: (p: ProjectData) => void;
}

export function PoliciesPage({ project, onProjectUpdated }: PoliciesPageProps) {
  const [selectedProfile, setSelectedProfile] = useState("fullstack-ts-react");
  const [selectedAutonomy, setSelectedAutonomy] = useState(
    project?.autonomyMode || "creative_within_constraints"
  );
  const [maxRetries, setMaxRetries] = useState(3);
  const [costCap, setCostCap] = useState("10.00");
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const PROFILES = [
    {
      id: "fullstack-ts-react",
      name: "Full-Stack TypeScript & React",
      description: "Optimized for modern Web apps with Vitest, TypeScript verification, and Playwright browser verifiers.",
      verifiers: ["npm test", "npx tsc --noEmit", "npx eslint"],
    },
    {
      id: "node-backend",
      name: "Node.js & Fastify Backend",
      description: "Focused on API routes, database migrations, and schema validation with strict path boundaries.",
      verifiers: ["npm test", "npm run build"],
    },
    {
      id: "python-data",
      name: "Python & Data Engineering",
      description: "Enforces pytest, mypy, and flake8 assertions for Python libraries and services.",
      verifiers: ["pytest", "mypy .", "flake8"],
    },
    {
      id: "strict-blueprint",
      name: "Strict Blueprint Adherence",
      description: "Zero autonomous deviations allowed. Every task must cite an approved blueprint requirement ID.",
      verifiers: ["npm test", "blueprint-traceability-gate"],
    },
  ];

  const handleSave = async () => {
    if (!project) return;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const res = await fetch(`/api/v1/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autonomyMode: selectedAutonomy,
        }),
      });
      if (res.ok) {
        const updated = await res.json();
        setSaveSuccess(true);
        if (onProjectUpdated) onProjectUpdated(updated);
      }
    } catch (err) {
      console.error("Save policy error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="content-container">
      <div style={{ marginBottom: "1.25rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-main)" }}>
          Policies & Profile Presets
        </h1>
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
          Configure autonomy modes, protected file boundaries, verifier acceptance gates, and budget guardrails.
        </p>
      </div>

      {saveSuccess && (
        <div style={{ padding: "0.75rem 1rem", background: "var(--accent-emerald-subtle)", color: "var(--accent-emerald)", borderRadius: "var(--radius-sm)", marginBottom: "1.25rem", border: "1px solid rgba(5, 150, 105, 0.3)", fontSize: "0.85rem" }}>
          ✓ Policy settings updated successfully for project: {project?.name}
        </div>
      )}

      <div className="two-col-grid">
        {/* Policy Configuration Controls */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Autonomy Mode */}
          <div className="card">
            <h2 className="card-title" style={{ marginBottom: "0.5rem" }}>Autonomy Operating Mode</h2>
            <p className="card-subtitle" style={{ marginBottom: "1rem" }}>
              Controls how much architectural freedom the reasoning brain has when decomposing tasks.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {[
                {
                  id: "strict_blueprint_adherence",
                  name: "Strict Blueprint Adherence",
                  desc: "Zero hallucination or creative feature addition. Every file edit must trace directly to a verified requirement citation.",
                  badge: "Highest Safety",
                },
                {
                  id: "creative_within_constraints",
                  name: "Creative Within Constraints (Recommended)",
                  desc: "Allows the planner to propose missing helper utilities and edge-case unit tests while strictly observing path boundaries and budgets.",
                  badge: "Balanced",
                },
                {
                  id: "creative_exploration",
                  name: "Creative Exploration",
                  desc: "Exploratory prototyping mode. Generates novel features and architecture alternatives with human approval required at milestones.",
                  badge: "Experimental",
                },
              ].map((m) => (
                <div
                  key={m.id}
                  onClick={() => setSelectedAutonomy(m.id)}
                  style={{
                    padding: "0.85rem",
                    borderRadius: "var(--radius-sm)",
                    border: `1px solid ${selectedAutonomy === m.id ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                    background: selectedAutonomy === m.id ? "var(--accent-primary-subtle)" : "var(--bg-subtle)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontWeight: 600, color: "var(--text-main)" }}>{m.name}</span>
                    <span className="badge badge-info">{m.badge}</span>
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginTop: "0.25rem" }}>
                    {m.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Profile Preset Selection */}
          <div className="card">
            <h2 className="card-title" style={{ marginBottom: "0.5rem" }}>Project Profile Preset</h2>
            <p className="card-subtitle" style={{ marginBottom: "1rem" }}>
              Presets inject recommended verifiers, lint configurations, and path policies.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              {PROFILES.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setSelectedProfile(p.id)}
                  style={{
                    padding: "0.75rem",
                    borderRadius: "var(--radius-sm)",
                    border: `1px solid ${selectedProfile === p.id ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                    background: selectedProfile === p.id ? "var(--accent-primary-subtle)" : "var(--bg-subtle)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>{p.name}</div>
                  <div style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: "0.25rem" }}>
                    {p.description}
                  </div>
                  <div style={{ marginTop: "0.5rem", display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                    {p.verifiers.map((v, i) => (
                      <span key={i} className="badge" style={{ fontSize: "0.65rem" }}>
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.25rem" }}>
              <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Policy Settings"}
              </button>
            </div>
          </div>
        </div>

        {/* Deterministic Guardrails Panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Protected File Paths */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: "0.5rem" }}>Protected Path Boundaries</h3>
            <p className="card-subtitle" style={{ marginBottom: "0.75rem" }}>
              Enforced by PathPolicy outside the model. Modifications to these patterns are rejected deterministically.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {[
                { pattern: ".env*", desc: "Secrets and private environment configurations" },
                { pattern: ".git/**", desc: "Internal version control metadata" },
                { pattern: "node_modules/**", desc: "Package dependencies" },
                { pattern: "**/*.pem, **/*.key", desc: "Cryptographic credentials and private keys" },
                { pattern: "package-lock.json", desc: "Monorepo dependency lockfile" },
              ].map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "0.4rem 0.6rem",
                    background: "var(--bg-subtle)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "0.78rem",
                  }}
                >
                  <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--accent-rose)" }}>
                    {item.pattern}
                  </span>
                  <span style={{ color: "var(--text-dim)" }}>{item.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bounded Retries & Circuit Breaker */}
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: "0.5rem" }}>Bounded Retries & Budget Caps</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.85rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-dim)" }}>Max Repair Attempts per Task:</span>
                <span style={{ fontWeight: 600 }}>{maxRetries} (1 initial + 2 repairs)</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-dim)" }}>Run Cost Ceiling:</span>
                <span style={{ fontWeight: 600, color: "var(--accent-emerald)" }}>${costCap} USD</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-dim)" }}>Anti-Stagnation Circuit Breaker:</span>
                <span className="badge badge-success">Active (Ping-Pong Edit Trap)</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
