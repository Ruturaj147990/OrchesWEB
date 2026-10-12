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

## Run it
```bash
npm install
npm run dev
```
Open http://127.0.0.1:4317. `npm run dev` builds the UI once and starts the server with TypeScript directly.
For a production-style run use `npm start` (builds everything, runs `apps/server/dist`). For UI work with hot
reload, run `npm run dev` in one terminal and `npm run dev:web` in another (http://127.0.0.1:5173).

Then:
1. **Add project**: enter the absolute path of the folder to work in (tick *Create the folder* for a new project).
2. **Settings**: configure ChatGPT Web browser profile and click *Open ChatGPT Browser* to authenticate if not already logged in.
3. For the Antigravity Agent: run `npm run bridge:install` once, open the project folder in Antigravity IDE
   (exactly one window), and choose *Antigravity Agent* under Settings → Coding mechanism.
4. Describe the task and press **Run task** (Ctrl+Enter). Watch progress in *Activity*; inspect files, diffs,
   checks and the review in *Result*. **Stop** cancels the current step and rolls back.

Data (SQLite database, settings, snapshots) lives in `%APPDATA%\AutonomousDevOrchestrator` on Windows, or `~/.config/AutonomousDevOrchestrator` on Linux; override
with `ORCHESTRATOR_DATA_DIR` (see [.env.example](.env.example)).

## Tests
```bash
npm test           # unit + integration (real files, real git, real processes; scripted model)
npm run test:e2e   # Playwright UI dashboard specs
```

## Layout
```
apps/server/src
  orchestrator/   run-manager (lifecycle, stop, crash recovery), run-pipeline, planner, critic, acceptance-gate
  workspace/      path-safety, snapshot-store (diff + scoped restore), project-inspector, text-diff
  verification/   runner (project checks, static validation)
  providers/      reasoning (chatgpt-web) and coding-agents (built-in coder)
  platform/       process-runner (timeouts, tree kill), settings, antigravity detection, secret redaction
  api/routes/     REST + server-sent events
apps/web/src      React dashboard (App.tsx + components/)
packages/shared-types   shared zod schemas
```

## Known limitations
- Output quality depends on the model. With `llama3.1:8b`, small, well-specified tasks usually succeed within
  the repair budget; larger or vaguer tasks are often rejected, and they are rolled back, never half-applied.
- The built-in coder rewrites whole files, so it suits small and medium files; very large files are shown to the
  model truncated and should not be the target of a task.
- Snapshots hash every tracked file per attempt; very large workspaces (tens of thousands of files) make runs slower.
- One run at a time per project and per folder. There is no authentication beyond loopback-only access.
