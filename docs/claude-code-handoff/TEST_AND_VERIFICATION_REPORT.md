# Autonomous Development Orchestrator (`orches`)
## Test & Verification Audit Report

**Document Version:** 1.0.0  
**Audit Date:** October 11, 2026  
**Host Environment:** Windows 11 Pro (x64), Node.js v24.19.0, npm 11.17.0  
**Live Local Ollama:** v0.32.9 on `http://127.0.0.1:11434` (`llama3.1:8b`)  
**Target Audience:** Claude Code / Engineering Handoff  

---

## 1. Test Framework Inventory & Configuration

| Suite Type | Framework | Config File | Root Directory | Scope |
|---|---|---|---|---|
| **Unit & Integration** | Vitest v3.2.7 | `vitest.config.ts` | `apps/server/tests/`, `packages/*/tests/` | 12 test files, 59 tests |
| **End-to-End Browser** | Playwright v1.50+ | `playwright.config.ts` | `e2e/` | 4 test files, 5 browser specs |
| **Monorepo Build** | TypeScript `tsc` & Vite | `tsconfig.base.json`, `apps/*/tsconfig.json` | Monorepo root | 3 packages, 2 apps |

---

## 2. Practical Verification Table

| Test / Command | What It Validates | Dependencies | Safe to Run? | Actually Executed? | Genuine Result | What It Does NOT Prove |
|---|---|---|---|---|---|---|
| `npm run build` | TypeScript type-checking and production bundling across packages & apps. | None | Yes | **YES** | Exited `0` in **540ms** | Does not prove runtime behavior or API availability. |
| `npm test` | Runs all 12 Vitest suites: health, policy, providers, snapshots, IDE bridge, loop. | In-memory SQLite (`:memory:`) | Yes | **YES** | **59/59 passed** in **6.49s** | Many tests use `Deterministic Test Mock Agent` instead of live LLMs. |
| `npx playwright test` | Multi-viewport rendering, drawer toggles, SSE stream, smoke run controls. | Fastify server (4317), Vite (5173) | Yes | **YES** | **5/5 passed** in **25.3s** | Uses mock/seeded database; does not wait for full LLM code generation. |
| `node scratch/run-smoke-test-visible-ide.js` | Real autonomous coding loop in Visible IDE mode in disposable non-Git folder. | Live Ollama (`llama3.1:8b`) on `127.0.0.1:11434` | Yes | **YES** | **PASSED in 14.7s**; created 4 files, tests passed | Does not test official `agy` CLI binary or external cloud OpenAI. |

---

## 3. Detailed Vitest Suite Breakdown (12 Suites, 59 Tests)

1. `apps/server/tests/health.test.ts` (2 tests) — `GET /health` and basic status.
2. `packages/policy-schema/tests/policy.test.ts` (3 tests) — Policy evaluation and path restriction rules.
3. `apps/server/tests/milestone1.test.ts` (3 tests) — Run lifecycle state machine, idempotency, event stream replay.
4. `apps/server/tests/milestone2.test.ts` (8 tests) — Reasoning provider switching, token ledger, budget enforcement.
5. `apps/server/tests/milestone3.test.ts` (4 tests) — Vertical slice failure-repair loop, BrowserVerifier screenshot assertions.
6. `apps/server/tests/milestone4.test.ts` (6 tests) — Project context builder, blueprint ingestion, memory manager.
7. `apps/server/tests/milestone5.test.ts` (5 tests) — Critic review schema validation, repair instructions feeding.
8. `apps/server/tests/milestone6.test.ts` (5 tests) — Stagnation detection, loop termination, max attempts boundary.
9. `apps/server/tests/milestone7.test.ts` (4 tests) — Secret redactor, process supervisor, signal abort cancellation.
10. `apps/server/tests/ide-integration.test.ts` (9 tests) — IdeDetector process detection, storage.json workspace parsing, bridge state pipeline.
11. `apps/server/tests/real-world-e2e.test.ts` (2 tests) — Complete autonomous loop with mock agent in Git workspace.
12. `apps/server/tests/git-optional-and-snapshots.test.ts` (8 tests) — SnapshotManager hashing, diff generation, rollback in non-Git folders.

---

## 4. Tests Providing Misleading Assurance

Claude Code must be aware of tests that appear to validate a feature but actually use mocks:
1. **`ide-integration.test.ts` Test 9 ("Executes complete autonomous loop in Visible IDE mode"):**
   - Uses `mockAgentTestResult: { success: true }` and `mockProcesses`. It validates the bridge state machine, but does not execute live code generation.
2. **`real-world-e2e.test.ts` ("Real Autonomous Coding Task"):**
   - Dispatches to a mock agent returning pre-scripted file strings. It validates the AcceptanceGate and loop transitions, not the actual reasoning model.
3. **`milestone2.test.ts` ("supports querying and switching active provider"):**
   - Connects to an in-memory test provider; does not validate real network calls to OpenAI.

The only test that proves real end-to-end LLM code generation is the **standalone smoke test** recorded in `artifacts/smoke-test-visible-ide-evidence.json`.
