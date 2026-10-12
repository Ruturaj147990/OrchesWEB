import { FormEvent, KeyboardEvent, useState } from "react";
import { AUTONOMY_MODE_LABELS, Project, Settings } from "../api";

interface Props {
  project?: Project | null;
  settings: Settings | null;
  providerReady: boolean | null;
  runActive: boolean;
  disabledReason: string | null;
  onRun: (task: string) => Promise<boolean>;
  onGuidance: (text: string) => Promise<void>;
  onOpenSettings: () => void;
}

export function TaskComposer({ project, settings, providerReady, runActive, disabledReason, onRun, onGuidance, onOpenSettings }: Props) {
  const [task, setTask] = useState("");
  const [guidance, setGuidance] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const canRun = task.trim().length >= 3 && !runActive && !submitting && !disabledReason;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!canRun) return;
    setSubmitting(true);
    const ok = await onRun(task.trim());
    setSubmitting(false);
    if (ok) setTask("");
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
  };

  const providerText = settings
    ? "ChatGPT Web · Browser"
    : "…";
  const agent = settings?.codingAgents.find((a) => a.id === settings.codingAgentId);
  const modeText = project
    ? `${project.profileId.replace(/_/g, " ")} (${AUTONOMY_MODE_LABELS[project.autonomyMode]?.label || project.autonomyMode})`
    : null;

  return (
    <section className="card composer" aria-label="Task">
      <form onSubmit={submit}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <label htmlFor="task-input" className="card-title">
            Task
          </label>
          {project?.objective?.trim() && !task.trim() && (
            <button
              type="button"
              className="link small"
              onClick={() => setTask(project.objective)}
              title="Fill composer with the saved project specification"
            >
              Use Project Specification
            </button>
          )}
        </div>
        <textarea
          id="task-input"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={onKey}
          placeholder="Describe the change you want, e.g. “Implement Library Management System” or paste a full project specification with strict rules."
          rows={4}
          disabled={runActive}
        />
        <div className="composer-foot">
          <button type="button" className="config-line" onClick={onOpenSettings} title="Change in Settings">
            <span className={`dot dot-${providerReady === null ? "neutral" : providerReady ? "ok" : "bad"}`} aria-hidden />
            {providerText}
            <span className="sep">→</span>
            {agent?.name ?? "Built-in coder"}
            {modeText && (
              <>
                <span className="sep">·</span>
                <span title="Active Profile & Mode">{modeText}</span>
              </>
            )}
            <span className="sep">·</span>
            up to {settings?.maxAttempts ?? 3} iterations
          </button>
          <button type="submit" className="btn btn-primary" disabled={!canRun} title={disabledReason ?? (runActive ? "A run is in progress" : "Ctrl+Enter")}>
            {submitting ? "Starting…" : "Run task"}
          </button>
        </div>
        {disabledReason && !runActive && <p className="muted small">{disabledReason}</p>}
      </form>
      {runActive && (
        <form
          className="guidance"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!guidance.trim()) return;
            await onGuidance(guidance.trim());
            setGuidance("");
          }}
        >
          <input value={guidance} onChange={(e) => setGuidance(e.target.value)} placeholder="Add guidance for the next attempt (optional)" aria-label="Guidance for the next attempt" />
          <button type="submit" className="btn btn-secondary btn-sm" disabled={!guidance.trim()}>
            Send
          </button>
        </form>
      )}
    </section>
  );
}
