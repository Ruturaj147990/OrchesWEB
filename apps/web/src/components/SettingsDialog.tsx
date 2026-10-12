import { FormEvent, useState } from "react";
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
  const [headless, setHeadless] = useState(settings.chatgptWeb?.headless ?? false);
  const [timeoutSec, setTimeoutSec] = useState(Math.round((settings.chatgptWeb?.timeoutMs ?? 300_000) / 1000));
  const [maxAttempts, setMaxAttempts] = useState(settings.maxAttempts);
  const [agentId, setAgentId] = useState(settings.codingAgentId);
  const [probe, setProbe] = useState<Probe>({ state: "idle" });
  const [openingBrowser, setOpeningBrowser] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const payload = () => ({
    activeProviderId: "chatgpt-web",
    chatgptWebHeadless: headless,
    chatgptWebTimeoutMs: Math.max(10, timeoutSec) * 1000,
    maxAttempts,
    codingAgentId: agentId,
  });

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 30) {
      setError("Maximum Agent Iterations must be a whole number between 1 and 30.");
      return null;
    }
    setBusy(true);
    try {
      const saved = await api.saveSettings(payload());
      onSaved(saved);
      return saved;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const openBrowser = async () => {
    setOpeningBrowser(true);
    setError(null);
    try {
      const res = await api.openBrowser();
      setProbe({
        state: "ok",
        text: `ChatGPT browser opened. Profile: ${res.profileDir}`,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setOpeningBrowser(false);
    }
  };

  const check = async (generate: boolean) => {
    const saved = await save();
    if (!saved) return;
    setProbe({ state: "busy", text: generate ? "Sending test reasoning request to ChatGPT Web…" : "Checking ChatGPT browser session…" });
    try {
      if (generate) {
        const r = await api.testProvider("chatgpt-web");
        setProbe({ state: "ok", text: `ChatGPT Web answered “${r.output}” in ${((r.durationMs ?? 0) / 1000).toFixed(1)}s.` });
      } else {
        const r: ProviderHealth = await api.checkProvider("chatgpt-web");
        setProbe({ state: r.ok ? "ok" : "error", text: r.message ?? (r.ok ? "ChatGPT Web is ready." : "Not ready.") });
      }
    } catch (err) {
      setProbe({ state: "error", text: err instanceof ApiError ? err.message : String(err) });
    }
  };

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
          <h3>Reasoning Engine — ChatGPT Web</h3>
          <p className="muted small">
            Orches reasons directly via your ChatGPT account through a dedicated browser profile. No API keys or subscriptions required.
          </p>

          <div className="card-callout" style={{ padding: "0.75rem 1rem", marginBottom: "1rem", borderRadius: "6px", background: "rgba(255, 255, 255, 0.04)" }}>
            <strong>First-Run Setup:</strong>
            <ol style={{ margin: "0.5rem 0 0 1.25rem", padding: 0 }}>
              <li>Click <strong>Open ChatGPT Browser</strong> below.</li>
              <li>Sign in to your ChatGPT account manually in the browser window.</li>
              <li>Complete any verification challenge if requested.</li>
              <li>Return to Orches — your authenticated browser session is saved permanently.</li>
            </ol>
            <p className="muted small" style={{ marginTop: "0.5rem", marginBottom: 0 }}>
              Your password and credentials are never stored or entered into Orches.
            </p>
          </div>

          <div className="grid-2">
            <label className="field">
              <span>Browser Profile Location</span>
              <input value={settings.chatgptWeb?.profileDir || "Managed Orches browser profile"} disabled readOnly />
              <small>Dedicated Chromium profile persisted between runs.</small>
            </label>
            <label className="field">
              <span>Reasoning Timeout (seconds)</span>
              <input type="number" min={10} max={900} value={timeoutSec} onChange={(e) => setTimeoutSec(Number(e.target.value))} />
              <small>Maximum wait time for ChatGPT reasoning response.</small>
            </label>
          </div>

          <label className="field-checkbox" style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.5rem" }}>
            <input type="checkbox" checked={headless} onChange={(e) => setHeadless(e.target.checked)} />
            <span>Run browser in background (headless mode)</span>
          </label>

          <div className="row" style={{ marginTop: "1rem", display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn btn-secondary" onClick={openBrowser} disabled={openingBrowser}>
              {openingBrowser ? "Opening…" : "Open ChatGPT Browser"}
            </button>
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
          <p className="muted small">
            Who edits the files. With the Antigravity Agent, ChatGPT Web reasons and writes engineering instructions, the agent executes workspace changes, and Orches coordinates the feedback loop.
          </p>
          <div role="radiogroup" aria-label="Coding mechanism" className="option-list">
            {settings.codingAgents.map((a) => (
              <label key={a.id} className={`option-card${agentId === a.id ? " selected" : ""}`}>
                <span className="row">
                  <input type="radio" name="agent" value={a.id} checked={agentId === a.id} onChange={() => setAgentId(a.id)} />
                  <strong>{a.name}</strong>
                  <span className={`dot dot-${a.available ? "ok" : "bad"}`} aria-hidden />
                  <span className="small muted">{a.available ? "available" : "not reachable now"}</span>
                </span>
                <span className="small">{a.description}</span>
                {!a.available && <span className="small warn-text">{a.detail}</span>}
              </label>
            ))}
          </div>
          {agentId === "antigravity" && (
            <p className="small muted">
              Requires the Orches Bridge extension in Antigravity IDE and the project folder open in exactly one Antigravity window. The agent uses your Antigravity account.
              {ide && !ide.nativeAgent.bridgeInstalled ? " The bridge extension is not installed yet (see README)." : ""}
            </p>
          )}
          <label className="field narrow">
            <span>Maximum Agent Iterations</span>
            <input
              type="number"
              min={1}
              max={30}
              step={1}
              value={maxAttempts}
              onChange={(e) => {
                const parsed = parseInt(e.target.value, 10);
                setMaxAttempts(isNaN(parsed) ? 1 : parsed);
              }}
              required
            />
            <small>
              Initial execution is iteration 1. Each subsequent repair/follow-up execution is another iteration (e.g. 4 allows 1 initial + up to 3 repairs; 10 allows 1 initial + up to 9 repairs). (Safety ceiling: 30)
            </small>
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
