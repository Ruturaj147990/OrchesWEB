// Orches bridge for Antigravity IDE.
// Runs inside the IDE's extension host and exposes a tiny loopback-only HTTP API that lets the
// local Orches server submit a prompt to the Agent panel of THIS window, using the IDE's own
// command (`antigravity.sendPromptToAgentPanel`) exactly as a user action would. It does not read
// or forward any IDE credentials. Discovery: ~/.orches/antigravity-bridge/<pid>.json holds the
// port, a random per-session token and this window's workspace folders.
const vscode = require("vscode");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const SEND_COMMAND = "antigravity.sendPromptToAgentPanel";
const NEW_CONVERSATION_COMMAND = "antigravity.startNewConversation";
const dir = path.join(os.homedir(), ".orches", "antigravity-bridge");
const token = crypto.randomBytes(24).toString("hex");
let server = null;
let infoFile = null;
let port = 0;
let busy = false;

function folders() {
  return (vscode.workspace.workspaceFolders || []).map((f) => f.uri.fsPath);
}

function writeInfo() {
  if (!port) return;
  fs.mkdirSync(dir, { recursive: true });
  infoFile = path.join(dir, `${process.pid}.json`);
  const info = { pid: process.pid, port, token, folders: folders(), app: vscode.env.appName, version: vscode.version, startedAt: new Date().toISOString() };
  fs.writeFileSync(infoFile, JSON.stringify(info, null, 2), { encoding: "utf8", mode: 0o600 });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (d) => {
      raw += d;
      if (raw.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function handle(req, res) {
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const host = String(req.headers.host || "").split(":")[0];
  if (host !== "127.0.0.1" && host !== "localhost") return send(403, { error: "loopback only" });
  if (req.headers.origin) return send(403, { error: "browser requests are not accepted" });
  if (req.headers["x-orches-token"] !== token) return send(401, { error: "invalid token" });

  if (req.method === "GET" && req.url === "/status") {
    const commands = await vscode.commands.getCommands(true);
    return send(200, {
      ok: true,
      pid: process.pid,
      folders: folders(),
      app: vscode.env.appName,
      version: vscode.version,
      canSubmit: commands.includes(SEND_COMMAND),
      canStartConversation: commands.includes(NEW_CONVERSATION_COMMAND),
      busy,
    });
  }

  if (req.method === "POST" && req.url === "/prompt") {
    if (busy) return send(409, { error: "a submission is already in progress" });
    const body = await readBody(req);
    if (typeof body.text !== "string" || !body.text.trim()) return send(400, { error: "text is required" });
    busy = true;
    try {
      if (body.newConversation !== false) {
        await vscode.commands.executeCommand(NEW_CONVERSATION_COMMAND);
        await sleep(1500);
      }
      const submittedAt = Date.now();
      await vscode.commands.executeCommand(SEND_COMMAND, body.text);
      return send(200, { ok: true, submittedAt });
    } catch (e) {
      return send(500, { error: String((e && e.message) || e) });
    } finally {
      busy = false;
    }
  }

  return send(404, { error: "not found" });
}

function activate(context) {
  server = http.createServer((req, res) => {
    handle(req, res).catch((e) => {
      try {
        res.writeHead(500, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      } catch {}
    });
  });
  server.listen(0, "127.0.0.1", () => {
    port = server.address().port;
    writeInfo();
  });
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => writeInfo()));
  context.subscriptions.push({ dispose: deactivate });
}

function deactivate() {
  try {
    if (server) server.close();
  } catch {}
  server = null;
  try {
    if (infoFile) fs.rmSync(infoFile, { force: true });
  } catch {}
}

module.exports = { activate, deactivate };
