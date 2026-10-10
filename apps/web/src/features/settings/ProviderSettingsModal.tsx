import React from "react";

interface ProviderSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ProviderSettingsModal({ isOpen, onClose }: ProviderSettingsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 100 }}>
      <div
        className="glass-card modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "720px",
          maxWidth: "95vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          padding: "1.5rem",
          overflowY: "auto",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-subtle)", paddingBottom: "0.75rem", marginBottom: "1rem" }}>
          <div>
            <h2 style={{ fontSize: "1.2rem", fontWeight: 600, color: "var(--text-main)" }}>
              Provider, Privacy & Security Settings
            </h2>
            <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>
              Audited system configurations and policy boundaries
            </div>
          </div>
          <button
            className="btn btn-secondary"
            onClick={onClose}
            style={{ padding: "0.3rem 0.6rem", fontSize: "0.85rem" }}
          >
            ✕
          </button>
        </div>

        {/* Section 1: Privacy Classification */}
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.8rem", color: "var(--accent-cyan)", textTransform: "uppercase", fontWeight: 600, marginBottom: "0.5rem" }}>
            Honest Privacy Classification
          </div>
          <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <span className="badge badge-unknown" style={{ background: "rgba(245, 158, 11, 0.15)", color: "var(--accent-amber)" }}>
                HYBRID (NOT END-TO-END OFFLINE)
              </span>
            </div>
            <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
              While the Reasoning Engine (Planner & Critic) communicates solely with local inference at <code style={{ color: "var(--accent-cyan)" }}>127.0.0.1:11434</code>, the coding agent is dispatched to Antigravity CLI (<code style={{ color: "var(--accent-cyan)" }}>agy</code>), which requires external connectivity for cloud model orchestration. The orchestrator transparently and honestly reflects this as <strong>Hybrid</strong>.
            </p>
          </div>
        </div>

        {/* Section 2: Active Reasoning & Coding Adapters */}
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.8rem", color: "var(--accent-cyan)", textTransform: "uppercase", fontWeight: 600, marginBottom: "0.5rem" }}>
            Engine Capabilities & Endpoints
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
            <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", padding: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>Reasoning Engine</span>
                <span className="badge badge-local" style={{ fontSize: "0.65rem" }}>LOCAL</span>
              </div>
              <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-main)" }}>OpenAI-Compatible Local</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginTop: "0.25rem" }}>
                Endpoint: 127.0.0.1:11434/v1<br />
                Model: llama3.1:8b
              </div>
            </div>

            <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", padding: "0.75rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
                <span style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>Coding Agent</span>
                <span className="badge" style={{ fontSize: "0.65rem", background: "rgba(99,102,241,0.2)", color: "var(--accent-primary)" }}>AGENT</span>
              </div>
              <div style={{ fontWeight: 600, fontSize: "0.9rem", color: "var(--text-main)" }}>Antigravity CLI (agy)</div>
              <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginTop: "0.25rem" }}>
                Execution: Headless Process<br />
                Process Tree Supervisor: Active
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: Hard Spending & Safety Limits */}
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.8rem", color: "var(--accent-cyan)", textTransform: "uppercase", fontWeight: 600, marginBottom: "0.5rem" }}>
            Hard Budgets & Guardrails
          </div>
          <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", padding: "0.75rem", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem", textAlign: "center" }}>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>Per-Task Warning</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--accent-amber)" }}>$0.50</div>
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>Per-Task Hard Cap</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--accent-rose)" }}>$2.00</div>
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>Run Hard Ceiling</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--accent-rose)" }}>$10.00</div>
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>Max Iterations</div>
              <div style={{ fontSize: "1.1rem", fontWeight: 600, color: "var(--accent-cyan)" }}>30</div>
            </div>
          </div>
        </div>

        {/* Section 4: Loopback Security & Origin Policy */}
        <div>
          <div style={{ fontSize: "0.8rem", color: "var(--accent-cyan)", textTransform: "uppercase", fontWeight: 600, marginBottom: "0.5rem" }}>
            Loopback & Network Security
          </div>
          <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", padding: "0.75rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
              <span>Strict Host Binding:</span>
              <span style={{ color: "var(--accent-emerald)", fontFamily: "var(--font-mono)" }}>127.0.0.1 (Loopback only)</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4rem" }}>
              <span>CORS & Origin Checks:</span>
              <span style={{ color: "var(--accent-emerald)" }}>Enforced (Non-loopback origins rejected)</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Secret Redaction:</span>
              <span style={{ color: "var(--accent-emerald)" }}>Active on Exports & Logs</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
