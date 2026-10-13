# Orches — local-first development orchestrator

Orches takes a development task you describe, changes the code in **one project folder you choose**, checks
the result with that project's own tests, has the diff reviewed, and keeps the change only if it holds up.
If it doesn't, every file it touched is restored.

Two coding mechanisms, chosen in Settings:

**Antigravity Agent (closed loop)** — the reasoning model directs the native Antigravity Agent:
```
you ─▶ Orches ─▶ reasoning model (ChatGPT Web via Browser): plan + first instruction
                     │
                     ▼
        Orches Bridge ─▶ Antigravity Agent codes in the IDE ─▶ Orches reads what it did
                     ▲                                          (conversation record + real diff)
                     │                                                   │
   next instruction ◀── reasoning model judges the evidence ◀── checks, validation, review
                                                                         │
                                  deterministic gate: keep (+ commit) or, after the last iteration, roll back
```

**Built-in coder** — the reasoning model writes the files itself; same verification, repair and rollback.

## What it does — and what it does not

| | |
|---|---|
| **Reasoning provider** | Real browser-based ChatGPT Web integration via Playwright Chromium. Zero API keys required; runs against your persistent browser session in `data/browser/chatgpt` with 1-to-1 project-scoped ChatGPT conversation mapping, secret redaction, and full attachment manifest delivery. |
| **Coding mechanism** | *Antigravity Agent*: each iteration the reasoning model writes an instruction; the **Orches Bridge** extension submits it to the Agent panel of the Antigravity window that has the project open (using the IDE's own `antigravity.sendPromptToAgentPanel` command); Orches then follows the agent's conversation record (read-only) until it goes idle and collects its reply and tool calls. *Built-in coder*: the reasoning model returns complete files and Orches writes them after path-safety checks. |
| **Antigravity limits** | The agent cannot be cancelled from outside (no public command): **Stop** waits up to 2 minutes for it to go idle before rolling back and tells you if it is still running. The conversation format is undocumented, so the agent's report is shown as evidence, never trusted for acceptance. The agent uses your Antigravity account. |
| **Verification** | Checks come from the project, not the model: npm `test`/`lint`/`typecheck` scripts, pytest or unittest, `go test`, `cargo test`, or commands you configure. They run before the change (baseline) and after, so regressions and pre-existing failures are told apart. Changed files are also syntax-checked (JSON, JavaScript, Python) and scanned for fences and "rest of code unchanged" stubs. |
| **Acceptance** | A model saying "done" is never enough. Accepted requires real file changes, no protected paths touched, valid files, no failing or regressed checks, and no concrete objection from the reviewer. |
| **Outcomes** | **Verified**: checks passed and the reviewer accepted. **Done — not fully verified**: accepted but without passing project checks or reviewer endorsement; review the diff. **Rejected — rolled back**: nothing kept. **Failed**: an error such as an unreachable model. **Stopped**: cancelled by you, with in-progress changes rolled back. |
| **Safety** | Snapshots live outside the workspace. Orches never switches or creates Git branches, and commits only accepted files on the current branch when the repo was clean. See [SECURITY.md](SECURITY.md). |

## Requirements
- Node.js 22.5+ (uses the built-in `node:sqlite`; developed on Node 24) and npm
- Git (optional per project; non-Git folders are protected by snapshots)
- Playwright Chromium (installed automatically via `npm install` / `npx playwright install chromium`) and a ChatGPT account (log in once via "Open ChatGPT Browser" in Settings)
- Python / Go / Rust toolchains only if your projects use them

## Quick Start & Cross-Platform Installation

Orches is fully cross-platform and supports **Windows** and **Ubuntu Linux** from a single source tree.

### Automated Setup

**Windows:**
```bat
scripts\setup.bat
scripts\start.bat
```

**Ubuntu Linux:**
```bash
chmod +x scripts/setup.sh scripts/start.sh
./scripts/setup.sh
./scripts/start.sh
```

### Manual Setup & Diagnostic Self-Check
```bash
# 1. Install dependencies
npm install

# 2. Install Playwright browser binaries
npx playwright install chromium

# 3. Build packages and apps
npm run build

# 4. Run system diagnostics self-check
npm run diagnose

# 5. Start Orches
npm start
```

Open http://127.0.0.1:4317. For development with live reload, run `npm run dev` and `npm run dev:web`.

Then:
1. **Add project**: enter the absolute path of the folder to work in (tick *Create the folder* for a new project).
2. **Settings**: configure ChatGPT Web browser profile and click *Open ChatGPT Browser* to authenticate if not already logged in.
3. For the Antigravity Agent: run `npm run bridge:install` once, open the project folder in Antigravity IDE
   (exactly one window), and choose *Antigravity Agent* under Settings → Coding mechanism.
4. Describe the task and press **Run task** (Ctrl+Enter). Watch progress in *Activity*; inspect files, diffs,
   checks and the review in *Result*. **Stop** cancels the current step and rolls back.

Data (SQLite database, settings, snapshots) lives in `%APPDATA%\AutonomousDevOrchestrator` on Windows, or `~/.config/AutonomousDevOrchestrator` on Linux; override
with `ORCHESTRATOR_DATA_DIR` (see [.env.example](.env.example)).

## Clean-Machine Redistribution

To redistribute or run Orches on a clean machine:
1. Ensure **Node.js >= 22.5.0** (Node 24 LTS recommended) and **Git** are installed.
2. Clone or copy the Orches repository directory.
3. Run `npm install` followed by `npx playwright install chromium`.
4. Run `npm run diagnose` to verify environment paths, write permissions, and port availability.
5. In Settings, authenticate ChatGPT Web via "Open ChatGPT Browser" (one-time persistent login stored locally in your OS profile directory).
6. Run `npm run bridge:install` if utilizing the native Antigravity Bridge extension.

## Testing & Quality Gates
```bash
npm test           # 21 test suites / 261 unit and integration tests (including production readiness & prompt regression gates)
npm run diagnose   # Environment and prerequisites diagnostic self-check
npm run build      # Full production TypeScript compile and Vite asset bundle
```

## Layout
```
apps/server/src
  orchestrator/   task-context, run-manager, run-pipeline, planner, critic, acceptance-gate, instructor
  workspace/      path-safety, snapshot-store, project-inspector, text-diff
  verification/   runner (project checks, static validation)
  providers/      reasoning (chatgpt-web) and coding-agents (builtin, antigravity-bridge)
  platform/       process-runner, settings-manager, diagnose, secret-redactor
  api/routes/     REST + server-sent events
apps/web/src      React dashboard (App.tsx + components/)
packages/shared-types   shared zod schemas
```

## Operational Safety & Middleman Protocol
- **No JSON Instructions to ChatGPT Web**: ChatGPT Web operates strictly via natural language Markdown protocols (Initial implementation brief and Iteration review protocol).
- **Middleman Architecture**: Quality feedback and critic repair requests do not reject iterations or trigger destructive rollbacks. All findings are structured as actionable feedback for subsequent iterations, preserving user and agent work.
- **Dynamic Context Budgeting**: Diff evidence is calculated against model context limits (~100,000 characters for 32k tokens), with deterministic multi-chunk review synthesis for very large multi-file diffs.
- **Path Boundary Safety**: IDE internal operational artifacts (`.gemini/antigravity-ide/brain/...`) are distinguished from genuine unauthorized workspace escapes.
- **Loopback-only binding**: Guarantees local machine security without remote exposure.
