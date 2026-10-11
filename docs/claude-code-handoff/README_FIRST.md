# Autonomous Development Orchestrator (`orches`)
## Claude Code Engineering Handoff: README FIRST

**Document Version:** 1.0.0  
**Audit Date:** October 11, 2026  
**Auditor:** Senior Software Architect & Repository Auditor (DeepMind Antigravity Pair-Programmer)  
**Target Audience:** Claude Code / Senior Engineering Handoff  
**Workspace Path:** `c:\Users\limbk\OneDrive\Desktop\orches`  
**Host Environment:** Windows 11 Pro (x64), Node.js v24.19.0, npm 11.17.0, Ollama v0.32.9 (live at `http://127.0.0.1:11434`)  
**Git Branch Baseline:** `orchestrator/proj-49ff4dcf-a699-45af-b6b7-4e7ca5bc15ec/task-7460/attempt-1` (Commit: `b5b58dd`)

---

## 1. Executive Orientation: What This Product Actually Is vs What Was Envisioned

### The Vision
The **Autonomous Development Orchestrator** is intended to be a local-first, multi-stage software development harness that bridges high-level requirements (Blueprints/Roadmaps) to verified code in user workspaces. The envisioned system coordinates:
1. **Reasoning Engines:** Switchable between Cloud (OpenAI API: `gpt-4o`, `o1-preview`) and 100% Private Local LLMs (Ollama: `llama3.1:8b`).
2. **Coding Agents:** Delegating code generation to specialized agents—specifically the native **Antigravity IDE Agent** (via editor integration or CLI) or standalone reasoning coders.
3. **Autonomous Execution Loop:** A strict cycle: `Planner → Coding Agent → Independent Verifier → Critic Review → Acceptance Gate → Git / Snapshot Checkpoint`.
4. **Safety & Confinement:** Working in both Git and non-Git repositories without corrupting user files, with cryptographic rollback and budget enforcement.
5. **Single-Page Dashboard:** An uncluttered React dashboard providing live SSE telemetry, provider switching, and run lifecycle control without confusing permanent sidebars.

### The Reality (Current State as of Commit `b5b58dd`)
- **Technology Stack:** npm workspaces monorepo containing:
  - `packages/shared-types`: Canonical TypeScript types and Zod schemas.
  - `packages/policy-schema`: Policy definitions and validation.
  - `packages/profile-presets`: Presets for autonomy modes and budgets.
  - `apps/server`: Fastify 5.2.1 REST & SSE backend, Better-Sqlite3 persistence, child process verification.
  - `apps/web`: React 19, Vite 6.4.4, Vanilla CSS design system, dark/light theme.
- **Completion Level:** ~80% functionally complete. The backend execution loop, database migrations, local Ollama integration, snapshot manager, and unit test coverage are functional and verified.
- **Crucial Architectural Catch:** The **Visible Antigravity IDE Adapter does NOT talk to an internal Antigravity AI Agent**. Instead, it verifies that the Antigravity/VS Code editor process is open with the matching workspace, and then delegates code generation directly to `ReasoningCodingAgentAdapter` (which prompts Ollama or OpenAI to output JSON file diffs, writing them straight to the disk).
- **Recent Forensic Fixes:** The orchestrator was previously failing because `VisibleIdeAdapter` was an empty stub returning 0 files, Windows drive paths with leading slashes resolved to `C:\`, and the Critic hallucinated rejections on passing tests. These were fixed in commit `b5b58dd`, enabling a live Ollama run to succeed in 14.7 seconds. However, critical edge cases remain (such as path colon stripping creating nested drive folders).

---

## 2. Directory Navigation & Reading Order

The audit documentation has been divided into 8 focused documents inside `docs/claude-code-handoff/`:

```
docs/claude-code-handoff/
├── README_FIRST.md                        <-- [You are here] Executive orientation and warnings
├── FILE_BY_FILE_REFERENCE.md              <-- Complete inventory of all 54+ authored source files
├── ARCHITECTURE_AND_DATA_FLOW.md          <-- End-to-end lifecycle, component breakdown & Mermaid diagrams
├── REQUIREMENTS_TRACEABILITY.md           <-- Requirements matrix, gap analysis & P0-P3 priorities
├── KNOWN_ISSUES_AND_FAILURE_ANALYSIS.md   <-- Deep-dive into historical & discovered defects (Issues A through J)
├── TEST_AND_VERIFICATION_REPORT.md        <-- Test suite status, mocks, evidence & real-world smoke test
├── CLAUDE_CODE_REPAIR_PLAN.md             <-- Prioritized step-by-step engineering roadmap for Claude Code
└── OPEN_QUESTIONS_AND_UNVERIFIED_CLAIMS.md<-- Missing protocol specs, unverified assumptions & risks
```

### Recommended Reading Order for Claude Code:
1. **`README_FIRST.md`**: Understand the architecture, top pitfalls, and operating constraints.
2. **`KNOWN_ISSUES_AND_FAILURE_ANALYSIS.md`**: Study the exact failure mechanisms (especially Issue B: the nested directory bug, and Issue D: the IDE agent reality).
3. **`ARCHITECTURE_AND_DATA_FLOW.md`**: Follow the Mermaid trace of `POST /runs` to file write and acceptance gate.
4. **`FILE_BY_FILE_REFERENCE.md`**: Reference specific files when modifying code.
5. **`CLAUDE_CODE_REPAIR_PLAN.md`**: Follow the structured, phased plan to stabilize the codebase.

---

## 3. Top Critical Defects & Warnings for Claude Code

Before making any code edits, Claude Code must be fully aware of these top 6 issues:

### 1. P0 Bug: Drive Colon Stripping Creates Nested Replicas in Workspace (Issue B)
- **Location:** `apps/server/src/providers/coding-agents/reasoning/reasoning-coding-adapter.ts:156`
- **Mechanism:** `let rawPath = item.path.trim().replace(/[*?<>|":]/g, "");`
- **Consequence:** If the LLM generates an absolute Windows path like `C:\Users\limbk\OneDrive\Desktop\test\README.md`, removing `:` turns `C:` into the relative folder name `C`. Resolving it against `workspacePath` creates `c:\Users\limbk\OneDrive\Desktop\test\c\Users\limbk\OneDrive\Desktop\test\README.md`!
- **Evidence:** The user's active document at the time of this audit was literally: `c:\Users\limbk\OneDrive\Desktop\test\c\Users\limbk\OneDrive\Desktop\test\README.md`.

### 2. P1 Architectural Fact: Native Antigravity IDE Integration is Simulated / Delegated (Issue D)
- **Location:** `apps/server/src/providers/coding-agents/antigravity/visible-ide-adapter.ts:90-107`
- **Mechanism:** `VisibleIdeAdapter` does not communicate via IPC, LSP, or extension protocol to Antigravity's internal model. It checks process PID via `IdeDetector` and `IdeBridge`, then delegates code generation to `ReasoningCodingAgentAdapter(activeProvider)`.
- **Consequence:** Do not assume there is an active Antigravity extension bridge. If native agent control is required, an actual extension protocol or CLI bridge (`agy`) must be designed.

### 3. P1 Flaw: Overly Prescriptive File Synthesis Can Mask Model Failures (Issue C)
- **Location:** `apps/server/src/providers/coding-agents/reasoning/reasoning-coding-adapter.ts:225-295`
- **Mechanism:** If the LLM fails to generate `package.json`, `test.js`, `project.js`, or `README.md`, the adapter synthesizes fallback boilerplate to satisfy Node.js test runs.
- **Consequence:** While this prevents crash loops on Node.js hello-world tasks, it hardcodes Node.js assumptions into non-Node projects (e.g. Python, Rust, Go). It must be generalized or scoped strictly to project profile types.

### 4. P1 Fragility: Critic Skepticism vs Deterministic Pass Overrides (Issue E)
- **Location:** `apps/server/src/orchestrator/critic.ts:80-105`
- **Mechanism:** Small local models (`llama3.1:8b`) frequently hallucinate that test output exit codes "need to be documented" even when exit code was `0`. A deterministic override was added to enforce `accept` when all verifiers pass with exit code `0` and diff is non-empty.
- **Consequence:** Claude Code must ensure that semantic code quality (e.g. bugs not caught by existing tests) is still reviewable by human or critic without triggering premature rollback loops.

### 5. P2 Warning: Windows Child Process Spawning & DEP0190 (Issue G)
- **Location:** `apps/server/src/verification/runner.ts:75-92`
- **Mechanism:** Windows Node.js 22/24 emits `DEP0190` if `child_process.spawn` uses `shell: true`. In commit `b5b58dd`, this was replaced with `process.env.ComSpec || "cmd.exe"` using `["/d", "/s", "/c", cmdLine]` and `windowsVerbatimArguments: true`.
- **Consequence:** Do NOT revert back to `shell: true` or unquoted cmdLine interpolation, as this reintroduces deprecation warnings and argument injection risks.

### 6. P0 Safety Constraint: Power & Workspace Preservation Policy
- **Rule:** **NEVER issue Windows reboot or shutdown commands.** The user's system must remain powered on.
- **Rule:** **NEVER write or delete files in the user's personal desktop folders (`c:\Users\limbk\OneDrive\Desktop\test` etc.) during automated tests.** All automated regression tests must use temporary directories (`fs.mkdtempSync(path.join(os.tmpdir(), ...))`).

---

## 4. Key Entry Points for Understanding the System

| Subsystem | Primary Source File | What to Inspect |
|---|---|---|
| **Server Entry & Fastify Setup** | `apps/server/src/server.ts` & `app.ts` | Route registration, CORS, SSE plugin, error handlers |
| **Run Orchestration Loop** | `apps/server/src/orchestrator/loop.ts` | Task creation, attempt loop, repair cycle, checkpointing |
| **Execution Dispatcher** | `apps/server/src/orchestrator/run-execution-service.ts` | Adapter selection, provider binding, background loop spawn |
| **Reasoning Provider (Local Ollama)** | `apps/server/src/providers/reasoning/openai-compatible/local-provider.ts` | Ollama endpoint normalization (`/api/version` vs `/v1`), chat generation |
| **Reasoning Provider (OpenAI)** | `apps/server/src/providers/reasoning/openai/openai-provider.ts` | OpenAI SDK client, token usage, cost tracking |
| **Coding Adapter (Reasoning)** | `apps/server/src/providers/coding-agents/reasoning/reasoning-coding-adapter.ts` | Prompt construction, JSON extraction, path resolution, file writing |
| **Coding Adapter (Visible IDE)** | `apps/server/src/providers/coding-agents/antigravity/visible-ide-adapter.ts` | IDE bridge handshake, workspace verification, delegation |
| **Verification & Command Runner** | `apps/server/src/verification/runner.ts` | Windows `cmd.exe` process execution, exit code capture, timeout |
| **Critic & Review Service** | `apps/server/src/orchestrator/critic.ts` | LLM review prompt, criteria evaluation, deterministic gates |
| **Acceptance Gate** | `apps/server/src/orchestrator/acceptance-gate.ts` | Rule 0 (non-metadata files check), rollback trigger, snapshot commit |
| **Snapshot & Non-Git Safety** | `apps/server/src/git/snapshot-manager.ts` | Cryptographic file hashing, manifest storage, unified diffs, rollback |
| **Frontend Root & State** | `apps/web/src/App.tsx` | Dashboard UI layout, SSE event listener, run state polling |

---

## 5. Verification Commands You Can Run Safely

All of the following commands were executed and verified during this audit. They are completely safe and do not touch user data:

```powershell
# 1. Typecheck and build all monorepo packages and applications (~540ms)
npm run build

# 2. Run all 12 Vitest unit & integration test suites (59/59 passing, ~6.5s)
npm test

# 3. Run all 5 Playwright end-to-end browser test suites (5/5 passing, ~25s)
npx playwright test
```

Proceed now to **`docs/claude-code-handoff/ARCHITECTURE_AND_DATA_FLOW.md`** and **`docs/claude-code-handoff/KNOWN_ISSUES_AND_FAILURE_ANALYSIS.md`**.
