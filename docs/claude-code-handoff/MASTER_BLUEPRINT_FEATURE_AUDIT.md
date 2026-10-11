# Master Blueprint Feature Audit & Traceability Matrix

Document: `Autonomous_Development_Orchestrator_MVP_Blueprint_FINAL.md`  
Audit Session: Antigravity AI, 2026-10-11  
Branch: `main`  
Baseline Commits: `3e98866`, `99dad94`, `cffb351`

---

## 1. Executive Summary

The master blueprint (`Autonomous_Development_Orchestrator_MVP_Blueprint_FINAL.md`) specifies an autonomous development orchestrator coordinating a **Project Reasoning Brain** (OpenAI / Ollama) and a **Coding Agent** (Native Antigravity Agent via Orches Bridge or Built-in Coder) inside a safe local execution loop.

While the core execution pipeline (snapshot safety, project-aware verification, deterministic acceptance gate, in-place repair loop, and the native Antigravity Bridge extension) is verified and functional, several critical blueprint capabilities were either stripped during earlier hardening or left disconnected from the prompt-generation pipeline:
1. **Prescriptive Micro-Prompts vs. Engineering Briefs**: The reasoning model was generating file-by-file micro-instructions or full code payloads rather than comprehensive engineering briefs.
2. **Creativity & Autonomy Modes**: The three distinct autonomy modes specified in the blueprint (`creative_within_constraints`, `creative_exploration`, and `strict_blueprint_adherence`) were present as type enums in shared types but disconnected from project persistence, API updates, reasoning prompts, and the UI.
3. **Master Blueprint Upload & Extraction**: Blueprint document ingestion (`.md`, `.txt`, `.json`, `.yaml`, `.pdf`, `.docx`) and requirement extraction had been removed as dead code, preventing users from attaching blueprints to guide tasks.
4. **Project Profiles & Preferences**: All 10 domain profiles from Blueprint Section 27 (`general`, `frontend`, `backend`, `fullstack`, `ai_ml`, `data_science`, `cli_tool`, `embedded_iot`, `docs_research`, `custom`) were stripped down to a generic file inspector without domain engineering guidelines feeding the reasoning model.

This audit documents the status of every major blueprint capability, establishes the gap analysis, and details the restoration plan.

---

## 2. Feature Traceability Matrix

| # | Master Blueprint Feature | Blueprint Section | User Perspective | UI Status | Backend Pipeline Status | Prompt Contribution | Audit Status | Required Action / Remediation |
|---|-------------------------|-------------------|------------------|-----------|-------------------------|---------------------|--------------|-------------------------------|
| 1 | **Autonomous Execution Loop** (Plan → Code → Verify → Review → Gate) | §11, §13 | User enters a task; system coordinates reasoning, execution, verification, and acceptance. | Complete (Task composer, live phases, results) | Complete (`run-pipeline.ts`, `state-machine.ts`) | Complete | `COMPLETE` | Preserve baseline. Do not break pipeline. |
| 2 | **Native Antigravity Agent Integration** | §8, §31 | Antigravity IDE executes coding tasks via native agent panel without Orches overwriting code directly. | Complete (Agent status, transcript display) | Complete (`antigravity-agent-adapter.ts`, `extension.js`, protobuf parser) | Partial (Prompt was micro-instruction) | `PARTIAL` | Upgrade prompt from prescriptive micro-command to comprehensive engineering brief. |
| 3 | **Built-in Fallback Coder** | §8, §31 | Reasoning model writes whole files when Antigravity is not reachable. | Complete (Settings toggle) | Complete (`builtin-coder.ts`) | Complete (Full file blocks) | `COMPLETE` | Preserve as alternative coding mechanism. |
| 4 | **Reasoning Provider Selection** (OpenAI / Ollama) | §9 | Switch between OpenAI cloud models and local Ollama offline models. | Complete (Settings dialog, health indicators) | Complete (`openai-provider.ts`, `ollama-native.ts`) | Complete | `COMPLETE` | Preserve active provider routing and health checks. |
| 5 | **Workspace Safety & Snapshots** | §6, §21, §22 | Files are snapshot outside workspace; rolled back on failure/cancel; current branch preserved. | Complete (Git branch / safety mode badges) | Complete (`snapshot-store.ts`, `git-manager.ts`) | N/A | `COMPLETE` | Preserve external snapshots and scoped rollback. |
| 6 | **Deterministic Verification Gate** | §13, §14 | Real tests (npm, pytest, cargo, go) run and evaluated; agent claims alone never accepted. | Complete (Check results, before/after diffs) | Complete (`acceptance-gate.ts`, `runner.ts`) | Complete | `COMPLETE` | Preserve regression rejection and static validation. |
| 7 | **In-Place Repair Loop** | §11.3 | Failed attempts build on previous files with focused error feedback rather than repeated clean slates. | Complete (Attempt tabs, blockers list) | Complete (`run-pipeline.ts`, `focusOutput`) | Complete | `COMPLETE` | Preserve in-place repair and error feedback. |
| 8 | **Intelligent Prompt Generation Architecture** | §3, §12, §13.2 | Reasoning model constructs a comprehensive engineering brief in natural language rather than code blocks to copy. | Missing (Shows raw instruction) | Broken (Produced prescriptive code payloads) | Broken (Did not act as tech lead) | `BROKEN` | Overhaul `instructor.ts` to generate comprehensive engineering briefs with architecture, requirements, risks, and verification. |
| 9 | **Creativity / Autonomy Modes** (3 Modes) | §11, §25, §27, §31 | Choose between Creative with constraints, Creative exploration, and Strict blueprint adherence. | Missing (No selector in UI) | Partial (Types exist, not in Project updates or prompts) | Missing (Prompt didn't adapt to mode) | `MISSING` | Wire into Project repo, DB, API, UI dialogs, reasoning prompts, and repair iterations. |
| 10 | **Master Blueprint Document Upload** | §16, §18, §31 | Upload `.md`, `.txt`, `.json`, `.yaml`, `.pdf`, `.docx` specifying complete project architecture. | Missing (Stripped) | Missing (Stripped in `3e98866`) | Missing (No blueprint context in prompt) | `MISSING` | Re-implement `BlueprintImporter`, `RequirementExtractor`, database tables, API routes, UI dialog, and prompt injection. |
| 11 | **Requirement Extraction & Provenance** | §16, §31 | Extract candidate requirements with explicit/inferred status, source reference, and acceptance tests. | Missing (Stripped) | Missing (Stripped) | Missing | `MISSING` | Extract requirements from blueprint, store in SQLite, inject into planning and engineering briefs. |
| 12 | **Project Profiles & Domain Preferences** (10 Profiles) | §27, §31 | Select domain profile (AI/ML, Full-stack, Frontend, Backend, CLI, etc.) influencing guidance. | Missing (Only file stats) | Partial (ProfileId in schema, no domain guidance) | Missing (No profile-specific engineering rules) | `MISSING` | Implement all 10 profiles with domain guidelines, focus areas, API routes, UI selection, and prompt integration. |
| 13 | **Automated Large-Prompt Workflow** | §3, §11, §31 | User supplies large multi-faceted project prompt; orchestrator synthesizes comprehensive brief. | Partial (Textarea takes 20k chars) | Partial (Truncated context, micro-prompted) | Partial | `PARTIAL` | Support large-prompt synthesis without file fragmentation or copy-paste code micromanagement. |
| 14 | **Budget Controls & Cost Ledger** | §10.3, §20 | Track API cost; enforce $2 cloud run ceiling; atomic spend tracking. | Partial (Ledger exists, cost ceiling active) | Complete (`usage-ledger.ts`) | N/A | `COMPLETE` | Preserve spend cap and ledger recording. |
| 15 | **Operator Guidance (Human-in-the-loop)** | §12 | Provide live operator notes during active run for subsequent attempts. | Complete (Input in composer during run) | Complete (`inbox-service.ts`) | Complete | `COMPLETE` | Preserve guidance consumption into instructor. |
| 16 | **Process & Crash Recovery** | §11, §20 | Process-tree kill (`taskkill /T /F`), rollback on stop/abort, recovery of interrupted runs on boot. | Complete (Stop button, status notifications) | Complete (`run-manager.ts`, `process-runner.ts`) | N/A | `COMPLETE` | Preserve process cleanup and recovery. |

---

## 3. Deep Dive: Missing & Broken Capabilities

### 3.1 Prompt Generation Architecture (Broken → Restored)
* **Blueprint Requirement (§3, §13.2)**: The Project Brain must act as the technical lead/systems architect. The reasoning model produces a comprehensive engineering brief describing *what* must be accomplished, architectural approach, interfaces, constraints, and verification criteria. The coding agent independently implements code changes using native tools.
* **Failure State**: `instructor.ts` asked the model to name files and frequently led to small models emitting prewritten file code payloads or micro-instructions like "Write file X with code Y".
* **Corrected Architecture**:
  - `composeInstruction` produces a structured markdown **Engineering Brief**:
    1. Executive Summary & Objective
    2. Architecture & System Design Guidance
    3. Technical Specifications & Constraints (incorporating Autonomy Mode & Project Profile)
    4. Blueprint Requirements & Provenance
    5. Workspace Investigation & Implementation Scope (guiding the agent to inspect conventions)
    6. Verification & Quality Expectations
    7. (On repair): Root Cause Analysis & Corrective Actions based on actual check failures.
  - Explicit instruction prevents code dumping: "DO NOT output complete source files or copy-paste payloads. Antigravity will independently inspect and code."

### 3.2 Autonomy & Creativity Modes (Missing → Restored)
* **Blueprint Requirement (§11, §25, §27, §31)**:
  - **Creative within constraints** (`creative_within_constraints`, default): Explores innovative, robust solutions while strictly respecting user requirements, existing project architecture, technical boundaries, and safety policies.
  - **Creative exploration / without constraints** (`creative_exploration`): Greater architectural autonomy. Soft preferences or conventions may be re-evaluated if a superior alternative exists. Clearly articulates trade-offs while keeping core objectives and safety non-negotiable.
  - **Strict blueprint adherence** (`strict_blueprint_adherence`): Prioritizes exact, faithful implementation of specified requirements and blueprint specifications. Discourages unsolicited features, refactoring, or redesign.
* **Restoration**:
  - Added to database schema, `ProjectRepository` update/create, API routes.
  - Selectable in project creation and edit dialogs.
  - Prompts in `composeInstruction` explicitly include mode directives and behavioral rules.
  - Mode persists across all repair attempts.

### 3.3 Master Blueprint Upload & Requirement Extraction (Missing → Restored)
* **Blueprint Requirement (§16, §18, §31)**:
  - Import `.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.pdf`, `.docx` up to 10MB.
  - Safely parse text without executing code or evaluating unsafe macros.
  - Extract candidate requirements with provenance (`filename:line`, `explicit` vs `inferred`, candidate acceptance tests).
  - Store blueprints and requirements in SQLite per project.
  - Feed extracted requirements and architecture into planning (`planTask`) and engineering briefs (`composeInstruction`).
* **Restoration**:
  - `BlueprintImporter`: multi-format document parser with size limits.
  - `RequirementExtractor`: rule-based extraction of explicit and inferred requirements with provenance.
  - Database tables: `project_blueprints` and `project_requirements`.
  - API endpoints: upload, list, delete blueprints; list, update requirements.
  - UI: Blueprint management dialog with file upload, requirements list, and provenance badges.

### 3.4 Project Profiles (10 Domain Profiles) (Missing → Restored)
* **Blueprint Requirement (§27)**:
  - 10 distinct profiles: `general`, `frontend`, `backend`, `fullstack`, `ai_ml`, `data_science`, `cli_tool`, `embedded_iot`, `docs_research`, `custom`.
  - Each profile provides tailored technical guidelines and focus areas:
    - `ai_ml`: data provenance, train/test leakage checks, random seeds, evaluation metrics, inference smoke test.
    - `fullstack`: client/server contracts, API consistency, error/loading states, isolated test services, environment variables.
    - `frontend`: accessibility, responsive viewports, component/interaction tests, browser validation.
    - `backend`: payload validation, error envelopes, API schema consistency, auth, timeout, migrations.
    - `cli_tool`: help/usage output, exit codes, invalid argument handling, platform path behavior.
    - `data_science`: data schema validation, reproducible pipelines, assumption documentation.
    - `embedded_iot`: target hardware constraints, compiler toolchain, simulated vs physical testing.
    - `docs_research`: source attributions, facts vs assumptions, link verification.
* **Restoration**:
  - Built-in profile registry in `project-profiles.ts`.
  - Project configuration stores `profileId`.
  - Reasoning prompts integrate domain guidelines into the engineering brief.
  - UI dropdown in project dialogs.

---

## 4. Verification & Testing Strategy

1. **Unit & Domain Tests**:
   - `blueprint-and-modes.test.ts`: Tests multi-format blueprint parsing, requirement extraction, persistence, and API routes.
   - `prompt-generation.test.ts`: Tests that each autonomy mode distinctly shapes reasoning prompts, that project profiles impart domain-specific guidance, and that blueprint requirements persist across iterations.
2. **Regression Testing**:
   - Run the entire existing test suite (`npm test`) to verify all 75 baseline tests pass with zero regressions.
3. **Build & Typecheck**:
   - `npm run build` and `npm run lint` across server and web workspaces.
4. **End-to-End Pipeline Integrity**:
   - Closed-loop execution test verifying Antigravity Agent receives comprehensive engineering brief and reports back.

---
*Status: In Progress — Implementation active.*
