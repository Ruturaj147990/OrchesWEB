# Autonomous Development Orchestrator (`orches`)
## Requirements Traceability Matrix

**Document Version:** 1.0.0  
**Audit Date:** October 11, 2026  
**Target Audience:** Claude Code / Engineering Handoff  

---

## 1. Traceability Matrix Table

| ID | Requirement | Intended Behavior | Actual Implementation | Evidence Reference | Verification Status | Gap / Risk | Priority |
|---|---|---|---|---|---|---|---|
| **REQ-01** | Reasoning Provider Selection | Switch between OpenAI API and Local Ollama via UI and REST API. | `ReasoningRegistry` stores providers; `POST /providers/reasoning/select` updates active provider in SQLite settings. | `apps/server/src/providers/reasoning/registry.ts:15` | `VERIFIED WORKING` | Active provider changes take effect immediately across all subsystems. | **P1** |
| **REQ-02** | Local Ollama Integration | Auto-detect Ollama on `127.0.0.1:11434`, query installed models, issue chat completions. | `OpenAICompatibleLocalProvider` queries `/api/tags` and `/api/version`, chats via `/v1/chat/completions`. | `apps/server/src/providers/reasoning/openai-compatible/local-provider.ts:40` | `VERIFIED WORKING` | Probed live `llama3.1:8b` (11ms ping, 5.8s generation). | **P1** |
| **REQ-03** | OpenAI API Integration | Call OpenAI API, track tokens and costs, redact keys. | `OpenAIProvider` uses official SDK, persists token counts and USD estimates to `reasoning_usage_ledger`. | `apps/server/src/providers/reasoning/openai/openai-provider.ts:35` | `VERIFIED WORKING` | Keys redacted in logs; unit tests pass in `milestone2.test.ts`. | **P1** |
| **REQ-04** | Visible IDE Mode Execution | Execute coding tasks in active IDE workspace. | `VisibleIdeAdapter` checks IDE process and workspace match, delegates to `ReasoningCodingAgentAdapter`. | `apps/server/src/providers/coding-agents/antigravity/visible-ide-adapter.ts:91` | `PARTIAL` | Does not call native IDE AI agent; delegates to reasoning coder. | **P1** |
| **REQ-05** | Native Antigravity CLI Integration | Spawn official `agy` CLI in headless mode. | `AntigravityAdapter` probes `agy` / `antigravity` in PATH. Returns `installed: false` if missing. | `apps/server/src/providers/coding-agents/antigravity/antigravity-adapter.ts:28` | `IMPLEMENTED BUT UNVERIFIED` | `agy` CLI binary is not present on the host Windows machine. | **P2** |
| **REQ-06** | Real File Generation | Generate concrete source files in target workspace. | `ReasoningCodingAgentAdapter` parses JSON response, writes files with `fs.writeFileSync`. | `apps/server/src/providers/coding-agents/reasoning/reasoning-coding-adapter.ts:186` | `VERIFIED WORKING` | Smoke test created `package.json`, `project.js`, `README.md`, `test.js`. | **P0** |
| **REQ-07** | Workspace Confinement & Path Security | Prevent writing outside workspace or in restricted directories (`.git`, `.env`). | Resolves paths against `workspacePath` and checks `fullPath.startsWith(resolvedWorkspace)`. | `apps/server/src/providers/coding-agents/reasoning/reasoning-coding-adapter.ts:169` | `KNOWN ISSUE` | **Issue B:** Stripping `:` from Windows absolute paths turns `C:\` into folder `c\`, nesting inside workspace! | **P0** |
| **REQ-08** | Task Planning | Decompose roadmap and specification into actionable, bounded tasks. | `PlannerService` builds context from memory and prompts LLM for JSON task definition. | `apps/server/src/orchestrator/planner.ts:25` | `VERIFIED WORKING` | Generated `TASK-002` ("Set up Basic Project Structure") in live test. | **P1** |
| **REQ-09** | Independent Verification | Run test commands via safe platform process invocation. | `VerificationRunner` invokes commands using Windows `cmd.exe /c` without `shell: true`. | `apps/server/src/verification/runner.ts:75` | `VERIFIED WORKING` | Zero `DEP0190` warnings; captured `node --test` with exit code `0`. | **P1** |
| **REQ-10** | Independent Critic Review | LLM reviews actual code diffs and test results against criteria. | `CriticService` builds diff and verification summary, prompts LLM for verdict. Deterministic overrides enforce truth. | `apps/server/src/orchestrator/critic.ts:60` | `VERIFIED WORKING` | Overrides prevent small LLMs from hallucinating rejections on passing code. | **P1** |
| **REQ-11** | Acceptance Gate Rule 0 | Never accept a task if only internal metadata was modified. | `AcceptanceGate` checks non-metadata files changed in diff. Rejects if 0 files outside `.orchestrator`. | `apps/server/src/orchestrator/acceptance-gate.ts:25` | `VERIFIED WORKING` | Tested in `milestone3.test.ts` and `git-optional-and-snapshots.test.ts`. | **P0** |
| **REQ-12** | Non-Git Workspace Safety | Support local projects without `.git` or GitHub connection. | `SnapshotManager` creates SHA-256 snapshots in `.orchestrator/snapshots/`, computes unified diffs, restores on rollback. | `apps/server/src/git/snapshot-manager.ts:40` | `VERIFIED WORKING` | 8 automated tests pass; verified in disposable non-Git directory. | **P1** |
| **REQ-13** | Git Workspace Safety | Isolate attempts on Git branches, commit on accept, revert on fail. | `GitManager` creates branches `orchestrator/<project>/<task>/attempt-<n>`, creates commits, checks dirty working trees. | `apps/server/src/git/git-manager.ts:50` | `VERIFIED WORKING` | Tested in `milestone1.test.ts` and `real-world-e2e.test.ts`. | **P1** |
| **REQ-14** | Single-Page React Dashboard | Clear, unified dashboard at `/` with zero permanent sidebars. | `App.tsx` provides Top Bar, Project Strip, Status Strip, Live Activity timeline, and slideout modals/drawers. | `apps/web/src/App.tsx:20` | `VERIFIED WORKING` | 5/5 Playwright tests passing across all viewports. | **P2** |
| **REQ-15** | Real-Time SSE Telemetry | Stream events and logs to the browser in real time. | `EventStore` emits events, Fastify serves SSE at `GET /api/v1/events`, React updates state via `EventSource`. | `apps/server/src/events/event-store.ts:15` | `VERIFIED WORKING` | Playwright test validates `run.started` and `task.attempt_started` stream. | **P2** |
| **REQ-16** | Bounded Repair & Stagnation Detection | Bound repair cycles to prevent infinite retry loops. | `AutonomousLoop` checks `maxAttemptsPerTask` (3); `StagnationDetector` flags identical diffs. | `apps/server/src/orchestrator/stagnation-detector.ts:20` | `VERIFIED WORKING` | Stops run with status `stalled` when repair attempts are exhausted. | **P1** |

---

## 2. Priority Classification Definitions

- **P0 — Critical:** Security vulnerability, path escape, destructive data loss, or fundamental file-writing integrity failure (e.g. Issue B: Colon stripping nested directory creation).
- **P1 — High:** Core workflow failure, incorrect agent delegation, or potential false-positive acceptance.
- **P2 — Medium:** Feature gaps, unverified external CLI tools, or dashboard state synchronization flakiness.
- **P3 — Low:** Cosmetic styling, documentation typos, or minor telemetry formatting.
