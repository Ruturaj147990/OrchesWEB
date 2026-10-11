import React, { useState, useEffect, useCallback } from "react";

export type ProviderId = "openai" | "openai-compatible-local";

export interface ProviderInfo {
  id: ProviderId;
  displayName: string;
  privacyClass: "local" | "cloud";
}

interface ReasoningEngineSelectorProps {
  onProviderChanged?: (provider: ProviderInfo) => void;
  onRequestOpenSettings?: () => void;
}

export function ReasoningEngineSelector({
  onProviderChanged,
  onRequestOpenSettings,
}: ReasoningEngineSelectorProps) {
  // Provider Selection State
  const [activeId, setActiveId] = useState<ProviderId>("openai-compatible-local");
  const [statusText, setStatusText] = useState<string>("Local Ollama · Checking...");
  const [statusState, setStatusState] = useState<"connected" | "warning" | "error" | "testing">("testing");

  // Configuration Drawer State
  const [isConfigOpen, setIsConfigOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<ProviderId>("openai-compatible-local");

  // OpenAI Config
  const [hasOpenAiKey, setHasEnvKey] = useState<boolean>(false);
  const [maskedApiKey, setMaskedApiKey] = useState<string>("");
  const [inputApiKey, setInputApiKey] = useState<string>("");
  const [openAiModel, setOpenAiModel] = useState<string>("gpt-4o-mini");
  const [openAiVerifying, setOpenAiVerifying] = useState<boolean>(false);
  const [openAiNotice, setOpenAiNotice] = useState<{ ok: boolean; message: string } | null>(null);

  // Ollama Config
  const [localBaseUrl, setLocalBaseUrl] = useState<string>("http://127.0.0.1:11434");
  const [localModel, setLocalModel] = useState<string>("llama3.1:8b");
  const [localTimeoutMs, setLocalTimeoutMs] = useState<number>(180000);
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [ollamaProbing, setOllamaProbing] = useState<boolean>(false);
  const [ollamaNotice, setOllamaNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const [saving, setSaving] = useState<boolean>(false);

  // 1. Initial Load & Provider Status Probe
  const refreshProviderState = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/providers/reasoning");
      if (!res.ok) throw new Error("Failed to load providers");
      const data = await res.json();

      const currentId: ProviderId = data.activeProviderId === "openai" ? "openai" : "openai-compatible-local";
      setActiveId(currentId);
      setActiveTab(currentId);
      setHasEnvKey(Boolean(data.hasOpenAiKey));
      setMaskedApiKey(data.maskedApiKey || "");
      if (data.savedModel) setOpenAiModel(data.savedModel);
      if (data.localConfig?.baseUrl) setLocalBaseUrl(data.localConfig.baseUrl);
      if (data.localConfig?.model) setLocalModel(data.localConfig.model);
      if (data.localConfig?.timeoutMs) setLocalTimeoutMs(data.localConfig.timeoutMs);

      // Inspect active health returned from backend
      if (currentId === "openai") {
        if (!data.hasOpenAiKey) {
          setStatusText("OpenAI API · Key required");
          setStatusState("warning");
        } else if (data.activeHealth?.ok) {
          setStatusText(`OpenAI API · Connected (${data.activeHealth.latencyMs || 0}ms)`);
          setStatusState("connected");
        } else if (data.activeHealth && !data.activeHealth.ok) {
          setStatusText("OpenAI API · Auth failed");
          setStatusState("error");
        } else {
          setStatusText("OpenAI API · Key configured");
          setStatusState("connected");
        }
      } else {
        if (data.activeHealth) {
          applyOllamaHealth(data.activeHealth, data.localConfig?.model || localModel);
        } else {
          probeOllama(data.localConfig?.baseUrl, data.localConfig?.model);
        }
      }
    } catch (err) {
      setStatusText("Reasoning · Disconnected");
      setStatusState("error");
    }
  }, []);

  const applyOllamaHealth = (data: any, targetModel: string) => {
    if (data.ok) {
      const models: string[] = data.discoveredModels || [];
      setDiscoveredModels(models);

      const target = targetModel || localModel;
      const modelPresent = models.length === 0 || models.some(
        (m) => m === target || m.startsWith(`${target}:`) || `${m}:latest` === target
      );

      if (modelPresent) {
        setStatusText(`Local Ollama · Ready (${data.latencyMs}ms)`);
        setStatusState("connected");
        setOllamaNotice({
          ok: true,
          message: `✓ Ollama server online${data.serverVersion ? ` (v${data.serverVersion})` : ""} (${data.latencyMs}ms). Model '${target}' is installed and ready for reasoning.`,
        });
      } else {
        setStatusText("Local Ollama · Model unavailable");
        setStatusState("warning");
        setOllamaNotice({
          ok: false,
          message: `⚠ Ollama online, but model '${target}' is not installed (${models.join(", ")}). Run '${data.installCommand || `ollama pull ${target}`}'.`,
        });
      }
    } else if (data.status === "model_unavailable") {
      const models: string[] = data.discoveredModels || [];
      setDiscoveredModels(models);
      setStatusText("Local Ollama · Model unavailable");
      setStatusState("warning");
      setOllamaNotice({
        ok: false,
        message: `⚠ ${data.message || `Model '${targetModel}' not in installed list.`}`,
      });
    } else {
      setStatusText("Local Ollama · Server unreachable");
      setStatusState("error");
      setOllamaNotice({
        ok: false,
        message: `✕ ${data.message || "Ollama server unreachable at " + localBaseUrl}`,
      });
    }
  };

  const probeOllama = async (url?: string, model?: string) => {
    setStatusText("Local Ollama · Testing connection");
    setStatusState("testing");
    setOllamaProbing(true);

    try {
      const res = await fetch("/api/v1/providers/reasoning/probe-local", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: url || localBaseUrl,
          model: model || localModel,
        }),
      });
      const data = await res.json();
      setOllamaProbing(false);
      applyOllamaHealth(data, model || localModel);
    } catch (err: unknown) {
      setOllamaProbing(false);
      setStatusText("Local Ollama · Server unreachable");
      setStatusState("error");
      setOllamaNotice({ ok: false, message: `✕ Network error: ${(err as Error).message}` });
    }
  };

  const [testGenerating, setTestGenerating] = useState<boolean>(false);

  const handleTestGeneration = async (targetId: ProviderId) => {
    setTestGenerating(true);
    try {
      const res = await fetch("/api/v1/providers/reasoning/test-generation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: targetId,
          model: targetId === "openai" ? openAiModel : localModel,
        }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        if (targetId === "openai") {
          setOpenAiNotice({
            ok: true,
            message: `✓ Live inference verified (${data.durationMs}ms): "${data.output}" [Usage: ${data.usage?.totalTokens || 0} tokens]`,
          });
        } else {
          setOllamaNotice({
            ok: true,
            message: `✓ Live local inference verified (${data.durationMs}ms): "${data.output}" [Usage: ${data.usage?.totalTokens || 0} tokens]`,
          });
        }
      } else {
        const errMsg = data.error || "Model test generation failed.";
        if (targetId === "openai") {
          setOpenAiNotice({ ok: false, message: `✕ Inference failed: ${errMsg}` });
        } else {
          setOllamaNotice({ ok: false, message: `✕ Inference failed: ${errMsg}` });
        }
      }
    } catch (err: unknown) {
      const errMsg = (err as Error).message;
      if (targetId === "openai") {
        setOpenAiNotice({ ok: false, message: `✕ Network error: ${errMsg}` });
      } else {
        setOllamaNotice({ ok: false, message: `✕ Network error: ${errMsg}` });
      }
    } finally {
      setTestGenerating(false);
    }
  };

  useEffect(() => {
    refreshProviderState();
  }, [refreshProviderState]);

  // 2. Switching Provider directly from the Segmented Toggle
  const handleSelectProvider = async (targetId: ProviderId) => {
    if (targetId === activeId) {
      // If clicking already selected provider, open its config drawer
      setActiveTab(targetId);
      setIsConfigOpen(true);
      return;
    }

    if (targetId === "openai" && !hasOpenAiKey && !inputApiKey.trim()) {
      // Need key: switch tab and open configuration drawer immediately
      setActiveTab("openai");
      setIsConfigOpen(true);
      setOpenAiNotice({ ok: false, message: "Please provide an OpenAI API key to activate OpenAI Cloud reasoning." });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/v1/providers/reasoning/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: targetId,
          model: targetId === "openai" ? openAiModel : localModel,
          baseUrl: targetId === "openai-compatible-local" ? localBaseUrl : undefined,
          timeoutMs: targetId === "openai-compatible-local" ? localTimeoutMs : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to switch provider");
      }

      setActiveId(targetId);
      if (onProviderChanged) {
        onProviderChanged(data.activeProvider);
      }

      if (targetId === "openai") {
        setStatusText("OpenAI API · Connected");
        setStatusState("connected");
      } else {
        probeOllama();
      }
    } catch (err: unknown) {
      alert(`Error switching provider: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  // 3. Quick Verify OpenAI Key
  const handleVerifyOpenAiKey = async () => {
    const keyToTest = inputApiKey.trim();
    if (!keyToTest) {
      setOpenAiNotice({ ok: false, message: "Please enter an API key to test." });
      return;
    }

    setOpenAiVerifying(true);
    setOpenAiNotice(null);
    try {
      const res = await fetch("/api/v1/providers/reasoning/verify-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: keyToTest }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setOpenAiNotice({ ok: true, message: "✓ Valid API key! Successfully connected to OpenAI API." });
      } else {
        setOpenAiNotice({ ok: false, message: `✕ ${data.error || "Verification failed."}` });
      }
    } catch (err: unknown) {
      setOpenAiNotice({ ok: false, message: `✕ Network probe error: ${(err as Error).message}` });
    } finally {
      setOpenAiVerifying(false);
    }
  };

  // 4. Save and Apply from Drawer
  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/v1/providers/reasoning/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerId: activeTab,
          apiKey: activeTab === "openai" && inputApiKey.trim() ? inputApiKey.trim() : undefined,
          model: activeTab === "openai" ? openAiModel : localModel,
          baseUrl: activeTab === "openai-compatible-local" ? localBaseUrl : undefined,
          timeoutMs: activeTab === "openai-compatible-local" ? Number(localTimeoutMs) : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save configuration");
      }

      setActiveId(activeTab);
      setHasEnvKey(Boolean(data.hasOpenAiKey));
      setMaskedApiKey(data.maskedApiKey || "");
      setInputApiKey(""); // clear raw key input once saved
      if (onProviderChanged) {
        onProviderChanged(data.activeProvider);
      }

      if (activeTab === "openai") {
        setStatusText("OpenAI API · Connected");
        setStatusState("connected");
        setOpenAiNotice({ ok: true, message: "✓ OpenAI Cloud reasoning settings saved and applied." });
      } else {
        setOllamaNotice({ ok: true, message: "✓ Local Ollama settings saved and applied." });
        probeOllama();
      }

      setTimeout(() => setIsConfigOpen(false), 1200);
    } catch (err: unknown) {
      if (activeTab === "openai") {
        setOpenAiNotice({ ok: false, message: `✕ ${(err as Error).message}` });
      } else {
        setOllamaNotice({ ok: false, message: `✕ ${(err as Error).message}` });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* ALWAYS-VISIBLE TOP BAR SEGMENTED REASONING SELECTOR */}
      <div className="reasoning-selector-container" id="reasoning-selector-container">
        {/* Primary Choice Toggle: [ OpenAI API ] [ Local Ollama ] */}
        <div className="segmented-toggle" role="group" aria-label="Reasoning Engine Selection">
          <button
            type="button"
            id="btn-provider-openai"
            className={`segmented-btn ${activeId === "openai" ? "active" : ""}`}
            onClick={() => handleSelectProvider("openai")}
            title="Switch to OpenAI API (Cloud reasoning via GPT-4o / GPT-4o-mini)"
            disabled={saving}
          >
            <span className="provider-icon">☁️</span>
            <span>OpenAI API</span>
          </button>

          <button
            type="button"
            id="btn-provider-ollama"
            className={`segmented-btn ${activeId === "openai-compatible-local" ? "active" : ""}`}
            onClick={() => handleSelectProvider("openai-compatible-local")}
            title="Switch to Local Ollama (Zero cloud egress, private reasoning)"
            disabled={saving}
          >
            <span className="provider-icon">🦙</span>
            <span>Local Ollama</span>
          </button>
        </div>

        {/* Live Status Pill */}
        <button
          type="button"
          id="btn-provider-status"
          className={`status-pill-btn status-${statusState}`}
          onClick={() => {
            setActiveTab(activeId);
            setIsConfigOpen(true);
          }}
          title="Click to view or adjust provider configuration"
        >
          <span className={`status-dot dot-${statusState}`} />
          <span id="badge-reasoning" className="status-text">Reasoning: {statusText}</span>
          <span className="status-gear">⚙️</span>
        </button>
      </div>

      {/* COMPACT CONFIGURATION DRAWER / MODAL */}
      {isConfigOpen && (
        <div className="drawer-backdrop" onClick={() => setIsConfigOpen(false)}>
          <div
            className="drawer-panel"
            style={{ maxWidth: "560px" }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="drawer-header">
              <div>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text-main)" }}>
                  Reasoning Engine Configuration
                </h3>
                <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                  Select reasoning provider, manage API keys, and test model connection.
                </p>
              </div>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => setIsConfigOpen(false)}
                aria-label="Close configuration"
              >
                ✕
              </button>
            </div>

            {/* Provider Tabs Inside Drawer */}
            <div style={{ display: "flex", borderBottom: "1px solid var(--border-subtle)", padding: "0 1.25rem", background: "var(--bg-subtle)" }}>
              <button
                type="button"
                className={`tab-btn ${activeTab === "openai" ? "active" : ""}`}
                onClick={() => setActiveTab("openai")}
                style={{
                  padding: "0.6rem 1rem",
                  background: "transparent",
                  border: "none",
                  borderBottom: activeTab === "openai" ? "2px solid var(--accent-primary)" : "2px solid transparent",
                  color: activeTab === "openai" ? "var(--text-main)" : "var(--text-dim)",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                ☁️ OpenAI API (Cloud)
              </button>
              <button
                type="button"
                className={`tab-btn ${activeTab === "openai-compatible-local" ? "active" : ""}`}
                onClick={() => setActiveTab("openai-compatible-local")}
                style={{
                  padding: "0.6rem 1rem",
                  background: "transparent",
                  border: "none",
                  borderBottom: activeTab === "openai-compatible-local" ? "2px solid var(--accent-primary)" : "2px solid transparent",
                  color: activeTab === "openai-compatible-local" ? "var(--text-main)" : "var(--text-dim)",
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  cursor: "pointer",
                }}
              >
                🦙 Local Ollama (Private)
              </button>
            </div>

            {/* Body */}
            <div className="drawer-body" style={{ padding: "1.25rem" }}>
              <form onSubmit={handleSaveConfig} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {activeTab === "openai" ? (
                  <>
                    {/* OpenAI Configuration */}
                    <div className="card" style={{ padding: "1rem", background: "var(--bg-card)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                        <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-main)" }}>OpenAI API Credentials</span>
                        <span className={`badge ${hasOpenAiKey ? "badge-success" : "badge-warning"}`}>
                          {hasOpenAiKey ? "KEY CONFIGURED" : "KEY REQUIRED"}
                        </span>
                      </div>

                      {hasOpenAiKey && (
                        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.75rem", fontFamily: "var(--font-mono)" }}>
                          Stored Key: {maskedApiKey}
                        </div>
                      )}

                      <div className="form-group" style={{ marginBottom: "0.75rem" }}>
                        <label className="form-label" style={{ fontSize: "0.78rem" }}>
                          {hasOpenAiKey ? "Replace API Key" : "Enter OpenAI API Key"}
                        </label>
                        <input
                          type="password"
                          className="form-input"
                          placeholder="sk-proj-..."
                          value={inputApiKey}
                          onChange={(e) => setInputApiKey(e.target.value)}
                          autoComplete="off"
                        />
                        <span style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: "0.2rem", display: "block" }}>
                          Keys are stored securely in local application settings. Never committed to repositories.
                        </span>
                      </div>

                      <div className="form-group" style={{ marginBottom: "0.75rem" }}>
                        <label className="form-label" style={{ fontSize: "0.78rem" }}>Model Identifier</label>
                        <select
                          className="form-select"
                          value={openAiModel}
                          onChange={(e) => setOpenAiModel(e.target.value)}
                        >
                          <option value="gpt-4o-mini">gpt-4o-mini (Recommended: Fast & Cost-Effective)</option>
                          <option value="gpt-4o">gpt-4o (High-Capability Multimodal)</option>
                          <option value="o1-mini">o1-mini (Deep Reasoning)</option>
                        </select>
                      </div>

                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={handleVerifyOpenAiKey}
                          disabled={openAiVerifying || !inputApiKey.trim()}
                        >
                          {openAiVerifying ? "Validating..." : "🔍 Validate Credential"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => handleTestGeneration("openai")}
                          disabled={testGenerating || (!hasOpenAiKey && !inputApiKey.trim())}
                          title="Makes one minimal live model inference request and records usage"
                        >
                          {testGenerating ? "Generating..." : "⚡ Send Test Generation"}
                        </button>
                      </div>

                      {openAiNotice && (
                        <div
                          style={{
                            marginTop: "0.75rem",
                            padding: "0.5rem 0.75rem",
                            borderRadius: "var(--radius-sm)",
                            fontSize: "0.78rem",
                            background: openAiNotice.ok ? "var(--accent-emerald-subtle)" : "var(--accent-rose-subtle)",
                            color: openAiNotice.ok ? "var(--accent-emerald)" : "var(--accent-rose)",
                            border: `1px solid ${openAiNotice.ok ? "rgba(16, 185, 129, 0.3)" : "rgba(244, 63, 94, 0.3)"}`,
                          }}
                        >
                          {openAiNotice.message}
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    {/* Ollama Configuration */}
                    <div className="card" style={{ padding: "1rem", background: "var(--bg-card)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
                        <span style={{ fontWeight: 600, fontSize: "0.85rem", color: "var(--text-main)" }}>Local Ollama Endpoint</span>
                        <span className="badge badge-local">LOCAL-ONLY (ZERO EGRESS)</span>
                      </div>

                      <div className="form-group" style={{ marginBottom: "0.75rem" }}>
                        <label className="form-label" style={{ fontSize: "0.78rem" }}>Ollama Server URL</label>
                        <input
                          type="text"
                          className="form-input"
                          style={{ fontFamily: "var(--font-mono)" }}
                          value={localBaseUrl}
                          onChange={(e) => setLocalBaseUrl(e.target.value)}
                          placeholder="http://127.0.0.1:11434"
                        />
                        <span style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: "0.2rem", display: "block" }}>
                          Native Ollama (port 11434) or OpenAI-compatible local server (vLLM, LM Studio).
                        </span>
                      </div>

                      <div className="form-group" style={{ marginBottom: "0.75rem" }}>
                        <label className="form-label" style={{ fontSize: "0.78rem" }}>Model Name</label>
                        {discoveredModels.length > 0 ? (
                          <div style={{ display: "flex", gap: "0.4rem" }}>
                            <select
                              className="form-select"
                              style={{ flex: 1 }}
                              value={localModel}
                              onChange={(e) => setLocalModel(e.target.value)}
                            >
                              {discoveredModels.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </select>
                            <input
                              type="text"
                              className="form-input"
                              style={{ flex: 1, fontFamily: "var(--font-mono)" }}
                              value={localModel}
                              onChange={(e) => setLocalModel(e.target.value)}
                              placeholder="or type model tag..."
                            />
                          </div>
                        ) : (
                          <input
                            type="text"
                            className="form-input"
                            style={{ fontFamily: "var(--font-mono)" }}
                            value={localModel}
                            onChange={(e) => setLocalModel(e.target.value)}
                            placeholder="llama3.1:8b"
                          />
                        )}
                        <span style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: "0.2rem", display: "block" }}>
                          Requires local installation via <code>ollama pull {localModel}</code>.
                        </span>
                      </div>

                      <div className="form-group" style={{ marginBottom: "0.75rem" }}>
                        <label className="form-label" style={{ fontSize: "0.78rem" }}>
                          Cold-Start Allowance: {Math.round(localTimeoutMs / 1000)}s
                        </label>
                        <input
                          type="range"
                          min="30000"
                          max="300000"
                          step="15000"
                          value={localTimeoutMs}
                          onChange={(e) => setLocalTimeoutMs(Number(e.target.value))}
                          style={{ width: "100%" }}
                        />
                        <span style={{ fontSize: "0.72rem", color: "var(--text-dim)", marginTop: "0.2rem", display: "block" }}>
                          Adjustable up to 5 minutes to allow heavy local model weights to load onto GPU/VRAM.
                        </span>
                      </div>

                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => probeOllama(localBaseUrl, localModel)}
                          disabled={ollamaProbing}
                        >
                          {ollamaProbing ? "Probing..." : "🔍 Test Connection"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline"
                          onClick={() => handleTestGeneration("openai-compatible-local")}
                          disabled={testGenerating}
                          title="Makes one minimal live model inference request to Ollama and measures latency/tokens"
                        >
                          {testGenerating ? "Generating..." : "⚡ Send Test Generation"}
                        </button>
                      </div>

                      {ollamaNotice && (
                        <div
                          style={{
                            marginTop: "0.75rem",
                            padding: "0.5rem 0.75rem",
                            borderRadius: "var(--radius-sm)",
                            fontSize: "0.78rem",
                            background: ollamaNotice.ok ? "var(--accent-emerald-subtle)" : "var(--accent-rose-subtle)",
                            color: ollamaNotice.ok ? "var(--accent-emerald)" : "var(--accent-rose)",
                            border: `1px solid ${ollamaNotice.ok ? "rgba(16, 185, 129, 0.3)" : "rgba(244, 63, 94, 0.3)"}`,
                          }}
                        >
                          {ollamaNotice.message}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Submit Actions */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    onClick={() => setIsConfigOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-sm btn-primary"
                    disabled={saving}
                  >
                    {saving ? "Applying..." : "✓ Save & Set Active"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
