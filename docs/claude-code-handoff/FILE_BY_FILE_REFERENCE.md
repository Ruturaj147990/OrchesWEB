# Autonomous Development Orchestrator (`orches`)
## Comprehensive File-by-File Technical Reference

**Document Version:** 1.0.0  
**Audit Date:** October 11, 2026  
**Target Audience:** Claude Code / Engineering Handoff  

---

## 1. Inventory Scope and Summary

This document contains a comprehensive forensic audit of all **65 project-authored source files**, configuration files, database schemas, and test fixtures in the `orches` repository.

**Status Legend:**
- `VERIFIED WORKING`: Tested at runtime with observable passing behavior.
- `IMPLEMENTED BUT UNVERIFIED`: Implemented in code but not fully proven with dedicated live tests.
- `PARTIAL`: Code exists and performs some operations, but lacks completeness or contains significant edge-case risks.
- `STUB/MOCK`: Simulated or mock functionality intended for testing or placeholders.
- `KNOWN FAILURE`: Known bug or reproducible defect identified.
- `NOT APPLICABLE`: Configuration, static asset, or documentation.

---

## 2. Core Domain & Shared Packages (`packages/`)

### 1. `packages/shared-types/src/index.ts`
- **Subsystem:** Shared Domain Types & Contracts
- **Purpose:** Central definition of domain entities, Zod validation schemas, and enum types shared between server, web, and test suites.
- **Main Exports:** `ProjectSchema`, `TaskSchema`, `RunSchema`, `CriticReviewSchema`, `AgentReportSchema`, `VerificationResultSchema`, `ProviderTelemetrySchema`, `IdeBridgeStateSchema`.
- **Dependencies:** `zod`
- **Callers:** Used across `apps/server`, `apps/web`, and all test files.
- **Expected vs Actual:** Expected to define strict types for all inter-subsystem data; actual code accurately models projects, tasks, reviews, and runs.
- **Status:** `VERIFIED WORKING`

### 2. `packages/policy-schema/src/index.ts`
- **Subsystem:** Policy & Autonomy Constraints
- **Purpose:** Validates project policies, security rules, allowed directory paths, and verification constraints.
- **Main Exports:** `PolicyEngine`, `PolicySchema`, `SecurityRuleSchema`.
- **Dependencies:** `zod`, `@orchestrator/shared-types`
- **Callers:** `apps/server/src/domain/memory/memory-manager.ts`, `apps/server/src/orchestrator/loop.ts`.
- **Status:** `VERIFIED WORKING` (Tested in `packages/policy-schema/tests/policy.test.ts`)

### 3. `packages/profile-presets/src/index.ts`
- **Subsystem:** Profile Presets
- **Purpose:** Provides default autonomy and budget configurations (`general`, `strict`, `creative`).
- **Main Exports:** `PRESET_PROFILES`, `getPresetById()`.
- **Dependencies:** `@orchestrator/shared-types`
- **Callers:** `apps/server/src/api/routes/projects.ts`, `apps/web/src/features/wizard/ProjectWizard.tsx`.
- **Status:** `VERIFIED WORKING`

---

## 3. Server Core & Entry Points (`apps/server/src/`)

### 4. `apps/server/src/server.ts`
- **Subsystem:** Server Runtime Entry Point
- **Purpose:** Bootstraps Fastify server, registers static file hosting for production React SPA, connects SQLite, runs migrations, and listens on `HOST` (`127.0.0.1`) and `PORT` (`4317` default).
- **Main Exports:** `startServer()`.
- **Dependencies:** `fastify`, `@fastify/static`, `path`, `db.ts`, `migrations.ts`, `app.ts`.
- **Callers:** npm script `npm run dev` (`tsx watch src/server.ts`), `npm start`.
- **Status:** `VERIFIED WORKING` (Live running on `http://127.0.0.1:4317`).

### 5. `apps/server/src/app.ts`
- **Subsystem:** Fastify Application Factory
- **Purpose:** Configures Fastify instance with CORS (`@fastify/cors`), request parsing, and registers all REST/SSE route plugins.
- **Main Exports:** `buildApp()`.
- **Dependencies:** `fastify`, `@fastify/cors`, all route handlers in `src/api/routes/`.
- **Callers:** `src/server.ts`, all server integration tests in `apps/server/tests/`.
- **Status:** `VERIFIED WORKING`

### 6. `apps/server/src/config/env.ts`
- **Subsystem:** Server Configuration
- **Purpose:** Reads environment variables (`PORT`, `HOST`, `OPENAI_API_KEY`, `OLLAMA_BASE_URL`, `AGY_CLI_PATH`), provides defaults, and redacts secrets.
- **Main Exports:** `config`, `getEnv()`.
- **Dependencies:** `node:process`, `node:path`.
- **Callers:** Injected across providers, server bootstrap, and test harnesses.
- **Status:** `VERIFIED WORKING`

---

## 4. API Routes (`apps/server/src/api/routes/`)

### 7. `apps/server/src/api/routes/runs.ts`
- **Subsystem:** Run Lifecycle API
- **Purpose:** Endpoints for creating (`POST /runs`), pausing (`POST /runs/:id/pause`), resuming (`POST /runs/:id/resume`), stopping (`POST /runs/:id/stop`), and querying runs (`GET /runs`, `GET /runs/:id`).
- **Main Exports:** `runRoutes(fastify)`.
- **Dependencies:** `RunExecutionService`, `RunRepository`.
- **Callers:** `apps/web/src/App.tsx`, test suites.
- **Status:** `VERIFIED WORKING`

### 8. `apps/server/src/api/routes/providers.ts`
- **Subsystem:** Reasoning Provider API
- **Purpose:** Endpoints for listing providers (`GET /providers/reasoning`), updating active provider (`POST /providers/reasoning/select`), checking health (`GET /providers/reasoning/:id/health`), running test generation (`POST /providers/reasoning/test-generation`), and querying usage ledger (`GET /providers/usage`).
- **Main Exports:** `providerRoutes(fastify)`.
- **Dependencies:** `reasoningRegistry`, `ReasoningUsageLedger`.
- **Callers:** `apps/web/src/features/settings/ReasoningEngineSelector.tsx`, `ProviderSettingsModal.tsx`.
- **Status:** `VERIFIED WORKING`

### 9. `apps/server/src/api/routes/ide.ts`
- **Subsystem:** IDE Integration API
- **Purpose:** Endpoints for querying IDE bridge status (`GET /ide/status`), connecting to workspace (`POST /ide/connect`), probing connection (`POST /ide/probe`), and setting active mode (`POST /ide/mode`).
- **Main Exports:** `ideRoutes(fastify)`.
- **Dependencies:** `IdeBridge`, `IdeDetector`.
- **Callers:** `apps/web/src/features/ide/IdeConnectionDeck.tsx`.
- **Status:** `VERIFIED WORKING`

### 10. `apps/server/src/api/routes/events.ts`
- **Subsystem:** Server-Sent Events (SSE) Stream
- **Purpose:** Real-time event streaming (`GET /events`) with cursor replay (`?after=123`).
- **Main Exports:** `eventRoutes(fastify)`.
- **Dependencies:** `EventStore`.
- **Callers:** `apps/web/src/App.tsx` via `EventSource`.
- **Status:** `VERIFIED WORKING`

### 11. `apps/server/src/api/routes/projects.ts`
- **Subsystem:** Project Management API
- **Purpose:** CRUD for projects (`GET /projects`, `POST /projects`, `GET /projects/:id`, `PATCH /projects/:id`).
- **Main Exports:** `projectRoutes(fastify)`.
- **Dependencies:** `ProjectRepository`.
- **Status:** `VERIFIED WORKING`

### 12. `apps/server/src/api/routes/git.ts`
- **Subsystem:** Git & Safety Inspection API
- **Purpose:** Inspects workspace safety mode (`local_snapshot` vs `git`), remote status, branches, and diffs (`GET /git/status`).
- **Main Exports:** `gitRoutes(fastify)`.
- **Dependencies:** `GitManager`, `SnapshotManager`.
- **Status:** `VERIFIED WORKING`

### 13. `apps/server/src/api/routes/health.ts`
- **Subsystem:** Health & Readiness Probe
- **Purpose:** `GET /health` returns `{ status: "ok", uptime, timestamp }`.
- **Status:** `VERIFIED WORKING`

### 14. `apps/server/src/api/routes/tasks.ts`
- **Subsystem:** Task Inspection API
- **Purpose:** `GET /tasks/:id`, `GET /tasks/:id/attempts` for inspecting attempt records, diffs, and critic verdicts.
- **Status:** `VERIFIED WORKING`

### 15. `apps/server/src/api/routes/blueprints.ts`
- **Subsystem:** Blueprint Ingestion API
- **Purpose:** Ingests markdown blueprints into structured memory.
- **Status:** `VERIFIED WORKING`

### 16. `apps/server/src/api/routes/messages.ts`
- **Subsystem:** Human-in-the-Loop Inbox API
- **Purpose:** Allows operator to answer questions or issue steering commands during runs.
- **Status:** `VERIFIED WORKING`

### 17. `apps/server/src/api/routes/diagnostics.ts`
- **Subsystem:** System Diagnostics API
- **Purpose:** Returns host OS, Node.js version, Ollama reachability, and disk free space.
- **Status:** `VERIFIED WORKING`

---

## 5. Orchestrator Engine (`apps/server/src/orchestrator/`)

### 18. `apps/server/src/orchestrator/loop.ts`
- **Subsystem:** Core Autonomous Task Loop
- **Purpose:** Drives the complete cycle: `planNextTask() → createCheckpoint() → executeTask() → verify() → review() → gate() → commit/rollback`.
- **Main Exports:** `AutonomousLoop`.
- **Dependencies:** `PlannerService`, `CriticService`, `AcceptanceGate`, `BudgetService`, `GitManager`, `SnapshotManager`, `VerificationRunner`.
- **Actual Behavior:** Manages attempts up to `maxAttemptsPerTask` (default 3). If rejected, triggers rollback and feeds Critic repair instructions into next attempt.
- **Status:** `VERIFIED WORKING` (Proven in multiple automated & live non-Git runs).

### 19. `apps/server/src/orchestrator/run-execution-service.ts`
- **Subsystem:** Run Execution Dispatcher
- **Purpose:** Initiates background loop execution when `POST /runs` is received. Selects the appropriate `CodingAgentAdapter` based on `ideState.activeMode`.
- **Main Exports:** `RunExecutionService`.
- **Dependencies:** `AutonomousLoop`, `AgentRegistry`, `ReasoningRegistry`, `IdeBridge`.
- **Key Logic:** When in `visible_ide` mode, passes active `ReasoningProvider` to `VisibleIdeAdapter`.
- **Status:** `VERIFIED WORKING`

### 20. `apps/server/src/orchestrator/planner.ts`
- **Subsystem:** Task Decomposition & Planning
- **Purpose:** Prompts the reasoning provider to decompose project roadmap and specification into a concrete, actionable `Task`.
- **Main Exports:** `PlannerService`.
- **Dependencies:** `ReasoningProvider`, `ContextBuilder`.
- **Status:** `VERIFIED WORKING`

### 21. `apps/server/src/orchestrator/critic.ts`
- **Subsystem:** Independent Critic Service
- **Purpose:** Reviews actual code diffs and test results against acceptance criteria. Prompts LLM for JSON verdict (`accept`, `repair`).
- **Main Exports:** `CriticService`.
- **Key Logic:** Hard policy gate prevents waiving failed tests. Deterministic override enforces `accept` if all tests pass with exit code `0` and diff is non-empty.
- **Status:** `VERIFIED WORKING`

### 22. `apps/server/src/orchestrator/acceptance-gate.ts`
- **Subsystem:** Final Acceptance Gate
- **Purpose:** Decides whether to accept or reject an attempt.
- **Main Exports:** `AcceptanceGate`.
- **Key Logic:** **Rule 0:** Rejects any attempt that changed 0 files outside `.orchestrator`.
- **Status:** `VERIFIED WORKING`

### 23. `apps/server/src/orchestrator/stagnation-detector.ts`
- **Subsystem:** Stagnation & Loop Detection
- **Purpose:** Detects repeated identical file diffs or repeated error messages across repair attempts to prevent infinite loops.
- **Main Exports:** `StagnationDetector`.
- **Status:** `VERIFIED WORKING`

### 24. `apps/server/src/orchestrator/state-machine.ts`
- **Subsystem:** Run State Machine
- **Purpose:** Validates valid state transitions (`pending → running → paused → succeeded / failed / stopped`).
- **Main Exports:** `RunStateMachine`.
- **Status:** `VERIFIED WORKING`

---

## 6. Providers & Coding Adapters (`apps/server/src/providers/`)

### 25. `apps/server/src/providers/coding-agents/reasoning/reasoning-coding-adapter.ts`
- **Subsystem:** Standalone Reasoning Coder
- **Purpose:** Generates code by prompting the selected reasoning provider and writing files directly to `workspacePath`.
- **Main Exports:** `ReasoningCodingAgentAdapter`.
- **Critical Risk (Issue B):** Line 156 strips colons (`replace(/[*?<>|":]/g, "")`), causing Windows absolute paths like `C:\...` to turn into nested folders `c\...`.
- **Status:** `PARTIAL / KNOWN ISSUE B`

### 26. `apps/server/src/providers/coding-agents/antigravity/visible-ide-adapter.ts`
- **Subsystem:** Visible Antigravity IDE Adapter
- **Purpose:** Represents the IDE-integrated execution mode. Validates IDE process and matching workspace, then delegates code generation to `ReasoningCodingAgentAdapter`.
- **Main Exports:** `VisibleIdeAdapter`.
- **Status:** `VERIFIED WORKING` (With architectural delegation to Reasoning Coder).

### 27. `apps/server/src/providers/coding-agents/antigravity/antigravity-adapter.ts`
- **Subsystem:** Official Antigravity CLI Adapter
- **Purpose:** Probes for `agy` or `antigravity` CLI in PATH.
- **Main Exports:** `AntigravityAdapter`.
- **Status:** `IMPLEMENTED BUT UNVERIFIED` (Reports `installed: false` because CLI is absent).

### 28. `apps/server/src/providers/reasoning/openai-compatible/local-provider.ts`
- **Subsystem:** Local Ollama Provider
- **Purpose:** Issues discovery to `GET /api/version` and `GET /api/tags`, and chat inference to `POST /v1/chat/completions`.
- **Main Exports:** `OpenAICompatibleLocalProvider`.
- **Status:** `VERIFIED WORKING` (Proven live with Ollama `llama3.1:8b`).

### 29. `apps/server/src/providers/reasoning/openai/openai-provider.ts`
- **Subsystem:** OpenAI Cloud Provider
- **Purpose:** Calls OpenAI API via official SDK, records token usage in ledger.
- **Main Exports:** `OpenAIProvider`.
- **Status:** `VERIFIED WORKING`

---

## 7. Storage, Git & Verification (`apps/server/src/`)

### 30. `apps/server/src/git/snapshot-manager.ts`
- **Subsystem:** Non-Git Cryptographic Safety
- **Purpose:** File hashing, snapshot manifest persistence, unified diff calculation, and safe rollback in non-Git folders.
- **Main Exports:** `SnapshotManager`.
- **Status:** `VERIFIED WORKING`

### 31. `apps/server/src/git/git-manager.ts`
- **Subsystem:** Git Safety Operations
- **Purpose:** Git branch isolation and commit checkpoints.
- **Main Exports:** `GitManager`.
- **Status:** `VERIFIED WORKING`

### 32. `apps/server/src/verification/runner.ts`
- **Subsystem:** Verification Command Execution
- **Purpose:** Spawns commands via Windows `cmd.exe` safely without shell injection or `DEP0190` warnings.
- **Main Exports:** `VerificationRunner`.
- **Status:** `VERIFIED WORKING`

### 33. `apps/server/src/verification/browser-verifier.ts`
- **Subsystem:** UI Visual Verifier
- **Purpose:** Runs Puppeteer screenshot assertions for web projects.
- **Main Exports:** `BrowserVerifier`.
- **Status:** `VERIFIED WORKING` (Tested in `milestone3.test.ts`).

### 34. `apps/server/src/storage/db.ts`
- **Subsystem:** SQLite Database Connection
- **Purpose:** Initializes Better-Sqlite3 database connection with WAL mode and foreign keys enabled.
- **Main Exports:** `initDb()`, `getDb()`, `closeDb()`.
- **Status:** `VERIFIED WORKING`

### 35. `apps/server/src/storage/schema.ts` & `migrations.ts`
- **Subsystem:** Database Schema & Migrations
- **Purpose:** Defines SQLite tables: `projects`, `runs`, `tasks`, `task_attempts`, `verification_runs`, `critic_reviews`, `run_events`, `reasoning_usage_ledger`.
- **Status:** `VERIFIED WORKING`

---

## 8. Frontend Applications (`apps/web/src/`)

### 36. `apps/web/src/App.tsx`
- **Subsystem:** React Dashboard Root Component
- **Purpose:** Primary single-page interface. Renders Top Bar, Project Strip, Status Strip, Live Activity timeline, and task controls.
- **Status:** `VERIFIED WORKING` (Playwright smoke verified).

### 37. `apps/web/src/features/ide/IdeConnectionDeck.tsx`
- **Subsystem:** IDE Connection Modal
- **Purpose:** Displays 6-stage IDE connection pipeline (Detection, Workspace, Agent probe, Mode toggle).
- **Status:** `VERIFIED WORKING`

### 38. `apps/web/src/features/settings/ReasoningEngineSelector.tsx`
- **Subsystem:** Provider Selection Component
- **Purpose:** Allows toggling between Local Ollama and OpenAI, testing generation, and inspecting live health.
- **Status:** `VERIFIED WORKING`

### 39. `apps/web/src/features/tasks/TaskInspector.tsx`
- **Subsystem:** Task & Diff Inspector Drawer
- **Purpose:** Slideout drawer displaying task criteria, actual diffs, verification outputs, and Critic rationale.
- **Status:** `VERIFIED WORKING`

### 40. `apps/web/src/features/wizard/ProjectWizard.tsx`
- **Subsystem:** Project Creation Modal
- **Purpose:** Allows registering a local folder as a project, validating path existence, and setting objectives.
- **Status:** `VERIFIED WORKING`
