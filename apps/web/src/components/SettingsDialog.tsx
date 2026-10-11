import { FormEvent, useEffect, useState } from "react";
import { Modal } from "./Modal";
import { api, ApiError, IdeStatus, ProviderHealth, Settings } from "../api";

interface Props {
  settings: Settings;
  ide: IdeStatus | null;
  runActive: boolean;
  onClose: () => void;
  onSaved: (s: Settings) => void;
}

type Probe = { state: "idle" | "busy" | "ok" | "error"; text?: string };

export function SettingsDialog({ settings, ide, runActive, onClose, onSaved }: Props) {
  const [providerId, setProviderId] = useState(settings.activeProviderId);
  const [baseUrl, setBaseUrl] = useState(settings.local.baseUrl);
  const [localModel, setLocalModel] = useState(settings.local.model);
  const [timeoutSec, setTimeoutSec] = useState(Math.round(settings.local.timeoutMs / 1000));
  const [contextTokens, setContextTokens] = useState(settings.local.contextTokens);
  const [models, setModels] = useState<string[]>([]);
  const [openaiKey, setOpenaiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState(settings.openai.model);
  const [maxAttempts, setMaxAttempts] = useState(settings.maxAttempts);
  const [probe, setProbe] = useState<Probe>({ state: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .localModels(baseUrl)
      .then((r) => setModels(r.models))
      .catch(() => setModels([]));
  }, [baseUrl]);

  const payload = () => ({
    activeProviderId: providerId,
    localBaseUrl: baseUrl.trim(),
    localModel: localModel.trim(),
    localTimeoutMs: Math.max(10, timeoutSec) * 1000,
    localContextTokens: contextTokens,
    openaiModel: openaiModel.trim(),
    maxAttempts,
    ...(openaiKey.trim() ? { openaiApiKey: openaiKey.trim() } : {}),
  });

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const saved = await api.saveSettings(payload());
      setOpenaiKey("");
      onSaved(saved);
      return saved;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const check = async (generate: boolean) => {
    const saved = await save();
    if (!saved) return;
    setProbe({ state: "busy", text: generate ? "Sending a one-word test request…" : "Checking connection…" });
    try {
      if (generate) {
        const r = await api.testProvider(providerId);
        setProbe({ state: "ok", text: `Model ${r.model} answered “${r.output}” in ${((r.durationMs ?? 0) / 1000).toFixed(1)}s.` });
      } else {
        const r: ProviderHealth = await api.checkProvider(providerId);
        setProbe({ state: r.ok ? "ok" : "error", text: r.message ?? (r.ok ? "Ready." : "Not ready.") });
      }
    } catch (err) {
      setProbe({ state: "error", text: err instanceof ApiError ? err.message : String(err) });
    }
  };

  const clearKey = async () => {
    try {
      onSaved(await api.saveSettings({ clearOpenaiKey: true, activeProviderId: "openai-compatible-local" }));
      setProviderId("openai-compatible-local");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    }
  };

  const agent = settings.codingAgents.find((a) => a.id === settings.codingAgentId) ?? settings.codingAgents[0];

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      wide
      footer={
        <>
          {runActive && <span className="muted small">Changes apply to the next run.</span>}
          <span className="spacer" />
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
          <button type="submit" form="settings-form" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <form id="settings-form" className="form" onSubmit={save}>
        <section className="settings-section">
          <h3>Reasoning model</h3>
          <p className="muted small">Plans the task, writes the code (built-in coder) and reviews the result.</p>
          <div className="segmented" role="radiogroup" aria-label="Reasoning provider">
            {(["openai-compatible-local", "openai"] as const).map((id) => (
              <label key={id} className={`segment${providerId === id ? " active" : ""}`}>
                <input type="radio" name="provider" value={id} checked={providerId === id} onChange={() => setProviderId(id)} />
                {id === "openai" ? "OpenAI API" : "Local (Ollama)"}
              </label>
            ))}
          </div>

          {providerId === "openai-compatible-local" ? (
            <div className="grid-2">
              <label className="field">
                <span>Server URL</span>
                <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
              </label>
              <label className="field">
                <span>Model</span>
                <input value={localModel} onChange={(e) => setLocalModel(e.target.value)} list="local-models" spellCheck={false} />
                <datalist id="local-models">
                  {models.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
                <small>{models.length ? `Installed: ${models.join(", ")}` : "No installed models found at this URL."}</small>
              </label>
              <label className="field">
                <span>Request timeout (seconds)</span>
                <input type="number" min={10} max={900} value={timeoutSec} onChange={(e) => setTimeoutSec(Number(e.target.value))} />
              </label>
              <label className="field">
                <span>Context window (tokens)</span>
                <input type="number" min={2048} max={131072} step={1024} value={contextTokens} onChange={(e) => setContextTokens(Number(e.target.value))} />
                <small>Sent to Ollama as num_ctx. Larger values use more memory.</small>
              </label>
            </div>
          ) : (
            <div className="grid-2">
              <label className="field">
                <span>API key</span>
                <input
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder={settings.openai.configured ? `Saved (${settings.openai.maskedKey}) — leave blank to keep` : "sk-…"}
                  autoComplete="off"
                />
                <small>
                  {settings.openai.keySource === "environment"
                    ? "Currently using OPENAI_API_KEY from the environment."
                    : "Stored only in the orchestrator's local settings file."}
                  {settings.openai.configured && settings.openai.keySource === "settings" && (
                    <>
                      {" "}
                      <button type="button" className="link" onClick={clearKey}>
                        Remove saved key
                      </button>
                    </>
                  )}
                </small>
              </label>
              <label className="field">
                <span>Model</span>
                <input value={openaiModel} onChange={(e) => setOpenaiModel(e.target.value)} spellCheck={false} />
                <small>Runs stop automatically after about $2 of API usage.</small>
              </label>
            </div>
          )}

          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => check(false)} disabled={probe.state === "busy"}>
              Check connection
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => check(true)} disabled={probe.state === "busy"}>
              Send test request
            </button>
            {probe.state !== "idle" && (
              <span className={`probe probe-${probe.state}`} role="status">
                {probe.text}
              </span>
            )}
          </div>
        </section>

        <section className="settings-section">
          <h3>Coding mechanism</h3>
          <div className="option-card selected">
            <strong>{agent?.name}</strong>
            <p className="small">{agent?.description}</p>
          </div>
          <div className="option-card disabled" aria-disabled="true">
            <strong>Antigravity IDE agent — not available</strong>
            <p className="small">{ide?.nativeAgent.reason ?? "Antigravity's built-in agent cannot be controlled by external programs."}</p>
            <p className="small muted">
              {ide?.installed ? (ide.running ? "Antigravity IDE is running." : "Antigravity IDE is installed but not running.") : "Antigravity IDE was not found."} You can still open the
              workspace in it from the dashboard to watch files change.
            </p>
          </div>
          <label className="field narrow">
            <span>Attempts per task</span>
            <select value={maxAttempts} onChange={(e) => setMaxAttempts(Number(e.target.value))}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "(no repair)" : `(1 + ${n - 1} repair${n > 2 ? "s" : ""})`}
                </option>
              ))}
            </select>
          </label>
        </section>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
