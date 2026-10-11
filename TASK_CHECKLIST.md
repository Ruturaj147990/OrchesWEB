# Master Task Checklist

## Milestone 0 — Repository Foundation
- [x] Inspect environment, OS, node, npm, git status.
- [x] Create root `package.json` with npm workspaces (`apps/*`, `packages/*`).
- [x] Create `tsconfig.base.json` with TypeScript `strict: true`.
- [x] Create `packages/shared-types` with initial domain interfaces.
- [x] Create `apps/server` (Fastify/Express, loopback 127.0.0.1:4317, `/api/v1/health` endpoint, origin/CSRF protection foundation).
- [x] Create `apps/web` (React + Vite + TypeScript, custom design system, dashboard shell).
- [x] Create `.env.example`, `README.md`, `SECURITY.md`.
- [x] Add Vitest test runner for server and shared packages; verify unit tests pass.
- [x] Add Playwright browser test harness for web dashboard smoke test; verify test runs and captures baseline screenshot.
- [x] Commit Milestone 0 checkpoint.

## Milestone 1 — Persistence and Bare Control Dashboard
- [x] Create SQLite storage engine with WAL mode and database migration runner.
- [x] Implement initial migration: `projects`, `runs`, `tasks`, `events`, `artifacts`, `approvals`, `budgets`, `provider_profiles`.
- [x] Implement Project Service & minimal project creation API (`POST /api/v1/projects`, `GET /api/v1/projects`, `GET /api/v1/projects/:id`).
- [x] Implement durable event store and Server-Sent Events (SSE) streaming endpoint (`GET /api/v1/projects/:id/events`) with cursor replay.
- [x] Implement Run state machine and lifecycle controls (`POST /api/v1/projects/:id/runs`, `pause`, `stop`, `resume`) with idempotency.
- [x] Build control dashboard in `apps/web` showing run state, current task, provider badges, budget usage, and working Start/Pause/Stop controls.
- [x] Run automated tests for persistence, state transitions, event replay, and browser control.
- [x] Commit Milestone 1 checkpoint.

## Milestone 2 — Minimum Real Provider and Coding-Agent Adapters
- [x] Create normalized `ReasoningProvider` interface and provider registry.
- [x] Implement OpenAI API provider adapter.
- [x] Implement OpenAI-compatible local endpoint adapter (Ollama/llama.cpp/vLLM) with Local-only enforcement (no silent fallback).
- [x] Implement official Antigravity CLI adapter (`agy` capability probe, headless invocation, event parsing, safe timeout/cancellation).
- [x] Implement deterministic `MockAgentAdapter` for reliable automated testing.
- [x] Define and implement strict Zod schemas for Planner output, Executor task context & response, and Critic review.
- [x] Implement preliminary token/usage tracker and budget enforcement hooks.
- [x] Run provider and adapter test suite.
- [x] Commit Milestone 2 checkpoint.

## Milestone 3 — Early Autonomous Vertical Slice (Mandatory Proof Point)
- [x] Implement compact Planner context builder (`SPEC.md`, `DECISIONS.md`, `ROADMAP.md`, `REPO_MAP.md`, current state, budget).
- [x] Implement Planner invocation emitting roadmap-linked task contract with acceptance criteria.
- [x] Implement Git task branch/worktree isolation manager (`orchestrator/<project-id>/<task-id>/attempt-<n>`).
- [x] Implement execution dispatch to coding agent (fresh session per attempt).
- [x] Implement independent orchestrator verification runner (lint, typecheck, test, build with actual argv, exit code, duration, log truncation).
- [x] Implement Playwright BrowserVerifier for web/UI tasks (supervised server start, headless browser assertions, console/network capture, screenshots).
- [x] Implement independent Critic review invocation (diff + verification evidence -> verdict: accept / repair / reject).
- [x] Implement deterministic acceptance gate (mandatory checks + criteria evidence + Critic accept + safe Git checkpoint commit & integration).
- [x] Implement bounded repair loop on verifier/Critic failure with fresh context.
- [x] Implement hard budget stop before model/agent dispatch.
- [x] Verify vertical slice with comprehensive test suite: failure -> repair -> success -> commit; UI screenshot capture; budget cut-off; crash restart resumption.
- [x] Commit Milestone 3 checkpoint.

## Milestone 4 — Cost Accuracy, Reliability, Context Compaction, and Recovery
- [x] Implement pricing catalogue & cost estimation service (Planner + Executor + Critic + repair reserve).
- [x] Configure beginner default budgets ($0.50 warning, $2.00 hard task ceiling, $10.00 hard run ceiling).
- [x] Implement cost state labelling (`measured`, `estimated`, `reserved`, `unknown`, `local_no_api_charge`).
- [x] Implement stagnation and cycle detection (consecutive no-diff, repeated error hashes, edit ping-pong).
- [x] Implement context compaction & rolling summaries for memory persistence.
- [x] Implement process supervisor & orphan cleanup on restart.
- [x] Run resilience and cost tests.
- [x] Commit Milestone 4 checkpoint.

## Milestone 5 — Project Wizard, Autonomy Modes, Profiles, and Blueprint Import
- [x] Implement 6-step project wizard UI & API.
- [x] Implement 3 autonomy modes (Creative within constraints, Creative exploration, Strict blueprint adherence).
- [x] Implement built-in project profile presets (Frontend, Backend, Fullstack, AI/ML, CLI, Data Science, Embedded, General).
- [x] Implement multi-format blueprint importer (.md, .txt, .json, .yaml, .pdf, .docx) with size limits and provenance tracking.
- [x] Implement requirement extraction with source attribution and candidate approval workflow.
- [x] Implement hard/soft constraint engine with contradiction detection.
- [x] Commit Milestone 5 checkpoint.

## Milestone 6 — Human Direction and Full Browser/Visual Verification
- [x] Implement human direction inbox (`next_task`, `replan`, `safe_interrupt`, approvals/rejections).
- [x] Wire safe-boundary interrupts into the execution loop.
- [x] Expand BrowserVerifier: desktop/mobile viewports, visual baseline comparison, accessibility smoke checks.
- [x] Implement visual evidence review in Critic.
- [x] Build task inspector in web UI showing screenshots, code diffs, logs, verifier evidence, and Critic findings.
- [x] Commit Milestone 6 checkpoint.

## Milestone 7 — Advanced UI, Export, and Hardening
- [x] Implement searchable timeline and logs viewer.
- [x] Implement run report generation and project memory export.
- [x] Complete provider settings screen with capability indicators and privacy badges.
- [x] Accessibility, responsiveness, and security hardening (loopback binding verification, path traversal checks).
- [x] Final end-to-end verification and documentation update.
- [x] Commit Milestone 7 checkpoint.

## Visible Antigravity IDE Integration
- [x] Implement `IdeDetector`: detect running Antigravity IDE processes, read VS Code storage (`storage.json` & `workspaceStorage`), decode file URIs, resolve canonical paths, validate directories.
- [x] Implement multi-window and multi-workspace support with directory validation and workspace selection.
- [x] Implement `IdeBridge` 6-stage visible verification workflow:
  `IDE Detected ➔ Workspace Identified ➔ Connection Established ➔ Workspace Confirmed ➔ Agent Tested ➔ Ready`.
- [x] Prohibit task dispatch and explain failures if any connection or workspace check fails.
- [x] Implement `VisibleIdeAdapter`: execute planner prompts directly targeting verified visible workspace with live editor synchronization.
- [x] Preserve Headless CLI (`agy`) as an explicit optional alternative.
- [x] Route tasks to verified workspace and implement Git cleanliness safety guard (`run.dirty_workspace`) to prevent overwriting user edits.
- [x] Synchronize autonomous development loop: send planner prompts, capture visible edits, run independent tests, invoke Critic, commit checkpoints.
- [x] Build interactive `IdeConnectionDeck` UI component in dashboard with stage progress, workspace picker, status badges, and controls.
- [x] Implement REST API routes (`/api/v1/ide/*`).
- [x] Implement comprehensive unit and integration tests (9/9 passed in `ide-integration.test.ts`).
- [x] Implement Playwright E2E browser tests (2/2 passed in `e2e/ide-integration.spec.ts` & `e2e/smoke.spec.ts`).

## Single-Destination Dashboard & Unattended Goal Completion (Sections 1-10)
- [x] Absolute navigation requirement: Zero permanent sidebar. Unified single dashboard at `/`.
- [x] Compact top header with brand title, project selector (+ Add wizard), live badges (reasoning, agent, workspace match, backend online), dark/light theme toggle, and settings button.
- [x] Project summary strip: project name, objective, canonical workspace path with copy action, autonomy mode badge.
- [x] System readiness and run status strip: run status badge, 5-phase lifecycle stepper (Planning -> Execution -> Verification -> Review -> Acceptance), attempts counter, cost ceiling ($0.00 / $10.00), and verifier summary.
- [x] Two-column main layout: searchable/filterable live activity timeline on the left; active task card, live execution logs, and embedded `IdeConnectionDeck` on the right.
- [x] Persistent human-direction composer mounted below main grid.
- [x] Bottom contextual action strip: run controls (Start, Pause, Resume, Stop) and contextual drawer triggers (History, Git & Diff, Diagnostics, Policies, Export).
- [x] Reusable slideout `Drawer` component with frosted glass backdrop blur and keyboard `Escape` dismiss.
- [x] Multi-viewport responsive audit across 4 viewports (Desktop 1440×900, Laptop 1280×720, Tablet 1024×768, Mobile 390×844) verified with visual artifacts in `artifacts/ui-audit/iteration-1/`.
- [x] Deployment Readiness Gate: 12 release criteria evaluated and confirmed in `DEPLOYMENT_READINESS_REPORT.md`.
- [x] Post-Readiness Codebase Cleanup: safe removal of 8 legacy multi-page sidebar views (1,870 lines of dead code pruned), extraction of centralized web types into `apps/web/src/types.ts`, verified with `CLEANUP_REPORT.md`.
- [x] Forensic Audit Resolutions & Explicit Reasoning Engine (Sections 1-22):
  - [x] Test environment isolation: isolated `settings.json` and DB directories; zero host `%APPDATA%` pollution; regression verified in `milestone2.test.ts`.
  - [x] Local Ollama cold-start handling: native `/api/tags` probing, normalized completions URL, configurable timeout up to 300s, clear explanatory error feedback.
  - [x] Explicit Reasoning Engine selector: always-visible top-bar segmented toggle `[ OpenAI API ] [ Local Ollama ]` with honest live status pills, compact configuration drawer, and zero silent cloud fallback in Local mode.
  - [x] Scoped Git staging and safe rollback: task diffs staged strictly via `scopedPaths`, rollbacks discard only attempt-specific edits via `filesToDiscard`, active workspace never force-reset.
  - [x] Credential persistence security: `.env` mutation eliminated; API keys stored safely in `settings.json` and masked in all responses (`sk-proj-••••...1234`).
  - [x] Windows process safety: PowerShell process detection uses scoped `-ExecutionPolicy Bypass -NoProfile` without global policy weakening.
  - [x] Post-cleanup regression verification: 100% passing tests (51/51 Vitest, 4/4 Playwright, monorepo build exits 0).
