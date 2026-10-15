import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Integration with the native Antigravity Agent.
 *
 * Submission: the Orches Bridge extension (apps/antigravity-bridge) runs inside the Antigravity IDE
 * window and calls the IDE's own `antigravity.sendPromptToAgentPanel` command — the same action as a
 * user typing into the Agent panel. Each window advertises itself in ~/.orches/antigravity-bridge/<pid>.json.
 *
 * Observation: the agent records every conversation as a SQLite database under
 * ~/.gemini/antigravity-ide/conversations/<id>.db (prompt, tool calls with arguments, replies).
 * Orches reads it READ-ONLY to identify the conversation it started (by a unique marker in the prompt),
 * follow progress, and collect the agent's final reply and tool calls. The format is undocumented, so
 * this is best-effort evidence; the orchestrator's own workspace diff remains the source of truth.
 */

export const BRIDGE_DIR = path.join(os.homedir(), ".orches", "antigravity-bridge");
export const CONVERSATIONS_DIR = path.join(os.homedir(), ".gemini", "antigravity-ide", "conversations");

export interface BridgeInfo {
  pid: number;
  port: number;
  token: string;
  folders: string[];
}

export interface BridgeStatus {
  bridgeInstalled: boolean;
  windows: Array<{ pid: number; folders: string[]; canSubmit: boolean }>;
  matchingWindow: { pid: number; canSubmit: boolean } | null;
  message: string;
}

const STEP_USER_INPUT = 14;
const STEP_MODEL_RESPONSE = 15;
/** Error step: model-provider failures (e.g. RESOURCE_EXHAUSTED / quota) and tool errors are recorded here. */
const STEP_ERROR = 17;
/** Step statuses observed in Antigravity's conversation records. */
const STATUS_RUNNING = 2;
const STATUS_DONE = 3;
const STATUS_WAITING_FOR_USER = 6;
const STATUS_ENDED = 8;

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => path.resolve(p).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function listBridges(): BridgeInfo[] {
  if (!fs.existsSync(BRIDGE_DIR)) return [];
  const out: BridgeInfo[] = [];
  for (const f of fs.readdirSync(BRIDGE_DIR).filter((n) => n.endsWith(".json"))) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(BRIDGE_DIR, f), "utf8")) as BridgeInfo;
      if (info.port && info.token && pidAlive(info.pid)) out.push(info);
    } catch {}
  }
  return out;
}

async function bridgeRequest<T>(b: BridgeInfo, method: string, url: string, body?: unknown, timeoutMs = 10_000): Promise<T> {
  const res = await fetch(`http://127.0.0.1:${b.port}${url}`, {
    method,
    headers: { "x-orches-token": b.token, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || `bridge returned HTTP ${res.status}`);
  return data;
}

export async function getBridgeStatus(workspaceRoot?: string): Promise<BridgeStatus> {
  const installed = fs.existsSync(BRIDGE_DIR);
  const windows: BridgeStatus["windows"] = [];
  for (const b of listBridges()) {
    try {
      const s = await bridgeRequest<{ folders: string[]; canSubmit: boolean }>(b, "GET", "/status", undefined, 3000);
      windows.push({ pid: b.pid, folders: s.folders, canSubmit: s.canSubmit });
    } catch {}
  }
  const match = workspaceRoot ? windows.find((w) => w.folders.some((f) => samePath(f, workspaceRoot))) : undefined;
  let message: string;
  if (windows.length === 0) {
    message = installed
      ? "No Antigravity IDE window with the Orches Bridge is running. Open the project folder in Antigravity."
      : "The Orches Bridge extension is not installed in Antigravity IDE.";
  } else if (workspaceRoot && !match) {
    message = "The project folder is not open in any Antigravity window. Open it in Antigravity first.";
  } else if (match && !match.canSubmit) {
    message = "This Antigravity version does not expose the Agent panel command the bridge needs.";
  } else {
    message = "Antigravity Agent is reachable through the Orches Bridge.";
  }
  return { bridgeInstalled: installed, windows, matchingWindow: match ? { pid: match.pid, canSubmit: match.canSubmit } : null, message };
}

export async function submitToAgent(workspaceRoot: string, text: string): Promise<{ submittedAt: number; windowPid: number }> {
  const candidates = listBridges().filter((b) => b.folders.some((f) => samePath(f, workspaceRoot)));
  if (candidates.length === 0) throw new Error("The project folder is not open in an Antigravity window with the Orches Bridge.");
  if (candidates.length > 1) throw new Error("The project folder is open in more than one Antigravity window; close the duplicates so the prompt goes to exactly one agent.");
  const b = candidates[0];
  const res = await bridgeRequest<{ submittedAt: number }>(b, "POST", "/prompt", { text, newConversation: true }, 30_000);
  return { submittedAt: res.submittedAt, windowPid: b.pid };
}

// --- Trajectory reading (read-only) ------------------------------------------------------------

/** Collect UTF-8 strings from a protobuf message without a schema. */
export function protoStrings(buf: Uint8Array, depth = 0, out: string[] = []): string[] {
  let i = 0;
  const readVarint = (): number | null => {
    let result = 0;
    let shift = 0;
    while (i < buf.length) {
      const b = buf[i++];
      result += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) return result;
      shift += 7;
      if (shift > 63) return null;
    }
    return null;
  };
  while (i < buf.length) {
    const key = readVarint();
    if (key === null) return out;
    const wire = key % 8;
    if (wire === 0) {
      if (readVarint() === null) return out;
    } else if (wire === 1) {
      i += 8;
    } else if (wire === 5) {
      i += 4;
    } else if (wire === 2) {
      const len = readVarint();
      if (len === null || i + len > buf.length) return out;
      const slice = buf.subarray(i, i + len);
      i += len;
      const nested: string[] = [];
      const parsedAsMessage = depth < 12 && len > 1 && looksLikeMessage(slice);
      if (parsedAsMessage) protoStrings(slice, depth + 1, nested);
      const text = Buffer.from(slice).toString("utf8");
      const printable = len > 0 && !text.includes("�") && !/[\u0000-\u0008\u000e-\u001f]/.test(text);
      if (printable && (!parsedAsMessage || nested.length === 0 || text.length > nested.join("").length * 1.5)) out.push(text);
      else out.push(...nested);
    } else {
      return out;
    }
  }
  return out;
}

function looksLikeMessage(buf: Uint8Array): boolean {
  // A quick structural check: the first byte must be a plausible key with a known wire type.
  const wire = buf[0] & 7;
  return [0, 1, 2, 5].includes(wire) && buf[0] >= 8;
}

export interface AgentToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface AgentTrajectory {
  conversationId: string;
  stepCount: number;
  lastStepType: number | null;
  lastStepStatus: number | null;
  prompt: string;
  /** Every string recorded in the user-input step(s); includes IDE context besides the prompt. */
  inputTexts: string[];
  toolCalls: AgentToolCall[];
  replies: string[];
  finalReply: string;
  workspaceUris: string[];
  /** Strings recorded in the most recent step (used to report agent errors). */
  lastStepTexts: string[];
}

function extractToolCalls(strings: string[]): AgentToolCall[] {
  const calls: AgentToolCall[] = [];
  for (let k = 0; k < strings.length - 1; k++) {
    if (/^[a-z][a-z_]{2,40}$/.test(strings[k]) && strings[k + 1].trim().startsWith("{")) {
      try {
        calls.push({ tool: strings[k], args: JSON.parse(strings[k + 1]) });
      } catch {}
    }
  }
  return calls;
}

function isIdentifier(s: string): boolean {
  return /^[\w-]{20,}$/.test(s) || /^(bot|call|toolu|req)[-_]/.test(s) || /^[0-9a-f-]{36}$/.test(s) || /^sessionID/.test(s);
}

export function readTrajectory(conversationId: string, dir = CONVERSATIONS_DIR): AgentTrajectory | null {
  const file = path.join(dir, `${conversationId}.db`);
  if (!fs.existsSync(file)) return null;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare("SELECT idx, step_type, status, step_payload FROM steps ORDER BY idx").all() as Array<{
      idx: number;
      step_type: number;
      status: number;
      step_payload: Uint8Array | null;
    }>;
    const meta = db.prepare("SELECT data FROM trajectory_metadata_blob LIMIT 1").get() as { data?: Uint8Array } | undefined;
    const workspaceUris = meta?.data ? protoStrings(meta.data).filter((s) => s.startsWith("file:///")) : [];
    const inputTexts: string[] = [];
    const toolCalls: AgentToolCall[] = [];
    const replies: string[] = [];
    const seenCalls = new Set<string>();
    for (const r of rows) {
      const strings = r.step_payload ? protoStrings(r.step_payload) : [];
      if (r.step_type === STEP_USER_INPUT) inputTexts.push(...strings);
      for (const c of extractToolCalls(strings)) {
        const key = `${c.tool}:${JSON.stringify(c.args)}`;
        if (!seenCalls.has(key)) {
          seenCalls.add(key);
          toolCalls.push(c);
        }
      }
      if (r.step_type === STEP_MODEL_RESPONSE) {
        const text = strings
          .filter((s) => !isIdentifier(s) && !s.trim().startsWith("{") && !/^[a-z_]+$/.test(s) && s.trim().length > 0)
          .reduce((a, b) => (b.length > a.length ? b : a), "");
        if (text) replies.push(text.trim());
      }
    }
    const last = rows[rows.length - 1];
    const lastStepTexts = last?.step_payload ? protoStrings(last.step_payload) : [];
    // The submitted prompt is recorded twice in the input step (raw and rendered); IDE context only once.
    const prompt =
      inputTexts.find((t, i) => t.trim().length > 0 && inputTexts.indexOf(t) !== i) ??
      inputTexts.find((t) => t.includes("[orches")) ??
      "";
    return {
      conversationId,
      stepCount: rows.length,
      lastStepType: last ? last.step_type : null,
      lastStepStatus: last ? last.status : null,
      prompt,
      inputTexts,
      toolCalls,
      replies,
      finalReply: replies[replies.length - 1] ?? "",
      workspaceUris,
      lastStepTexts,
    };
  } catch {
    return null; // database briefly locked or mid-write; caller retries
  } finally {
    try {
      db?.close();
    } catch {}
  }
}

/** Find the conversation whose first prompt contains `marker`, created at or after `sinceMs`. */
export function findConversation(marker: string, sinceMs: number, dir = CONVERSATIONS_DIR): string | null {
  if (!fs.existsSync(dir)) return null;
  const candidates = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".db"))
    .map((f) => ({ id: f.slice(0, -3), mtime: Math.max(fs.statSync(path.join(dir, f)).mtimeMs, fs.existsSync(path.join(dir, `${f}-wal`)) ? fs.statSync(path.join(dir, `${f}-wal`)).mtimeMs : 0) }))
    .filter((c) => c.mtime >= sinceMs - 10_000)
    .sort((a, b) => b.mtime - a.mtime);
  for (const c of candidates) {
    const t = readTrajectory(c.id, dir);
    if (t && t.inputTexts.some((x) => x.includes(marker))) return c.id;
  }
  return null;
}

export interface AgentWaitResult {
  state: "finished" | "timeout" | "not_started" | "cancelled" | "error";
  trajectory: AgentTrajectory | null;
  /** For state "error": the agent's own error text and its category. */
  error?: string;
  errorKind?: "quota" | "agent_error";
}

/** The readable error message recorded in an error step (skips ids, tool names and JSON arguments). */
export function agentErrorMessage(texts: string[]): string {
  const readable = texts
    .map((t) => t.trim())
    .filter((t) => t.length > 10 && !/^[a-z][a-z_]{2,40}$/.test(t) && !t.startsWith("{") && !/^[\w-]{20,}$/.test(t) && !/^[0-9a-f-]{36}(-\d+)?$/i.test(t) && !/^(call|toolu|bot)[-_]/.test(t));
  const preferred = readable.find((t) => /error|quota|exhausted|failed|denied|unavailable|exceeded|limit|refused/i.test(t));
  const tool = texts.find((t) => /^[a-z][a-z_]{2,40}$/.test(t));
  return (preferred ?? readable[0] ?? (tool ? `the agent stopped after an error in tool '${tool}'` : "the agent stopped after an unspecified error")).slice(0, 500);
}

export function classifyAgentError(message: string): "quota" | "agent_error" {
  return /RESOURCE_EXHAUSTED|quota|rate.?limit|\b429\b|too many requests/i.test(message) ? "quota" : "agent_error";
}

/**
 * Wait until the agent's conversation goes idle: the last recorded step is a completed reply and
 * nothing new has been recorded (and no workspace activity reported) for `quietMs`.
 */
export async function waitForAgent(opts: {
  marker: string;
  submittedAt: number;
  timeoutMs: number;
  quietMs?: number;
  startTimeoutMs?: number;
  signal?: AbortSignal;
  onProgress?: (t: AgentTrajectory) => void;
  /** Called once when the agent has been waiting for the user's approval (e.g. to run a command). */
  onWaitingForUser?: (t: AgentTrajectory) => void;
  workspaceActivity?: () => number; // epoch ms of the last observed file change in the workspace
}): Promise<AgentWaitResult> {
  const quietMs = opts.quietMs ?? 8000;
  const startDeadline = opts.submittedAt + (opts.startTimeoutMs ?? 90_000);
  const deadline = opts.submittedAt + opts.timeoutMs;
  let conversationId: string | null = null;
  let lastCount = -1;
  let lastChange = Date.now();
  let latest: AgentTrajectory | null = null;
  let notifiedWaiting = false;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  while (true) {
    if (opts.signal?.aborted) return { state: "cancelled", trajectory: latest };
    const now = Date.now();
    if (!conversationId) {
      conversationId = findConversation(opts.marker, opts.submittedAt);
      if (!conversationId && now > startDeadline) return { state: "not_started", trajectory: null };
    }
    if (conversationId) {
      const t = readTrajectory(conversationId);
      if (t) {
        latest = t;
        if (t.stepCount !== lastCount) {
          lastCount = t.stepCount;
          lastChange = now;
          opts.onProgress?.(t);
        }
        const fsQuiet = !opts.workspaceActivity || now - opts.workspaceActivity() >= quietMs;
        const replied =
          t.lastStepType === STEP_MODEL_RESPONSE &&
          (t.lastStepStatus === STATUS_DONE || t.lastStepStatus === STATUS_ENDED) &&
          t.finalReply.length > 0;
        if (replied && now - lastChange >= quietMs && fsQuiet) return { state: "finished", trajectory: t };

        // The agent's turn ended on an error step (model quota exhausted, provider failure, fatal tool
        // error) and nothing new happened afterwards. "Retryable" errors get longer, because the agent
        // retries them on its own; anything else is reported once it has stayed quiet for 30 seconds.
        if (t.lastStepType === STEP_ERROR && t.lastStepStatus !== STATUS_RUNNING) {
          const message = agentErrorMessage(t.lastStepTexts);
          const settleMs = /retryable/i.test(message) ? 180_000 : Math.max(quietMs, 30_000);
          if (now - lastChange >= settleMs && fsQuiet) {
            return { state: "error", trajectory: t, error: message, errorKind: classifyAgentError(message) };
          }
        }

        if (t.lastStepStatus === STATUS_WAITING_FOR_USER && now - lastChange >= 15_000 && !notifiedWaiting) {
          notifiedWaiting = true;
          opts.onWaitingForUser?.(t);
        } else if (t.lastStepStatus !== STATUS_WAITING_FOR_USER) {
          notifiedWaiting = false;
        }
      }
    }
    if (now > deadline) return { state: "timeout", trajectory: latest };
    await sleep(1500);
  }
}
