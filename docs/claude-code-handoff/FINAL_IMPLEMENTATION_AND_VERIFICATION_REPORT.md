# Final implementation and verification report

Session: Claude Code, 2026-10-11 · Branch: `main` (only branch) · Commits: `3e98866`, `99dad94` and the final docs/cleanup commit.

Evidence labels used below: **[runtime]** observed by running the real system; **[test]** automated test with
real files/processes and a scripted model; **[live]** real local model (Ollama `llama3.1:8b`); **[source]**
established by reading code only.

## 1. Starting point
- The handoff documents and the newest code existed only on an orchestrator attempt branch
  (`orchestrator/proj-49ff4dcf…/task-7460/attempt-1`, commit `b35f70c`). `main` was 5 commits behind. The
  orchestrator had been pointed at its own repository and had left 25 `orchestrator/*` branches. **[runtime]**
- Action: fast-forwarded `main` to `b35f70c` (nothing rewritten), then removed the 25 branches with
  `git branch -d` (all were fully merged). The repository now has one local branch, `main`. Nothing was pushed.

## 2. Significant defects found and how they were fixed

| # | Defect (root cause) | Fix | Evidence |
|---|---|---|---|
| 1 | Every attempt ran `git checkout -b` in the user's repo and never switched back; branches piled up (this is what happened to this repo). | Branch operations removed entirely. Content-addressed snapshots stored **outside** the workspace give exact diffs and scoped restore; accepted changes are committed only on the current branch, only for changed paths, and only when the repo was clean. | [test] `pipeline.test.ts` Git cases; [live] e2e README edit commits on `main`, branch count stays 1 |
| 2 | Rollback ran `git checkout <sha> -- <files>`, which fails for new files; the exit code was ignored, so "rolled back" could be false. | `SnapshotStore.restore` restores modified/deleted files, deletes added files and their new folders, keeps backups of discarded content, and reports failures; an incomplete rollback marks the run failed with the file list. | [test] `snapshot-store.test.ts`, rejection/stop/crash tests |
| 3 | Project `rootPath` defaulted to `process.cwd()` (the orchestrator repo). Tests created projects there too. | Absolute existing folder required; drive roots, home, system folders and the orchestrator's own install/data folders refused, both at creation and at every run start (legacy projects in the user's DB pointing at `orches` are now refused). | [test] path-safety + API tests; [runtime] legacy project refused on the real DB |
| 4 | Drive-colon stripping turned `C:\…\README.md` into `<ws>\c\Users\…\README.md`; `..` was stripped instead of rejected; `startsWith` prefix check. | `resolveModelPath`: in-workspace absolute paths relativized, outside ones rejected, traversal rejected, reserved/secret paths blocked, Windows device names and invalid characters rejected, symlink escape detected. | [test] `path-safety.test.ts` (Issue B regression) |
| 5 | Verification commands came from the LLM planner and ran via `cmd.exe /c` (arbitrary command execution from model output). | `project-inspector` detects checks from project files (npm scripts, pytest/unittest, go, cargo) or user-configured commands; model output is never executed. | [test] Python + Node projects; [source] |
| 6 | Planner silently fell back to a canned task; critic silently fell back to "accept"; deterministic code rewrote critic verdicts/criteria to "passed". | Provider errors fail the run visibly; malformed planner output uses the user's task text and records a warning; the critic is advisory and can block only with concrete reasons; it never converts failing checks into a pass. | [test] gate tests, planner-garbage test |
| 7 | The coder synthesized `package.json`, `test.js` and a `greet()` stub to satisfy `npm test`, whatever the project was. | Removed. Prompts are project-aware; checks come from what the project actually contains. | [test] Python project gets no `package.json` |
| 8 | "Visible Antigravity IDE" adapter: a fake 6-stage handshake ("agent tested" = folder exists) wrapping the reasoning-model file writer. | Removed. Antigravity is reported as detected/running/folder-open, can open the workspace via its documented CLI, and its native agent is explicitly reported unavailable (see §4). | [runtime] probes in §4 |
| 9 | The user could not type a task; runs executed `project.objective`. | Runs take the task text; it reaches the planner, coder and reviewer, and is stored with the run. | [test] prompt contains task text |
| 10 | SSE subscribers were per `EventStore` instance, so events recorded by the pipeline never reached the dashboard. | Shared subscriber registry; tail replay on connect, resume via `Last-Event-ID`. | [test] `events.test.ts` |
| 11 | Successful runs never left `running`; Stop only flipped a DB flag (agent/processes kept going); no recovery after a crash. | One run = one task with exactly one terminal state; Stop aborts the model request and kills process trees, then rolls back; on startup, interrupted runs are rolled back from their snapshot and marked failed. | [test] stop + crash-recovery tests |
| 12 | Timeouts killed only `cmd.exe`, not the npm/node grandchildren. | `process-runner`: `taskkill /T /F` tree kill, abort support, output caps, quoting for paths with spaces. | [test] tree-kill + spaces tests |
| 13 | Ollama called via `/v1` silently truncates prompts to the default context. | Native `/api/chat` with `num_ctx` (default 16k, configurable); generic OpenAI-compatible servers still supported. | [test] fake-server tests; [live] runs |
| 14 | Usage ledger never wired to the DB; unknown cloud models priced at $0 as "local". | Ledger persisted; unknown cloud prices reported as unknown; per-run usage shown; cloud runs stop at $2. | [source]/[test] |
| 15 | Verification processes inherited `OPENAI_API_KEY`. | Scrubbed environment for checks. | [test] |
| 16 | No DNS-rebinding protection; SSE reflected any `Origin`. | Host-header check, CORS loopback-only. | [test] |

Removed as dead or misleading: IDE bridge/detector, Antigravity CLI adapter with invented flags, stagnation
detector, memory manager, browser verifier, blueprint importer/requirement extractor, `policy-schema` and
`profile-presets` packages, compiled files committed under `packages/shared-types/src`, the old mock-only test
suites, the old UI, and root-level reports that claimed "100% production ready".

## 3. Repair design (changed after live evidence)
The first live runs showed that rolling back between attempts made the 8B model repeat the same mistake.
Attempts now build on the previous attempt's files: they are judged on the cumulative change since the run
started, the coder sees its current files plus a `KEY ERROR:` headline and focused check output, and short
toolchain notes are added when a known framework is involved (node:test, pytest, unittest). The workspace is
restored only when the run ends without an accepted result, or is stopped or crashes. **[live]**

## 4. Provider and coding-mechanism reality
- **Ollama (local)**: Ollama 0.32.9, model `llama3.1:8b` (the only installed model; nothing was downloaded).
  Used for every live run. **[live]**
- **OpenAI**: implemented with the official SDK. Verified against a local stand-in endpoint (request shape,
  auth header, JSON mode, usage) **[test]**. Not called against api.openai.com in this session, to avoid cost.
  The key in `.env` ends in `…cdef` and appears to be a placeholder, which explains the old "Auth failed" badge.
- **Antigravity IDE 1.107**: installed and running with `Desktop\test` open. Probes **[runtime]**:
  - `antigravity-ide chat -m agent -r "<prompt>"` exits 0 and opens the Agent panel, but does not submit
    the prompt. No file was created in 3 minutes, and a screenshot showed an empty agent panel.
  - `language_server … agentapi new-conversation` refuses with `ANTIGRAVITY_LS_ADDRESS is not set`. It also
    needs `ANTIGRAVITY_CSRF_TOKEN`, which the IDE gives only to processes it launches. Extracting it from
    another process would bypass a security boundary, so it was not attempted.
  - Conclusion: no supported external interface to the native agent. The UI says so. The built-in coder
    executes tasks. "Open folder" uses the documented `antigravity-ide <folder>` CLI.
  - Side effect of the probe: the Agent panel was opened in your IDE window; no files were created.

## 5. Frontend
One dashboard: **Workspace** (folder, project type, detected checks, Git/snapshot safety, Antigravity status)
→ **Task** (text box; the line beneath states exactly which provider, model and mechanism will run) →
**Result** (outcome badge, summary, next step on failure, per-attempt files with diffs, checks before and
after, review, rejection reasons). **History** and a live **Activity** log sit in a side column. Settings and
project configuration are dialogs (keyboard accessible, Escape closes). Light/dark/auto theme, no external
fonts, works at 390px width without horizontal scroll. Every control maps to a working endpoint; unsupported
features (e.g. the Antigravity agent) are shown as unavailable, never as working.
Visually reviewed at 1440×900, 1280×720 and 390×844 in light and dark via headless Playwright screenshots
(the in-app browser pane could not render while its window was in the background).

## 6. Tests and commands (final run, all green)
| Command | Result |
|---|---|
| `npm run build` | exit 0 |
| `npm run lint` | exit 0 (TypeScript strict, all workspaces) |
| `npm test` | 7 files, **70 tests passed**: path safety, snapshots, gate/parsing, providers (fake HTTP servers), process runner, events/SSE, full pipeline (real files, real git, real npm/python checks, scripted model) |
| `npm run test:e2e` | **6 passed**: 4 UI behaviour tests plus 2 live Ollama runs through the real UI. Final run: Node module task **Verified**; README edit in a Git repo **accepted and committed on `main`** ("not fully verified", because a docs-only project has no checks) |

Additional live evidence **[live]**: after the repair redesign, the "math.js + node:test" task from an empty
folder was run 7 times with a recorded outcome: 5 verified, 1 accepted but not fully verified (tests passed;
the reviewer did not fully endorse it), and 1 rejected (the model kept importing a wrong path). One more e2e run
passed before outcomes were logged. Before the redesign, 2 runs were rejected. Every rejection restored the
folder to empty. Typical successful run time: 9–20 s.

## 7. Remaining limitations
- **Model quality**: `llama3.1:8b` handles small, precise tasks but often needs the repair attempt and sometimes
  fails (for example importing the wrong module). Larger tasks need a stronger local model or OpenAI.
- **Whole-file writes**: the built-in coder rewrites complete files, so files larger than ~12k characters are
  shown to the model truncated. Patch-style editing would be the next improvement.
- **Snapshot cost** grows with workspace size (every non-ignored file is hashed per attempt).
- **OpenAI** not exercised against the real service (cost avoidance; the configured key appears to be a placeholder).
- **No authentication** beyond loopback binding, the Host check and CORS. Keys are stored in plain text in
  the user's data directory.
- **Antigravity's agent** cannot be driven (see §4). Supporting it would need an official API or an extension
  that exposes the agent to external callers.

## 8. Running it
```bash
npm install
npm run dev        # http://127.0.0.1:4317
npm test
npm run test:e2e   # live specs need Ollama
```
Your real data directory (`%APPDATA%\AutonomousDevOrchestrator`) was migrated in place (columns added only;
it had no runs left in a running state). Existing projects whose folder is the `orches` repo remain listed but are
refused at run start. Edit or remove them in the dashboard. A copy of the pre-migration database was taken
during the session and deleted with the other temporary files.
