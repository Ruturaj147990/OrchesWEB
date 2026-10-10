import React, { useState, useEffect } from "react";

interface ProviderInfo {
  id: string;
  displayName: string;
  privacyClass: string;
  configured: boolean;
}

interface ProvidersPageProps {
  onProviderChanged?: (provider: { id: string; displayName: string; privacyClass: string }) => void;
}

export function ProvidersPage({ onProviderChanged }: ProvidersPageProps) {
  const [activeProviderId, setActiveProviderId] = useState("openai-compatible-local");
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [savedApiKey, setSavedApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-4o-mini");
  const [localUrl, setLocalUrl] = useState("http://127.0.0.1:11434/v1");
  const [localModel, setLocalModel] = useState("llama3.1:8b");
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; message: string; latencyMs?: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/v1/providers/reasoning")
      .then((res) => res.json())
      .then((data) => {
        setActiveProviderId(data.activeProviderId || "openai-compatible-local");
        setProviders(data.providers || []);
        if (data.savedApiKey) {
          setSavedApiKey(data.savedApiKey);
          setApiKeyInput(data.savedApiKey);
        }
        if (data.savedModel) {
          setSelectedModel(data.savedModel);
        }
      })
      .catch((err) => console.error("Providers fetch error:", err));
  }, []);

  const handleTestKey = async () => {
    setIsVerifying(true);
    setVerifyResult(null);
    try {
      const res = await fetch("/api/v1/providers/reasoning/verify-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setVerifyResult({
          valid: true,
          message: `API Key verified successfully! Available models: ${data.models?.slice(0, 3).join(", ") || "gpt-4o, gpt-4o-mini"}`,
        });
      } else {
        setVerifyResult({
          valid: false,
          message: data.error || "API Key verification failed.",
        });
      }
    } catch (err: unknown) {
      setVerifyResult({
        valid: false,
        message: (err as Error).message || "Connection to OpenAI verification endpoint failed.",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSelectProvider = async (providerId: "openai" | "openai-compatible-local") => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const res = await fetch("/api/v1/providers/reasoning/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId,
          apiKey: providerId === "openai" ? apiKeyInput.trim() : undefined,
          model: providerId === "openai" ? selectedModel : localModel,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setActiveProviderId(providerId);
        setSaveSuccess(true);
        if (onProviderChanged && data.activeProvider) {
          onProviderChanged(data.activeProvider);
        }
      } else {
        alert(data.error || "Failed to switch provider");
      }
    } catch (err) {
      alert("Error saving provider configuration");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="content-container">
      <div style={{ marginBottom: "1.25rem" }}>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 700, color: "var(--text-main)" }}>
          Reasoning Providers & Model Engines
        </h1>
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>
          Configure the LLM reasoning brain responsible for roadmap decomposition and adversarial Critic reviews.
        </p>
      </div>

      {saveSuccess && (
        <div style={{ padding: "0.75rem 1rem", background: "var(--accent-emerald-subtle)", color: "var(--accent-emerald)", borderRadius: "var(--radius-sm)", marginBottom: "1.25rem", border: "1px solid rgba(5, 150, 105, 0.3)", fontSize: "0.85rem" }}>
          ✓ Provider configuration saved and active! All subsequent task planning will use this provider.
        </div>
      )}

      <div className="two-col-grid">
        {/* Provider Cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          {/* OpenAI Cloud Provider */}
          <div className="card" style={activeProviderId === "openai" ? { borderColor: "var(--accent-primary)", boxShadow: "var(--shadow-md)" } : {}}>
            <div className="card-header">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <h2 className="card-title">OpenAI Reasoning (Cloud)</h2>
                  {activeProviderId === "openai" && <span className="badge badge-success">ACTIVE</span>}
                </div>
                <div className="card-subtitle">Remote cloud reasoning via official OpenAI API</div>
              </div>
              <span className="badge badge-warning">Network Egress Required</span>
            </div>

            <div className="form-group">
              <label className="form-label">OpenAI API Key (sk-...)</label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <input
                  type="password"
                  className="form-input"
                  style={{ flex: 1, fontFamily: "var(--font-mono)" }}
                  placeholder="sk-proj-..."
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                />
                <button
                  className="btn btn-secondary"
                  onClick={handleTestKey}
                  disabled={isVerifying || !apiKeyInput.trim()}
                >
                  {isVerifying ? "Verifying..." : "Test Key"}
                </button>
              </div>
            </div>

            {verifyResult && (
              <div
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "var(--radius-sm)",
                  fontSize: "0.8rem",
                  marginBottom: "1rem",
                  background: verifyResult.valid ? "var(--accent-emerald-subtle)" : "var(--accent-rose-subtle)",
                  color: verifyResult.valid ? "var(--accent-emerald)" : "var(--accent-rose)",
                }}
              >
                {verifyResult.message}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Model Selection</label>
              <select
                className="form-select"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                <option value="gpt-4o-mini">gpt-4o-mini (Fast & Cost Effective)</option>
                <option value="gpt-4o">gpt-4o (High Accuracy Architecture)</option>
                <option value="o3-mini">o3-mini (High Reasoning)</option>
              </select>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button
                className="btn btn-primary"
                onClick={() => handleSelectProvider("openai")}
                disabled={isSaving || !apiKeyInput.trim()}
              >
                {activeProviderId === "openai" ? "Save OpenAI Configuration" : "Switch to OpenAI Cloud"}
              </button>
            </div>
          </div>

          {/* Local / Ollama Provider */}
          <div className="card" style={activeProviderId === "openai-compatible-local" ? { borderColor: "var(--accent-primary)", boxShadow: "var(--shadow-md)" } : {}}>
            <div className="card-header">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <h2 className="card-title">OpenAI-Compatible Local (Ollama / LM Studio)</h2>
                  {activeProviderId === "openai-compatible-local" && <span className="badge badge-success">ACTIVE</span>}
                </div>
                <div className="card-subtitle">Zero data leaves this machine. Complete offline privacy.</div>
              </div>
              <span className="badge badge-local">100% Loopback Local</span>
            </div>

            <div className="form-group">
              <label className="form-label">Local Base URL</label>
              <input
                type="text"
                className="form-input"
                style={{ fontFamily: "var(--font-mono)" }}
                value={localUrl}
                onChange={(e) => setLocalUrl(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Local Model Name</label>
              <input
                type="text"
                className="form-input"
                style={{ fontFamily: "var(--font-mono)" }}
                value={localModel}
                onChange={(e) => setLocalModel(e.target.value)}
              />
              <span style={{ fontSize: "0.72rem", color: "var(--text-dim)" }}>
                e.g. llama3.1:8b, qwen2.5-coder:14b, codellama:13b
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
              <button
                className="btn btn-primary"
                onClick={() => handleSelectProvider("openai-compatible-local")}
                disabled={isSaving}
              >
                {activeProviderId === "openai-compatible-local" ? "Save Local Configuration" : "Switch to Local Mode"}
              </button>
            </div>
          </div>
        </div>

        {/* Privacy & Guarantees Panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
          <div className="card">
            <h3 className="card-title" style={{ marginBottom: "0.75rem" }}>Privacy & Egress Guarantees</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", fontSize: "0.85rem" }}>
              <div style={{ padding: "0.5rem", background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)" }}>
                <strong style={{ color: "var(--accent-emerald)" }}>✓ Zero Silent Cloud Fallback:</strong>
                <p style={{ fontSize: "0.78rem", color: "var(--text-dim)", marginTop: "0.2rem" }}>
                  When local mode is active, the orchestrator is architecturally prevented from falling back to cloud endpoints on failure.
                </p>
              </div>

              <div style={{ padding: "0.5rem", background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)" }}>
                <strong style={{ color: "var(--accent-emerald)" }}>✓ Secret Redactor Active:</strong>
                <p style={{ fontSize: "0.78rem", color: "var(--text-dim)", marginTop: "0.2rem" }}>
                  API keys, bearer tokens, and private keys are scrubbed by regular expressions before any event or export is written.
                </p>
              </div>

              <div style={{ padding: "0.5rem", background: "var(--bg-subtle)", borderRadius: "var(--radius-sm)" }}>
                <strong style={{ color: "var(--accent-emerald)" }}>✓ Local SQLite Storage:</strong>
                <p style={{ fontSize: "0.78rem", color: "var(--text-dim)", marginTop: "0.2rem" }}>
                  All task checkpoints and events are persisted in Node.js v24 native SQLite in WAL mode.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
