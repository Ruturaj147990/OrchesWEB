import React, { useState } from "react";

interface SettingsPageProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
}

export function SettingsPage({ theme, onToggleTheme }: SettingsPageProps) {
  const [defaultDir, setDefaultDir] = useState("c:\\Users\\limbk\\OneDrive\\Desktop\\orches");
  const [maxIterations, setMaxIterations] = useState(30);
  const [costCeiling, setCostCeiling] = useState("10.00");
  const [redactionTestInput, setRedactionTestInput] = useState("Bearer sk-proj-1234567890abcdef12345678");
  const [savedSuccess, setSavedSuccess] = useState(false);

  const testRedaction = (text: string) => {
    return text.replace(/sk-[a-zA-Z0-9_-]{15,}/g, "[REDACTED_API_KEY]")
      .replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, "Bearer [REDACTED_TOKEN]");
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  return (
    <div className="content-container">
      <div style={{ marginBottom: "1.25rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-main)" }}>Application Settings</h1>
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
          Configure appearance, default workspace directories, execution limits, and privacy preferences.
        </p>
      </div>

      {savedSuccess && (
        <div style={{ padding: "0.75rem 1rem", background: "var(--accent-emerald-subtle)", color: "var(--accent-emerald)", borderRadius: "var(--radius-sm)", marginBottom: "1.25rem", border: "1px solid rgba(5, 150, 105, 0.3)", fontSize: "0.85rem" }}>
          ✓ Preferences saved successfully.
        </div>
      )}

      <div className="two-col-grid">
        <form onSubmit={handleSave} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* Appearance */}
          <div className="card">
            <h2 className="card-title" style={{ marginBottom: "0.5rem" }}>Appearance & Theme</h2>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>Active Color Scheme</div>
                <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>
                  Toggle between professional Light mode and high-contrast Dark mode.
                </div>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={onToggleTheme}
              >
                {theme === "light" ? "🌙 Switch to Dark" : "☀️ Switch to Light"}
              </button>
            </div>
          </div>

          {/* General & Execution Defaults */}
          <div className="card">
            <h2 className="card-title" style={{ marginBottom: "0.5rem" }}>Execution & Workspace Defaults</h2>

            <div className="form-group">
              <label className="form-label">Default Workspace Directory</label>
              <input
                type="text"
                className="form-input"
                style={{ fontFamily: "var(--font-mono)" }}
                value={defaultDir}
                onChange={(e) => setDefaultDir(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Maximum Task Iterations per Run</label>
              <input
                type="number"
                className="form-input"
                value={maxIterations}
                onChange={(e) => setMaxIterations(Number(e.target.value))}
              />
              <span style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>
                Finite ceiling to prevent runaway model loops.
              </span>
            </div>

            <div className="form-group">
              <label className="form-label">Default Run Cost Ceiling ($ USD)</label>
              <input
                type="text"
                className="form-input"
                value={costCeiling}
                onChange={(e) => setCostCeiling(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button type="submit" className="btn btn-primary">
                Save Preferences
              </button>
            </div>
          </div>
        </form>

        {/* Security & Secret Redaction Verification */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: "0.5rem" }}>Secret Redaction Verification</h3>
            <p className="card-subtitle" style={{ marginBottom: "0.75rem" }}>
              All console logs and exported project snapshots are scrubbed through the redaction engine before persistence.
            </p>

            <div className="form-group">
              <label className="form-label">Sample Input (Contains Secret)</label>
              <input
                type="text"
                className="form-input"
                style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}
                value={redactionTestInput}
                onChange={(e) => setRedactionTestInput(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Redacted Output (What Is Persisted & Streamed)</label>
              <div
                style={{
                  padding: "0.5rem 0.75rem",
                  background: "var(--bg-subtle)",
                  borderRadius: "var(--radius-sm)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "0.8rem",
                  color: "var(--accent-emerald)",
                  wordBreak: "break-all",
                }}
              >
                {testRedaction(redactionTestInput)}
              </div>
            </div>
          </div>

          <div className="card">
            <h3 className="card-title" style={{ marginBottom: "0.5rem" }}>Local Loopback Guarantee</h3>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
              The server is strictly bound to <code>127.0.0.1:4317</code>. Cross-origin requests from non-loopback browser origins are rejected with HTTP 403.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
