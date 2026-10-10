# Autonomous Development Orchestrator — Implementation State

**Current Milestone:** Milestone 2 — Minimum real provider and coding-agent adapters (IN PROGRESS)  
**Last Updated:** 2026-10-10  
**Overall Status:** Milestones 0 & 1 Complete. Executing Milestone 2.

---

## 1. Milestone Tracking

- [x] **Milestone 0 — Repository foundation** (COMPLETED)
  - Monorepo, TypeScript strict mode, Fastify loopback health, React+Vite dashboard shell, Vitest (5/5 tests), Playwright baseline screenshot.
- [x] **Milestone 1 — Persistence and bare control dashboard** (COMPLETED)
  - SQLite storage engine with WAL mode and idempotent migrations runner.
  - Relational schema: `projects`, `runs`, `tasks`, `task_attempts`, `critic_reviews`, `verification_runs`, `run_events`, `human_messages`, `budget_counters`, `approvals`, `artifacts`, `provider_profiles`, `roadmap_items`, `project_config_versions`.
  - Project REST API: `POST /api/v1/projects`, `GET /api/v1/projects`, `GET /api/v1/projects/:projectId`.
  - Durable event store with per-project sequence numbering, subscriber dispatch, and cursor replay.
  - Server-Sent Events (SSE) route: `GET /api/v1/projects/:projectId/events` with heartbeat and reconnection replay.
  - Run state machine enforcing valid lifecycle transitions (`ready -> running -> paused -> stopped`), idempotency on repeated start, and rejecting invalid transitions.
  - React dashboard wired to backend REST and live SSE event stream.
  - Tests passing (8/8 unit/integration tests + Playwright E2E).
- [ ] **Milestone 2 — Minimum real provider and coding-agent adapters** (IN PROGRESS)
  - Normalized `ReasoningProvider` interface and provider registry.
  - OpenAI API adapter (cloud reasoning with key protection).
  - OpenAI-compatible local endpoint adapter (Ollama/llama.cpp/vLLM) with Local-only enforcement (no silent cloud fallback).
  - Official Antigravity CLI discovery/probe and minimal headless adapter.
  - Normalized coding-agent interface and deterministic mock adapter for testing.
  - Schema-validated Planner/Executor/Critic message contracts; fresh agent session per task attempt.
  - Preliminary token/usage tracker and budget enforcement hooks ($0.50 warning, $2.00 hard task ceiling, $10.00 run ceiling).
- [ ] **Milestone 3 — Early autonomous vertical slice (Mandatory Feasibility Gate)**
- [ ] **Milestone 4 — Cost accuracy, reliability, context compaction, and recovery**
- [ ] **Milestone 5 — Project wizard, autonomy modes, profiles, and blueprint import**
- [ ] **Milestone 6 — Human direction and full browser/visual verification**
- [ ] **Milestone 7 — Advanced UI, export, and hardening**

---

## 2. Completed Work
- Database persistence layer with WAL mode and full migration schema.
- Project and Run repositories with SQLite prepared statements.
- Run state machine with full transition validation and audit logging.
- Durable EventStore with sequence tracking and SSE live streaming.
- Real-time React frontend integration with controls, metrics, and event log.

---

## 3. Changed Files
- `apps/server/src/storage/schema.ts`
- `apps/server/src/storage/migrations.ts`
- `apps/server/src/storage/repositories/project-repository.ts`
- `apps/server/src/storage/repositories/run-repository.ts`
- `apps/server/src/events/event-store.ts`
- `apps/server/src/orchestrator/state-machine.ts`
- `apps/server/src/api/routes/projects.ts`
- `apps/server/src/api/routes/runs.ts`
- `apps/server/src/api/routes/events.ts`
- `apps/server/src/app.ts`
- `apps/server/tests/milestone1.test.ts`
- `apps/web/src/App.tsx`
- `TASK_CHECKLIST.md`
- `IMPLEMENTATION_STATE.md`

---

## 4. Actual Test Results
- `npm run build`: Exit Code 0 (all workspaces compiled).
- `npm test`: 3 test files, 8 passed, 0 failed.
- `npx playwright test`: 1 passed (2.9s).

---

## 5. Architectural Decisions
1. **Durable SSE Streams**: Events are stored first with monotonically incremented `event_seq` per project, ensuring clients can resume from any cursor without missed messages.
2. **Idempotent Runs**: Starting a project that already has an active run returns the existing run instead of spawning multiple workers.
3. **Strict State Transitions**: Run state transitions are validated by `VALID_TRANSITIONS` table before database update.

---

## 6. Known Issues / Blockers
- None.

---

## 7. Exact Next Steps for Milestone 2
1. Implement `ReasoningProvider` interface and registry in `apps/server/src/providers/reasoning/`.
2. Implement OpenAI cloud reasoning adapter with token tracking and secret protection.
3. Implement OpenAI-compatible local reasoning adapter with capability probe and strict Local-only policy (no cloud fallback).
4. Implement `CodingAgentAdapter` interface and registry in `apps/server/src/providers/coding-agents/`.
5. Implement Antigravity CLI adapter with version/help/auth probe, headless execution, event parsing, safe timeout and cancellation.
6. Implement `MockAgentAdapter` for deterministic automated testing.
7. Implement budget enforcement service with token/usage counters and cost ceilings.
8. Write comprehensive unit and integration tests for providers, adapters, and budget cut-offs.
