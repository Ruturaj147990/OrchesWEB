import { useMemo, useState } from "react";
import { AGENT_LABELS, Attempt, CheckRecord, describeRun, FileChange, PROVIDER_LABELS, RunDetail } from "../api";

const PHASES = ["planning", "coding", "verifying", "reviewing"] as const;
const PHASE_LABEL: Record<string, string> = { preparing: "Preparing", baseline: "Baseline checks", planning: "Planning", coding: "Writing code", verifying: "Verifying", reviewing: "Reviewing" };

export function Badge({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

function duration(start: string | null, end: string | null): string {
  if (!start) return "";
  const ms = (end ? Date.parse(end) : Date.now()) - Date.parse(start);
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Splits a multi-file unified diff into per-file sections. */
function splitDiff(diff: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = diff.split(/^(?=diff --git )/m);
  for (const part of parts) {
    const m = part.match(/^diff --git a\/(.+?) b\//);
    if (m) out[m[1]] = part.trimEnd();
  }
  return out;
}

function DiffView({ text }: { text: string }) {
  const lines = text.split("\n").slice(0, 1500);
  return (
    <pre className="diff" aria-label="Diff">
      {lines.map((l, i) => (
        <div
          key={i}
          className={
            l.startsWith("+") && !l.startsWith("+++")
              ? "diff-add"
              : l.startsWith("-") && !l.startsWith("---")
                ? "diff-del"
                : l.startsWith("@@")
                  ? "diff-hunk"
                  : l.startsWith("diff --git") || l.startsWith("---") || l.startsWith("+++") || l === "new file" || l === "deleted file"
                    ? "diff-meta"
                    : undefined
          }
        >
          {l || " "}
        </div>
      ))}
      {text.split("\n").length > 1500 && <div className="diff-meta">… diff truncated in this view</div>}
    </pre>
  );
}

function FileList({ files, diff }: { files: FileChange[]; diff: string }) {
  const sections = useMemo(() => splitDiff(diff), [diff]);
  const [open, setOpen] = useState<string | null>(null);
  if (files.length === 0) return <p className="muted small">No files changed.</p>;
  return (
    <ul className="file-list">
      {files.map((f) => (
        <li key={f.path}>
          <button className="file-row" onClick={() => setOpen(open === f.path ? null : f.path)} aria-expanded={open === f.path}>
            <span className={`file-kind kind-${f.kind}`}>{f.kind === "added" ? "A" : f.kind === "deleted" ? "D" : "M"}</span>
            <span className="file-path">{f.path}</span>
            <span className="file-stats">
              {f.binary ? "binary" : (
                <>
                  <span className="add">+{f.additions}</span> <span className="del">−{f.deletions}</span>
                </>
              )}
            </span>
          </button>
          {open === f.path && <DiffView text={sections[f.path] ?? "Diff not available for this file."} />}
        </li>
      ))}
    </ul>
  );
}

function CheckList({ checks }: { checks: CheckRecord[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const project = checks.filter((c) => c.phase !== "static");
  const statics = checks.filter((c) => c.phase === "static");
  const staticFailed = statics.filter((c) => c.status !== "passed");
  return (
    <ul className="check-list">
      {project.map((c, i) => (
        <li key={i}>
          <button className="check-row" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
            <span className={`dot dot-${c.status === "passed" ? "ok" : "bad"}`} aria-hidden />
            <span className="check-label">
              {c.label} <span className="muted small">{c.phase === "baseline" ? "before change" : "after change"}</span>
            </span>
            <span className={`check-status ${c.status === "passed" ? "ok" : "bad"}`}>
              {c.status}
              {c.exitCode !== null && c.status !== "passed" ? ` (exit ${c.exitCode})` : ""}
            </span>
          </button>
          {open === i && <pre className="output">{c.output || "(no output)"}</pre>}
        </li>
      ))}
      {statics.length > 0 && (
        <li>
          <div className="check-row static">
            <span className={`dot dot-${staticFailed.length ? "bad" : "ok"}`} aria-hidden />
            <span className="check-label">Syntax & format validation of changed files</span>
            <span className={`check-status ${staticFailed.length ? "bad" : "ok"}`}>
              {staticFailed.length ? `${staticFailed.length} problem(s)` : `${statics.length} passed`}
            </span>
          </div>
          {staticFailed.map((c, i) => (
            <pre key={i} className="output">
              {c.label}: {c.output}
            </pre>
          ))}
        </li>
      )}
      {project.length === 0 && statics.length === 0 && <li className="muted small">No checks ran.</li>}
    </ul>
  );
}

function AttemptBlock({ attempt, total, defaultOpen }: { attempt: Attempt; total: number; defaultOpen: boolean }) {
  const gate = attempt.gate;
  const critic = gate?.critic;
  return (
    <details className="attempt" open={defaultOpen}>
      <summary>
        <span>
          Attempt {attempt.number}
          {total > 1 ? ` of ${total}` : ""}
        </span>
        {gate ? (
          <Badge tone={gate.accepted ? (gate.outcome === "verified" ? "success" : "warning") : "danger"}>{gate.accepted ? "accepted" : "rejected"}</Badge>
        ) : (
          <Badge tone="running">{attempt.status}</Badge>
        )}
      </summary>
      {attempt.agentError && <p className="callout callout-danger small">Coding mechanism: {attempt.agentError}</p>}
      {gate && gate.blockers.length > 0 && (
        <div className="callout callout-danger">
          <strong>Why it was rejected</strong>
          <ul>
            {gate.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </div>
      )}
      <h4>Files changed</h4>
      <FileList files={attempt.files} diff={attempt.diff} />
      <h4>Verification</h4>
      <CheckList checks={attempt.checks} />
      {critic && (
        <>
          <h4>Independent review</h4>
          {critic.available ? (
            <div className="review">
              <p>
                <Badge tone={critic.verdict === "accept" ? "success" : "warning"}>{critic.verdict}</Badge> {critic.summary}
              </p>
              {critic.criteria.length > 0 && (
                <ul className="criteria">
                  {critic.criteria.map((c) => (
                    <li key={c.id}>
                      <span className={`dot dot-${c.status === "passed" ? "ok" : c.status === "failed" ? "bad" : "neutral"}`} aria-hidden /> {c.id}: {c.status}
                      {c.reason ? ` — ${c.reason}` : ""}
                    </li>
                  ))}
                </ul>
              )}
              {critic.findings.length > 0 && (
                <ul className="findings">
                  {critic.findings.map((f, i) => (
                    <li key={i}>
                      <Badge tone={f.severity === "high" || f.severity === "critical" ? "danger" : "neutral"}>{f.severity}</Badge> {f.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="muted small">Not available: {critic.error}</p>
          )}
        </>
      )}
      {gate && gate.warnings.length > 0 && (
        <ul className="warnings small">
          {gate.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

function nextStep(detail: RunDetail): string | null {
  const { run } = detail;
  if (run.outcome === "rejected") return "Nothing was kept. Try rephrasing the task more concretely, splitting it into smaller steps, or selecting a stronger model in Settings.";
  if (run.outcome === "error") {
    if (/provider is not ready|model server|did not answer|unreachable|API key/i.test(run.summary ?? "")) return "Check the reasoning model in Settings (Check connection), then run the task again.";
    return "Review the activity log for details, fix the cause, and run the task again.";
  }
  if (run.outcome === "unverified") return "The change was kept but could not be fully verified. Review the diff before relying on it.";
  return null;
}

interface Props {
  detail: RunDetail | null;
  livePhase: { phase: string; attempt: number | null } | null;
  onStop: () => void;
  stopping: boolean;
}

export function RunResult({ detail, livePhase, onStop, stopping }: Props) {
  if (!detail) {
    return (
      <section className="card result empty" aria-label="Result">
        <h2 className="card-title">Result</h2>
        <p className="muted">Run a task to see what changed, what was verified, and the outcome here.</p>
      </section>
    );
  }
  const { run, task, attempts, details } = detail;
  const state = describeRun(run);
  const running = run.status === "running";
  const phaseIndex = livePhase ? PHASES.indexOf(livePhase.phase as (typeof PHASES)[number]) : -1;
  const hint = nextStep(detail);
  const lastAttempt = attempts[attempts.length - 1];
  const usage = details.usage;

  return (
    <section className="card result" aria-label="Result" aria-live="polite">
      <div className="result-head">
        <div className="result-title">
          <Badge tone={state.tone}>{state.label}</Badge>
          <h2>{run.title || task?.title || "Task"}</h2>
        </div>
        {running && (
          <button className="btn btn-danger" onClick={onStop} disabled={stopping}>
            {stopping ? "Stopping…" : "Stop"}
          </button>
        )}
      </div>
      <p className="task-text">{run.taskText}</p>
      <p className="meta small">
        {PROVIDER_LABELS[run.providerId ?? ""] ?? run.providerId} · {run.modelId} · {AGENT_LABELS[run.agentId ?? ""] ?? run.agentId} · {duration(run.startedAt, run.endedAt)}
        {usage && usage.requests > 0 ? ` · ${usage.totalTokens.toLocaleString()} tokens${usage.costUsd > 0 ? ` · $${usage.costUsd.toFixed(3)}` : usage.costKnown ? "" : " · cost unknown"}` : ""}
        {run.commitSha ? ` · committed ${run.commitSha.slice(0, 8)}` : ""}
      </p>

      {running && (
        <ol className="stepper" aria-label="Progress">
          {PHASES.map((p, i) => (
            <li key={p} className={i < phaseIndex ? "done" : i === phaseIndex ? "current" : ""}>
              {PHASE_LABEL[p]}
            </li>
          ))}
          {livePhase && !PHASES.includes(livePhase.phase as any) && <li className="current">{PHASE_LABEL[livePhase.phase] ?? livePhase.phase}</li>}
          {livePhase?.attempt ? <li className="attempt-count">attempt {livePhase.attempt}</li> : null}
        </ol>
      )}

      {!running && run.summary && <p className={`summary tone-${state.tone}`}>{run.summary}</p>}
      {hint && <p className="callout callout-info">{hint}</p>}

      {task && task.acceptanceCriteria.length > 0 && (
        <details className="criteria-box">
          <summary>Acceptance criteria ({task.acceptanceCriteria.length})</summary>
          <ol>
            {task.acceptanceCriteria.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ol>
        </details>
      )}

      {details.warnings && details.warnings.length > 0 && !running && (
        <ul className="warnings small">
          {details.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      {attempts.map((a) => (
        <AttemptBlock key={a.id} attempt={a} total={attempts.length} defaultOpen={a === lastAttempt && !running} />
      ))}
    </section>
  );
}
