import React, { useState, useEffect } from "react";

interface ProviderSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProviderChanged?: (provider: { id: string; displayName: string; privacyClass: string }) => void;
}

export function ProviderSettingsModal({ isOpen, onClose, onProviderChanged }: ProviderSettingsModalProps) {
  const [activeProviderId, setActiveProviderId] = useState<string>("openai-compatible-local");
  const [selectedProvider, setSelectedProvider] = useState<"openai-compatible-local" | "openai">("openai-compatible-local");
  const [apiKey, setApiKey] = useState<string>("");
  const [model, setModel] = useState<string>("gpt-4o-mini");
  const [hasEnvKey, setHasEnvKey] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setFeedback(null);
    fetch("/api/v1/providers/reasoning")
      .then((res) => res.json())
      .then((data) => {
        setActiveProviderId(data.activeProviderId);
        setSelectedProvider(data.activeProviderId);
        setHasEnvKey(data.hasOpenAiKey);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load providers:", err);
        setLoading(false);
      });
  }, [isOpen]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFeedback(null);

    try {
      const res = await fetch("/api/v1/providers/reasoning/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: selectedProvider,
          apiKey: apiKey.trim() || undefined,
          model,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to switch provider");
      }

      setActiveProviderId(data.activeProviderId);
      setHasEnvKey(data.hasOpenAiKey);
      setFeedback({
        type: "success",
        text: `Switched reasoning engine to ${data.activeProvider.displayName} (${data.activeProvider.id === "openai" ? model : "llama3.1:8b"}).`,
      });

      if (onProviderChanged) {
        onProviderChanged(data.activeProvider);
      }
    } catch (err: unknown) {
      setFeedback({
        type: "error",
        text: (err as Error).message,
      });
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 100 }}>
      <div
        className="glass-card modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "750px",
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
              Reasoning Engine & Provider Settings
            </h2>
            <div style={{ fontSize: "0.75rem", color: "var(--text-dim)" }}>
              Switch between Local Ollama and OpenAI Cloud API directly from the dashboard
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

        {feedback && (
          <div
            style={{
              padding: "0.75rem 1rem",
              borderRadius: "var(--radius-sm)",
              marginBottom: "1rem",
              fontSize: "0.85rem",
              background: feedback.type === "success" ? "rgba(16, 185, 129, 0.15)" : "rgba(244, 63, 94, 0.15)",
              border: `1px solid ${feedback.type === "success" ? "var(--accent-emerald)" : "var(--accent-rose)"}`,
              color: feedback.type === "success" ? "var(--accent-emerald)" : "var(--accent-rose)",
            }}
          >
            {feedback.text}
          </div>
        )}

        {/* Section 1: Provider Switcher Form */}
        <form onSubmit={handleSave} style={{ marginBottom: "1.5rem" }}>
          <div style={{ fontSize: "0.8rem", color: "var(--accent-cyan)", textTransform: "uppercase", fontWeight: 600, marginBottom: "0.75rem" }}>
            Select Active Reasoning Engine
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
            {/* Option A: Local Ollama */}
            <div
              onClick={() => setSelectedProvider("openai-compatible-local")}
              style={{
                background: selectedProvider === "openai-compatible-local" ? "rgba(16, 185, 129, 0.08)" : "rgba(0,0,0,0.25)",
                border: `2px solid ${selectedProvider === "openai-compatible-local" ? "var(--accent-emerald)" : "var(--border-subtle)"}`,
                borderRadius: "var(--radius-md)",
                padding: "1rem",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <span style={{ fontWeight: 600, color: "var(--text-main)", fontSize: "0.95rem" }}>
                  Local Inference (Ollama)
                </span>
                <span className="badge badge-local" style={{ fontSize: "0.65rem" }}>LOCAL</span>
              </div>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
                Connects to local server at <code>127.0.0.1:11434</code>. 100% offline reasoning with zero cloud API token billing.
              </p>
              {activeProviderId === "openai-compatible-local" && (
                <div style={{ marginTop: "0.5rem", fontSize: "0.7rem", color: "var(--accent-emerald)", fontWeight: 600 }}>
                  ● Currently Active
                </div>
              )}
            </div>

            {/* Option B: OpenAI Cloud API */}
            <div
              onClick={() => setSelectedProvider("openai")}
              style={{
                background: selectedProvider === "openai" ? "rgba(99, 102, 241, 0.08)" : "rgba(0,0,0,0.25)",
                border: `2px solid ${selectedProvider === "openai" ? "var(--accent-primary)" : "var(--border-subtle)"}`,
                borderRadius: "var(--radius-md)",
                padding: "1rem",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                <span style={{ fontWeight: 600, color: "var(--text-main)", fontSize: "0.95rem" }}>
                  OpenAI Cloud API
                </span>
                <span className="badge badge-unknown" style={{ fontSize: "0.65rem" }}>CLOUD</span>
              </div>
              <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
                Direct API calls to OpenAI models (GPT-4o, GPT-4o-mini). Tracks real token usage against your hard spend caps.
              </p>
              {activeProviderId === "openai" && (
                <div style={{ marginTop: "0.5rem", fontSize: "0.7rem", color: "var(--accent-primary)", fontWeight: 600 }}>
                  ● Currently Active
                </div>
              )}
            </div>
          </div>

          {/* OpenAI Configuration Fields (shown when OpenAI is selected) */}
          {selectedProvider === "openai" && (
            <div
              style={{
                background: "rgba(0,0,0,0.35)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md)",
                padding: "1rem",
                marginBottom: "1rem",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-dim)", marginBottom: "0.3rem" }}>
                  OpenAI API Key {hasEnvKey && <span style={{ color: "var(--accent-emerald)" }}>(Already set in .env)</span>}
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasEnvKey ? "•••••••••••••••••••••••••• (Configured via env - enter new key to override)" : "sk-proj-..."}
                  style={{
                    width: "100%",
                    background: "#070a10",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text-main)",
                    padding: "0.5rem 0.75rem",
                    fontSize: "0.85rem",
                    fontFamily: "var(--font-mono)",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-dim)", marginBottom: "0.3rem" }}>
                  Reasoning Model
                </label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  style={{
                    width: "100%",
                    background: "#070a10",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-sm)",
                    color: "var(--text-main)",
                    padding: "0.5rem 0.75rem",
                    fontSize: "0.85rem",
                  }}
                >
                  <option value="gpt-4o-mini">gpt-4o-mini (Fast, cost-effective default)</option>
                  <option value="gpt-4o">gpt-4o (High-intelligence multimodal reasoning)</option>
                  <option value="o1-mini">o1-mini (Advanced STEM reasoning)</option>
                </select>
              </div>
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              style={{ fontSize: "0.85rem" }}
            >
              Close
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
              style={{ fontSize: "0.85rem", padding: "0.5rem 1.25rem" }}
            >
              {saving ? "Switching..." : `Apply & Switch to ${selectedProvider === "openai" ? "OpenAI Cloud" : "Local Ollama"}`}
            </button>
          </div>
        </form>

        {/* Section 2: Privacy Notice */}
        <div style={{ marginBottom: "1.25rem" }}>
          <div style={{ fontSize: "0.8rem", color: "var(--accent-cyan)", textTransform: "uppercase", fontWeight: 600, marginBottom: "0.5rem" }}>
            Privacy Classification Breakdown
          </div>
          <div style={{ background: "rgba(0,0,0,0.3)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "0.85rem", fontSize: "0.82rem", color: "var(--text-muted)", lineHeight: 1.5 }}>
            <div style={{ marginBottom: "0.4rem" }}>
              <strong>When using Local Ollama:</strong> Reasoning is 100% loopback local. Coding agent uses Antigravity CLI (Hybrid).
            </div>
            <div>
              <strong>When using OpenAI Cloud API:</strong> High-level planning prompts and critic evaluations communicate directly with OpenAI's cloud endpoint.
            </div>
          </div>
        </div>

        {/* Section 3: Hard Spending & Safety Limits */}
        <div>
          <div style={{ fontSize: "0.8rem", color: "var(--accent-cyan)", textTransform: "uppercase", fontWeight: 600, marginBottom: "0.5rem" }}>
            Active Safety & Spend Ceilings
          </div>
          <div style={{ background: "rgba(0,0,0,0.25)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", padding: "0.75rem", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.5rem", textAlign: "center" }}>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>Per-Task Warning</div>
              <div style={{ fontSize: "1.05rem", fontWeight: 600, color: "var(--accent-amber)" }}>$0.50</div>
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>Per-Task Hard Cap</div>
              <div style={{ fontSize: "1.05rem", fontWeight: 600, color: "var(--accent-rose)" }}>$2.00</div>
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>Run Hard Ceiling</div>
              <div style={{ fontSize: "1.05rem", fontWeight: 600, color: "var(--accent-rose)" }}>$10.00</div>
            </div>
            <div>
              <div style={{ fontSize: "0.7rem", color: "var(--text-dim)" }}>Max Iterations</div>
              <div style={{ fontSize: "1.05rem", fontWeight: 600, color: "var(--accent-cyan)" }}>30</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
