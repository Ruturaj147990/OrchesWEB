# Autonomous Development Orchestrator — Implementation State

**Current Milestone:** Milestone 3 — Early autonomous vertical slice (IN PROGRESS - MANDATORY FEASIBILITY GATE)  
**Last Updated:** 2026-10-10  
**Overall Status:** Milestones 0, 1 & 2 Complete. Executing Milestone 3.

---

## 1. Milestone Tracking

- [x] **Milestone 0 — Repository foundation** (COMPLETED)
  - Monorepo, TypeScript strict mode, Fastify loopback health, React dashboard shell, Vitest (5/5 tests), Playwright baseline screenshot.
- [x] **Milestone 1 — Persistence and bare control dashboard** (COMPLETED)
  - SQLite storage engine with WAL mode and idempotent migrations runner.
  - Relational schema: `projects`, `runs`, `tasks`, `task_attempts`, `critic_reviews`, `verification_runs`, `run_events`, `human_messages`, `budget_counters`, `approvals`, `artifacts`, `provider_profiles`, `roadmap_items`, `project_config_versions`.
  - Project REST API: `POST /api/v1/projects`, `GET /api/v1/projects`, `GET /api/v1/projects/:projectId`.
  - Durable event store with per-project sequence numbering, subscriber dispatch, and cursor replay.
  - Server-Sent Events (SSE) route: `GET /api/v1/projects/:projectId/events` with heartbeat and reconnection replay.
  - Run state machine enforcing valid lifecycle transitions (`ready -> running -> paused -> stopped`), idempotency on repeated start, and rejecting invalid transitions.
  - React dashboard wired to backend REST and live SSE event stream.
- [x] **Milestone 2 — Minimum real provider and coding-agent adapters** (COMPLETED)
  - Normalized `ReasoningProvider` interface and `ReasoningRegistry`.
  - `OpenAIProvider`: Cloud reasoning with API key protection and token tracking.
  - `OpenAICompatibleLocalProvider`: Local reasoning with `/models` health probe and strict Local-only enforcement (no silent cloud fallback on disconnect).
  - `AntigravityAdapter`: Official Antigravity CLI adapter (`agy`) with capability/version probing, headless execution, streaming event capture, and safe cancellation.
  - `MockAgentAdapter`: Deterministic test mock supporting success, test failure, file editing, permission denial, and timeout modes.
  - `BudgetService`: Pre-flight budget reservation, token cost calculation, $0.50 soft warning, $2.00 hard task ceiling, $10.00 hard run ceiling, and hard cut-off prevention.
  - Tests passing (14/14 unit/integration tests + Playwright E2E).
- [ ] **Milestone 3 — Early autonomous vertical slice (Mandatory Feasibility Gate)** (IN PROGRESS)
  - Implement complete Planner -> isolated Git worktree/branch -> Executor (Mock/Antigravity) -> independent Orchestrator verifier (lint/typecheck/test/build + Playwright browser/screenshot for UI) -> independent Critic review -> Git checkpoint commit & integration -> dashboard evidence & timeline.
  - Implement bounded repair loop on verifier/Critic failure with fresh context.
  - Implement hard budget stop before model/agent dispatch.
  - Feasibility gate tests: failing check -> mock agent fix -> independent verifier pass -> Critic accept -> commit checkpoint; UI browser assertion & screenshot artifact; budget cut-off; restart recovery.
- [ ] **Milestone 4 — Cost accuracy, reliability, context compaction, and recovery**
- [ ] **Milestone 5 — Project wizard, autonomy modes, profiles, and blueprint import**
- [ ] **Milestone 6 — Human direction and full browser/visual verification**
- [ ] **Milestone 7 — Advanced UI, export, and hardening**

---

## 2. Completed Work
- Implemented `ReasoningProvider`, `OpenAIProvider`, `OpenAICompatibleLocalProvider`, and `ReasoningRegistry`.
- Implemented `CodingAgentAdapter`, `AntigravityAdapter`, `MockAgentAdapter`, and `AgentRegistry`.
- Implemented `BudgetService` with pre-flight checks and cost calculation catalogue.
- Verified all 14 unit and integration tests and Playwright E2E.

---

## 3. Changed Files
- `apps/server/src/providers/reasoning/provider.ts`
- `apps/server/src/providers/reasoning/openai/openai-provider.ts`
- `apps/server/src/providers/reasoning/openai-compatible/local-provider.ts`
- `apps/server/src/providers/reasoning/registry.ts`
- `apps/server/src/providers/coding-agents/adapter.ts`
- `apps/server/src/providers/coding-agents/antigravity/antigravity-adapter.ts`
- `apps/server/src/providers/coding-agents/mock/mock-adapter.ts`
- `apps/server/src/providers/coding-agents/registry.ts`
- `apps/server/src/domain/budgets/budget-service.ts`
- `apps/server/tests/milestone2.test.ts`
- `TASK_CHECKLIST.md`
- `IMPLEMENTATION_STATE.md`

---

## 4. Actual Test Results
- `npm run build`: Exit Code 0.
- `npm test`: 4 test files, 14 passed, 0 failed (795ms).
- `npx playwright test`: 1 passed (2.9s).

---

## 5. Architectural Decisions
1. **Separation of Reasoning & Agent**: Reasoning providers and coding agents have separate registries, credentials, and privacy classes.
2. **Deterministic Test Mocking**: Production defaults to Antigravity CLI; test suite uses deterministic `MockAgentAdapter` for guaranteed repeatability without external network dependencies.
3. **Pre-flight Budget Reservation**: Budget is checked and atomically reserved *before* dispatching model calls.

---

## 6. Known Issues / Blockers
- None.

---

## 7. Exact Next Steps for Milestone 3
1. Implement canonical project memory files (`SPEC.md`, `DECISIONS.md`, `.orchestrator/ROADMAP.md`, `REPO_MAP.md`, `CURRENT_STATE.md`) and Planner Context Builder.
2. Implement Planner role: decomposes roadmap into schema-valid task contract linked to approved roadmap items.
3. Implement Git Worktree & Branch Isolation Manager (`orchestrator/<project-id>/<task-id>/attempt-<n>`) with checkpoint commit & safe integration.
4. Implement Independent Verification Runner: executes lint, typecheck, test, build, and captures argv, exit code, duration, logs, and evidence IDs.
5. Implement Playwright `BrowserVerifier`: starts supervised dev server, executes browser assertions, captures console/network errors, and saves desktop/mobile screenshots.
6. Implement Independent Critic role: reviews diff + actual verifier evidence against acceptance criteria without seeing Planner verdict.
7. Implement Deterministic Acceptance Gate: requires all mandatory checks pass, criteria verified, Critic accept, and commits checkpoint.
8. Implement Autonomous Loop Orchestrator connecting all stages with repair attempts on failure.
9. Write comprehensive Milestone 3 integration tests verifying:
   - Failing test fixture -> mock repair attempt -> verifier pass -> Critic accept -> Git checkpoint;
   - Web UI task verifying browser assertion + screenshot artifact;
   - Budget cut-off blocking dispatch;
   - State persistence and restart resumption.
